# Play table UI overhaul (to do, planned for the Sonnet UI block)

User request (2026-10-23): make card handling and the table feel like https://riftatlas.com/play.
Reference screenshots: `ui-ref/riftatlas-table.webp` (target), `ui-ref/pay-buttons-today.png` (current).

## Problems today
- Payment is a row of identical buttons ("Pay: exhaust 3 runes" ×3) — the player can't tell the plans apart.
- Rune cards take a lot of room in a flat row.

## Wanted
- **Manual rune payment flow:** after choosing a card, show a clear hint
  ("Exhaust 3 runes to pay"), let the player click runes on the board to exhaust/recycle
  them (selected runes visibly tilt/dim, a counter shows paid / needed per domain),
  then confirm with a **Play / Confirm** button at the bottom → the card is played.
  Keep auto-pay as a shortcut button.
- **Runes stacked/overlapping** (fanned like the reference) to save space.
- General riftatlas-like layout: large central battlefields with units on them,
  base row per player, rune pool row near each player's base, point tracks on the side,
  right rail with turn/log, selected card preview and an action button (Resolve / End turn),
  hand fanned at the bottom, floating Energy/Power counters, deck/trash piles in corners.
- Arrows/lines from a spell to its target while it's on the chain.

## Play tab like the League client (user request 2026-10-23)
- Mode picker: **Ranked**, **Unranked**, **Custom** (private lobby, all cards available), vs Computer, Tutorial.
- Goal: real online play between players (server-authoritative engine, matchmaking, ranked rating).
- Tutorial opponent: a **random other starter deck** (today it is fixed: Garen, or Lux if you own Garen).
- Custom decks from the deck builder must be playable → needs all cards defined in the engine first.
