use rand::seq::SliceRandom;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Card {
    pub id: u32,
    pub rank: u8,
    pub suit: Suit,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct CardFace {
    pub rank: u8,
    pub suit: Suit,
}
impl From<Card> for CardFace {
    fn from(c: Card) -> Self {
        Self {
            rank: c.rank,
            suit: c.suit,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Penalty {
    pub kind: String,
    pub amount: usize,
}
#[derive(Clone, Debug, Serialize)]
pub struct PlayView {
    pub id: u64,
    pub seat: usize,
    pub kind: String,
    pub cards: Vec<CardFace>,
    pub amount: usize,
    pub outcome: Option<String>,
    pub caller: Option<usize>,
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<usize>,
}
#[derive(Clone, Debug, Serialize)]
pub struct PlacedView {
    pub id: u64,
    pub seat: usize,
    pub cards: Vec<CardFace>,
}
#[derive(Clone, Debug, Serialize)]
pub struct GameView {
    pub round: u32,
    pub dealer: Option<usize>,
    pub current: Option<usize>,
    pub direction: i8,
    pub active: Vec<usize>,
    pub counts: Vec<usize>,
    pub last_card_calls: Vec<bool>,
    pub pickup: usize,
    pub pot: Option<CardFace>,
    pub pot_count: usize,
    pub penalty: Option<Penalty>,
    pub last: Option<PlayView>,
    pub last_placed: Option<PlacedView>,
    pub candidate: Option<usize>,
    pub winner: Option<usize>,
    pub placements: Vec<usize>,
    pub finished: bool,
}
#[derive(Clone)]
struct Snapshot {
    hands: Vec<Vec<Card>>,
    pickup: Vec<Card>,
    pot: Vec<Card>,
    current: Option<usize>,
    direction: i8,
    penalty: Option<Penalty>,
    candidate: Option<usize>,
    last_placed: Option<PlacedView>,
}
#[derive(Clone)]
struct Challenge {
    offender: usize,
    valid: bool,
    before: Snapshot,
}

#[derive(Clone)]
struct LastCardChallenge {
    offender: usize,
    play_id: u64,
    called: bool,
    card: Card,
    cards: Vec<CardFace>,
    previous_placed: Option<PlacedView>,
}

pub struct Game {
    round: u32,
    dealer: Option<usize>,
    current: Option<usize>,
    direction: i8,
    active: Vec<usize>,
    hands: Vec<Vec<Card>>,
    pickup: Vec<Card>,
    pot: Vec<Card>,
    penalty: Option<Penalty>,
    last: Option<PlayView>,
    last_placed: Option<PlacedView>,
    candidate: Option<usize>,
    winner: Option<usize>,
    placements: Vec<usize>,
    finished: bool,
    challenge: Option<Challenge>,
    last_card_challenge: Option<LastCardChallenge>,
    last_card_calls: Vec<bool>,
    next_play_id: u64,
}
impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}
impl Game {
    pub fn new() -> Self {
        Self {
            round: 0,
            dealer: None,
            current: None,
            direction: 1,
            active: vec![],
            hands: vec![vec![]; 10],
            pickup: vec![],
            pot: vec![],
            penalty: None,
            last: None,
            last_placed: None,
            candidate: None,
            winner: None,
            placements: vec![],
            finished: true,
            challenge: None,
            last_card_challenge: None,
            last_card_calls: vec![false; 10],
            next_play_id: 1,
        }
    }
    fn next_from(&self, seat: usize, direction: i8) -> Option<usize> {
        (1..=10)
            .map(|n| ((seat as i32 + direction as i32 * n).rem_euclid(10)) as usize)
            .find(|s| self.active.contains(s))
    }
    pub fn start(&mut self, seats: &[usize]) -> Result<(), String> {
        if seats.len() < 2 || seats.len() > 10 || seats.iter().any(|&s| s >= 10) {
            return Err("A round needs 2–10 valid seats".into());
        }
        let mut active = seats.to_vec();
        active.sort_unstable();
        active.dedup();
        if active.len() != seats.len() {
            return Err("Duplicate seat".into());
        }
        self.active = active;
        self.dealer = Some(match self.dealer {
            Some(d) => self.next_from(d, 1).unwrap(),
            None => self.active[0],
        });
        self.current = self.next_from(self.dealer.unwrap(), 1);
        self.direction = 1;
        self.round += 1;
        self.hands = vec![vec![]; 10];
        self.pot.clear();
        self.penalty = None;
        self.last = None;
        self.last_placed = None;
        self.candidate = None;
        self.winner = None;
        self.placements.clear();
        self.finished = false;
        self.challenge = None;
        self.last_card_challenge = None;
        self.last_card_calls.fill(false);
        let decks = match self.active.len() {
            2..=4 => 2,
            5..=7 => 3,
            _ => 4,
        };
        self.pickup = (0..decks)
            .flat_map(|d| {
                [Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades]
                    .into_iter()
                    .enumerate()
                    .flat_map(move |(s, suit)| {
                        (1..=13).map(move |rank| Card {
                            id: (d * 52 + s * 13 + rank as usize) as u32,
                            rank,
                            suit,
                        })
                    })
            })
            .collect();
        self.pickup.shuffle(&mut rand::rng());
        let mut ids: Vec<u32> = (1..=self.pickup.len() as u32).collect();
        ids.shuffle(&mut rand::rng());
        for (card, id) in self.pickup.iter_mut().zip(ids) {
            card.id = id;
        }
        for _ in 0..7 {
            for &seat in &self.active {
                self.hands[seat].push(self.pickup.pop().unwrap());
            }
        }
        self.pot.push(self.pickup.pop().unwrap());
        Ok(())
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            hands: self.hands.clone(),
            pickup: self.pickup.clone(),
            pot: self.pot.clone(),
            current: self.current,
            direction: self.direction,
            penalty: self.penalty.clone(),
            candidate: self.candidate,
            last_placed: self.last_placed.clone(),
        }
    }
    fn restore(&mut self, s: Snapshot) {
        self.hands = s.hands;
        self.pickup = s.pickup;
        self.pot = s.pot;
        self.current = s.current;
        self.direction = s.direction;
        self.penalty = s.penalty;
        self.candidate = s.candidate;
        self.last_placed = s.last_placed;
    }
    fn is_black(c: Card) -> bool {
        c.rank == 11 && matches!(c.suit, Suit::Clubs | Suit::Spades)
    }
    fn is_red(c: Card) -> bool {
        c.rank == 11 && matches!(c.suit, Suit::Diamonds | Suit::Hearts)
    }
    fn legal(&self, cards: &[Card]) -> bool {
        if let Some(p) = &self.penalty {
            return match p.kind.as_str() {
                "two" => cards.iter().all(|c| c.rank == 2),
                "jack" => {
                    cards.iter().all(|&c| Self::is_black(c))
                        || (cards.len() == 1 && Self::is_red(cards[0]))
                }
                _ => false,
            };
        }
        let top = *self.pot.last().unwrap();
        let first = cards[0];
        if first.rank != 1 && first.rank != top.rank && first.suit != top.suit {
            return false;
        }
        cards.windows(2).all(|pair| {
            let a = pair[0];
            let b = pair[1];
            if a.rank == 1 {
                a.suit == b.suit && (b.rank == 13 || b.rank == 2)
            } else {
                a.rank == b.rank
                    || (a.suit == b.suit && (b.rank == 1 || a.rank.abs_diff(b.rank) == 1))
            }
        })
    }
    fn draw_cards(&mut self, seat: usize, count: usize) -> usize {
        let mut drawn = 0;
        for _ in 0..count {
            // Keep the card under a challengeable top so it can become the new POT.
            let keep = if self.last_card_challenge.is_some() {
                2
            } else {
                1
            };
            if self.pickup.is_empty() && self.pot.len() > keep {
                let recyclable = self.pot.len() - keep;
                self.pickup = self.pot.drain(..recyclable).rev().collect();
            }
            if let Some(c) = self.pickup.pop() {
                self.hands[seat].push(c);
                self.last_card_calls[seat] = false;
                drawn += 1;
            } else {
                break;
            }
        }
        drawn
    }
    fn check_turn(&self, seat: usize) -> Result<(), String> {
        if self.finished
            || self.candidate.is_some()
            || self.current != Some(seat)
            || !self.active.contains(&seat)
        {
            Err("It is not your turn".into())
        } else {
            Ok(())
        }
    }
    fn record(&mut self, seat: usize, kind: &str, cards: Vec<CardFace>, amount: usize) {
        let id = self.next_play_id;
        self.next_play_id += 1;
        self.last = Some(PlayView {
            id,
            seat,
            kind: kind.into(),
            cards,
            amount,
            outcome: None,
            caller: None,
            reason: None,
            skipped: vec![],
        });
    }
    pub fn submit(&mut self, seat: usize, ids: &[u32]) -> Result<(), String> {
        self.check_turn(seat)?;
        if ids.is_empty() {
            return Err("Select at least one card".into());
        }
        let mut cards = Vec::new();
        for id in ids {
            if cards.iter().any(|c: &Card| c.id == *id) {
                return Err("Duplicate card".into());
            }
            cards.push(
                *self.hands[seat]
                    .iter()
                    .find(|c| c.id == *id)
                    .ok_or("Card is not in your hand")?,
            );
        }
        let valid = self.legal(&cards);
        if ids.len() == self.hands[seat].len() && !valid {
            return Err("A finishing play must be legal".into());
        }
        let before = self.snapshot();
        self.last_card_calls[seat] = false;
        self.last_card_challenge = None;
        self.hands[seat].retain(|c| !ids.contains(&c.id));
        self.pot.extend(cards.iter().copied());
        let last = *cards.last().unwrap();
        if self.penalty.as_ref().is_some_and(|p| p.kind == "jack")
            && cards.len() == 1
            && Self::is_red(last)
        {
            self.penalty = None;
        } else if last.rank == 2 {
            let count = cards.iter().rev().take_while(|c| c.rank == 2).count();
            let prev = self
                .penalty
                .as_ref()
                .filter(|p| p.kind == "two")
                .map_or(0, |p| p.amount);
            self.penalty = Some(Penalty {
                kind: "two".into(),
                amount: prev + 2 * count,
            });
        } else if Self::is_black(last) {
            let count = cards
                .iter()
                .rev()
                .take_while(|&&c| Self::is_black(c))
                .count();
            let prev = self
                .penalty
                .as_ref()
                .filter(|p| p.kind == "jack")
                .map_or(0, |p| p.amount);
            self.penalty = Some(Penalty {
                kind: "jack".into(),
                amount: if prev == 0 {
                    7 * count
                } else {
                    prev.saturating_mul(2usize.saturating_pow(count as u32))
                },
            });
        } else {
            self.penalty = None;
        }
        if last.rank == 8 {
            self.direction *= -1;
        }
        let skips = if last.rank == 12 {
            cards.iter().rev().take_while(|c| c.rank == 12).count()
        } else {
            0
        };
        let mut skipped = Vec::with_capacity(skips);
        let mut next = seat;
        for _ in 0..skips {
            next = self.next_from(next, self.direction).unwrap();
            skipped.push(next);
        }
        self.current = self.next_from(next, self.direction);
        if self.hands[seat].is_empty() {
            self.candidate = Some(seat);
        }
        self.record(
            seat,
            "play",
            cards.iter().copied().map(Into::into).collect(),
            0,
        );
        let play = self.last.as_mut().unwrap();
        play.skipped = skipped;
        self.last_placed = Some(PlacedView {
            id: play.id,
            seat,
            cards: play.cards.clone(),
        });
        if self.hands[seat].len() == 1 {
            self.last_card_challenge = Some(LastCardChallenge {
                offender: seat,
                play_id: play.id,
                called: false,
                card: last,
                cards: play.cards.clone(),
                previous_placed: before.last_placed.clone(),
            });
        }
        self.challenge = Some(Challenge {
            offender: seat,
            valid,
            before,
        });
        Ok(())
    }
    pub fn draw(&mut self, seat: usize) -> Result<(), String> {
        self.check_turn(seat)?;
        self.challenge = None;
        self.last_card_calls[seat] = false;
        let count = self.penalty.take().map_or(1, |p| p.amount);
        let amount = self.draw_cards(seat, count);
        self.current = self.next_from(seat, self.direction);
        self.record(seat, "draw", vec![], amount);
        Ok(())
    }
    pub fn call_last_card(&mut self, seat: usize) -> Result<(), String> {
        if self.finished || !self.active.contains(&seat) || self.hands[seat].len() != 1 {
            return Err("You must hold exactly one card to call Last Card".into());
        }
        if self.last_card_calls[seat] {
            return Err("You already called Last Card".into());
        }
        let challenge = self
            .last_card_challenge
            .as_mut()
            .filter(|challenge| challenge.offender == seat)
            .ok_or("The Last Card call window has closed")?;
        challenge.called = true;
        self.last_card_calls[seat] = true;
        Ok(())
    }
    pub fn challenge_id(&self, seat: usize) -> Option<u64> {
        if self.finished || !self.active.contains(&seat) {
            return None;
        }
        if let Some(c) = &self.challenge {
            if c.offender != seat {
                return self.last.as_ref().map(|p| p.id);
            }
        }
        self.last_card_challenge
            .as_ref()
            .filter(|c| c.offender != seat)
            .map(|c| c.play_id)
    }
    pub fn can_blunder(&self, seat: usize) -> bool {
        self.challenge_id(seat).is_some()
    }
    pub fn blunder(&mut self, caller: usize) -> Result<(), String> {
        if !self.can_blunder(caller) {
            return Err("No play available to challenge".into());
        }
        // An illegal play takes priority over the Last Card rule.
        let illegal = self
            .challenge
            .as_ref()
            .is_some_and(|c| !c.valid && c.offender != caller);
        if !illegal {
            if let Some(special) = self
                .last_card_challenge
                .take()
                .filter(|c| c.offender != caller)
            {
                self.challenge = None;
                let called = special.called;
                let target = if called { caller } else { special.offender };
                if !called {
                    let card = self
                        .pot
                        .pop()
                        .expect("Last Card challenge requires the top card");
                    debug_assert_eq!(card.id, special.card.id);
                    self.hands[special.offender].push(card);
                    self.last_card_calls[special.offender] = false;
                    if let Some(placed) = &mut self.last_placed {
                        placed.cards.pop();
                        if placed.cards.is_empty() {
                            self.last_placed = special.previous_placed;
                        }
                    }
                }
                let amount = self.draw_cards(target, 1);
                self.record(special.offender, "blunder", special.cards, amount);
                if let Some(last) = &mut self.last {
                    last.outcome = Some(if called { "valid" } else { "invalid" }.into());
                    last.caller = Some(caller);
                    last.reason = Some("last_card".into());
                }
                return Ok(());
            }
        }
        let challenge = self.challenge.take().unwrap();
        self.last_card_challenge = None;
        let cards = self
            .last
            .as_ref()
            .map_or_else(Vec::new, |p| p.cards.clone());
        let (target, outcome) = if challenge.valid {
            (caller, "valid")
        } else {
            self.restore(challenge.before);
            self.last_card_calls[challenge.offender] = false;
            (challenge.offender, "invalid")
        };
        let amount = self.draw_cards(target, 2);
        if !challenge.valid {
            self.current = self.next_from(challenge.offender, self.direction);
        }
        self.record(challenge.offender, "blunder", cards, amount);
        if let Some(last) = &mut self.last {
            last.outcome = Some(outcome.into());
            last.caller = Some(caller);
        }
        Ok(())
    }
    pub fn remove_player(&mut self, seat: usize) {
        if !self.active.contains(&seat) {
            return;
        }
        self.last_card_calls[seat] = false;
        if self
            .last_card_challenge
            .as_ref()
            .is_some_and(|c| c.offender == seat)
        {
            self.last_card_challenge = None;
        }
        // Keep a pending challenge when an unrelated player leaves, and apply their
        // departure to its rollback state as well.
        if self.challenge.as_ref().is_some_and(|c| c.offender == seat) {
            self.challenge = None;
        } else if let Some(challenge) = &mut self.challenge {
            let cards = std::mem::take(&mut challenge.before.hands[seat]);
            challenge.before.pickup.splice(0..0, cards);
        }
        let was_current = self.current == Some(seat);
        let next = self.next_from(seat, self.direction);
        self.active.retain(|&s| s != seat);
        let cards = std::mem::take(&mut self.hands[seat]);
        self.pickup.splice(0..0, cards);
        if self.candidate == Some(seat) {
            self.candidate = None;
        }
        if self.active.len() <= 1 {
            self.finish_if_complete();
        } else if was_current {
            self.current = next;
        }
    }
    // Once only one player remains, they take the next available podium place.
    // Departed players never take a place; already confirmed places are preserved.
    fn finish_if_complete(&mut self) {
        if self.placements.len() < 3 && self.active.len() == 1 {
            let seat = self.active.pop().unwrap();
            self.placements.push(seat);
            if self.winner.is_none() {
                self.winner = Some(seat);
            }
        }
        if self.placements.len() >= 3 || self.active.is_empty() {
            self.finished = true;
            self.current = None;
            self.candidate = None;
            self.challenge = None;
            self.last_card_challenge = None;
            self.last_card_calls.fill(false);
        }
    }
    pub fn finish(&mut self) {
        if let Some(seat) = self.candidate.take() {
            let next = self.next_from(seat, self.direction);
            self.active.retain(|&s| s != seat);
            self.placements.push(seat);
            if self.winner.is_none() {
                self.winner = Some(seat);
            }
            if self.current == Some(seat) {
                self.current = next.filter(|&s| s != seat);
            }
            self.challenge = None;
            self.last_card_challenge = None;
            self.last_card_calls[seat] = false;
            self.finish_if_complete();
        }
    }
    pub fn public(&self) -> GameView {
        let mut counts = vec![0; 10];
        for &s in &self.active {
            counts[s] = self.hands[s].len();
        }
        GameView {
            round: self.round,
            dealer: self.dealer,
            current: self.current,
            direction: self.direction,
            active: self.active.clone(),
            counts,
            last_card_calls: self.last_card_calls.clone(),
            pickup: self.pickup.len(),
            pot: self.pot.last().copied().map(Into::into),
            pot_count: self.pot.len(),
            penalty: self.penalty.clone(),
            last: self.last.clone(),
            last_placed: self.last_placed.clone(),
            candidate: self.candidate,
            winner: self.winner,
            placements: self.placements.clone(),
            finished: self.finished,
        }
    }
    pub fn hand(&self, seat: usize) -> &[Card] {
        self.hands.get(seat).map_or(&[], Vec::as_slice)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn card(id: u32, rank: u8, suit: Suit) -> Card {
        Card { id, rank, suit }
    }
    fn fixture() -> Game {
        let mut g = Game::new();
        g.start(&[0, 3, 8]).unwrap();
        g.current = Some(3);
        g.pot = vec![card(900, 5, Suit::Hearts)];
        g.pickup = (100..110).map(|id| card(id, 4, Suit::Clubs)).collect();
        g.hands[3] = vec![
            card(1, 5, Suit::Clubs),
            card(2, 6, Suit::Clubs),
            card(3, 9, Suit::Spades),
        ];
        g
    }
    #[test]
    fn round_deals_and_advances_dealer() {
        let mut g = Game::new();
        g.start(&[2, 7]).unwrap();
        assert_eq!(g.public().dealer, Some(2));
        assert_eq!(g.public().current, Some(7));
        assert_eq!(g.hand(2).len(), 7);
        assert_eq!(g.public().pickup, 89);
        assert_eq!(g.public().pot_count, 1);
        g.start(&[2, 7]).unwrap();
        assert_eq!(g.public().dealer, Some(7));
    }
    #[test]
    fn chain_and_ace_restriction() {
        let g = fixture();
        assert!(g.legal(&[card(1, 5, Suit::Clubs), card(2, 6, Suit::Clubs)]));
        assert!(g.legal(&[card(1, 1, Suit::Clubs), card(2, 13, Suit::Clubs)]));
        assert!(!g.legal(&[card(1, 1, Suit::Clubs), card(2, 1, Suit::Spades)]));
    }
    #[test]
    fn invalid_play_is_reverted_on_challenge() {
        let mut g = fixture();
        let old = g.pot.clone();
        g.submit(3, &[3]).unwrap();
        assert_eq!(g.public().pot_count, 2);
        assert_eq!(g.current, Some(8));
        g.blunder(0).unwrap();
        assert_eq!(g.pot, old);
        assert_eq!(g.public().pot_count, 1);
        assert_eq!(g.hand(3).len(), 5);
        assert_eq!(g.current, Some(8));
        assert_eq!(g.last.unwrap().outcome.as_deref(), Some("invalid"));
    }
    #[test]
    fn valid_challenge_penalizes_caller_and_closes_window() {
        let mut g = fixture();
        g.submit(3, &[1, 2]).unwrap();
        let before = g.hand(0).len();
        g.blunder(0).unwrap();
        assert_eq!(g.hand(0).len(), before + 2);
        assert!(!g.can_blunder(8));
    }
    #[test]
    fn illegal_finish_does_not_mutate() {
        let mut g = fixture();
        g.hands[3] = vec![card(3, 9, Suit::Spades)];
        assert!(g.submit(3, &[3]).is_err());
        assert_eq!(g.hand(3).len(), 1);
        assert_eq!(g.pot.len(), 1);
    }
    #[test]
    fn penalties_stack_and_cancel() {
        let mut g = fixture();
        g.hands[3] = vec![
            card(1, 2, Suit::Hearts),
            card(2, 2, Suit::Clubs),
            card(3, 9, Suit::Spades),
        ];
        g.submit(3, &[1, 2]).unwrap();
        assert_eq!(g.penalty.as_ref().unwrap().amount, 4);
        g.hands[8] = vec![card(4, 2, Suit::Spades), card(5, 8, Suit::Clubs)];
        g.submit(8, &[4]).unwrap();
        assert_eq!(g.penalty.as_ref().unwrap().amount, 6);
        g.draw(0).unwrap();
        assert!(g.penalty.is_none());
    }
    #[test]
    fn recycle_preserves_oldest_first_and_top() {
        let mut g = fixture();
        g.pickup.clear();
        g.pot = vec![
            card(10, 3, Suit::Clubs),
            card(11, 4, Suit::Clubs),
            card(12, 5, Suit::Clubs),
        ];
        assert_eq!(g.draw_cards(3, 3), 2);
        assert_eq!(g.hand(3)[3].id, 10);
        assert_eq!(g.hand(3)[4].id, 11);
        assert_eq!(g.pot[0].id, 12);
        assert_eq!(g.public().pot_count, 1);
    }
    #[test]
    fn departure_preserves_challenge_and_does_not_restore_hand() {
        let mut g = fixture();
        g.submit(3, &[3]).unwrap();
        g.remove_player(8);
        assert!(g.can_blunder(0));
        g.blunder(0).unwrap();
        assert!(g.hand(8).is_empty());
        assert_eq!(g.current, Some(0));
    }
    #[test]
    fn finish_and_forfeit() {
        let mut g = fixture();
        g.hands[3] = vec![card(1, 5, Suit::Clubs)];
        g.submit(3, &[1]).unwrap();
        assert_eq!(g.candidate, Some(3));
        g.finish();
        assert_eq!(g.winner, Some(3));
        let mut g = fixture();
        g.remove_player(3);
        assert_eq!(g.current, Some(8));
        g.remove_player(8);
        assert_eq!(g.winner, Some(0));
    }
    #[test]
    fn deck_tiers() {
        for (players, decks) in [(2, 2), (4, 2), (5, 3), (7, 3), (8, 4), (10, 4)] {
            let mut g = Game::new();
            g.start(&(0..players).collect::<Vec<_>>()).unwrap();
            assert_eq!(
                g.pickup.len() + g.pot.len() + g.hands.iter().map(Vec::len).sum::<usize>(),
                decks * 52
            );
        }
    }
    #[test]
    fn unchallenged_illegal_play_stands() {
        let mut g = fixture();
        g.submit(3, &[3]).unwrap();
        g.draw(8).unwrap();
        assert_eq!(g.pot.last().unwrap().id, 3);
        assert!(!g.can_blunder(0));
    }
    #[test]
    fn effects_depend_on_final_card_and_trailing_run() {
        let mut g = fixture();
        g.pot = vec![card(900, 12, Suit::Hearts)];
        g.hands[3] = vec![
            card(1, 12, Suit::Hearts),
            card(2, 12, Suit::Clubs),
            card(3, 11, Suit::Clubs),
            card(4, 9, Suit::Spades),
        ];
        g.submit(3, &[1, 2, 3]).unwrap();
        assert_eq!(g.current, Some(8));
        assert_eq!(g.penalty.as_ref().unwrap().amount, 7);
        let mut g = fixture();
        g.pot = vec![card(900, 12, Suit::Hearts)];
        g.hands[3] = vec![
            card(1, 12, Suit::Hearts),
            card(2, 12, Suit::Clubs),
            card(4, 9, Suit::Spades),
        ];
        g.submit(3, &[1, 2]).unwrap();
        assert_eq!(g.current, Some(3));
        let mut g = fixture();
        g.pot = vec![card(900, 2, Suit::Hearts)];
        g.hands[3] = vec![
            card(1, 2, Suit::Hearts),
            card(2, 3, Suit::Hearts),
            card(3, 2, Suit::Hearts),
            card(4, 9, Suit::Spades),
        ];
        g.submit(3, &[1, 2, 3]).unwrap();
        assert_eq!(g.penalty.unwrap().amount, 2);
    }
    #[test]
    fn eight_reverses_from_offender() {
        let mut g = fixture();
        g.hands[3] = vec![card(1, 8, Suit::Hearts), card(2, 9, Suit::Spades)];
        g.submit(3, &[1]).unwrap();
        assert_eq!(g.direction, -1);
        assert_eq!(g.current, Some(0));
    }
    #[test]
    fn black_jacks_add_double_and_red_cancels() {
        let mut g = fixture();
        g.pot = vec![card(900, 11, Suit::Hearts)];
        g.hands[3] = vec![
            card(1, 11, Suit::Clubs),
            card(2, 11, Suit::Spades),
            card(3, 11, Suit::Clubs),
            card(4, 9, Suit::Spades),
        ];
        g.hands[8] = vec![
            card(5, 11, Suit::Spades),
            card(6, 11, Suit::Clubs),
            card(7, 9, Suit::Spades),
        ];
        g.hands[0] = vec![card(8, 11, Suit::Diamonds), card(9, 9, Suit::Clubs)];
        g.submit(3, &[1, 2, 3]).unwrap();
        assert_eq!(g.penalty.as_ref().unwrap().amount, 21);
        g.submit(8, &[5, 6]).unwrap();
        assert_eq!(g.penalty.as_ref().unwrap().amount, 84);
        g.submit(0, &[8]).unwrap();
        assert!(g.penalty.is_none());
    }
    #[test]
    fn forced_draw_takes_only_available_cards() {
        let mut g = fixture();
        g.pickup = vec![card(100, 4, Suit::Clubs)];
        g.pot = vec![card(900, 2, Suit::Hearts)];
        g.penalty = Some(Penalty {
            kind: "two".into(),
            amount: 8,
        });
        let before = g.hand(3).len();
        g.draw(3).unwrap();
        assert_eq!(g.hand(3).len(), before + 1);
        assert_eq!(g.last.unwrap().amount, 1);
        assert_eq!(g.current, Some(8));
        assert!(g.penalty.is_none());
    }
}
