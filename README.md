# 🍻 Last Orders

A Jackbox-style party drinking game for you and your mates. One big screen (TV / laptop) hosts,
everyone plays on their phone in the browser — no app, no accounts.

## How to play

1. On the TV or laptop, open the site and tap **Host on this screen**.
2. Everyone else scans the QR code (or opens the site) and enters the **4-letter room code** and a name.
3. Pick the number of rounds and the timer, then hit **start**.

### Round types

| Round | What happens | Who drinks |
|---|---|---|
| ✍️ **Quip Clash** | Everyone fills in the blank, then votes for the funniest answer | Answers with zero votes drink 2 · no answer drinks 2 |
| 👉 **Most Likely To** | Vote for the friend who best fits the prompt | Most-voted player drinks 2 |
| ⚖️ **Would You Rather** | Pick a side | The minority drinks 1 (a dead-even split: everyone drinks) |
| 🙊 **Never Have I Ever** | Confess on your phone | Everyone who has drinks 1 (+50 pts for honesty) |
| 🍻 **Social** | A rule for the whole room | Whoever the rule says |

Too slow to answer? That's a sip. Points decide the winner; sips are tracked for the "Thirstiest player" award.

Please drink responsibly — a "sip" can be any drink, water included.

## Tech

- **Static site** (plain HTML/CSS/ES modules, no build step), hosted on **GitHub Pages**.
- **Supabase** stores rooms, players, answers and votes, and pushes live updates via Realtime.
- Logins are room code + nickname. Each browser gets a random secret token (kept in `localStorage`) that
  identifies the player or host, so a refresh or locked phone rejoins automatically.
- The browser can only **read** game tables. Every write goes through `SECURITY DEFINER` functions
  (`dg_create_room`, `dg_join_room`, `dg_submit`, `dg_host_*`) that check the caller's token, so players can't
  edit scores or act as host. Token tables are not readable by the public key at all.
- The host screen runs the game clock: it advances phases, scores each round and writes results back.
- Rooms idle for 12 hours are deleted automatically when a new room is created.

```
index.html          entry point
css/style.css       all styles
js/config.js        Supabase URL + publishable key
js/app.js           home screen + routing
js/host.js          big-screen host and game engine
js/player.js        phone controller
js/logic.js         round plan + scoring rules (pure, testable)
js/prompts.js       prompt decks — add your own in-jokes!
supabase/migrations database schema, RLS and RPC functions
```

## Setup

1. Create a Supabase project and run `supabase/migrations/001_init.sql` in the SQL editor.
2. Put the project URL and publishable (anon) key in `js/config.js`.
3. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
4. Open `https://<your-user>.github.io/drinking-game/`.

To run locally: `python3 -m http.server` in this folder and open http://localhost:8000.

## Adding prompts

Edit the arrays in `js/prompts.js`. Quip prompts use `___` for the blank; Would You Rather entries are
`["option A", "option B"]` pairs.
