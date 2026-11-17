const $ = (id) => document.getElementById(id);
const main = document.querySelector("main");
let modalReturnFocus;
let modalOnClose;
const defaults = {
  name: "",
  gender: "neutral",
  hairStyle: "bald",
  hairColor: "#382c28",
  skinColor: "#c58e68",
  sweaterColor: "#527ca3",
};
const sweaterColors = [
  { name: "Blue", color: "#527ca3" },
  { name: "Red", color: "#b65a55" },
  { name: "Orange", color: "#c98449" },
  { name: "Yellow", color: "#c6a84f" },
  { name: "Green", color: "#62866b" },
  { name: "Purple", color: "#82709f" },
  { name: "Pink", color: "#c47f9b" },
  { name: "Grey", color: "#85898d" },
];
function validSweaterColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || "")
    ? color.toLowerCase()
    : defaults.sweaterColor;
}
let profile;
try {
  profile = {
    ...defaults,
    ...JSON.parse(localStorage.getItem("bj-profile") || "{}"),
  };
} catch {
  profile = { ...defaults };
}
profile = {
  ...profile,
  gender: defaults.gender,
  hairStyle: defaults.hairStyle,
  hairColor: defaults.hairColor,
  skinColor: defaults.skinColor,
  sweaterColor: validSweaterColor(profile.sweaterColor),
};
let socket,
  serverUrl,
  serverPassword,
  connected = false,
  sending = false,
  state = null,
  token = "",
  address = localStorage.getItem("bj-address") || "",
  selected = [],
  order = [],
  hidden = false,
  reconnectTimer,
  reconnecting = false,
  intentional = false,
  lastShown = null,
  presentationTimer,
  countdownTimer,
  revealing = false,
  displayedPot = null,
  displayedPotCount = 0,
  handSignature = "",
  dragging = false,
  seatSignature = "",
  pileSignature = "",
  lastPlaySignature = "",
  choosingLook = false,
  firstRun = !profile.name;
let blunderAudio;
let announcementTimer;
let cancelHandDrag;
const suits = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
const faceNames = { 1: "Ace", 11: "Jack", 12: "Queen", 13: "King" };
const faceRanks = { 11: "J", 12: "Q", 13: "K" };
const emotes = { finger: { icon: "🖕", name: "Middle finger" } };
const positions = [
  [50, 12],
  [70, 15],
  [86, 29],
  [90, 53],
  [78, 76],
  [61, 87],
  [39, 87],
  [22, 76],
  [10, 53],
  [14, 29],
];
function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function avatar(p, extra = "") {
  const sweater = validSweaterColor(p?.sweaterColor);
  return `<span class="avatar ${extra}"><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#343434"/><path d="M9 64V58Q9 44 25 43H39Q55 44 55 58V64Z" fill="${sweater}"/><ellipse cx="32" cy="25" rx="16" ry="17" fill="#fff"/><circle cx="26" cy="25" r="1.8" fill="#1c1c1c"/><circle cx="38" cy="25" r="1.8" fill="#1c1c1c"/><path d="M27 32Q32 37 37 32" fill="none" stroke="#1c1c1c" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
}
function cardLabel(card) {
  return `${faceNames[card.rank] ?? card.rank} of ${card.suit}`;
}
function isRedSuit(suit) {
  return suit === "hearts" || suit === "diamonds";
}
function cardMarks(card) {
  return `<span class="card-suit" aria-hidden="true">${suits[card.suit]}</span><span class="card-rank" aria-hidden="true">${faceRanks[card.rank] ?? card.rank}</span>`;
}
function cardHTML(
  card,
  cls = "",
  { interactive = true, id = "", handIndex = false } = {},
) {
  const tag = interactive ? "button" : "span";
  const attributes = interactive ? 'type="button"' : 'role="img"';
  const red = isRedSuit(card.suit);
  const label = escapeHtml(cardLabel(card));
  const index = handIndex
    ? `<span class="hand-card-index" aria-hidden="true">${suits[card.suit]}<br>${faceRanks[card.rank] ?? card.rank}</span>`
    : "";
  return `<${tag} ${attributes} ${id ? `id="${id}"` : ""} class="playing-card ${red ? "red" : ""} ${cls}" aria-label="${label}" title="${label}">${cardMarks(card)}${index}</${tag}>`;
}
function modal(html) {
  hideScoreboard();
  const overlay = $("modal");
  const content = $("modal-content");
  if (overlay.classList.contains("hidden")) {
    modalReturnFocus = document.activeElement;
  }
  modalOnClose = null;
  content.innerHTML = html;
  content.querySelector("h2").id = "dialog-title";
  overlay.classList.toggle("required-profile", firstRun);
  overlay.classList.remove("hidden");
  main.inert = true;
  const initialFocus =
    content.querySelector("input, button") ||
    overlay.querySelector(".modal-close");
  initialFocus.focus();
}
function closeModal() {
  if (firstRun || $("modal").classList.contains("hidden")) return;
  $("modal").classList.add("hidden");
  const onClose = modalOnClose;
  modalOnClose = null;
  main.inert = false;
  if (modalReturnFocus && modalReturnFocus !== document.body)
    modalReturnFocus.focus();
  else $("open-connect").focus();
  onClose?.();
}
function toast(message, error = false) {
  let el = $("toast");
  el.textContent = message;
  el.className = "toast" + (error ? " error" : "");
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.add("hidden"), 4000);
}
function profileModal() {
  let selectedColor = validSweaterColor(profile.sweaterColor);
  modal(
    `<h2>Choose your character</h2><div class="profile-layout"><div class="avatar-preview" id="avatar-preview">${avatar(profile)}</div><div><label class="form-label" for="profile-name">DISPLAY NAME</label><input class="field" id="profile-name" maxlength="20" value="${escapeHtml(profile.name)}"><div class="form-label" id="sweater-color-label">SWEATER COLOUR</div><div class="sweater-swatches" role="group" aria-labelledby="sweater-color-label">${sweaterColors.map((color) => `<button type="button" class="sweater-swatch" style="--sweater-color: ${color.color}" data-color="${color.color}" aria-label="${color.name} sweater" aria-pressed="${color.color === selectedColor}"></button>`).join("")}</div></div></div><button class="primary" id="save-profile">SAVE CHARACTER <span>→</span></button>`,
  );
  const read = () => ({
    name: $("profile-name").value.trim().slice(0, 20),
    gender: defaults.gender,
    hairStyle: defaults.hairStyle,
    hairColor: defaults.hairColor,
    skinColor: defaults.skinColor,
    sweaterColor: selectedColor,
  });
  document.querySelectorAll(".sweater-swatch").forEach((button) => {
    button.addEventListener("click", () => {
      selectedColor = button.dataset.color;
      document
        .querySelectorAll(".sweater-swatch")
        .forEach((swatch) =>
          swatch.setAttribute("aria-pressed", String(swatch === button)),
        );
      $("avatar-preview").innerHTML = avatar(read());
    });
  });
  $("save-profile").onclick = () => {
    profile = read();
    if (!profile.name) {
      toast("Please enter a display name", true);
      $("profile-name").focus();
      return;
    }
    localStorage.setItem("bj-profile", JSON.stringify(profile));
    firstRun = false;
    closeModal();
    if (socket?.readyState === WebSocket.OPEN)
      send({ type: "profile", profile });
    toast("Character saved");
  };
  $("profile-name").onkeydown = (event) => {
    if (event.key === "Enter") $("save-profile").click();
  };
}
function connectModal() {
  modal(
    `<h2>Connect to a server</h2><p>Enter the host’s IP address or server address to join friends at their table.</p><label class="form-label" for="server-address">SERVER ADDRESS</label><input class="field" id="server-address" placeholder="e.g. 192.168.1.10:8765" value="${escapeHtml(address)}"><button class="primary" id="connect-button">CONNECT TO TABLE <span>→</span></button>`,
  );
  $("connect-button").onclick = () => {
    address = $("server-address").value.trim();
    if (!address) {
      toast("Enter a server address", true);
      return;
    }
    localStorage.setItem("bj-address", address);
    enableBlunderAudio();
    closeModal();
    connect();
  };
  $("server-address").onkeydown = (e) => {
    if (e.key === "Enter") $("connect-button").click();
  };
}
function wsUrl(input) {
  let s = input.trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = "ws://" + s;
  let u = new URL(s);
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  if (!["ws:", "wss:"].includes(u.protocol)) throw Error("Invalid protocol");
  if (u.username || u.password || u.hash) throw Error("Invalid server address");
  if (!u.port && !/^[a-z]+:\/\//i.test(input)) u.port = "8765";
  if (u.pathname === "/" || !u.pathname) u.pathname = "/ws";
  return u.toString();
}
function clientIdentity(url) {
  const endpoint = new URL(url);
  const trusted =
    window.isSecureContext &&
    (endpoint.protocol === "wss:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname));
  const storageKey = `${trusted ? "bj-identity-key" : "bj-guest-id"}:${url}`;
  let value = localStorage.getItem(storageKey);
  if (!value) {
    const bytes = crypto.getRandomValues(new Uint8Array(trusted ? 32 : 16));
    if (!trusted) {
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
    }
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    value = trusted
      ? hex
      : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    localStorage.setItem(storageKey, value);
  }
  return trusted ? { identityKey: value } : { clientId: value };
}
function setConnectionStatus(status, detail = "") {
  const message =
    {
      CONNECTING: "Connecting…",
      RECONNECTING: "Reconnecting…",
      "SESSION CLOSED": "Session closed",
    }[status] || detail;
  $("connection-status").textContent = message;
  $("connection-status").classList.toggle("hidden", !message);
  $("menu-status").textContent = message;
}
function connect() {
  clearTimeout(reconnectTimer);
  intentional = false;
  let url;
  try {
    url = wsUrl(address);
  } catch {
    toast("That server address is not valid", true);
    return;
  }
  if (serverUrl !== url) {
    resetTable();
    reconnecting = false;
    serverPassword = undefined;
    serverUrl = url;
  }
  connected = false;
  sending = false;
  token = sessionStorage.getItem("bj-token:" + url) || "";
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  setConnectionStatus("CONNECTING");
  try {
    socket = new WebSocket(url);
  } catch {
    setConnectionStatus("OFFLINE");
    toast("Could not connect to server", true);
    return;
  }
  const connection = socket;
  let triedLegacyProfile = false;
  let gazeReady = false;
  let helloTimer;
  let joinSent = false;
  let passwordPrompt = false;
  let helloReceived = false;
  let identity;
  let versionMismatch = false;
  const clientVersion =
    typeof window.BLUNDERJACK_VERSION === "string" && window.BLUNDERJACK_VERSION
      ? window.BLUNDERJACK_VERSION
      : "unknown";
  const rejectVersion = (version) => {
    if (versionMismatch || socket !== connection) return;
    versionMismatch = true;
    clearTimeout(helloTimer);
    clearTimeout(reconnectTimer);
    reconnecting = false;
    intentional = true;
    if (passwordPrompt) {
      passwordPrompt = false;
      modalOnClose = null;
      $("server-password").value = "";
      closeModal();
    }
    const serverVersion = typeof version === "string" && version ? version : "unknown";
    setConnectionStatus(
      "VERSION MISMATCH",
      `Client does not match server version. Client: ${clientVersion}, Server: ${serverVersion}`,
    );
    connection.close();
  };
  const join = () => {
    if (socket !== connection || connection.readyState !== WebSocket.OPEN)
      return;
    joinSent = true;
    const { sweaterColor, ...legacyProfile } = profile;
    const joinProfile = triedLegacyProfile ? legacyProfile : profile;
    send({
      type: "join",
      version: clientVersion,
      profile: joinProfile,
      token: token || undefined,
      ...identity,
      ...(serverPassword !== undefined ? { password: serverPassword } : {}),
    });
  };
  const promptPassword = (message = "") => {
    if (socket !== connection || passwordPrompt) return;
    passwordPrompt = true;
    modal(
      `<h2>Server password</h2><p>${escapeHtml(message || "Enter the password for this table.")}</p><label class="form-label" for="server-password">PASSWORD</label><input class="field" id="server-password" type="password" autocomplete="current-password"><button class="primary" id="submit-password">JOIN TABLE <span>→</span></button>`,
    );
    modalOnClose = () => {
      passwordPrompt = false;
      $("server-password").value = "";
      if (socket === connection) leaveTable();
    };
    const submit = () => {
      serverPassword = $("server-password").value;
      $("server-password").value = "";
      passwordPrompt = false;
      modalOnClose = null;
      closeModal();
      join();
    };
    $("submit-password").onclick = submit;
    $("server-password").onkeydown = (event) => {
      if (event.key === "Enter") submit();
    };
  };
  socket.onopen = () => {
    helloTimer = setTimeout(() => rejectVersion(), 5000);
  };
  socket.onmessage = (e) => {
    if (socket !== connection || versionMismatch) return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      clearTimeout(helloTimer);
      helloReceived = true;
      if (clientVersion === "unknown" || msg.version !== clientVersion) {
        rejectVersion(msg.version);
        return;
      }
      if (!joinSent) {
        identity = msg.clientIdentity ? clientIdentity(url) : undefined;
        if (!msg.passwordRequired) serverPassword = undefined;
        if (msg.passwordRequired && serverPassword === undefined)
          promptPassword();
        else join();
      }
    } else if (msg.type === "error" && msg.code === "version_mismatch") {
      rejectVersion(msg.version);
    } else if (!helloReceived) {
      rejectVersion();
    } else if (msg.type === "welcome") {
      if (token && token !== msg.token) resetTable();
      token = msg.token;
      sessionStorage.setItem("bj-token:" + url, token);
      reconnecting = false;
      connected = true;
      setConnectionStatus("CONNECTED");
      $("welcome").classList.add("hidden");
      $("table-screen").classList.remove("hidden");
      music?.connect(msg, (id) => {
        if (socket !== connection || connection.readyState !== WebSocket.OPEN)
          return false;
        connection.send(JSON.stringify({ type: "music_clock", id }));
        return true;
      });
    } else if (msg.type === "music_clock") {
      music?.clock(msg);
    } else if (msg.type === "state") {
      const previous = state;
      state = msg.state;
      updateChatAvailability();
      if (!Array.isArray(state.scoreboard) && previous?.scoreboard)
        state.scoreboard = previous.scoreboard;
      sending = false;
      if (previous && previous.game.round !== state.game.round) {
        cancelHandDrag?.();
        selected = [];
        order = [];
        dragging = false;
      }
      if (
        state.pendingBlunder &&
        state.pendingBlunder.playId !== previous?.pendingBlunder?.playId
      ) {
        playBlunderCall();
      }
      syncHand();
      present(previous);
      recordActivity(previous);
      render();
      announceAction(previous);
      if (state.sharedGaze) {
        document.dispatchEvent(
          new CustomEvent("blunderjack:gaze-snapshot", {
            detail: state.gestures.map((gesture) => gesture?.gaze ?? null),
          }),
        );
        if (!gazeReady) {
          gazeReady = true;
          document.dispatchEvent(new Event("blunderjack:gaze-ready"));
        }
      }
    } else if (
      msg.type === "chat" &&
      typeof msg.name === "string" &&
      typeof msg.message === "string"
    ) {
      addActivity(`${msg.name}: ${msg.message}`, "activity-chat");
    } else if (msg.type === "chat_notice" && typeof msg.message === "string") {
      addActivity(msg.message, "activity-notice");
    } else if (msg.type === "scoreboard" && state) {
      state.scoreboard = msg.scoreboard;
      renderScoreboard();
    } else if (msg.type === "reorder" && state?.cosmeticReorder) {
      showReorder(msg.seat);
    } else if (msg.type === "prank" && state?.seats?.[msg.seat]) {
      document.dispatchEvent(
        new CustomEvent("blunderjack:prank", { detail: msg }),
      );
    } else if (msg.type === "gaze" && state?.sharedGaze) {
      document.dispatchEvent(
        new CustomEvent("blunderjack:gaze", { detail: msg }),
      );
    } else if (msg.type === "error") {
      if (
        !connected &&
        !triedLegacyProfile &&
        msg.message === "Invalid profile"
      ) {
        triedLegacyProfile = true;
        join();
        return;
      }
      if (
        !connected &&
        (msg.code === "password_required" || msg.code === "incorrect_password")
      ) {
        clearTimeout(helloTimer);
        serverPassword = undefined;
        promptPassword(msg.message);
        return;
      }
      sending = false;
      toast(msg.message || "Something went wrong", true);
      render();
    }
  };
  socket.onclose = (event) => {
    if (socket !== connection) return;
    clearTimeout(helloTimer);
    if (passwordPrompt) {
      passwordPrompt = false;
      modalOnClose = null;
      $("server-password").value = "";
      closeModal();
    }
    hideScoreboard();
    connected = false;
    sending = false;
    updateChatAvailability();
    document.dispatchEvent(new Event("blunderjack:gaze-offline"));
    if (versionMismatch) {
      render();
      return;
    }
    if (event.code === 4001) {
      setConnectionStatus("SESSION CLOSED");
      toast(
        "This table session closed. Connect again from the main menu.",
        true,
      );
      render();
      return;
    }
    setConnectionStatus(intentional ? "OFFLINE" : "RECONNECTING");
    if (!intentional) {
      if (!reconnecting) toast("Connection lost. Reconnecting…", true);
      reconnecting = true;
      reconnectTimer = setTimeout(connect, 2500);
    }
    render();
  };
  socket.onerror = () => {};
}

function enableBlunderAudio() {
  if (!window.AudioContext) return;
  blunderAudio ??= new AudioContext();
  blunderAudio.resume().catch(() => {});
}

function playBlunderCall() {
  if (blunderAudio?.state !== "running" || document.hidden) return;
  const start = blunderAudio.currentTime;
  for (const [offset, pitch] of [
    [0, 155],
    [0.18, 112],
  ]) {
    const at = start + offset;
    const voice = blunderAudio.createOscillator();
    const filter = blunderAudio.createBiquadFilter();
    const volume = blunderAudio.createGain();
    voice.type = "sawtooth";
    voice.frequency.setValueAtTime(pitch, at);
    voice.frequency.exponentialRampToValueAtTime(pitch * 0.72, at + 0.14);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(offset ? 500 : 810, at);
    filter.Q.value = 2;
    volume.gain.setValueAtTime(0.001, at);
    volume.gain.linearRampToValueAtTime(0.23, at + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
    voice.connect(filter).connect(volume).connect(blunderAudio.destination);
    voice.start(at);
    voice.stop(at + 0.16);
  }
}

function send(data) {
  if (data.type === "profile" && state && !("pendingBlunder" in state)) {
    const { sweaterColor, ...legacyProfile } = data.profile;
    data = { ...data, profile: legacyProfile };
  }
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  else toast("Not connected to the table", true);
}
function syncHand() {
  let hand = state?.hand || [],
    ids = hand.map((c) => c.id);
  order = order.filter((id) => ids.includes(id));
  ids.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });
  selected = selected.filter((id) => ids.includes(id));
}

function takeAction(message) {
  if (!connected || sending) return;
  sending = true;
  send({ ...message, round: state.game.round });
  render();
}

function render() {
  if (!state) return;
  renderScoreboard();
  const g = state.game;
  const seats = state.seats;
  const playing = state.phase === "playing" || state.phase === "finishing";
  const active = playing && g.active.includes(state.you);
  const turnSeat = playing ? (g.candidate ?? g.current) : null;
  const cameraSeat =
    state.pendingBlunder?.caller ?? (revealing ? g.last?.seat : turnSeat);

  const lookEnabled =
    connected &&
    state.you != null &&
    Array.isArray(state.gestures) &&
    seats.some((seat, index) => index !== state.you && seat?.connected);
  $("look-button").disabled = !lookEnabled;
  if (!lookEnabled) choosingLook = false;
  $("look-button").setAttribute("aria-pressed", String(choosingLook));
  $("look-hint").classList.toggle("hidden", !choosingLook);
  $("table-screen").classList.toggle("choosing-look", choosingLook);
  $("watch-button").classList.toggle(
    "hidden",
    state.you == null ||
      active ||
      (playing && g.placements?.includes(state.you)),
  );
  $("watch-button").disabled = !connected;
  $("last-card-button").disabled =
    !connected ||
    sending ||
    !state.lastCardRule ||
    !active ||
    Boolean(state.pendingBlunder);
  $("dealer-label").textContent =
    g.dealer == null
      ? ""
      : `Dealer: ${seats[g.dealer]?.profile?.name || "Player"} · ${g.direction === -1 ? "↺ Counterclockwise" : "↻ Clockwise"}`;

  renderSeats(seats, g, playing, cameraSeat);
  renderPiles(g);
  renderLastPlay(g);

  const turn =
    connected &&
    !sending &&
    state.phase === "playing" &&
    !revealing &&
    !state.pendingBlunder &&
    active &&
    g.current === state.you;
  $("hand-panel").classList.toggle("hidden", !active);
  $("hand-count").textContent = state.hand.length
    ? `${state.hand.length} cards`
    : "";
  $("hide-hand").textContent = hidden ? "Show hand" : "Hide hand";
  $("hide-hand").disabled = !state.hand.length;
  const canSubmit = turn && selected.length > 0;
  const canBlunder =
    connected && !sending && state.canBlunder && !state.pendingBlunder;
  $("action-bar").classList.toggle("hidden", !turn);
  $("submit-button").classList.toggle("hidden", !canSubmit);
  $("draw-button").classList.toggle("hidden", !turn);
  $("blunder-button").disabled = !canBlunder;
  $("draw-button").textContent = g.penalty
    ? `Draw ${g.penalty.amount}`
    : "Draw";
  $("clear-selection").classList.toggle("hidden", !selected.length);
  renderHand();
  renderNotice(active);
}

function renderScoreboard() {
  const rows = Array.isArray(state?.scoreboard) ? state.scoreboard : [];
  const value = (v) => (Number.isFinite(v) ? escapeHtml(v) : "—");
  $("scoreboard-rows").innerHTML = rows
    .map(
      (row) =>
        `<tr class="${row.you ? "scoreboard-you" : ""} ${row.connected === false ? "scoreboard-disconnected" : ""}"><th scope="row">${escapeHtml(row.name || "Player")}${row.you ? " (you)" : ""}${row.connected === false ? " (offline)" : ""}</th><td>${value(row.first)}</td><td>${value(row.second)}</td><td>${value(row.third)}</td><td>${value(row.losses)}</td><td>${value(row.latencyMs)}</td></tr>`,
    )
    .join("");
}

function hideScoreboard() {
  $("scoreboard").classList.add("hidden");
}

function renderSeats(seats, game, playing, cameraSeat) {
  const gestures = state.gestures?.map((gesture) =>
    gesture?.look != null || gesture?.emoji
      ? { look: gesture.look, emoji: gesture.emoji }
      : null,
  );
  const signature = JSON.stringify([
    seats,
    game.round,
    cameraSeat,
    game.dealer,
    game.counts,
    game.placements,
    game.last_card_calls,
    game.active,
    game.current,
    game.candidate,
    game.last?.id,
    state.pendingBlunder?.playId,
    gestures,
    state.you,
    connected,
    playing,
    choosingLook,
  ]);
  if (signature === seatSignature) return;
  seatSignature = signature;
  const canSit = connected && state.you == null;
  $("seats").innerHTML = positions
    .map(([x, y], index) => {
      const seat = seats[index];
      const placement = `data-index="${index}" style="left:${x}%;top:${y}%"`;
      if (!seat) {
        return canSit && !(playing && game.placements?.includes(index))
          ? `<div class="seat" ${placement}>
        <button type="button" class="seat-button" data-seat="${index}" aria-label="Take seat ${index + 1}" title="Take seat ${index + 1}">+</button>
      </div>`
          : "";
      }
      const name =
        escapeHtml(seat.profile.name) + (state.you === index ? " (you)" : "");
      const place = game.placements?.indexOf(index) ?? -1;
      const status = !seat.connected
        ? "Offline"
        : place >= 0
          ? ["1st place", "2nd place", "3rd place"][place]
          : !playing
            ? ""
            : game.active.includes(index)
              ? `${game.counts[index]} cards`
              : "Next round";
      const chip =
        game.dealer === index
          ? '<span class="dealer-chip" title="Dealer">D</span>'
          : "";
      const canLook = choosingLook && index !== state.you && seat.connected;
      const nameTag = canLook ? "button" : "span";
      const lookTarget = canLook ? ` data-look-seat="${index}"` : "";
      const nameType = canLook ? ' type="button"' : "";
      const emoji = Object.hasOwn(emotes, gestures?.[index]?.emoji?.name)
        ? emotes[gestures[index].emoji.name]
        : null;
      return `<div class="seat occupied" ${placement}>
      ${game.last_card_calls?.[index] ? '<span class="seat-last-card">LAST CARD!</span>' : ""}
      ${emoji ? `<span class="seat-emoji" role="img" aria-label="${emoji.name}">${emoji.icon}</span>` : ""}
      <${nameTag}${nameType} class="seat-name ${cameraSeat === index ? "current" : ""}" title="#${index + 1} ${name}"${lookTarget}><span class="seat-number">#${index + 1}</span><span class="seat-display-name">${name}</span></${nameTag}>
      <div class="seat-avatar"${lookTarget}>${avatar(seat.profile, seat.connected ? "" : "offline")}${chip}</div>
      <span class="seat-meta">${status}</span>
    </div>`;
    })
    .join("");
  document.dispatchEvent(
    new CustomEvent("blunderjack:table", {
      detail: {
        seats,
        you: state.you,
        gestures,
        dealer: game.dealer,
        round: game.round,
        current: cameraSeat,
        turn: playing ? (game.candidate ?? game.current) : null,
        counts: game.counts,
        active: playing ? game.active : [],
        last: playing ? game.last : null,
        pendingBlunder: state.pendingBlunder,
      },
    }),
  );
}

function renderPiles(game) {
  const pot = revealing ? displayedPot : game.pot;
  const potCount = revealing
    ? displayedPotCount
    : (game.pot_count ?? (pot ? 1 : 0));
  const signature = JSON.stringify([pot, potCount, game.pickup, game.penalty]);
  if (signature === pileSignature) return;
  pileSignature = signature;
  $("pickup-count").textContent = game.round ? game.pickup : "—";
  $("pot-count").textContent = pot && game.pot_count != null ? potCount : "—";
  $("pot-penalty").textContent = game.penalty
    ? `+${game.penalty.amount} draw`
    : "";
  $("pot-card").outerHTML = pot
    ? cardHTML(pot, "mini-card", { interactive: false, id: "pot-card" })
    : '<span id="pot-card" class="playing-card mini-card empty-card">—</span>';
  document.dispatchEvent(
    new CustomEvent("blunderjack:piles", {
      detail: { pot, potCount, pickup: game.pickup },
    }),
  );
}

function renderLastPlay(game) {
  if (revealing) return;
  const play = "last_placed" in game
    ? game.last_placed
    : (game.last?.kind === "play" ? game.last : null);
  const count = play?.cards.length ?? 0;
  const name = state.seats[play?.seat]?.profile?.name || "Player";
  const signature = JSON.stringify([play?.id, count, name]);
  if (signature === lastPlaySignature) return;
  lastPlaySignature = signature;
  $("last-play").classList.toggle("hidden", !count);
  $("last-play-label").textContent = `Last play (${name})`;
  const strip = $("last-play-cards");
  strip.innerHTML = count
    ? play.cards
        .map((card) =>
          cardHTML(card, "last-play-card", { interactive: false, handIndex: true }),
        )
        .join("")
    : "";
  strip.scrollLeft = strip.scrollWidth;
}

function renderHand() {
  let cards = state?.hand || [];
  let signature = JSON.stringify([cards, order, selected, hidden]);
  if (signature === handSignature || dragging) return;
  handSignature = signature;
  const focusedCard = document.activeElement?.closest(".card-wrap");
  const focusId = focusedCard?.dataset.id;
  const focusHandle = document.activeElement?.classList.contains("card-grab");
  let map = new Map(cards.map((c) => [c.id, c]));
  document.dispatchEvent(
    new CustomEvent("blunderjack:first-person-hand", {
      detail: { cards: order.map((id) => map.get(id)), selected, hidden },
    }),
  );
  $("hand").innerHTML = order.length
    ? order
        .map((id, i) => {
          let c = map.get(id);
          const staged = selected.includes(id) ? "selected" : "";
          const face = hidden
            ? `<button class="playing-card card-hidden ${staged}" aria-label="Select hidden card ${i + 1}">♠</button>`
            : cardHTML(c, staged, { handIndex: true });
          return `<div class="card-wrap" data-id="${id}">${face}<button type="button" class="card-grab" aria-label="Move card ${i + 1}; use left and right arrow keys" title="Drag to reorder; use arrow keys to move">⋮⋮</button></div>`;
        })
        .join("")
    : '<div class="empty-hand">No cards left</div>';
  sizeHand();
  $("selection").innerHTML = selected.length
    ? selected
        .map((id) => {
          let c = map.get(id);
          const face = hidden ? "♠" : cardMarks(c);
          const label = hidden ? "hidden card" : escapeHtml(cardLabel(c));
          return `<button type="button" data-unstage="${id}" class="playing-card staged-card ${hidden ? "card-hidden" : isRedSuit(c.suit) ? "red" : ""}" aria-label="Return ${label} to hand" title="Return ${label} to hand">${face}</button>`;
        })
        .join("")
    : "<span>Select cards in play order</span>";
  $("selection")
    .querySelectorAll("[data-unstage]")
    .forEach((button) => {
      button.onclick = () => {
        selected = selected.filter(
          (id) => id !== Number(button.dataset.unstage),
        );
        render();
      };
    });
  document.querySelectorAll(".card-wrap").forEach((el) => {
    let id = Number(el.dataset.id);
    el.querySelector(".playing-card").onclick = () => {
      selected = selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id];
      render();
    };
    const handle = el.querySelector(".card-grab");
    handle.onkeydown = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const from = order.indexOf(id);
      const to = from + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to], order[from]];
      renderHand();
      $("hand")
        .querySelector(`[data-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      document.dispatchEvent(new Event("blunderjack:hand-reordered"));
    };
    handle.onpointerdown = (event) => startHandDrag(event, el, id);
  });
  if (focusId) {
    const card = $("hand").querySelector(`[data-id="${focusId}"]`);
    card
      ?.querySelector(focusHandle ? ".card-grab" : ".playing-card")
      ?.focus({ preventScroll: true });
  }
}
function sizeHand() {
  const hand = $("hand");
  const count = hand.querySelectorAll(".card-wrap").length;
  const available = Math.max(0, hand.clientWidth - 6);
  const width = count
    ? Math.max(44, Math.min(58, (available - 6 * (count - 1)) / count))
    : 58;
  const step =
    count > 1
      ? Math.min(width + 6, Math.max(18, (available - width) / (count - 1)))
      : width;
  const wraps = width + step * (count - 1) > available + 0.01;
  hand.style.setProperty("--hand-card-width", `${width}px`);
  hand.style.setProperty("--hand-card-step", `${step}px`);
  hand.classList.toggle("overlapping", count > 1 && step < width);
  hand.classList.toggle("wrapping", wraps);
}
new ResizeObserver(sizeHand).observe($("hand"));

// Move the placeholder through the hand while a floating card follows the pointer.
function startHandDrag(event, card, id) {
  if (event.button !== 0 || dragging) return;
  event.preventDefault();
  const hand = $("hand");
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("hand-drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  document.body.appendChild(ghost);
  card.classList.add("hand-drag-placeholder");
  dragging = true;
  let x = event.clientX,
    y = event.clientY,
    frame;
  const offsetX = x - rect.left,
    offsetY = y - rect.top;
  function update() {
    ghost.style.left = `${x - offsetX}px`;
    ghost.style.top = `${y - offsetY}px`;
    const others = [
      ...hand.querySelectorAll(".card-wrap:not(.hand-drag-placeholder)"),
    ];
    const bounds = hand.getBoundingClientRect();
    const step = parseFloat(hand.style.getPropertyValue("--hand-card-step"));
    const before = others.find((item) => {
      const top = bounds.top + item.offsetTop;
      return (
        y < top ||
        (y < top + item.offsetHeight &&
          x < bounds.left + item.offsetLeft + step / 2)
      );
    });
    if ((before || null) !== card.nextElementSibling) {
      const positions = new Map(
        others.map((item) => [item, item.getBoundingClientRect().left]),
      );
      hand.insertBefore(card, before || null);
      others.forEach((item) => {
        const delta = positions.get(item) - item.getBoundingClientRect().left;
        if (delta)
          item.animate(
            [
              { transform: `translateX(${delta}px)` },
              { transform: "translateX(0)" },
            ],
            { duration: 150, easing: "ease-out" },
          );
      });
    }
    frame = requestAnimationFrame(update);
  }
  function move(e) {
    if (e.pointerId === event.pointerId) {
      x = e.clientX;
      y = e.clientY;
    }
  }
  function finish(e) {
    if (e.pointerId !== event.pointerId) return;
    cancelHandDrag = undefined;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    cancelAnimationFrame(frame);
    ghost.remove();
    const next = [...hand.querySelectorAll(".card-wrap")].map((item) =>
      Number(item.dataset.id),
    );
    const changed =
      e.type === "pointerup" &&
      next.length === order.length &&
      next.every((value) => order.includes(value)) &&
      next.some((value, index) => value !== order[index]);
    if (changed) order = next;
    dragging = false;
    handSignature = "";
    renderHand();
    $("hand")
      .querySelector(`[data-id="${id}"] .card-grab`)
      ?.focus({ preventScroll: true });
    if (changed) document.dispatchEvent(new Event("blunderjack:hand-reordered"));
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  cancelHandDrag = () =>
    finish({ pointerId: event.pointerId, type: "pointercancel" });
  update();
}

function renderNotice(active) {
  const game = state.game;
  const heading = $("table-state");
  const subtitle = $("table-subtitle");
  const nameAt = (seat) => state.seats[seat]?.profile?.name || "Player";
  const winner = game.winner == null ? null : nameAt(game.winner);
  const countingDown = state.phase === "countdown";
  $("shuffle").classList.toggle("hidden", !countingDown);
  clearInterval(countdownTimer);

  if (state.phase === "paused") {
    heading.textContent = "Waiting for host to start";
    subtitle.textContent =
      state.you == null ? "Choose an open seat to join." : "";
    return;
  }

  if (state.pendingBlunder) {
    heading.textContent = `${nameAt(state.pendingBlunder.caller)} calls BLUNDER!`;
    subtitle.textContent = "Waiting for the ruling…";
    return;
  }

  if (countingDown) {
    heading.textContent = winner ? `${winner} wins` : "Shuffling";
    const end = performance.now() + state.countdownMs;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      subtitle.textContent = `Next deal in ${seconds}s`;
    };
    tick();
    countdownTimer = setInterval(tick, 250);
    return;
  }

  const place = game.placements?.indexOf(state.you) ?? -1;
  const seatHint =
    state.you == null
      ? "Choose an open seat to join."
      : place >= 0
        ? `You finished in ${["1st", "2nd", "3rd"][place]} place.`
        : "You’ll be dealt in next round.";
  if (state.phase === "finishing") {
    heading.textContent = `${nameAt(game.candidate)} played their last card`;
    subtitle.textContent = state.canBlunder ? "Blunder is open" : "";
  } else if (state.phase === "playing") {
    const current = game.current;
    const text =
      current === state.you ? "Your turn" : `${nameAt(current)}’s turn`;
    heading.textContent = revealing ? `${nameAt(game.last.seat)} plays` : text;
    subtitle.textContent = active
      ? (revealing ? "" : skippedPlayers(game.last, nameAt))
      : seatHint;
  } else {
    heading.textContent = winner
      ? `${winner} wins`
      : state.you == null
        ? "Choose a seat"
        : "Waiting for players";
    subtitle.textContent = winner && state.you == null ? seatHint : "";
  }
}

function present(previous) {
  const { game } = state;
  const last = game.last;
  if (!last || game.finished) {
    clearTimeout(presentationTimer);
    revealing = false;
    lastShown = null;
    return;
  }
  if (last.id === lastShown) return;
  lastShown = last.id;
  clearTimeout(presentationTimer);
  revealing = false;
  if (game.round !== previous?.game?.round) return;

  if (last.kind === "draw" || last.kind === "blunder") {
    const upheld = last.kind === "blunder" && last.outcome === "invalid";
    if (upheld) flyCard({ kind: "cancel" });
    const seat = last.kind === "blunder" && !upheld ? last.caller : last.seat;
    if (last.amount)
      flyCard({ kind: "draw", seat, amount: last.amount, durationMs: 520 });
    return;
  }
  const cards = last.cards;
  if (last.kind !== "play" || !cards.length) return;
  displayedPot = previous.game.pot;
  displayedPotCount = previous.game.pot_count ?? (displayedPot ? 1 : 0);
  revealing = true;
  const stepMs = Math.max(24, Math.min(650, Math.floor(4800 / cards.length)));
  let index = 0;
  function step() {
    const card = cards[index];
    flyCard({ kind: "play", seat: last.seat, card, durationMs: stepMs });
    presentationTimer = setTimeout(() => {
      displayedPot = card;
      displayedPotCount++;
      index++;
      if (index === cards.length) {
        revealing = false;
        presentationTimer = null;
      }
      render();
      if (revealing) step();
    }, stepMs);
  }
  step();
}

function flyCard(detail) {
  document.dispatchEvent(new CustomEvent("blunderjack:card-flight", { detail }));
}

function skippedPlayers(play, nameAt) {
  return play?.skipped?.length
    ? `Skipped ${play.skipped.map(nameAt).join(", ")}`
    : "";
}
function addActivity(message, kind = "") {
  const log = $("activity-log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const item = document.createElement("div");
  item.className = `activity-entry ${kind}`;
  item.textContent = message;
  log.append(item);
  if (log.childElementCount > 250) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function recordActivity(previous) {
  const game = state.game;
  const nameAt = (seat) => state.seats[seat]?.profile?.name || "Player";
  const add = addActivity;
  if (game.round && game.round !== previous?.game?.round)
    add(`Round ${game.round} started`, "activity-event");
  game.last_card_calls?.forEach((called, seat) => {
    if (
      called &&
      (game.round !== previous?.game?.round ||
        !previous?.game?.last_card_calls?.[seat])
    )
      add(`${nameAt(seat)} called LAST CARD`, "activity-event");
  });
  const last = game.last;
  if (
    last &&
    (game.round !== previous?.game?.round ||
      last.id !== previous?.game?.last?.id)
  ) {
    const name = nameAt(last.seat);
    if (last.kind === "play") {
      const skip = skippedPlayers(last, nameAt);
      add(
        `${name} played ${(last.cards || []).map(cardLabel).join(", ")}${skip ? ` · ${skip}` : ""}`,
      );
    } else if (last.kind === "draw") {
      add(
        `${name} drew ${last.amount} ${last.amount === 1 ? "card" : "cards"}`,
      );
    } else if (last.kind === "blunder") {
      const upheld = last.outcome === "invalid";
      add(
        `BLUNDER ${upheld ? "valid" : "invalid"} · ${blunderDetail(last, nameAt)}`,
        "activity-event",
      );
    }
  }
  const pending = state.pendingBlunder;
  if (pending && pending.playId !== previous?.pendingBlunder?.playId)
    add(`${nameAt(pending.caller)} called BLUNDER`, "activity-event");
  if (
    game.winner != null &&
    (game.winner !== previous?.game?.winner ||
      game.round !== previous?.game?.round)
  )
    add(`${nameAt(game.winner)} wins round ${game.round}`, "activity-event");
  const previousPlaces =
    game.round === previous?.game?.round
      ? (previous.game.placements?.length ?? 0)
      : 0;
  game.placements?.forEach((seat, place) => {
    if (place > 0 && place >= previousPlaces)
      add(
        `${nameAt(seat)} took ${["1st", "2nd", "3rd"][place]} place`,
        "activity-event",
      );
  });
}

function blunderDetail(last, nameAt) {
  const upheld = last.outcome === "invalid";
  const name = nameAt(upheld ? last.seat : last.caller);
  if (last.reason === "last_card") {
    return upheld
      ? `Last Card missed · ${name} took back the last played card and drew ${last.amount}`
      : `Last Card was called · ${name} drew ${last.amount}`;
  }
  return `${upheld ? "Play reversed" : "Play stands"} · ${name} drew ${last.amount}`;
}

function announceAction(previous) {
  const game = state.game;
  const nameAt = (seat) => state.seats[seat]?.profile?.name || "Player";
  const pending = state.pendingBlunder;
  if (pending) {
    if (pending.playId !== previous?.pendingBlunder?.playId) {
      showAnnouncement(
        `${nameAt(pending.caller)} called BLUNDER`,
        "Waiting for the ruling",
        pending.remainingMs ?? 2000,
        "blunder",
      );
    }
    return;
  }
  if (previous?.pendingBlunder) hideAnnouncement();
  if (!previous || game.round !== previous.game.round) {
    if (game.round)
      showAnnouncement(`Round ${game.round}`, "Seven cards dealt", 1300);
    return;
  }
  if (game.winner != null && game.winner !== previous.game.winner) {
    showAnnouncement(`${nameAt(game.winner)} wins`, "", 2400, "ruling");
    return;
  }
  const place = (game.placements?.length ?? 0) - 1;
  if (place > 0 && place >= (previous.game.placements?.length ?? 0)) {
    showAnnouncement(
      `${nameAt(game.placements[place])} took ${["1st", "2nd", "3rd"][place]} place`,
      "",
      1700,
    );
    return;
  }
  const last = game.last;
  if (!last || last.id === previous.game.last?.id) return;
  if (last.kind === "blunder") {
    const upheld = last.outcome === "invalid";
    showAnnouncement(
      upheld ? "BLUNDER was valid" : "BLUNDER was invalid",
      blunderDetail(last, nameAt),
      2000,
      "ruling",
    );
  } else if (last.kind === "draw") {
    showAnnouncement(
      `${nameAt(last.seat)} drew ${last.amount} ${last.amount === 1 ? "card" : "cards"}`,
      "",
      1400,
      "card-action",
    );
  } else if (last.kind === "play") {
    const count = last.cards.length;
    const queens = [...last.cards]
      .reverse()
      .findIndex((card) => card.rank !== 12);
    const detail =
      game.direction !== previous.game.direction
        ? "Direction reversed"
        : game.penalty
          ? `Draw penalty: ${game.penalty.amount}`
          : previous.game.penalty
            ? "Draw penalty cleared"
            : last.cards.at(-1)?.rank === 12
              ? skippedPlayers(last, nameAt) || `${queens === -1 ? count : queens} skipped`
              : "";
    showAnnouncement(
      `${nameAt(last.seat)} played ${count} ${count === 1 ? "card" : "cards"}`,
      detail,
      1500,
      "card-action",
    );
  }
}
function hideAnnouncement() {
  clearTimeout(announcementTimer);
  $("action-announcement").className = "action-announcement hidden";
}
function showAnnouncement(title, detail, duration, style = "") {
  hideAnnouncement();
  const announcement = $("action-announcement");
  $("announcement-title").textContent = title;
  $("announcement-detail").textContent = detail;
  void announcement.offsetWidth;
  announcement.className = `action-announcement ${style}`;
  announcementTimer = setTimeout(hideAnnouncement, duration);
}
$("open-profile").onclick = profileModal;
$("open-connect").onclick = connectModal;
function rulesModal() {
  modal(`<div class="rules-content">
    <h2>Rules</h2>
    <p>Be the first to empty your hand with a legal play. Everyone starts with 7 cards. The game uses 2 decks for 2–4 players, 3 for 5–7, and 4 for 8–10. Play starts clockwise with the player to the dealer’s left. The dealer moves clockwise each round.</p>

    <h3>Your turn</h3>
    <p>Match the top card of the POT by rank or suit. To chain cards, match the previous rank or go one rank up or down in the same suit. A, J, Q and K count as 1, 11, 12 and 13.</p>
    <p>Select cards in play order and click <strong>Submit</strong>, or <strong>Draw</strong> 1 card (or the penalty amount) to end your turn. If the PICKUP runs out, recycle the POT in order, keeping its top card.</p>

    <h3>Special cards</h3>
    <p>Draw penalties, skips and reversals only trigger at the end of a play.</p>
    <ul>
      <li><strong>Ace</strong> can lead on any card. Inside a chain it must match suit, and only a same-suit King or 2 can follow it.</li>
      <li><strong>2</strong> adds 2 to the pickup penalty for each 2 at the end. The next player draws the total or passes it on with more 2s.</li>
      <li><strong>8</strong> reverses play.</li>
      <li><strong>Black Jack (♠ ♣)</strong> starts a penalty of 7 per black Jack at the end. The next player draws the total or doubles it for each black Jack they play.</li>
      <li><strong>Red Jack (♥ ♦)</strong> cancels the entire black Jack penalty when played alone.</li>
      <li><strong>Queen</strong> skips one turn per Queen at the end.</li>
    </ul>

    <h3>Blunder</h3>
    <p>Use <strong>Blunder</strong> to challenge someone else’s play before the next player acts. If it was illegal, they take their cards back and draw 2. Otherwise, the caller draws 2, unless Last Card applies. Unchallenged illegal plays stand. A finishing play has an 8-second challenge window after the reveal.</p>

    <h3>Last Card</h3>
    <p>When you play down to one card, call <strong>Last Card</strong> before the next play or Blunder. If a legal play is challenged and you missed the call, take back your last played card and draw 1. If you called it, the challenger draws 1.</p>
  </div>`);
}
$("rules-button").onclick = rulesModal;
function savedFirstPersonFov() {
  const stored = localStorage.getItem("bj-first-person-fov");
  const parsed = stored === null || stored.trim() === "" ? NaN : Number(stored);
  return Number.isFinite(parsed)
    ? Math.round(Math.max(60, Math.min(160, parsed)))
    : 78;
}
$("options-button").onclick = () => {
  const fov = savedFirstPersonFov();
  modal(`<h2>Options</h2>
    <div class="fov-setting">
      <label class="form-label" for="first-person-fov">FIRST PERSON FOV</label>
      <output id="first-person-fov-value" for="first-person-fov">${fov}°</output>
      <input id="first-person-fov" type="range" min="60" max="160" step="1" value="${fov}">
    </div>
    <label class="fps-setting"><input id="show-fps" type="checkbox" ${localStorage.getItem("bj-show-fps") === "true" ? "checked" : ""}> Show FPS</label>`);
  $("first-person-fov").addEventListener("input", (event) => {
    const value = Number(event.target.value);
    $("first-person-fov-value").textContent = `${value}°`;
    localStorage.setItem("bj-first-person-fov", String(value));
    document.dispatchEvent(
      new CustomEvent("blunderjack:first-person-fov", { detail: value }),
    );
  });
  $("show-fps").addEventListener("change", (event) => {
    localStorage.setItem("bj-show-fps", String(event.target.checked));
    document.dispatchEvent(new CustomEvent("blunderjack:show-fps", { detail: event.target.checked }));
  });
};
$("menu-button").onclick = () =>
  modal(
    `<h2>Table menu</h2>
    <div class="menu-actions">
      <button type="button" id="menu-profile">Edit character</button>
      <button type="button" id="menu-options">Options</button>
      <button type="button" id="menu-rules">Rules</button>
      <button type="button" id="leave-button">Leave table</button>
    </div>`,
  );
document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeModal();
  if (e.target.id === "menu-profile") profileModal();
  if (e.target.id === "menu-options") $("options-button").click();
  if (e.target.id === "menu-rules") rulesModal();
  if (e.target.id === "leave-button") leaveTable();
});
document.addEventListener("keydown", (e) => {
  if (e.target === $("chat-input")) return;
  if (
    e.key === "Tab" &&
    !$("table-screen").classList.contains("hidden") &&
    $("modal").classList.contains("hidden") &&
    !e.target.closest(
      '#music-player, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  ) {
    e.preventDefault();
    $("scoreboard").classList.remove("hidden");
    return;
  }
  if (e.repeat) return;
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyE") {
    if (
      !connected ||
      state?.you == null ||
      !state.emojiEmotes ||
      !$("modal").classList.contains("hidden")
    )
      return;
    e.preventDefault();
    modal(
      `<h2>Emotes</h2><div class="emoji-options">${Object.entries(emotes)
        .map(
          ([key, { icon, name }]) =>
            `<button type="button" class="quiet-button" data-emoji="${key}" aria-label="${name}" title="${name}">${icon}</button>`,
        )
        .join("")}</div>`,
    );
    $("modal-content")
      .querySelectorAll("[data-emoji]")
      .forEach((button) => {
        button.onclick = () => {
          closeModal();
          if (connected && state?.emojiEmotes && state.you != null)
            send({ type: "emoji", name: button.dataset.emoji });
        };
      });
    return;
  }
  if (e.key !== "Escape") return;
  if (!$("modal").classList.contains("hidden")) closeModal();
  else if (choosingLook) $("look-button").click();
  else if (!$("table-screen").classList.contains("hidden"))
    $("menu-button").click();
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Tab") hideScoreboard();
});
window.addEventListener("blur", hideScoreboard);
function resetTable() {
  hideScoreboard();
  cancelHandDrag?.();
  hideAnnouncement();
  clearTimeout(presentationTimer);
  clearInterval(countdownTimer);
  presentationTimer = null;
  revealing = false;
  lastShown = null;
  displayedPot = null;
  displayedPotCount = 0;
  handSignature = "";
  seatSignature = "";
  pileSignature = "";
  lastPlaySignature = "";
  dragging = false;
  choosingLook = false;
  $("activity-log").replaceChildren();
  $("last-play").classList.add("hidden");
  $("shuffle").classList.add("hidden");
  $("hand-panel").classList.add("hidden");
  $("action-bar").classList.add("hidden");
  $("blunder-button").disabled = true;
  $("last-card-button").disabled = true;
  $("seats").replaceChildren();
  state = null;
  updateChatAvailability();
  selected = [];
  order = [];
  document.dispatchEvent(new Event("blunderjack:reset-view"));
}
function leaveTable() {
  closeModal();
  intentional = true;
  connected = false;
  reconnecting = false;
  serverPassword = undefined;
  clearTimeout(reconnectTimer);
  resetTable();
  socket?.close();
  music?.disconnect();
  $("table-screen").classList.add("hidden");
  $("welcome").classList.remove("hidden");
  setConnectionStatus("OFFLINE");
  $("open-connect").focus();
}
const controls = $("table-controls");
const controlsHandle = $("controls-handle");
function placeControls(left, top) {
  const maxLeft = Math.max(
    0,
    document.documentElement.clientWidth - controls.offsetWidth,
  );
  const maxTop = Math.max(
    0,
    document.documentElement.clientHeight - controls.offsetHeight,
  );
  controls.style.left = `${Math.max(0, Math.min(left, maxLeft))}px`;
  controls.style.top = `${Math.max(0, Math.min(top, maxTop))}px`;
  controls.style.right = "auto";
}
controlsHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const rect = controls.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  controlsHandle.setPointerCapture(event.pointerId);
  const move = (e) => {
    if (e.pointerId === event.pointerId)
      placeControls(e.clientX - offsetX, e.clientY - offsetY);
  };
  const finish = (e) => {
    if (e.pointerId !== event.pointerId) return;
    controlsHandle.removeEventListener("pointermove", move);
    controlsHandle.removeEventListener("lostpointercapture", finish);
  };
  controlsHandle.addEventListener("pointermove", move);
  controlsHandle.addEventListener("lostpointercapture", finish);
  event.preventDefault();
});
function clampControls() {
  if (controls.style.left && controls.offsetWidth)
    placeControls(
      parseFloat(controls.style.left),
      parseFloat(controls.style.top),
    );
}
window.addEventListener("resize", clampControls);
new ResizeObserver(clampControls).observe(controls);

function updateChatAvailability() {
  const available = connected && state?.chat === true;
  $("chat-input").disabled = !available;
  $("chat-send").disabled = !available;
  $("chat-input").placeholder = available
    ? "Type a message…"
    : connected
      ? "Chat unavailable on this server"
      : "Chat unavailable while offline";
}
$("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("chat-input");
  const message = input.value.trim();
  if (!message) return;
  if ([...message].length > 280) {
    addActivity("Messages must be 280 characters or fewer", "activity-notice");
    return;
  }
  if (!connected || state?.chat !== true || socket?.readyState !== WebSocket.OPEN) {
    addActivity("Not connected to the table", "activity-notice");
    return;
  }
  send({ type: "chat", message });
  input.value = "";
});

const activityPanel = $("activity-panel");
const activityHandle = $("activity-handle");
const activityResize = $("activity-resize");
function placeActivity(left, top, width, height) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  width = Math.min(Math.max(180, width), vw);
  height = Math.min(Math.max(120, height), vh);
  activityPanel.style.width = `${width}px`;
  activityPanel.style.height = `${height}px`;
  activityPanel.style.left = `${Math.max(0, Math.min(left, vw - width))}px`;
  activityPanel.style.top = `${Math.max(0, Math.min(top, vh - height))}px`;
  activityPanel.style.right = "auto";
}
function activityPointer(handle, resize) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = activityPanel.getBoundingClientRect();
    const x = event.clientX,
      y = event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - x,
        dy = e.clientY - y;
      placeActivity(
        rect.left + (resize ? 0 : dx),
        rect.top + (resize ? 0 : dy),
        rect.width + (resize ? dx : 0),
        rect.height + (resize ? dy : 0),
      );
    };
    const finish = (e) => {
      if (e.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("lostpointercapture", finish);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", finish);
    event.preventDefault();
  });
  handle.addEventListener("keydown", (event) => {
    const dx =
      event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0;
    const dy =
      event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0;
    if (!dx && !dy) return;
    const r = activityPanel.getBoundingClientRect();
    placeActivity(
      r.left + (resize ? 0 : dx),
      r.top + (resize ? 0 : dy),
      r.width + (resize ? dx : 0),
      r.height + (resize ? dy : 0),
    );
    event.preventDefault();
  });
}
activityPointer(activityHandle, false);
activityPointer(activityResize, true);
window.addEventListener("resize", () => {
  if (!activityPanel.offsetWidth) return;
  const r = activityPanel.getBoundingClientRect();
  placeActivity(r.left, r.top, r.width, r.height);
});

$("seats").onclick = (event) => {
  const button = event.target.closest("[data-seat]");
  if (button) send({ type: "seat", seat: Number(button.dataset.seat) });
  const target = event.target.closest("[data-look-seat]");
  if (target) lookAtSeat(Number(target.dataset.lookSeat));
};
function lookAtSeat(seat) {
  if (!choosingLook || seat === state.you || !state.seats[seat]?.connected)
    return;
  choosingLook = false;
  send({ type: "look", seat });
  render();
}
$("look-button").onclick = () => {
  choosingLook = !choosingLook;
  render();
};
document.addEventListener("blunderjack:look", ({ detail }) => lookAtSeat(detail));
function showReorder(seat) {
  document.dispatchEvent(
    new CustomEvent("blunderjack:reorder", { detail: { seat } }),
  );
}
document.addEventListener("blunderjack:hand-reordered", () => {
  if (connected && state?.cosmeticReorder) send({ type: "reorder" });
  else if (state?.you != null) showReorder(state.you);
});
document.addEventListener("dragstart", (event) => event.preventDefault());
document.addEventListener("blunderjack:gaze-aim", ({ detail }) => {
  if (connected && state?.sharedGaze && state.you != null) {
    send({
      type: "gaze",
      yaw: detail?.yaw ?? null,
      pitch: detail?.pitch ?? null,
      ...(detail?.yaw != null && detail?.pitch != null && detail?.zoom != null
        ? { zoom: detail.zoom }
        : {}),
    });
  }
});
$("watch-button").onclick = () => {
  if (state?.you != null) send({ type: "stand" });
  else toast("You are watching the table");
};
function sortHand(bySuit) {
  const cards = new Map((state?.hand || []).map((card) => [card.id, card]));
  const suitOrder = { hearts: 0, diamonds: 1, spades: 2, clubs: 3 };
  const previous = order.slice();
  order.sort((a, b) => {
    const left = cards.get(a),
      right = cards.get(b);
    if (!left || !right) return 0;
    const rank = left.rank - right.rank;
    const suit = suitOrder[left.suit] - suitOrder[right.suit];
    return bySuit ? suit || rank : rank || suit;
  });
  if (order.some((id, i) => id !== previous[i])) {
    renderHand();
    document.dispatchEvent(new Event("blunderjack:hand-reordered"));
  }
}
$("sort-value").onclick = () => sortHand(false);
$("sort-suit").onclick = () => sortHand(true);
$("hide-hand").onclick = () => {
  hidden = !hidden;
  render();
};
$("clear-selection").onclick = () => {
  selected = [];
  render();
};
$("submit-button").onclick = () => {
  if (selected.length) takeAction({ type: "play", cards: selected });
};
$("draw-button").onclick = () => takeAction({ type: "draw" });
$("last-card-button").onclick = () => takeAction({ type: "last_card" });
$("blunder-button").onclick = () => {
  enableBlunderAudio();
  takeAction({
    type: "blunder",
    playId: state?.challengePlayId ?? state?.game?.last?.id,
  });
};

function startIntro() {
  const welcome = $("welcome");
  const heading = welcome.querySelector(".welcome-heading");
  const card = $("intro-card");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    welcome.classList.remove("intro-pending");
    if (firstRun) profileModal();
    return;
  }
  card.innerHTML = cardMarks({ rank: 11, suit: "spades" });
  let finished = false;
  let frame;
  let fallback;
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    welcome.classList.remove("intro-running");
    heading.style.clipPath = "";
    main.inert = false;
    document.removeEventListener("keydown", skipKey, true);
    document.removeEventListener("click", skipClick, true);
    window.removeEventListener("resize", centerCard);
    if (firstRun) profileModal();
  }
  function skipKey(event) {
    if (event.target.closest("#music-player")) return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish();
  }
  function skipClick(event) {
    if (event.target.closest("#music-player")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish();
  }
  function reveal() {
    if (finished) return;
    const titleRect = heading.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const revealed = Math.max(
      0,
      Math.min(1, (cardRect.left - titleRect.left) / titleRect.width),
    );
    heading.style.clipPath = `inset(0 ${(1 - revealed) * 100}% 0 0)`;
    frame = requestAnimationFrame(reveal);
  }
  function centerCard() {
    const headingRect = heading.getBoundingClientRect();
    card.style.top = `${headingRect.top + headingRect.height / 2}px`;
  }
  card.addEventListener("animationstart", reveal, { once: true });
  card.addEventListener("animationend", finish, { once: true });
  card.addEventListener("animationcancel", finish, { once: true });
  document.addEventListener("keydown", skipKey, true);
  document.addEventListener("click", skipClick, true);
  main.inert = true;
  window.addEventListener("resize", centerCard);
  centerCard();
  welcome.classList.replace("intro-pending", "intro-running");
  fallback = setTimeout(finish, 1800);
}
startIntro();
