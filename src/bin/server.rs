use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use rand::seq::SliceRandom;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{self, BufRead},
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

#[path = "server/identity.rs"]
mod identity;
use identity::{Admins, Identity, join_identity, normalize_id};

#[tokio::main]
async fn main() {
    let address = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "0.0.0.0:8765".into());
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .expect("could not bind server address");
    let port = listener
        .local_addr()
        .expect("could not read server address")
        .port();
    let admin_path = PathBuf::from(format!("blunderjack-admins-{port}.txt"));
    let legacy_admin_path = PathBuf::from(format!("blackjack-admins-{port}.txt"));
    if !admin_path.exists() && legacy_admin_path.exists() {
        std::fs::copy(&legacy_admin_path, &admin_path)
            .expect("could not migrate server administrators");
    }
    let admins = Admins::load(admin_path).expect("could not load server administrators");
    let (tx, rx) = mpsc::channel(256);
    tokio::spawn(room(rx, admins));
    let console_tx = tx.clone();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(command) => {
                    if console_tx.blocking_send(Event::Console(command)).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    eprintln!("Could not read console input: {err}");
                    break;
                }
            }
        }
    });
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(upgrade))
        .fallback(get(asset))
        .with_state(tx);
    eprintln!("BlunderJack server version: {}", blunderjack::GAME_VERSION);
    eprintln!("Listening on http://{}", listener.local_addr().unwrap());
    eprintln!("Waiting for game_start in this console.");
    axum::serve(listener, app).await.expect("server failed");
}

async fn asset(uri: Uri) -> Response {
    match blunderjack::client_assets::get(uri.path()) {
        Some((content_type, bytes)) => {
            let mut response = Response::new(axum::body::Body::from(bytes));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                header::HeaderValue::from_static(content_type),
            );
            response.headers_mut().insert(
                header::X_CONTENT_TYPE_OPTIONS,
                header::HeaderValue::from_static("nosniff"),
            );
            if uri.path() == "/" || uri.path() == "/index.html" {
                response.headers_mut().insert(
                    header::CONTENT_SECURITY_POLICY,
                    header::HeaderValue::from_static(
                        blunderjack::client_assets::CONTENT_SECURITY_POLICY,
                    ),
                );
            }
            response
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn upgrade(ws: WebSocketUpgrade, State(tx): State<mpsc::Sender<Event>>) -> Response {
    ws.max_message_size(16 * 1024)
        .on_upgrade(move |socket| session(socket, tx))
}

#[derive(Clone)]
struct Session {
    send: mpsc::Sender<String>,
    close: watch::Sender<bool>,
}

async fn session(socket: WebSocket, tx: mpsc::Sender<Event>) {
    let (mut outgoing, mut incoming) = socket.split();
    let (send, mut recv) = mpsc::channel::<String>(32);
    let (close, mut closed) = watch::channel(false);
    let session = Session { send, close };
    let id = rand::random::<u64>();
    if tx
        .send(Event::Connected {
            send: session.clone(),
        })
        .await
        .is_err()
    {
        return;
    }
    let mut allowance = 60.0_f64;
    let mut last = Instant::now();
    let mut server_closed = false;
    let mut ping = tokio::time::interval(Duration::from_secs(4));
    let mut pending_ping: Option<(Vec<u8>, Instant)> = None;
    loop {
        tokio::select! {
            biased;
            _ = closed.changed() => { server_closed = true; break; },
            message = incoming.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    let now = Instant::now();
                    allowance = (allowance + now.duration_since(last).as_secs_f64() * 30.0).min(60.0);
                    last = now;
                    if allowance < 1.0 { break; }
                    allowance -= 1.0;
                    match serde_json::from_str::<Value>(&text) {
                        Ok(value) if value.is_object() => {
                            if tx.send(Event::Message { id, send: session.clone(), value }).await.is_err() { break; }
                        }
                        _ => if !Room::send(&session, json!({"type":"error","message":"Invalid JSON message"})) { break; },
                    }
                }
                Some(Ok(Message::Pong(payload))) => {
                    if let Some((expected, sent)) = &pending_ping {
                        if payload.as_ref() == expected.as_slice() {
                            let latency_ms = (sent.elapsed().as_millis() / 2).min(u128::from(u64::MAX)) as u64;
                            let _ = tx.send(Event::Latency { id, latency_ms }).await;
                            pending_ping = None;
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            _ = ping.tick() => {
                let payload = rand::random::<u64>().to_be_bytes().to_vec();
                let sent = Instant::now();
                if !matches!(tokio::time::timeout(Duration::from_secs(2), outgoing.send(Message::Ping(payload.clone().into()))).await, Ok(Ok(()))) { break; }
                pending_ping = Some((payload, sent));
            },
            message = recv.recv() => match message {
                Some(message) => {
                    if !matches!(tokio::time::timeout(Duration::from_secs(2), outgoing.send(Message::Text(message.into()))).await, Ok(Ok(()))) { break; }
                }
                None => break,
            },
        }
    }
    let close_frame = if server_closed {
        Some(axum::extract::ws::CloseFrame {
            code: 4001,
            reason: "Session replaced or too slow".into(),
        })
    } else {
        None
    };
    let _ = tokio::time::timeout(
        Duration::from_millis(200),
        outgoing.send(Message::Close(close_frame)),
    )
    .await;
    let _ = tx.send(Event::Disconnect { id }).await;
}

enum Event {
    Connected {
        send: Session,
    },
    Console(String),
    Message {
        id: u64,
        send: Session,
        value: Value,
    },
    Disconnect {
        id: u64,
    },
    Latency {
        id: u64,
        latency_ms: u64,
    },
}

struct Player {
    profile: Value,
    identity: Option<Identity>,
    seat: Option<usize>,
    session: Option<u64>,
    sender: Option<Session>,
    disconnected: Option<Instant>,
    look: Option<(u64, Instant)>,
    emoji: Option<(&'static str, Instant)>,
    gaze: Option<(f64, f64, bool)>,
    latency_ms: Option<u64>,
    first: u32,
    second: u32,
    third: u32,
    losses: u32,
}

struct PendingBlunder {
    caller: usize,
    play_id: u64,
    started: Instant,
    deadline: Instant,
}

struct Room {
    music_epoch: Instant,
    music_rotation: u64,
    music_order: Vec<usize>,
    music_next_order: Vec<usize>,
    password: Option<String>,
    admins: Admins,
    players: HashMap<String, Player>,
    game: blunderjack::engine::Game,
    phase: &'static str,
    deadline: Option<Instant>,
    candidate: Option<usize>,
    reveal_until: Option<Instant>,
    pending_blunder: Option<PendingBlunder>,
    logged_round: u32,
    logged_turn: Option<usize>,
    logged_winner: Option<usize>,
    round_players: HashMap<usize, String>,
    scored_placements: usize,
    scored_losses: bool,
    scoreboard_dirty: bool,
}

const SELF_PRANKS: &[&str] = &[
    "grow_head",
    "tiny_head",
    "spin_chair",
    "bounce",
    "disco",
    "pancake",
];

fn reveal_duration(cards: usize) -> Duration {
    // Match the client animation and keep a long hand from holding up the table.
    let step_ms = (4_800 / cards.max(1)).clamp(24, 650);
    Duration::from_millis((cards * step_ms) as u64)
}

impl Room {
    fn new(admins: Admins) -> Self {
        let mut music_order: Vec<usize> = (0..blunderjack::music_catalog::TRACKS.len()).collect();
        let topless = blunderjack::music_catalog::TRACKS
            .iter()
            .position(|(title, _)| *title == "Topless")
            .expect("Topless must be in the music catalog");
        music_order.retain(|&id| id != topless);
        music_order.shuffle(&mut rand::rng());
        music_order.insert(0, topless);
        let music_next_order = Self::next_music_order(&music_order);
        Self {
            music_epoch: Instant::now(),
            music_rotation: 0,
            music_order,
            music_next_order,
            password: None,
            admins,
            players: HashMap::new(),
            game: blunderjack::engine::Game::new(),
            phase: "paused",
            deadline: None,
            candidate: None,
            reveal_until: None,
            pending_blunder: None,
            logged_round: 0,
            logged_turn: None,
            logged_winner: None,
            round_players: HashMap::new(),
            scored_placements: 0,
            scored_losses: false,
            scoreboard_dirty: false,
        }
    }

    fn next_music_order(previous: &[usize]) -> Vec<usize> {
        let excluded = &previous[previous.len().saturating_sub(3)..];
        let mut eligible: Vec<usize> = (0..blunderjack::music_catalog::TRACKS.len())
            .filter(|id| !excluded.contains(id))
            .collect();
        eligible.shuffle(&mut rand::rng());
        let mut order: Vec<usize> = eligible.drain(..3).collect();
        eligible.extend_from_slice(excluded);
        eligible.shuffle(&mut rand::rng());
        order.extend(eligible);
        order
    }

    fn music_clock(&mut self) -> (u64, &[usize], &[usize]) {
        let elapsed = self.music_epoch.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let total_ms: u64 = blunderjack::music_catalog::TRACKS
            .iter()
            .map(|(_, duration)| u64::from(*duration))
            .sum();
        let rotation = elapsed / total_ms;
        while self.music_rotation < rotation {
            self.music_order = std::mem::take(&mut self.music_next_order);
            self.music_next_order = Self::next_music_order(&self.music_order);
            self.music_rotation += 1;
        }
        (elapsed, &self.music_order, &self.music_next_order)
    }

    fn player_label(player: &Player) -> String {
        let name = player.profile["name"].as_str().unwrap_or("?");
        format!("\"{}\"", name.escape_default())
    }

    fn seat_label(&self, seat: usize) -> String {
        self.players
            .values()
            .find(|p| p.seat == Some(seat))
            .map(|p| format!("{} (seat {})", Self::player_label(p), seat + 1))
            .unwrap_or_else(|| format!("seat {}", seat + 1))
    }

    fn log_game_state(&mut self, view: &blunderjack::engine::GameView) {
        if view.round != self.logged_round {
            self.logged_round = view.round;
            self.logged_turn = None;
            self.logged_winner = None;
            eprintln!(
                "Round {} started with {} players.",
                view.round,
                view.active.len()
            );
        }
        if let Some(winner) = view.winner {
            if self.logged_winner != Some(winner) {
                eprintln!("Round {} winner: {}.", view.round, self.seat_label(winner));
                self.logged_winner = Some(winner);
            }
        }
        let turn = if view.finished || view.candidate.is_some() {
            None
        } else {
            view.current
        };
        if turn != self.logged_turn {
            if let Some(seat) = turn {
                eprintln!("Current turn: {}.", self.seat_label(seat));
            }
            self.logged_turn = turn;
        }
    }

    fn token_for(&self, id: u64) -> Option<String> {
        self.players
            .iter()
            .find(|(_, p)| p.session == Some(id))
            .map(|(t, _)| t.clone())
    }

    fn send(send: &Session, value: Value) -> bool {
        if send.send.try_send(value.to_string()).is_err() {
            let _ = send.close.send(true);
            false
        } else {
            true
        }
    }

    fn error(send: &Session, message: &str) {
        Self::send(send, json!({"type":"error","message":message}));
    }

    fn connected_seats(&self) -> Vec<usize> {
        let mut seats: Vec<_> = self
            .players
            .values()
            .filter(|p| p.session.is_some())
            .filter_map(|p| p.seat)
            .collect();
        seats.sort_unstable();
        seats
    }

    fn start_round_tracking(&mut self, seats: &[usize]) {
        self.round_players = self
            .players
            .iter()
            .filter_map(|(token, p)| {
                p.seat
                    .filter(|seat| seats.contains(seat))
                    .map(|seat| (seat, token.clone()))
            })
            .collect();
        self.scored_placements = 0;
        self.scored_losses = false;
    }

    fn score_round(&mut self, view: &blunderjack::engine::GameView) {
        for (index, seat) in view
            .placements
            .iter()
            .enumerate()
            .skip(self.scored_placements)
        {
            if let Some(player) = self
                .round_players
                .get(seat)
                .and_then(|token| self.players.get_mut(token))
            {
                match index {
                    0 => player.first += 1,
                    1 => player.second += 1,
                    2 => player.third += 1,
                    _ => {}
                }
            }
        }
        self.scored_placements = view.placements.len();
        if view.finished && !self.scored_losses {
            for (seat, token) in &self.round_players {
                if !view.placements.contains(seat) {
                    if let Some(player) = self.players.get_mut(token) {
                        player.losses += 1;
                    }
                }
            }
            self.scored_losses = true;
        }
    }

    fn scoreboard(&self, viewer: &str) -> Vec<Value> {
        let mut rows: Vec<_> = self
            .players
            .iter()
            .filter(|(_, p)| p.session.is_some() || p.first + p.second + p.third + p.losses > 0)
            .map(|(token, p)| (token, p))
            .collect();
        rows.sort_by(|(ta, a), (tb, b)| {
            b.first
                .cmp(&a.first)
                .then(b.second.cmp(&a.second))
                .then(b.third.cmp(&a.third))
                .then(a.losses.cmp(&b.losses))
                .then(a.profile["name"].as_str().cmp(&b.profile["name"].as_str()))
                .then(ta.cmp(tb))
        });
        rows.into_iter().map(|(token, p)| json!({"name":p.profile["name"], "first":p.first, "second":p.second, "third":p.third, "losses":p.losses, "latencyMs":p.latency_ms, "connected":p.session.is_some(), "you":token == viewer})).collect()
    }

    fn broadcast_scoreboard(&self) {
        for (token, p) in &self.players {
            if let Some(sender) = &p.sender {
                Self::send(
                    sender,
                    json!({"type":"scoreboard", "scoreboard":self.scoreboard(token)}),
                );
            }
        }
    }

    fn console_command(&mut self, command: &str) {
        let command = command.trim();
        let (verb, argument) = command
            .split_once(char::is_whitespace)
            .map_or((command, ""), |(verb, argument)| (verb, argument.trim()));
        if matches!(verb, "admin_add" | "admin_remove") {
            let Some(id) = normalize_id(argument) else {
                eprintln!("Usage: {verb} <client ID>");
                return;
            };
            let enabled = verb == "admin_add";
            if enabled && id.as_bytes()[14] != b'8' {
                eprintln!("Use the verified client ID from /id on a local or wss:// connection.");
                return;
            }
            match self.admins.set(&id, enabled) {
                Ok(true) if enabled => eprintln!("Admin access granted to {id}."),
                Ok(true) => eprintln!("Admin access revoked for {id}."),
                Ok(false) if enabled => eprintln!("{id} already has admin access."),
                Ok(false) => eprintln!("{id} has no admin access."),
                Err(err) => eprintln!("Could not save administrators: {err}"),
            }
            return;
        }
        if verb == "admin_list" {
            if !argument.is_empty() {
                eprintln!("Usage: admin_list");
            } else {
                let ids = self.admins.list().collect::<Vec<_>>().join(", ");
                if ids.is_empty() {
                    eprintln!("No administrators configured.");
                } else {
                    eprintln!("Administrators: {ids}");
                }
            }
            return;
        }
        if let Some(response) = self.execute_server_command(command) {
            eprintln!("{response}");
        }
    }

    fn execute_server_command(&mut self, command: &str) -> Option<String> {
        let command = command.trim();
        let (verb, target) = command
            .split_once(char::is_whitespace)
            .map_or((command, ""), |(verb, target)| (verb, target.trim()));
        if verb == "password_set" {
            match serde_json::from_str::<String>(target) {
                Ok(password) if password.is_empty() => {
                    self.password = None;
                    return Some("Server password cleared.".into());
                }
                Ok(password) if password.len() <= 1024 => {
                    self.password = Some(password);
                    return Some("Server password set.".into());
                }
                Ok(_) => return Some("Server password is too long (maximum 1024 bytes).".into()),
                Err(_) => {
                    return Some(
                        "Usage: password_set \"password\" (use empty quotes to clear).".into(),
                    );
                }
            }
        }
        if verb == "prank_help" {
            return Some(format!(
                "Prank commands: {}, bomb, teabag.\nUsage: <command> <username> (quote names with spaces if desired), or <command> #<seat number>.\nTwo-player prank: teabag <player1> <player2> (e.g. teabag #1 #3).",
                SELF_PRANKS.join(", ")
            ));
        }
        if verb == "teabag" {
            return Some(self.console_teabag(target));
        }
        if SELF_PRANKS.contains(&verb) || verb == "bomb" {
            return Some(self.console_prank(verb, target));
        }
        let restart = match command.trim() {
            "game_start" if self.phase == "paused" => false,
            "game_start" => {
                return Some("Game already started; use game_restart to deal a new round.".into());
            }
            "game_restart" if self.phase != "paused" => true,
            "game_restart" => {
                return Some("Game has not started; use game_start first.".into());
            }
            "" => return None,
            _ => {
                return Some(
                    "Unknown command. Use game_start, game_restart, password_set, or prank_help."
                        .into(),
                );
            }
        };
        let seats = self.connected_seats();
        if seats.len() < 2 {
            return Some(format!(
                "Cannot {}: at least 2 connected seated players are required ({} present).",
                if restart { "restart" } else { "start" },
                seats.len()
            ));
        }
        match self.game.start(&seats) {
            Ok(()) => {
                self.start_round_tracking(&seats);
                self.phase = "playing";
                self.deadline = None;
                self.candidate = None;
                self.reveal_until = None;
                self.pending_blunder = None;
                self.broadcast();
                Some(format!(
                    "Game {} with {} players.",
                    if restart { "restarted" } else { "started" },
                    seats.len()
                ))
            }
            Err(err) => Some(format!("Could not start round: {err}")),
        }
    }

    fn console_prank(&mut self, effect: &str, target: &str) -> String {
        if target.is_empty() {
            return format!("Usage: {effect} <username> or {effect} #<seat number>.");
        }
        let player = match self.prank_player(target) {
            Ok(player) => player,
            Err(message) => return message,
        };
        let seat = player.seat.unwrap();
        let response = format!(
            "Prank {effect} sent to {} (seat {}).",
            Self::player_label(player),
            seat + 1
        );
        self.broadcast_transient(json!({"type":"prank", "seat":seat, "effect":effect}));
        response
    }

    fn console_teabag(&mut self, args: &str) -> String {
        let mut rest = args.trim_start();
        let mut targets = Vec::new();
        while !rest.is_empty() && targets.len() < 2 {
            let end = if let Some(quoted) = rest.strip_prefix('"') {
                let Some(end) = quoted.find('"') else { break };
                end + 2
            } else {
                rest.find(char::is_whitespace).unwrap_or(rest.len())
            };
            let (target, remaining) = rest.split_at(end);
            if !remaining.is_empty() && !remaining.starts_with(char::is_whitespace) {
                break;
            }
            targets.push(target);
            rest = remaining.trim_start();
        }
        let [source, target] = targets.as_slice() else {
            return "Usage: teabag <player1> <player2>. Quote names with spaces or use #seat."
                .into();
        };
        if !rest.is_empty() {
            return "Usage: teabag <player1> <player2>. Quote names with spaces or use #seat."
                .into();
        }
        let source = match self.prank_player(source) {
            Ok(player) => player,
            Err(message) => return message,
        };
        let target = match self.prank_player(target) {
            Ok(player) => player,
            Err(message) => return message,
        };
        let seat = source.seat.unwrap();
        let target_seat = target.seat.unwrap();
        if seat == target_seat {
            return "Choose two different players for teabag.".into();
        }
        let response = format!(
            "Prank teabag sent to {} (seat {}) and {} (seat {}).",
            Self::player_label(source),
            seat + 1,
            Self::player_label(target),
            target_seat + 1
        );
        self.broadcast_transient(
            json!({"type":"prank", "effect":"teabag", "seat":seat, "targetSeat":target_seat}),
        );
        response
    }

    fn prank_player(&self, target: &str) -> Result<&Player, String> {
        let quoted = target.starts_with('"');
        let name = if quoted {
            match target.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
                Some(name) if !name.is_empty() && !name.contains('"') => name,
                _ => {
                    return Err("Invalid target. Use a quoted username or #<seat number>.".into());
                }
            }
        } else {
            target
        };
        let candidates: Vec<&Player> = self
            .players
            .values()
            .filter(|p| p.session.is_some() && p.seat.is_some())
            .collect();
        let matches: Vec<&Player> = if !quoted && name.starts_with('#') {
            let seat = name[1..]
                .parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1));
            candidates
                .into_iter()
                .filter(|p| p.seat == seat && seat.is_some())
                .collect()
        } else {
            let exact: Vec<_> = candidates
                .iter()
                .copied()
                .filter(|p| p.profile["name"].as_str() == Some(name))
                .collect();
            if exact.is_empty() {
                let folded = name.to_lowercase();
                candidates
                    .into_iter()
                    .filter(|p| {
                        p.profile["name"]
                            .as_str()
                            .is_some_and(|n| n.to_lowercase() == folded)
                    })
                    .collect()
            } else {
                exact
            }
        };
        match matches.as_slice() {
            [player] => Ok(player),
            [] => Err(
                "No connected seated player matches that target. Use prank_help for usage.".into(),
            ),
            _ => Err("Ambiguous player name. Use #<seat number> to choose a player.".into()),
        }
    }

    fn update_phase(&mut self) {
        if self.pending_blunder.is_some() {
            return;
        }
        let now = Instant::now();
        let view = self.game.public();
        if self.phase == "playing" || self.phase == "finishing" {
            if view.finished {
                self.phase = "waiting";
                self.deadline = None;
                self.candidate = None;
            } else if let Some(candidate) = view.candidate {
                if self.phase != "finishing" || self.candidate != Some(candidate) {
                    self.phase = "finishing";
                    self.candidate = Some(candidate);
                    self.deadline = Some(self.reveal_until.unwrap_or(now) + Duration::from_secs(8));
                }
                if self.deadline.is_some_and(|d| now >= d) {
                    self.game.finish();
                    self.phase = if self.game.public().finished {
                        "waiting"
                    } else {
                        "playing"
                    };
                    self.deadline = None;
                    self.candidate = None;
                }
            } else {
                self.phase = "playing";
                self.deadline = None;
                self.candidate = None;
            }
        }
        if self.phase == "waiting" && self.connected_seats().len() >= 2 {
            self.phase = "countdown";
            self.deadline = Some(now + Duration::from_secs(5));
        }
        if self.phase == "countdown" {
            let seats = self.connected_seats();
            if seats.len() < 2 {
                self.phase = "waiting";
                self.deadline = None;
            } else if self.deadline.is_some_and(|d| now >= d) {
                match self.game.start(&seats) {
                    Ok(()) => {
                        self.start_round_tracking(&seats);
                        self.phase = "playing";
                        self.deadline = None;
                        self.reveal_until = None;
                    }
                    Err(err) => {
                        eprintln!("Could not start round: {err}");
                        self.phase = "waiting";
                        self.deadline = None;
                    }
                }
            }
        }
    }

    fn broadcast(&mut self) {
        let view = self.game.public();
        self.score_round(&view);
        let mut seats = vec![Value::Null; 10];
        let mut gestures = vec![Value::Null; 10];
        for p in self.players.values() {
            if let Some(seat) = p.seat {
                seats[seat] = json!({"profile":p.profile,"connected":p.session.is_some()});
                if p.session.is_some() {
                    let look = p.look.and_then(|(session, _)| {
                        self.players
                            .values()
                            .find(|target| target.session == Some(session))
                            .and_then(|target| target.seat)
                    });
                    let emoji = p.emoji.map(|(name, _)| json!({"name":name}));
                    let gaze = p
                        .gaze
                        .map(|(yaw, pitch, zoom)| json!({"yaw":yaw,"pitch":pitch,"zoom":zoom}));
                    if look.is_some() || emoji.is_some() || gaze.is_some() {
                        gestures[seat] = json!({"look":look,"emoji":emoji,"gaze":gaze});
                    }
                }
            }
        }
        let spectators = self
            .players
            .values()
            .filter(|p| p.session.is_some() && p.seat.is_none())
            .count();
        let countdown = if self.phase == "countdown" {
            self.deadline
                .map(|d| d.saturating_duration_since(Instant::now()).as_millis() as u64)
        } else {
            None
        };
        self.log_game_state(&view);
        let pending_blunder = self.pending_blunder.as_ref().map(|pending| json!({
            "caller": pending.caller,
            "playId": pending.play_id,
            "remainingMs": pending.deadline.saturating_duration_since(Instant::now()).as_millis() as u64,
        }));
        let mut dead = Vec::new();
        for (token, p) in &self.players {
            if let Some(sender) = &p.sender {
                let hand = if matches!(self.phase, "playing" | "finishing") {
                    p.seat
                        .filter(|s| view.active.contains(s))
                        .map(|s| self.game.hand(s))
                        .unwrap_or(&[])
                } else {
                    &[]
                };
                let challenge_play_id = p
                    .seat
                    .filter(|_| self.pending_blunder.is_none())
                    .and_then(|s| self.game.challenge_id(s));
                let state = json!({"type":"state","state":{"phase":self.phase,"countdownMs":countdown,"seats":seats,"you":p.seat,"hand":hand,"canBlunder":challenge_play_id.is_some(),"challengePlayId":challenge_play_id,"lastCardRule":true,"pendingBlunder":pending_blunder,"gestures":gestures,"sharedGaze":true,"emojiEmotes":true,"cosmeticReorder":true,"chat":true,"game":view,"spectators":spectators,"scoreboard":self.scoreboard(token)}});
                if !Self::send(sender, state) {
                    dead.push(token.clone());
                }
            }
        }
        let changed = !dead.is_empty();
        for token in dead {
            if let Some(p) = self.players.get_mut(&token) {
                eprintln!("{} disconnected (slow client).", Self::player_label(p));
                p.session = None;
                p.sender = None;
                p.disconnected = Some(Instant::now());
                p.gaze = None;
                p.latency_ms = None;
            }
        }
        if changed {
            self.update_phase();
            self.broadcast();
        }
    }

    // Transient events use the same bounded queues and slow-client cleanup as full state.
    fn broadcast_transient(&mut self, message: Value) {
        let mut dead = Vec::new();
        for (token, player) in &self.players {
            if let Some(sender) = &player.sender {
                if !Self::send(sender, message.clone()) {
                    dead.push(token.clone());
                }
            }
        }
        if !dead.is_empty() {
            for token in dead {
                let player = self.players.get_mut(&token).unwrap();
                eprintln!("{} disconnected (slow client).", Self::player_label(player));
                player.session = None;
                player.sender = None;
                player.disconnected = Some(Instant::now());
                player.gaze = None;
            }
            self.update_phase();
            self.broadcast();
        }
    }

    fn chat(&mut self, token: &str, send: &Session, value: &Value) {
        let Some(raw) = value.get("message").and_then(Value::as_str) else {
            Self::chat_notice(send, "Invalid chat message.");
            return;
        };
        let message = raw.trim();
        if message.is_empty() || message.chars().count() > 280 || raw.chars().any(char::is_control)
        {
            Self::chat_notice(
                send,
                "Chat must be 1-280 characters and contain no control characters",
            );
            return;
        }
        if let Some(command) = message.strip_prefix('/') {
            self.chat_command(token, send, command);
        } else {
            let name = self.players[token].profile["name"]
                .as_str()
                .unwrap_or("?")
                .to_owned();
            self.broadcast_transient(json!({"type":"chat", "name":name, "message":message}));
        }
    }

    fn chat_notice(send: &Session, message: &str) {
        Self::send(send, json!({"type":"chat_notice", "message":message}));
    }

    fn chat_command(&mut self, token: &str, send: &Session, command: &str) {
        let command = command.trim();
        let (verb, args) = command
            .split_once(char::is_whitespace)
            .map_or((command, ""), |(verb, args)| (verb, args.trim()));
        if verb == "id" {
            if !args.is_empty() {
                Self::chat_notice(send, "Usage: /id");
            } else if let Some(identity) = &self.players[token].identity {
                let status = if !identity.verified {
                    "unverified. Use a local or wss:// connection for admin commands"
                } else if self.admins.contains(&identity.id) {
                    "verified admin"
                } else {
                    "verified"
                };
                Self::chat_notice(send, &format!("Client ID: {} ({status})", identity.id));
            } else {
                Self::chat_notice(send, "Update your client to get a persistent ID.");
            }
            return;
        }
        if verb == "admin" || matches!(verb, "game_start" | "game_restart" | "password_set") {
            self.admin_chat(token, send, if verb == "admin" { args } else { command });
            return;
        }
        let mut parts = args.split_whitespace();
        let argument = parts.next();
        if verb == "prank_help" {
            if argument.is_none() {
                Self::chat_notice(
                    send,
                    &format!(
                        "Pranks: /{}. Use /bomb #N or /teabag #N to target another connected player's seat.",
                        SELF_PRANKS.join(", /")
                    ),
                );
            } else {
                Self::chat_notice(send, "Usage: /prank_help");
            }
            return;
        }
        let targeted = matches!(verb, "bomb" | "teabag");
        if !targeted && !SELF_PRANKS.contains(&verb) {
            Self::chat_notice(
                send,
                "Unknown command. Use /prank_help for available commands.",
            );
            return;
        }
        if targeted != argument.is_some() || parts.next().is_some() {
            Self::chat_notice(
                send,
                if targeted {
                    "Usage: /bomb #N or /teabag #N"
                } else {
                    "This prank takes no arguments."
                },
            );
            return;
        }
        let Some(seat) = self.players[token].seat else {
            Self::chat_notice(send, "You must be seated to use a prank.");
            return;
        };
        if let Some(argument) = argument {
            let target = argument.strip_prefix('#').unwrap_or(argument);
            let target_seat = target.parse::<usize>().ok().and_then(|n| n.checked_sub(1));
            let Some(target_seat) = target_seat.filter(|target| {
                *target != seat
                    && self
                        .players
                        .values()
                        .any(|p| p.seat == Some(*target) && p.session.is_some())
            }) else {
                Self::chat_notice(send, "Choose another connected player's seat number.");
                return;
            };
            if verb == "teabag" {
                self.broadcast_transient(
                    json!({"type":"prank", "effect":verb, "seat":seat, "targetSeat":target_seat}),
                );
            } else {
                self.broadcast_transient(
                    json!({"type":"prank", "effect":verb, "seat":target_seat}),
                );
            }
        } else {
            self.broadcast_transient(json!({"type":"prank", "effect":verb, "seat":seat}));
        }
    }

    fn admin_chat(&mut self, token: &str, send: &Session, command: &str) {
        let Some(identity) = self.players[token]
            .identity
            .as_ref()
            .filter(|id| id.verified)
        else {
            Self::chat_notice(
                send,
                "Admin commands need a verified ID. Connect locally or use wss://, then type /id.",
            );
            return;
        };
        if !self.admins.contains(&identity.id) {
            Self::chat_notice(
                send,
                "Admin access is required. Use /id to find your client ID.",
            );
            return;
        }
        match command.split_whitespace().next() {
            None => Self::chat_notice(
                send,
                "Use /admin <command>. Commands include game_start, game_restart, password_set and prank_help.",
            ),
            Some("admin_add" | "admin_remove" | "admin_list") => {
                Self::chat_notice(send, "Manage administrators from the server console.")
            }
            Some(_) => {
                eprintln!("Admin {} ran a command from chat.", identity.id);
                if let Some(response) = self.execute_server_command(command) {
                    Self::chat_notice(send, &response);
                }
            }
        }
    }

    fn handle(&mut self, id: u64, send: Session, value: Value) {
        if *send.close.borrow() {
            return;
        }
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "join" {
            let version = value.get("version").and_then(Value::as_str);
            if version != Some(blunderjack::GAME_VERSION) {
                let client_version = version
                    .filter(|v| {
                        v.len() <= 64
                            && v.starts_with('v')
                            && v.as_bytes().get(1).is_some_and(u8::is_ascii_digit)
                            && v.bytes().all(|c| {
                                c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'+')
                            })
                    })
                    .unwrap_or("unknown");
                Self::send(
                    &send,
                    json!({
                        "type": "error",
                        "code": "version_mismatch",
                        "version": blunderjack::GAME_VERSION,
                        "message": format!("Client does not match server version. Client: {client_version}, Server: {}", blunderjack::GAME_VERSION),
                    }),
                );
                return;
            }
            if self.token_for(id).is_some() {
                Self::error(&send, "Already joined");
                return;
            }
            if let Some(password) = &self.password {
                match value.get("password").and_then(Value::as_str) {
                    None | Some("") => {
                        Self::send(
                            &send,
                            json!({"type":"error","code":"password_required","message":"A server password is required"}),
                        );
                        return;
                    }
                    Some(provided) if provided != password => {
                        Self::send(
                            &send,
                            json!({"type":"error","code":"incorrect_password","message":"Incorrect server password"}),
                        );
                        return;
                    }
                    Some(_) => {}
                }
            }
            let Some(profile) = value.get("profile").and_then(normalize_profile) else {
                Self::error(&send, "Invalid profile");
                return;
            };
            let identity = match join_identity(&value) {
                Ok(identity) => identity,
                Err(message) => {
                    Self::error(&send, message);
                    return;
                }
            };
            let token = if let Some(token) =
                value.get("token").and_then(Value::as_str).filter(|t| {
                    self.players.get(*t).is_some_and(|player| {
                        !player.identity.as_ref().is_some_and(|id| id.verified)
                            || player.identity == identity
                    })
                }) {
                let p = self.players.get_mut(token).unwrap();
                if let Some(old) = &p.sender {
                    let _ = old.close.send(true);
                }
                p.session = Some(id);
                p.sender = Some(send.clone());
                p.disconnected = None;
                p.gaze = None;
                p.latency_ms = None;
                p.profile = profile;
                p.identity = identity;
                eprintln!(
                    "{} reconnected{}.",
                    Self::player_label(p),
                    p.seat
                        .map(|s| format!(" at seat {}", s + 1))
                        .unwrap_or_default()
                );
                token.to_owned()
            } else {
                if self
                    .players
                    .values()
                    .filter(|p| p.session.is_some())
                    .count()
                    >= 100
                {
                    Self::error(&send, "Room is full");
                    return;
                }
                let token: String = rand::random::<[u8; 32]>()
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect();
                eprintln!(
                    "\"{}\" connected.",
                    profile["name"].as_str().unwrap_or("?").escape_default()
                );
                self.players.insert(
                    token.clone(),
                    Player {
                        profile,
                        identity,
                        seat: None,
                        session: Some(id),
                        sender: Some(send.clone()),
                        disconnected: None,
                        look: None,
                        emoji: None,
                        gaze: None,
                        latency_ms: None,
                        first: 0,
                        second: 0,
                        third: 0,
                        losses: 0,
                    },
                );
                token
            };
            if let Some(identity) = &self.players[&token].identity {
                eprintln!(
                    "{} client ID {} ({}).",
                    Self::player_label(&self.players[&token]),
                    identity.id,
                    if identity.verified {
                        "verified"
                    } else {
                        "unverified"
                    },
                );
            }
            let (elapsed, order, next_order) = self.music_clock();
            Self::send(
                &send,
                json!({"type":"welcome","token":token,"musicElapsedMs":elapsed,"musicOrder":order,"musicNextOrder":next_order}),
            );
            self.update_phase();
            self.broadcast();
            return;
        }
        let Some(token) = self.token_for(id) else {
            Self::error(&send, "Join first");
            return;
        };
        if kind == "music_clock" {
            if let Some(request_id) = value
                .get("id")
                .and_then(Value::as_u64)
                .filter(|id| *id <= u64::from(u32::MAX))
            {
                let (elapsed, order, next_order) = self.music_clock();
                Self::send(
                    &send,
                    json!({"type":"music_clock","id":request_id,"musicElapsedMs":elapsed,"musicOrder":order,"musicNextOrder":next_order}),
                );
            } else {
                Self::error(&send, "Invalid music clock id");
            }
            return;
        }
        let seat = self.players[&token].seat;
        if kind == "chat" {
            self.chat(&token, &send, &value);
            return;
        }
        if matches!(kind, "play" | "draw" | "blunder" | "last_card")
            && value
                .get("round")
                .is_some_and(|round| round.as_u64() != Some(u64::from(self.game.public().round)))
        {
            Self::error(&send, "That action was for a previous round");
            return;
        }
        if kind == "gaze" {
            let direction = match (value.get("yaw"), value.get("pitch")) {
                (Some(Value::Null), Some(Value::Null)) if value.get("zoom").is_none() => Some(None),
                (Some(yaw), Some(pitch)) => yaw
                    .as_f64()
                    .zip(pitch.as_f64())
                    .zip(match value.get("zoom") {
                        None => Some(false),
                        Some(zoom) => zoom.as_bool(),
                    })
                    .filter(|((yaw, pitch), _)| {
                        (-std::f64::consts::PI..=std::f64::consts::PI).contains(yaw)
                            && (-0.85..=1.1).contains(pitch)
                    })
                    .map(|((yaw, pitch), zoom)| Some((yaw.clamp(-1.45, 1.45), pitch, zoom))),
                _ => None,
            };
            if let (Some(seat), Some(gaze)) = (seat, direction) {
                self.players.get_mut(&token).unwrap().gaze = gaze;
                let message = json!({"type":"gaze","seat":seat,"gaze":gaze.map(|(yaw, pitch, zoom)| json!({"yaw":yaw,"pitch":pitch,"zoom":zoom}))});
                self.broadcast_transient(message);
            } else {
                Self::error(&send, "Gaze needs a seated player and a valid direction");
            }
            return;
        }
        if kind == "reorder" {
            if let Some(seat) = seat {
                self.broadcast_transient(json!({"type":"reorder","seat":seat}));
            } else {
                Self::error(&send, "Reordering needs a seated player");
            }
            return;
        }
        if matches!(kind, "play" | "draw" | "blunder" | "last_card")
            && self.pending_blunder.is_some()
        {
            Self::error(&send, "Wait for the challenge ruling");
            return;
        }
        if matches!(kind, "play" | "draw")
            && self.reveal_until.is_some_and(|end| Instant::now() < end)
        {
            Self::error(&send, "Wait for the cards to finish revealing");
            return;
        }
        let result: Result<(), String> = match kind {
            "profile" => match value.get("profile").and_then(normalize_profile) {
                Some(profile) => {
                    self.players.get_mut(&token).unwrap().profile = profile;
                    Ok(())
                }
                None => Err("Invalid profile".into()),
            },
            "seat" => {
                if seat.is_some() {
                    Err("Stand before changing seats".into())
                } else if let Some(n) = value
                    .get("seat")
                    .and_then(Value::as_u64)
                    .filter(|n| *n < 10)
                {
                    let n = n as usize;
                    if self.players.values().any(|p| p.seat == Some(n))
                        || (matches!(self.phase, "playing" | "finishing")
                            && self.game.public().placements.contains(&n))
                    {
                        Err("That seat is occupied".into())
                    } else {
                        self.players.get_mut(&token).unwrap().seat = Some(n);
                        eprintln!(
                            "{} sat at seat {}.",
                            Self::player_label(&self.players[&token]),
                            n + 1
                        );
                        Ok(())
                    }
                } else {
                    Err("Invalid seat".into())
                }
            }
            "stand" => {
                if let Some(s) = seat {
                    let view = self.game.public();
                    if matches!(self.phase, "playing" | "finishing")
                        && (view.active.contains(&s) || view.placements.contains(&s))
                    {
                        Err("You cannot stand during your round".into())
                    } else {
                        let player = self.players.get_mut(&token).unwrap();
                        player.seat = None;
                        player.look = None;
                        player.emoji = None;
                        player.gaze = None;
                        eprintln!("{} stood from seat {}.", Self::player_label(player), s + 1);
                        Ok(())
                    }
                } else {
                    Err("You are not seated".into())
                }
            }
            "look" => {
                let target = value.get("seat").and_then(Value::as_u64);
                let target_session = target.and_then(|target| {
                    self.players
                        .values()
                        .find(|p| {
                            p.seat.map(|index| index as u64) == Some(target) && p.seat != seat
                        })
                        .and_then(|p| p.session)
                });
                if let (Some(_), Some(target_session)) = (seat, target_session) {
                    self.players.get_mut(&token).unwrap().look =
                        Some((target_session, Instant::now() + Duration::from_secs(5)));
                    Ok(())
                } else {
                    Err("Choose another connected player while seated".into())
                }
            }
            "emoji" | "finger" => {
                let name = if kind == "finger" {
                    Some("finger")
                } else {
                    value.get("name").and_then(Value::as_str)
                };
                if seat.is_some() && name == Some("finger") {
                    self.players.get_mut(&token).unwrap().emoji =
                        Some(("finger", Instant::now() + Duration::from_secs(5)));
                    Ok(())
                } else {
                    Err("Choose a valid emoji while seated".into())
                }
            }
            "play" => {
                if self.phase != "playing" {
                    Err("The round is not accepting plays".into())
                } else if let Some(s) = seat {
                    let ids = value.get("cards").and_then(Value::as_array).and_then(|a| {
                        a.iter()
                            .map(|v| v.as_u64().and_then(|n| u32::try_from(n).ok()))
                            .collect::<Option<Vec<_>>>()
                    });
                    match ids {
                        Some(ids) if !ids.is_empty() && ids.len() <= 208 => {
                            self.game.submit(s, &ids).map(|()| {
                                self.reveal_until =
                                    Some(Instant::now() + reveal_duration(ids.len()));
                            })
                        }
                        _ => Err("Invalid cards".into()),
                    }
                } else {
                    Err("You are not seated".into())
                }
            }
            "draw" => {
                if self.phase != "playing" {
                    Err("The round is not accepting draws".into())
                } else if let Some(s) = seat {
                    self.game.draw(s)
                } else {
                    Err("You are not seated".into())
                }
            }
            "last_card" => {
                if !matches!(self.phase, "playing" | "finishing") {
                    Err("Last Card is available during a round".into())
                } else if let Some(s) = seat {
                    self.game.call_last_card(s).map(|()| {
                        eprintln!("{} called Last Card.", self.seat_label(s));
                    })
                } else {
                    Err("You are not seated".into())
                }
            }
            "blunder" => {
                if !matches!(self.phase, "playing" | "finishing") {
                    Err("There is no play to challenge".into())
                } else if let Some(s) = seat {
                    if let Some(play_id) = self.game.challenge_id(s) {
                        if value.get("playId").and_then(Value::as_u64) != Some(play_id) {
                            Self::error(&send, "That play is no longer available to challenge");
                            return;
                        }
                        let now = Instant::now();
                        self.pending_blunder = Some(PendingBlunder {
                            caller: s,
                            play_id,
                            started: now,
                            deadline: now + Duration::from_millis(2000),
                        });
                        Ok(())
                    } else {
                        Err("No play available to challenge".into())
                    }
                } else {
                    Err("You are not seated".into())
                }
            }
            _ => Err("Unknown message".into()),
        };
        match result {
            Err(err) => Self::error(&send, &err),
            Ok(()) => {
                if let Some(s) = seat.filter(|_| matches!(kind, "play" | "draw" | "blunder")) {
                    let view = self.game.public();
                    match kind {
                        "play" => {
                            if let Some(last) = view.last {
                                let cards = last
                                    .cards
                                    .iter()
                                    .map(|card| {
                                        let rank = match card.rank {
                                            1 => "A".to_string(),
                                            11 => "J".to_string(),
                                            12 => "Q".to_string(),
                                            13 => "K".to_string(),
                                            rank => rank.to_string(),
                                        };
                                        format!(
                                            "{} of {}",
                                            rank,
                                            format!("{:?}", card.suit).to_ascii_lowercase()
                                        )
                                    })
                                    .collect::<Vec<_>>()
                                    .join(", ");
                                eprintln!("{} played: {}.", self.seat_label(s), cards);
                            }
                        }
                        "draw" => {
                            if let Some(last) = view.last {
                                eprintln!("{} drew {} card(s).", self.seat_label(s), last.amount);
                            }
                        }
                        "blunder" => eprintln!("{} called BLUNDER.", self.seat_label(s)),
                        _ => {}
                    }
                    if matches!(kind, "play" | "draw") {
                        self.logged_turn = None;
                    }
                }
                self.update_phase();
                self.broadcast();
            }
        }
    }

    fn tick(&mut self) {
        if self.scoreboard_dirty {
            self.scoreboard_dirty = false;
            self.broadcast_scoreboard();
        }
        let now = Instant::now();
        let mut gestures_expired = false;
        for p in self.players.values_mut() {
            if p.look.is_some_and(|(_, end)| now >= end) {
                p.look = None;
                gestures_expired = true;
            }
            if p.emoji.is_some_and(|(_, end)| now >= end) {
                p.emoji = None;
                gestures_expired = true;
            }
        }
        let ruling_due = self
            .pending_blunder
            .as_ref()
            .is_some_and(|p| now >= p.deadline);
        if ruling_due {
            let pending = self.pending_blunder.take().unwrap();
            if let Some(deadline) = &mut self.deadline {
                *deadline += now.duration_since(pending.started);
            }
            match self.game.blunder(pending.caller) {
                Err(err) => eprintln!("Could not resolve challenge: {err}"),
                Ok(()) => {
                    if let Some(last) = self.game.public().last {
                        let target = if last.outcome.as_deref() == Some("valid") {
                            pending.caller
                        } else {
                            last.seat
                        };
                        if last.reason.as_deref() == Some("last_card") {
                            let ruling = if last.outcome.as_deref() == Some("valid") {
                                "Last Card was called"
                            } else {
                                "Last Card was missed and the top card was returned"
                            };
                            eprintln!(
                                "BLUNDER ruling: {ruling}; {} drew {} card(s).",
                                self.seat_label(target),
                                last.amount
                            );
                        } else {
                            eprintln!(
                                "BLUNDER ruling: play was {}; {} drew {} card(s).",
                                last.outcome.as_deref().unwrap_or("unknown"),
                                self.seat_label(target),
                                last.amount
                            );
                        }
                    }
                    self.logged_turn = None;
                }
            }
            self.reveal_until = None;
            self.update_phase();
            self.broadcast();
        }
        let before = (
            self.phase,
            self.deadline,
            self.candidate,
            self.players.len(),
        );
        let expired: Vec<_> = self
            .players
            .iter()
            .filter(|(_, p)| {
                p.disconnected
                    .is_some_and(|t| now.duration_since(t) >= Duration::from_secs(20))
            })
            .map(|(t, _)| t.clone())
            .collect();
        let had_expired = !expired.is_empty() && self.pending_blunder.is_none();
        for token in expired {
            if self.pending_blunder.is_some() {
                break;
            }
            if let Some(p) = self.players.get_mut(&token) {
                let seat = p.seat.take();
                p.disconnected = None;
                p.latency_ms = None;
                if matches!(self.phase, "playing" | "finishing") {
                    if let Some(seat) = seat {
                        self.game.remove_player(seat);
                    }
                }
            }
        }
        self.update_phase();
        if gestures_expired
            || had_expired
            || before
                != (
                    self.phase,
                    self.deadline,
                    self.candidate,
                    self.players.len(),
                )
        {
            self.broadcast();
        }
    }
}

fn normalize_profile(profile: &Value) -> Option<Value> {
    let obj = profile.as_object()?;
    if !(obj.len() == 5 || (obj.len() == 6 && obj.contains_key("sweaterColor"))) {
        return None;
    }
    let name = obj.get("name")?.as_str()?.trim();
    if name.is_empty() || name.chars().count() > 20 || name.chars().any(char::is_control) {
        return None;
    }
    let gender = obj.get("gender")?.as_str()?;
    let hair_style = obj.get("hairStyle")?.as_str()?;
    if !["neutral", "female", "male"].contains(&gender)
        || !["short", "long", "curly", "bald"].contains(&hair_style)
    {
        return None;
    }
    let color = |key: &str| -> Option<String> {
        let value = obj.get(key)?.as_str()?;
        if value.len() != 7
            || !value.starts_with('#')
            || !value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return None;
        }
        Some(value.to_ascii_lowercase())
    };
    let mut normalized = json!({"name":name,"gender":gender,"hairStyle":hair_style,"hairColor":color("hairColor")?,"skinColor":color("skinColor")?});
    if obj.contains_key("sweaterColor") {
        normalized["sweaterColor"] = json!(color("sweaterColor")?);
    }
    Some(normalized)
}

async fn room(mut rx: mpsc::Receiver<Event>, admins: Admins) {
    let mut room = Room::new(admins);
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            biased;
            Some(event) = rx.recv() => { match event {
                Event::Connected { send } => { Room::send(&send, json!({"type":"hello","passwordRequired":room.password.is_some(),"version":blunderjack::GAME_VERSION,"clientIdentity":true})); },
                Event::Console(command) => room.console_command(&command),
                Event::Message { id, send, value } => { room.tick(); room.handle(id, send, value); },
                Event::Latency { id, latency_ms } => {
                    if let Some(token) = room.token_for(id) {
                        room.players.get_mut(&token).unwrap().latency_ms = Some(latency_ms);
                        room.scoreboard_dirty = true;
                    }
                }
                Event::Disconnect { id } => {
                    if let Some(token) = room.token_for(id) {
                        let p = room.players.get_mut(&token).unwrap();
                        eprintln!("{} disconnected.", Room::player_label(p));
                        p.session = None; p.sender = None; p.disconnected = Some(Instant::now()); p.gaze = None; p.latency_ms = None;
                        room.update_phase(); room.broadcast();
                    }
                }
            } },
            _ = tick.tick() => room.tick(),
            else => break,
        }
    }
}
