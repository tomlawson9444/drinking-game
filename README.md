# 🍻 Last Orders

A Jackbox-style party drinking game for you and your mates. One big screen (TV / laptop) hosts,
everyone plays on their phone in the browser — no app, no accounts. **18+ only.**

Hosted by **The Landlord**, an AI game master (Claude) who reads out every prompt, roasts you by name
after each round in a deadpan British one-liner style, and writes custom prompts about your group before
the game starts. Turn the TV volume up.

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
| 🤥 **Lie Detector** | Write a fake answer to a weird-but-true fact, then spot the truth | Fooled by a lie: 1 sip. Each person you fool: +100 pts. Truth: +200 |
| 🍻 **Social** | A rule for the whole room | Whoever the rule says |

**Filth level:** 🔥 Filthy (default — sex, bodily functions, brutal roasts; prompts get personalised with
players' names) or 😇 Mild. Too slow to answer? That's a sip. Points decide the winner; sips are tracked for the "Thirstiest player" award.

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
- **The Landlord** lives in the `game-master` Supabase Edge Function, which holds the Anthropic API key —
  it is never sent to browsers. Only a room's host (proved by the host token) can call it, capped at 150
  calls per room. Lines are spoken with the browser's built-in text-to-speech (a British voice when
  available) and shown as captions. If the key isn't set, or Claude is unavailable, the game falls back to
  built-in lines and prompts.

```
index.html          entry point
css/style.css       all styles
js/config.js        Supabase URL + publishable key
js/app.js           home screen + routing
js/host.js          big-screen host and game engine
js/player.js        phone controller
js/logic.js         round plan + scoring rules (pure, testable)
js/gm.js            The Landlord: voice-over + calls to the game-master function
js/prompts.js       prompt decks (mild + filthy) — add your own in-jokes!
supabase/migrations database schema, RLS and RPC functions
supabase/functions/game-master   Edge Function that calls Claude
```

## Setup

1. Create a Supabase project and run the files in `supabase/migrations/` in order in the SQL editor.
2. Put the project URL and publishable (anon) key in `js/config.js`.
3. Deploy the AI host: `supabase functions deploy game-master --no-verify-jwt` (it does its own host-token
   check), then add your Anthropic key as a secret — either `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
   or **Supabase dashboard → Edge Functions → Secrets → Add `ANTHROPIC_API_KEY`**. Never put the key in
   `js/config.js` or anywhere in this repo.
4. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
5. Open `https://<your-user>.github.io/drinking-game/`.

To run locally: `python3 -m http.server` in this folder and open http://localhost:8000.

## Adding prompts

Edit the arrays in `js/prompts.js`. Quip prompts use `___` for the blank; Would You Rather entries are
`["option A", "option B"]` pairs.
