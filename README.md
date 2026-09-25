# 🍻 Last Orders

A Jackbox-style party drinking game for you and your mates. One big screen (TV / laptop) hosts,
everyone plays on their phone in the browser — no app, no accounts. **18+ only.**

Hosted by **The Landlord**, a deadpan British game-master voice who reads out every prompt and roasts
you by name after each round. Turn the TV volume up. (He's free: the voice is your browser's built-in
text-to-speech and his lines are pre-written in `js/prompts.js`, so there are no API keys or costs.)

## How to play

1. On the TV or laptop, open the site and tap **Host on this screen**.
2. Everyone else scans the QR code (or opens the site) and enters the **4-letter room code** and a name.
3. Pick the number of rounds and the timer, then hit **start**.
4. During the game the host screen has **Skip ⏭**, **Back to lobby** and **🏁 End game** (finish early and
   jump straight to the final scores).
5. **No sound from the TV?** Many TV browsers have no speech voices. On any phone tap **🔈 Be the speaker**
   and the Landlord talks through that phone instead (or a Bluetooth speaker paired with it). Keep that
   phone's screen on. The lobby's **📺 TV speaks** toggle stops the TV talking if both would.
6. **Refreshing the host screen closes the room**: the game is cancelled, everyone is sent back to the start
   screen, and a fresh room with a new code opens. (**New room** in the lobby does the same.)

### Round types

| Round | What happens | Who drinks |
|---|---|---|
| ✍️ **Quip Clash** | Everyone fills in the blank, then votes for the funniest answer | Answers with zero votes drink 2 · no answer drinks 2 |
| 👉 **Most Likely To** | Vote for the friend who best fits the prompt | Most-voted player drinks 2 |
| ⚖️ **Would You Rather** | Pick a side | The minority drinks 1 (a dead-even split: everyone drinks) |
| 🙊 **Never Have I Ever** | Confess on your phone | Everyone who has drinks 1 (+50 pts for honesty) |
| 🤥 **Lie Detector** | Write a fake answer to a weird-but-true fact, then spot the truth | Fooled by a lie: 1 sip. Each person you fool: +100 pts. Truth: +200 |
| 📅 **Year Guess** *(Time Jinx)* | Guess the year something happened | Furthest off drinks 2. Closest +300, bang on +500 |
| ☠️ **Pub Quiz of Doom** *(Trivia Murder Party)* | Multiple-choice question; wrong answers enter the Drinking Chamber (pick a glass — one's spiked — or pick a number and hope nobody matches) | Chamber losers drink 3. Correct +200 |
| 🎭 **Who's Who** *(Role Models)* | Sort your mates into a set — Spice Girls, Only Fools, night-out roles… | Whoever the group crowns the 🍺 role drinks 2; agree with nobody = 1 |
| 🥊 **Pub Brawl** *(Bracketeering)* | Everyone answers, then answers fight head-to-head in a knockout bracket | Every knocked-out answer drinks 1. Champion +500 |
| 👕 **Tee K.O.** | Draw a picture and write a slogan on your phone, build a shirt from your mates' work, then shirts fight in a bracket | Every knocked-out shirt's maker drinks 1 |
| 📱 **Out of Context** *(Survive the Internet)* | Answer an innocent question; someone else reveals where it was "really posted" | Twists with zero votes drink 2 |
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
- Rooms idle for 12 hours are deleted automatically when a new room is created, and a host screen closes its
  previous room (`dg_close_room`) whenever it loads.
- **The Landlord** picks a line from `LINES` in `js/prompts.js` for each moment, fills in the relevant
  player's name, speaks it with the browser's speech synthesis (a British voice when available) and shows
  it as a caption. Toggle the voice from the lobby or the 🔊 button. Every line is also sent over a
  Supabase Realtime broadcast (no database write) to phones that chose "Be the speaker".

```
index.html          entry point
css/style.css       all styles
js/config.js        Supabase URL + publishable key
js/app.js           home screen + routing
js/host.js          big-screen host and game engine
js/player.js        phone controller
js/logic.js         round plan + scoring rules (pure, testable)
js/gm.js            The Landlord: voice-over + captions
js/prompts.js       prompt decks (mild + filthy) and the Landlord's lines — add your own in-jokes!
supabase/migrations database schema, RLS and RPC functions
```

## Setup

1. Create a Supabase project and run the files in `supabase/migrations/` in order in the SQL editor.
2. Put the project URL and publishable (anon) key in `js/config.js`.
3. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
4. Open `https://<your-user>.github.io/drinking-game/`.

To run locally: `python3 -m http.server` in this folder and open http://localhost:8000.

## Adding prompts

Edit the arrays in `js/prompts.js` (years, trivia, role sets, T-shirt ideas and Out of Context
questions/contexts live there too; trivia lists the correct option first). Quip prompts use `___` for the blank; Would You Rather entries are
`["option A", "option B"]` pairs. Add Landlord lines to `LINES`; `{name}`-style blanks are filled with
player names, and a line is only used when all its blanks can be filled.
