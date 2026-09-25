// The "TV" screen: creates the room, shows the prompts, runs the game clock and
// gives The Landlord (the game-master voice) his cues.
import { api, watchRoom, newToken, store } from "./api.js";
import { ROUND_INFO, shuffle } from "./prompts.js";
import { buildPlan, allIn, expected, quipAnswers, fibOptions, scoreRound, brawlInit, brawlNext, brawlRecord, teeOffers, teeShirts, stiTwists, stiPosts, whitePile, dealHands, cardPlays, discardPlays, fillCard } from "./logic.js";
import { createGM } from "./gm.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast, shirt, drawingOf } from "./ui.js";

const INTRO_MS = 5000;
const REVEAL_MS = 12000;
const SCORES_MS = 6000;
const MAX_HOLD_MS = 30000; // longest we'll wait for the Landlord to finish talking
const MATCH_S = 15; // each knockout match
const CHAMBER_S = 20; // the Drinking Chamber
const DRAW_S = 90; // minimum time to draw a Tee K.O. shirt
const POINT_REASONS = /^\d+ votes?$|crowd|majority|Unanimous|Found the truth|Fooled someone|Correct|Agreed|Closest|Close-ish|Bang on|Champion|Drew|Wrote|twisted|Czar's favourite/;

const DEFAULT_SETTINGS = { mode: "party", rounds: 10, timer: 45, social: true, filthy: true, dark: false, voice: true, tvVoice: true };
// Cards Against Sobriety needs a Czar plus at least two players.
const minPlayers = (mode) => (mode === "cards" ? 3 : 2);

export async function startHost(app) {
  // Every load of the host screen (including a refresh) starts a fresh room. The previous
  // room is closed, which cancels its game and sends everyone in it back to the start.
  const old = store.get("dg-host");
  if (old) await api.closeRoom(old.code, old.token).catch(() => {});
  store.del("dg-host");
  const token = newToken();
  const code = await api.createRoom(token);
  store.set("dg-host", { code, token });
  history.replaceState(null, "", `?host=${code}`);

  let live = { room: null, players: [], subs: [] };
  let busy = false;
  let watcher = null;
  const scored = new Set(); // rounds whose points/sips were already applied
  const settings = { ...DEFAULT_SETTINGS, ...store.get("dg-settings") };

  const caption = $("#gm");
  let captionTimer = null;
  const gm = createGM({
    settings,
    onSpeak: (text) => watcher?.say({ text }),
    onCaption(text) {
      caption.innerHTML = `<span class="gm-name">🎙️ The Landlord</span><span class="gm-text">${esc(text)}</span>`;
      caption.classList.add("show");
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => caption.classList.remove("show"), 6000 + text.length * 60);
    },
  });

  let moved = false;
  let pending = null; // the phase we just wrote and haven't seen come back yet
  const set = (phase, round, state) => {
    moved = true;
    pending = { phase, round, at: Date.now() };
    return api.setState(code, token, phase, round, state);
  };

  // Remember what this screen has played, so the next game night serves fresh prompts first.
  const seenSet = () => new Set(store.get("dg-seen") ?? []);
  const markSeen = (keys) => store.set("dg-seen", [...(store.get("dg-seen") ?? []), ...keys.filter(Boolean)].slice(-5000));

  async function startGame() {
    const names = live.players.map((p) => p.name);
    const cards = settings.mode === "cards";
    const types = cards ? ["cards"] : ["quip", "likely", "fib", "wyr", "nhie", "year", "trivia", "roles", "sti"];
    // The knockout games need at least three players to be worth it.
    if (!cards && names.length >= 3) types.push("brawl", "tee");
    if (!cards && settings.social) types.push("social");
    const plan = buildPlan(settings.rounds, types, { filthy: settings.filthy, dark: settings.filthy && settings.dark, names, seen: seenSet() });
    markSeen(plan.map((r) => r.key));
    await api.reset(code, token);
    scored.clear();
    const [name, other] = shuffle(names);
    gm.line("welcome", { name, other });
    const extra = cards ? { hands: {}, pile: whitePile(settings.filthy, seenSet(), settings.filthy && settings.dark) } : {};
    await beginRound({ plan, settings: { ...settings }, idx: 0, ...extra }, 1);
  }

  async function beginRound(base, roundNo) {
    const r = base.plan[base.idx];
    if (r.type === "cards") {
      // Top up everyone's hand, and pass the Czar round the room in joining order.
      const { hands, pile } = dealHands(base.hands, base.pile, live.players, base.settings.filthy, base.settings.filthy && base.settings.dark);
      markSeen(base.pile.slice(0, base.pile.length - pile.length));
      const czar = live.players[base.idx % live.players.length]?.id;
      await set("intro", roundNo, { ...base, hands, pile, cur: { ...r, czar }, until: Date.now() + INTRO_MS });
      return;
    }
    await set("intro", roundNo, { ...base, cur: { ...r }, until: Date.now() + INTRO_MS });
  }

  // Timed phases wait for the Landlord to finish his line (up to a limit).
  const ready = (until, now) => now >= until && (!gm.busy() || now >= until + MAX_HOLD_MS);

  async function step() {
    const room = live.room;
    if (!room || busy) return;
    // Never act on a stale copy of the room: wait until our last write is visible.
    if (pending) {
      if (room.phase === pending.phase && room.round === pending.round) pending = null;
      else if (Date.now() - pending.at < 5000) return;
    }
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const now = Date.now();
    const timer = (st.settings?.timer ?? 45) * 1000;
    const voteTime = Math.min(timer, 40000);
    busy = true;
    moved = false;
    try {
      if (room.phase === "intro" && ready(st.until, now)) {
        if (cur.type === "social") await set("reveal", room.round, { ...st, cur: { ...cur, view: {} }, until: now + REVEAL_MS });
        else {
          const secs = cur.type === "tee" ? Math.max(DRAW_S, timer / 1000) : timer / 1000;
          // Out of Context: everyone gets their own innocent question.
          const extra = cur.type === "sti" ? { ask: Object.fromEntries(live.players.map((p, i) => [p.id, cur.questions[i % cur.questions.length]])) } : {};
          await set("input", room.round, { ...st, cur: { ...cur, ...extra }, deadline: now + secs * 1000, span: secs });
        }
      } else if (room.phase === "input" && (now >= st.deadline || allIn("input", cur, live.players, live.subs))) {
        if (cur.type === "quip") {
          const answers = quipAnswers(live.subs);
          if (answers.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, answers }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, answers });
        } else if (cur.type === "sti") {
          const twists = stiTwists(live.subs, live.players, cur.contexts);
          if (twists) await set("twist", room.round, { ...st, cur: { ...cur, twists }, deadline: now + timer, span: timer / 1000 });
          else await reveal(room, st, { ...cur, posts: [] });
        } else if (cur.type === "cards") {
          const plays = cardPlays(live.subs, st.hands, cur);
          const czarHere = live.players.some((p) => p.id === cur.czar);
          if (plays.length && czarHere) await set("vote", room.round, { ...st, cur: { ...cur, plays }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, plays });
        } else if (cur.type === "brawl") {
          await startBracket(room, st, { ...cur, entries: quipAnswers(live.subs) });
        } else if (cur.type === "tee") {
          const offers = teeOffers(live.subs, live.players);
          if (offers) await set("vote", room.round, { ...st, cur: { ...cur, offers }, deadline: now + timer, span: timer / 1000 });
          else await reveal(room, st, { ...cur, entries: [] });
        } else if (cur.type === "trivia") {
          // Everyone who got it wrong (or didn't answer) goes into the Drinking Chamber.
          const right = new Set(live.subs.filter((x) => x.kind === "input" && x.value?.choice === cur.answer).map((x) => x.player_id));
          const chamber = live.players.map((p) => p.id).filter((id) => !right.has(id));
          if (chamber.length) {
            const game = chamber.length <= 2 || Math.random() < 0.5 ? "glasses" : "unique";
            const spiked = Math.floor(Math.random() * 4);
            await set("vote", room.round, { ...st, cur: { ...cur, chamber, game, spiked }, deadline: now + CHAMBER_S * 1000, span: CHAMBER_S });
          } else await reveal(room, st, { ...cur, chamber });
        } else if (cur.type === "fib") {
          const options = fibOptions(live.subs, cur.truth);
          if (options.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, options }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, options });
        } else {
          await reveal(room, st, cur);
        }
      } else if (room.phase === "vote" && (now >= st.deadline || allIn("vote", cur, live.players, live.subs))) {
        if (cur.type === "tee") await startBracket(room, st, { ...cur, entries: teeShirts(live.subs, cur.offers) });
        else await reveal(room, st, cur);
      } else if (room.phase === "twist" && (now >= st.deadline || allIn("twist", cur, live.players, live.subs))) {
        const posts = stiPosts(live.subs, cur.twists);
        if (posts.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, posts }, deadline: now + voteTime, span: voteTime / 1000 });
        else await reveal(room, st, { ...cur, posts });
      } else if (room.phase === "match" && (now >= st.deadline || allIn("match", cur, live.players, live.subs))) {
        await nextMatch(room, st, { ...cur, br: brawlRecord(cur.br, cur.match, live.subs) });
      } else if (room.phase === "reveal" && ready(st.until, now)) {
        await set("scores", room.round, { ...st, until: now + SCORES_MS });
      } else if (room.phase === "scores" && now >= st.until) {
        await next(room, st);
      }
      // Pull the new state before the next tick so we never act on a stale phase.
      if (moved) await watcher?.refresh();
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  // Knockout bracket (Pub Brawl answers / Tee K.O. shirts): one match per phase until a champion.
  async function startBracket(room, st, cur) {
    await nextMatch(room, st, { ...cur, br: brawlInit(cur.entries) });
  }

  async function nextMatch(room, st, cur) {
    const n = brawlNext(cur.br);
    if (n.match) {
      await set("match", room.round, { ...st, cur: { ...cur, br: n.br, match: n.match }, deadline: Date.now() + MATCH_S * 1000, span: MATCH_S });
    } else {
      await reveal(room, st, { ...cur, br: n.br, match: null, champion: n.champion });
    }
  }

  async function reveal(room, st, cur) {
    if (cur.type === "cards") st = { ...st, hands: discardPlays(st.hands, cur.plays) };
    const { deltas, view } = scoreRound(cur, live.players, live.subs);
    const list = Object.entries(deltas).map(([id, d]) => ({ id, score: d.score, sips: d.sips }));
    if (list.length && !scored.has(room.round)) await api.apply(code, token, list);
    scored.add(room.round);
    await set("reveal", room.round, { ...st, cur: { ...cur, view, deltas }, until: Date.now() + REVEAL_MS });
  }

  async function next(room, st) {
    const idx = st.idx + 1;
    if (idx >= st.plan.length) await set("final", room.round, { ...st });
    else await beginRound({ plan: st.plan, settings: st.settings, idx, hands: st.hands, pile: st.pile }, room.round + 1);
  }

  // The Landlord's cues, fired once per phase change.
  function announce(room) {
    const nameOf = (id) => live.players.find((p) => p.id === id)?.name;
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    switch (room.phase) {
      case "intro":
        gm.say(`Round ${st.idx + 1}. ${info.title}.`);
        break;
      case "input":
        if (cur.type === "wyr") gm.say(`Would you rather ${cur.prompt[0]}? Or ${cur.prompt[1]}?`, { caption: false });
        else if (cur.type === "year") gm.say(`What year? ${cur.prompt}`, { caption: false });
        else if (cur.type === "tee") gm.say("Draw something on your phone, and write a slogan. Filth encouraged.", { caption: false });
        else if (cur.type === "sti") gm.say("Answer the question on your phone. Honestly. What could possibly go wrong?", { caption: false });
        else if (cur.type === "cards") gm.say(`${nameOf(cur.czar) ?? "The Czar"} is the Card Czar. ${cur.prompt}`, { caption: false });
        else gm.say(cur.prompt, { caption: false });
        break;
      case "vote": {
        const lines = {
          fib: "Now. Which one's the truth?",
          trivia: "Wrong answers, welcome to the Drinking Chamber.",
          tee: "Now make a shirt out of someone else's rubbish.",
          sti: "Vote for the most out-of-context. No mercy.",
          cards: "Card Czar. Pick your favourite. And the one you hate.",
        };
        gm.say(lines[cur.type] ?? "Right. Vote for the least disappointing one.", { caption: false });
        break;
      }
      case "match":
        gm.say(`${cur.match?.label ?? "Next match"}. Fight!`, { caption: false });
        break;
      case "twist":
        gm.say("Now for the fun part. You've been given someone else's answer. Tell us where it was really posted.", { caption: false });
        break;
      case "reveal":
        if (cur.type === "social") gm.say(cur.prompt, { caption: false });
        else if (cur.type === "cards" && cur.view?.win) {
          const win = cur.view.plays.find((p) => p.pid === cur.view.win);
          gm.say(fillCard(cur.prompt, win.cards), { caption: false }).then(() => roastRound(cur));
        } else roastRound(cur);
        break;
      case "final": {
        const ranked = [...live.players].sort((a, b) => b.score - a.score);
        const thirsty = [...live.players].sort((a, b) => b.sips - a.sips)[0];
        const last = ranked.length > 1 ? ranked[ranked.length - 1] : null;
        gm.line("final", { winner: ranked[0]?.name, thirsty: thirsty?.sips ? thirsty.name : null, last: last?.name });
        break;
      }
    }
  }

  // The Landlord's reaction to a round: roast the most relevant person, falling back
  // to anyone who's drinking, then to a generic line.
  function roastRound(cur) {
    const nameOf = (id) => live.players.find((p) => p.id === id)?.name;
    const any = (ids) => shuffle((ids ?? []).map(nameOf).filter(Boolean))[0];
    const v = cur.view ?? {};
    const deltas = Object.entries(cur.deltas ?? {});
    const drinking = (why) => deltas.filter(([, d]) => d.sips > 0 && (!why || d.why.includes(why))).map(([id]) => id);
    let key = cur.type;
    let vars = {};
    switch (cur.type) {
      case "likely":
        vars = { name: any(v.losers) };
        break;
      case "nhie":
        if (!v.have?.length) key = "nhie_none";
        vars = { name: any(v.have) };
        break;
      case "wyr":
        if (v.tie) key = "wyr_tie";
        vars = { name: any(drinking("In the minority")) };
        break;
      case "quip":
        vars = { winner: any((v.results ?? []).filter((a) => a.winner).map((a) => a.pid)), name: any(drinking("Zero votes")) };
        break;
      case "fib": {
        const fooled = shuffle((v.options ?? []).filter((o) => !o.truth && o.pickers.length))[0];
        vars = { liar: any(fooled?.pids), name: any(fooled?.pickers) };
        break;
      }
      case "year": {
        const g = v.guesses ?? [];
        const worst = g.filter((x) => (cur.deltas?.[x.pid]?.why ?? []).includes("Furthest off"));
        vars = { winner: nameOf(g[0]?.pid), name: nameOf(worst[0]?.pid), miss: worst[0]?.miss };
        break;
      }
      case "trivia":
        if (!(v.results ?? []).some((r) => r.dead)) key = "trivia_clean";
        vars = { name: any((v.results ?? []).filter((r) => r.dead).map((r) => r.pid)) };
        break;
      case "roles": {
        const c = (v.crowned ?? []).find((x) => x.role === cur.drink);
        vars = { name: any(c?.holders), role: cur.drink.replace(/^The /, "the ") };
        break;
      }
      case "brawl":
      case "tee":
        vars = { winner: nameOf(v.champion?.pid), name: nameOf(v.history?.[0]?.loser) };
        break;
      case "cards":
        vars = { winner: nameOf(v.win), name: nameOf(v.worst), czar: nameOf(cur.czar) };
        break;
      case "sti": {
        const top = (v.results ?? []).find((x) => x.winner);
        vars = { winner: nameOf(top?.pid), victim: nameOf(top?.from), name: any(drinking("Zero votes")) };
        break;
      }
    }
    gm.line(key, vars) ?? gm.line("drink", { name: any(drinking()) }) ?? gm.line("none");
  }

  // Host controls
  app.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === "start") {
        if (live.players.length < minPlayers(settings.mode)) return toast(`Need at least ${minPlayers(settings.mode)} players!`);
        btn.disabled = true;
        await startGame();
      } else if (act === "skip") {
        // Fast-forward whatever is on screen (and shut the Landlord up).
        gm.stop();
        const st = live.room.state;
        const patch = live.room.phase === "input" || live.room.phase === "vote" ? { deadline: 0 } : { until: 0 };
        await set(live.room.phase, live.room.round, { ...st, ...patch });
      } else if (act === "end") {
        // Finish early: skip the remaining rounds and go straight to the final scores.
        if (!confirm("End the game now and show the final scores?")) return;
        gm.stop();
        await set("final", live.room.round, { ...live.room.state });
      } else if (act === "lobby") {
        gm.stop();
        await api.reset(code, token);
      } else if (act === "new-room") {
        if (!confirm("Close this room and start a new one? Everyone will need the new code.")) return;
        location.href = location.pathname + "?host"; // loading the host screen closes this room
      } else if (act === "kick") {
        const p = live.players.find((x) => x.id === btn.dataset.id);
        if (p && confirm(`Kick ${p.name}?`)) await api.kick(code, token, p.id);
      } else if (act === "mode") {
        settings.mode = btn.dataset.val;
        store.set("dg-settings", settings);
        render();
      } else if (act === "rounds" || act === "timer") {
        settings[act] = +btn.dataset.val;
        store.set("dg-settings", settings);
        render();
      } else if (["social", "filthy", "dark", "voice", "tvVoice"].includes(act)) {
        settings[act] = !settings[act];
        store.set("dg-settings", settings);
        if ((act === "voice" || act === "tvVoice") && settings.voice) gm.say("Testing. One, two. Can the cheap seats hear me?");
        if (act === "voice" && !settings.voice) gm.stop();
        render();
      }
    } catch (err) {
      toast(err.message);
    }
  });

  const joinUrl = `${location.origin}${location.pathname}?room=${code}`;
  const toggle = (key, on, off = "Off") =>
    `<button class="pill ${settings[key] ? "on" : ""}" data-act="${key}">${settings[key] ? on : off}</button>`;

  function render() {
    const room = live.room;
    if (!room) {
      app.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
      return;
    }
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    const byId = Object.fromEntries(live.players.map((p) => [p.id, p]));
    const header = `<header class="host-head">
        <div class="logo sm">Last Orders</div>
        <div class="roomcode">Join at <b>${esc(location.host + location.pathname)}</b> · code <b class="code">${code}</b></div>
        ${room.phase !== "lobby" ? `<div class="round-no">Round ${st.idx + 1}/${st.plan?.length ?? "?"}</div>` : ""}
      </header>`;
    const controls = room.phase === "lobby" ? "" : `<footer class="host-foot">
        <button class="btn ghost sm" data-act="voice">${settings.voice ? "🔊 Voice on" : "🔇 Voice off"}</button>
        ${room.phase === "final" ? "" : `<button class="btn ghost sm" data-act="skip">Skip ⏭</button>
        <button class="btn ghost sm" data-act="lobby">Back to lobby</button>
        <button class="btn danger sm" data-act="end">🏁 End game</button>`}
      </footer>`;
    let body = "";

    switch (room.phase) {
      case "lobby":
        body = `<div class="lobby">
          <div class="join-card">
            <div class="logo">Last Orders</div>
            <p class="tag">The party drinking game. Grab your phones!</p>
            <div id="qr" class="qr"></div>
            <p>Go to <b>${esc(location.host + location.pathname)}</b><br>and enter code</p>
            <div class="bigcode">${code}</div>
          </div>
          <div class="lobby-side">
            <h2>Players (${live.players.length}/12)</h2>
            <div class="player-grid">
              ${live.players.map((p) => `<div class="player-card" style="--c:${esc(p.color)}">${avatar(p, "lg")}<span>${esc(p.name)}</span>
                <button class="kick" data-act="kick" data-id="${p.id}" aria-label="Kick ${esc(p.name)}">✕ Kick</button></div>`).join("") || `<p class="muted">Waiting for players to join…</p>`}
            </div>
            <div class="settings">
              <div class="setting"><span>Game</span>
                <button class="pill ${settings.mode !== "cards" ? "on" : ""}" data-act="mode" data-val="party">🎉 Party Mix</button>
                <button class="pill ${settings.mode === "cards" ? "on" : ""}" data-act="mode" data-val="cards">🃏 Cards Against Sobriety</button></div>
              ${settings.mode === "cards" ? `<p class="muted small">Everyone gets 7 cards on their phone. Each round one player's phone is the 👑 Card Czar and picks the winner — the Czar passes round the room. Needs 3+ players.</p>` : ""}
              <div class="setting"><span>Rounds</span>${[6, 10, 15, 20].map((n) => `<button class="pill ${settings.rounds === n ? "on" : ""}" data-act="rounds" data-val="${n}">${n}</button>`).join("")}</div>
              <div class="setting"><span>Timer</span>${[30, 45, 60, 90].map((n) => `<button class="pill ${settings.timer === n ? "on" : ""}" data-act="timer" data-val="${n}">${n}s</button>`).join("")}</div>
              <div class="setting"><span>Filth level</span>${toggle("filthy", "🔥 Filthy", "😇 Mild")}${settings.filthy && settings.mode === "cards" ? toggle("dark", "💀 Dark humour", "💀 Dark: off") : ""}</div>
              <div class="setting"><span>Landlord voice</span>${toggle("voice", "🔊 On")}${settings.voice ? toggle("tvVoice", "📺 TV speaks", "📺 TV silent") : ""}</div>
              ${settings.voice ? `<p class="muted small">${gm.canSpeak() ? "" : "⚠️ This TV browser has no voice. "}No sound from the TV? On one phone, tap <b>🔈 Be the speaker</b> and the Landlord talks through that phone instead (or a Bluetooth speaker connected to it).</p>` : ""}
              ${settings.mode === "cards" ? "" : `<div class="setting"><span>Social rounds</span>${toggle("social", "On")}</div>`}
            </div>
            <button class="btn big" data-act="start" ${live.players.length < minPlayers(settings.mode) ? "disabled" : ""}>Everybody's in — start! 🍻</button>
            <p class="muted small">Adults only — ${settings.filthy ? "filthy mode is very much not safe for your nan" : "mild mode is safe-ish for your nan"}. Host wants to play too? Join from your phone as well. Drink responsibly — a "sip" can be anything, water counts.</p>
            <button class="btn ghost sm" data-act="new-room">New room</button>
          </div>
        </div>`;
        break;

      case "intro":
        body = `<div class="intro pop">
          <div class="intro-emoji">${info.emoji ?? "🍺"}</div>
          <h1>${esc(info.title)}</h1>
          <p class="rules">${esc(info.rules)}</p>
        </div>`;
        break;

      case "input":
      case "vote":
      case "twist":
      case "match": {
        const { kind, ids } = expected(room.phase, cur, live.players);
        const who = room.phase === "input" ? live.players : live.players.filter((p) => ids.includes(p.id));
        const done = new Set(live.subs.filter((x) => x.kind === (kind ?? "input")).map((x) => x.player_id));
        body = `<div class="stage">
          ${timerBar(st.deadline, st.span ?? st.settings.timer)}
          <div class="round-type">${info.emoji} ${esc(info.title)}</div>
          ${hostStage(room, cur, byId)}
          <div class="waiting-on">${who.map((p) => chip(p, done.has(p.id) ? "done" : "wait")).join("")}</div>
        </div>`;
        break;
      }

      case "reveal":
        body = `<div class="stage">${renderReveal(cur, info, byId)}</div>`;
        break;

      case "scores":
      case "final": {
        const ranked = [...live.players].sort((a, b) => b.score - a.score);
        const thirsty = [...live.players].sort((a, b) => b.sips - a.sips)[0];
        const final = room.phase === "final";
        const winners = ranked.filter((p) => ranked[0] && p.score === ranked[0].score);
        body = `<div class="stage">
          <h1>${final ? "🏆 Final scores 🏆" : "Leaderboard"}</h1>
          ${final && winners.length ? `<div class="winner pop"><div class="row">${winners.map((p) => avatar(p, "xl")).join("")}</div>
            <div><b>${winners.map((p) => esc(p.name)).join(" & ")}</b> win${winners.length === 1 ? "s" : ""}!</div></div>` : ""}
          <ol class="board">${ranked.map((p, i) => `<li class="pop" style="animation-delay:${i * 60}ms">
              <span class="rank">${i + 1}</span>${avatar(p)}<span class="name">${esc(p.name)}</span>
              <span class="sips">🍺 ${p.sips}</span><span class="score">${p.score}</span></li>`).join("")}</ol>
          ${final && thirsty?.sips ? `<p class="award">🍺 Thirstiest player: <b>${esc(thirsty.name)}</b> with ${sipsText(thirsty.sips)}</p>` : ""}
          ${final ? `<div class="row"><button class="btn big" data-act="lobby">Play again</button><button class="btn ghost" data-act="new-room">New room</button></div>` : ""}
        </div>`;
        break;
      }
    }
    app.innerHTML = `<div class="host">${header}<main>${body}</main>${controls}</div>`;

    const qr = $("#qr");
    if (qr && window.qrcode) {
      const q = window.qrcode(0, "M");
      q.addData(joinUrl);
      q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }
  }

  // What the TV shows while phones are busy (answering, voting, fighting).
  function hostStage(room, cur, byId) {
    const phase = room.phase;
    const name = (id) => esc(byId[id]?.name ?? "?");
    const cards = (items) => `<div class="answers">${items.map((t, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${esc(t)}</div>`).join("")}</div>`;
    if (phase === "match") {
      const m = cur.match;
      const side = (e) => (cur.type === "tee" ? shirt(drawingOf(live.subs, e.img), e.text) : `<div class="answer">${esc(e.text)}</div>`);
      return `<h2 class="kicker">${esc(m.label)}</h2>${cur.type === "brawl" ? `<h2 class="prompt sm">${esc(cur.prompt)}</h2>` : ""}
        <div class="versus"><div class="fighter a pop">${side(m.a)}</div><div class="vs">VS</div><div class="fighter b pop">${side(m.b)}</div></div>
        <p class="kicker">Tap your favourite on your phone!</p>`;
    }
    if (phase === "twist") return `<h1 class="prompt">Everyone's been handed someone else's answer…</h1>
      <p class="kicker">Now say where it was REALLY posted. Make it hurt.</p>`;
    if (phase === "vote") {
      switch (cur.type) {
        case "fib":
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">Which one is the TRUTH? Vote on your phone!</p>${cards((cur.options ?? []).map((o) => o.text))}`;
        case "trivia":
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">✅ ${esc(cur.answer)}</p>
            <h1 class="chamber-title">☠️ THE DRINKING CHAMBER ☠️</h1>
            <p class="rules">${cur.game === "glasses" ? "Four glasses. One is spiked. Pick one on your phone — whoever picks the spiked glass drinks 3." : "Pick a number from 1 to 5. If anyone else picks the same number, you both drink 3."}</p>`;
        case "tee":
          return `<h1 class="prompt">Make your shirt!</h1><p class="kicker">Pick a drawing and a slogan — made by your mates — on your phone.</p>`;
        case "sti":
          return `<p class="kicker">Vote for the best twist on your phone!</p>${stiCards(cur.posts ?? [], byId, false)}`;
        case "cards":
          return `${blackCard(cur.prompt, cur.pick)}<p class="kicker">👑 ${name(cur.czar)} is choosing…</p>
            <div class="answers">${(cur.plays ?? []).map((p, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${filled(cur.prompt, p.cards)}</div>`).join("")}</div>`;
        default:
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">Vote for your favourite on your phone!</p>${cards((cur.answers ?? []).map((a) => a.text))}`;
      }
    }
    // Answering.
    switch (cur.type) {
      case "wyr":
        return `<h2 class="kicker">Would you rather…</h2>
          <div class="wyr"><div class="wyr-opt a">${esc(cur.prompt[0])}</div><div class="or">OR</div><div class="wyr-opt b">${esc(cur.prompt[1])}</div></div>`;
      case "year":
        return `<h2 class="kicker">What year?</h2><h1 class="prompt">${esc(cur.prompt)}</h1><p class="kicker">Type your guess on your phone!</p>`;
      case "trivia":
        return `<h1 class="prompt">${esc(cur.prompt)}</h1>${cards(cur.options)}<p class="kicker">Get it wrong and you enter the Drinking Chamber…</p>`;
      case "roles":
        return `<h1 class="prompt">${esc(cur.prompt)}</h1><div class="role-list">${cur.roles.map((r) => `<span class="role ${r === cur.drink ? "drink-role" : ""}">${esc(r)}${r === cur.drink ? " 🍺" : ""}</span>`).join("")}</div>
          <p class="kicker">Match each one to a mate on your phone!</p>`;
      case "tee":
        return `<h1 class="prompt">Design a T-shirt!</h1><p class="kicker">Draw a picture and write a slogan on your phone. Everything gets mixed up later…</p>`;
      case "sti":
        return `<h1 class="prompt">Answer your question on your phone.</h1><p class="kicker">Honestly. Innocently. What could possibly go wrong?</p>`;
      case "cards":
        return `${blackCard(cur.prompt, cur.pick)}<p class="kicker">👑 Card Czar: ${name(cur.czar)} — everyone else, play ${cur.pick === 1 ? "a card" : `${cur.pick} cards`} from your phone!</p>`;
      default: {
        const hint = {
          likely: "Vote on your phone!",
          nhie: "Answer honestly on your phone…",
          quip: "Write your funniest answer on your phone!",
          brawl: "Write an answer — then they fight!",
          fib: "Write a convincing LIE on your phone!",
        }[cur.type];
        return `<h1 class="prompt">${esc(cur.prompt)}</h1><p class="kicker">${hint ?? ""}</p>`;
      }
    }
  }

  // Cards Against Sobriety: the black card, and a black card filled in with white cards.
  function blackCard(text, pick) {
    return `<div class="black-card pop">${esc(text).replace(/___/g, "<span class=\"blank\">______</span>")}${pick > 1 ? `<div class="pick">PICK ${pick}</div>` : ""}</div>`;
  }
  function filled(text, cards) {
    const whites = cards.map((c) => `<b class="white-fill">${esc(String(c).replace(/[.!?]$/, ""))}</b>`);
    if (!String(text).includes("___")) return `${esc(text)} ${whites.join(" / ")}`;
    let i = 0;
    return esc(text).replace(/___/g, () => whites[i++] ?? "___");
  }

  // Out of Context posts, optionally with who wrote what and the votes.
  function stiCards(posts, byId, reveal) {
    return `<div class="answers results">${posts.map((x, i) => `<div class="answer post pop ${reveal && x.winner ? "win" : ""}" style="animation-delay:${i * 120}ms">
      <div class="post-ctx">Posted as ${esc(x.context)}:</div>
      <div class="post-q">“${esc(x.answer)}”</div>
      <div class="a-text">${esc(x.text)}</div>
      ${reveal ? `<div class="a-meta">Answer by ${chip(byId[x.from])} · twisted by ${chip(byId[x.pid])} <b>${x.voters.length}</b> vote${x.voters.length === 1 ? "" : "s"} ${x.winner ? "👑" : ""}</div>` : ""}
    </div>`).join("")}</div>`;
  }

  function renderReveal(cur, info, byId) {
    const name = (id) => esc(byId[id]?.name ?? "?");
    const v = cur.view ?? {};
    let main = "";
    switch (cur.type) {
      case "social":
        return `<div class="intro pop"><div class="intro-emoji">🍻</div><h1 class="prompt">${esc(cur.prompt)}</h1></div>`;
      case "likely":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          ${v.losers?.length ? `<div class="spotlight pop">${v.losers.map((id) => avatar(byId[id], "xl")).join("")}
            <div>${v.losers.map(name).join(" & ")}!</div></div>` : `<p>Nobody voted?!</p>`}
          <div class="tally">${(v.tally ?? []).map((t) => `<div class="tally-row">${chip(byId[t.pid])}
            <span class="bar" style="--n:${t.voters.length}"></span><span class="voters">${t.voters.map(name).join(", ")}</span></div>`).join("")}</div>`;
        break;
      case "nhie":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="split"><div><h3>I have 🍺</h3>${(v.have ?? []).map((id) => chip(byId[id])).join("") || `<p class="muted">Liars, all of you.</p>`}</div>
          <div><h3>Never 😇</h3>${(v.never ?? []).map((id) => chip(byId[id])).join("") || `<p class="muted">Nobody!</p>`}</div></div>`;
        break;
      case "wyr":
        main = `<div class="split">${[0, 1].map((i) => `<div><h3>${esc(cur.prompt[i])}</h3>
          <div class="count">${v.sides?.[i]?.length ?? 0}</div>${(v.sides?.[i] ?? []).map((id) => chip(byId[id])).join("")}</div>`).join("")}</div>
          ${v.tie ? `<p class="kicker">Dead even! Everyone drinks!</p>` : ""}`;
        break;
      case "quip":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="answers results">${(v.results ?? []).map((a, i) => `<div class="answer pop ${a.winner ? "win" : ""}" style="animation-delay:${i * 150}ms">
            <div class="a-text">${esc(a.text)}</div>
            <div class="a-meta">${chip(byId[a.pid])} <b>${a.voters.length}</b> vote${a.voters.length === 1 ? "" : "s"} ${a.winner ? "👑" : ""}</div></div>`).join("") || `<p>No answers?! Everybody drinks.</p>`}</div>`;
        break;
      case "fib":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="answers results">${(v.options ?? []).map((o, i) => `<div class="answer pop ${o.truth ? "truth" : ""}" style="animation-delay:${i * 150}ms">
            <div class="a-text">${o.truth ? "✅ " : "🤥 "}${esc(o.text)}</div>
            <div class="a-meta">${o.truth ? "<b>THE TRUTH</b>" : `Lie by ${o.pids.map((id) => chip(byId[id])).join("")}`}</div>
            <div class="a-meta small">${o.pickers.length ? `Picked by ${o.pickers.map(name).join(", ")}` : "Nobody fell for it"}</div></div>`).join("")}</div>`;
        break;
    }
    switch (cur.type) {
      case "year":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2><div class="bigyear pop">${cur.year}</div>
          <div class="tally">${(v.guesses ?? []).map((g) => `<div class="tally-row">${chip(byId[g.pid])} <b>${g.year}</b>
            <span class="voters">${g.miss === 0 ? "BANG ON!" : `${g.miss} year${g.miss === 1 ? "" : "s"} out`}</span></div>`).join("") || `<p>No guesses?!</p>`}</div>`;
        break;
      case "trivia":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">✅ ${esc(cur.answer)}</p>
          ${v.correct?.length ? `<p>Got it right: ${v.correct.map((id) => chip(byId[id])).join("")}</p>` : ""}
          ${(v.results ?? []).length ? `<h2 class="chamber-title">☠️ The Drinking Chamber</h2>
            ${cur.game === "glasses" ? `<p class="muted">The spiked glass was number ${cur.spiked + 1}.</p>` : ""}
            <div class="tally">${v.results.map((r) => `<div class="tally-row">${chip(byId[r.pid])}
              <span>${r.pick === undefined ? "—" : cur.game === "glasses" ? `glass ${r.pick + 1}` : `picked ${r.pick}`}</span>
              <b>${r.dead ? `💀 ${esc(r.dead)}` : "😅 Survived"}</b></div>`).join("")}</div>` : `<p class="kicker">Everyone survived!</p>`}`;
        break;
      case "roles":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="tally">${(v.crowned ?? []).map((c) => `<div class="tally-row"><span class="role ${c.role === cur.drink ? "drink-role" : ""}">${esc(c.role)}</span>
            ${c.holders.length ? c.holders.map((h) => chip(byId[h])).join("") : `<span class="muted">nobody</span>`}
            <span class="voters">${c.holders.map((h) => `${c.tally[h].length} vote${c.tally[h].length === 1 ? "" : "s"}`).join(", ")}</span></div>`).join("")}</div>`;
        break;
      case "brawl":
      case "tee": {
        const tee = cur.type === "tee";
        const c = v.champion;
        main = `${tee ? "" : `<h2 class="prompt sm">${esc(cur.prompt)}</h2>`}
          ${c ? `<div class="spotlight pop">🏆 CHAMPION 🏆</div>${tee ? shirt(drawingOf(live.subs, c.img), c.text, "big") : `<div class="answer win">${esc(c.text)}</div>`}
            <p>${tee ? `Made by ${chip(byId[c.pid])} · drawn by ${chip(byId[c.img])} · slogan by ${chip(byId[c.by])}` : `by ${chip(byId[c.pid])}`}</p>` : `<p>No entries?! Everybody drinks.</p>`}
          <div class="tally">${(v.history ?? []).map((h) => `<div class="tally-row"><span class="muted">${esc(h.label)}</span> ${chip(byId[h.winner])} beat ${chip(byId[h.loser])}
            <span class="voters">${Math.max(h.va.length, h.vb.length)}–${Math.min(h.va.length, h.vb.length)}</span></div>`).join("")}</div>`;
        break;
      }
      case "sti":
        main = (v.results ?? []).length ? stiCards(v.results, byId, true) : `<p>No twists?! Everybody drinks.</p>`;
        break;
      case "cards": {
        const plays = [...(v.plays ?? [])].sort((a, b) => (b.pid === v.win) - (a.pid === v.win) || (a.pid === v.worst) - (b.pid === v.worst));
        main = `<p class="kicker">👑 Czar: ${chip(byId[cur.czar])}</p>
          <div class="answers results">${plays.map((p, i) => `<div class="answer pop ${p.pid === v.win ? "win" : ""} ${p.pid === v.worst ? "worst" : ""}" style="animation-delay:${i * 120}ms">
            <div class="a-text">${filled(cur.prompt, p.cards)}</div>
            <div class="a-meta">${chip(byId[p.pid])} ${p.pid === v.win ? "👑 Czar's favourite" : p.pid === v.worst ? "💩 Czar's least favourite" : ""}</div></div>`).join("") || `<p>Nobody played a card?!</p>`}</div>`;
        break;
      }
    }
    const drinkers = Object.entries(cur.deltas ?? {}).filter(([, d]) => d.sips > 0);
    return `<div class="round-type">${info.emoji} ${esc(info.title)}</div>${main}
      ${drinkers.length ? `<div class="drink-list"><h2>🍺 Drink up!</h2>${drinkers
        .map(([id, d]) => `<div class="drink pop">${chip(byId[id])} <b>${sipsText(d.sips)}</b> <span class="muted">${esc(d.why.filter((w) => !POINT_REASONS.test(w)).join(", "))}</span></div>`)
        .join("")}</div>` : ""}`;
  }

  let lastSig = "";
  let lastPhase = null;
  // Voices load asynchronously; refresh the lobby's "can this TV talk?" hint when they arrive.
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => live.room?.phase === "lobby" && render());

  watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.map((s) => s.player_id + s.kind)]);
    if (sig !== lastSig) render();
    lastSig = sig;
    const phaseKey = l.room && `${l.room.phase}:${l.room.round}:${l.room.state?.cur?.match?.m ?? ""}`;
    if (lastPhase !== null && phaseKey !== lastPhase && l.room) announce(l.room);
    lastPhase = phaseKey;
    step();
  });
  setInterval(() => step(), 500);
  return watcher;
}
