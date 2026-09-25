// The "TV" screen: creates the room, shows the prompts, runs the game clock and
// gives The Landlord (the game-master voice) his cues.
import { api, watchRoom, newToken, store } from "./api.js";
import { ROUND_INFO, shuffle } from "./prompts.js";
import { buildPlan, allIn, quipAnswers, fibOptions, scoreRound } from "./logic.js";
import { createGM } from "./gm.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast } from "./ui.js";

const INTRO_MS = 5000;
const REVEAL_MS = 12000;
const SCORES_MS = 6000;
const MAX_HOLD_MS = 30000; // longest we'll wait for the Landlord to finish talking
const POINT_REASONS = /^\d+ votes?$|crowd|majority|Unanimous|Found the truth|Fooled someone/;

const DEFAULT_SETTINGS = { rounds: 10, timer: 45, social: true, filthy: true, voice: true };

export async function startHost(app) {
  let session = store.get("dg-host");
  if (session) {
    const room = await api.room(session.code).catch(() => null);
    if (!room) session = null;
  }
  if (!session) {
    const token = newToken();
    const code = await api.createRoom(token);
    session = { code, token };
    store.set("dg-host", session);
  }
  const { code, token } = session;
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

  async function startGame() {
    const names = live.players.map((p) => p.name);
    const types = ["quip", "likely", "fib", "wyr", "nhie", ...(settings.social ? ["social"] : [])];
    const plan = buildPlan(settings.rounds, types, { filthy: settings.filthy, names });
    await api.reset(code, token);
    scored.clear();
    const [name, other] = shuffle(names);
    gm.line("welcome", { name, other });
    await beginRound({ plan, settings: { ...settings }, idx: 0 }, 1);
  }

  async function beginRound(base, roundNo) {
    const r = base.plan[base.idx];
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
        else await set("input", room.round, { ...st, deadline: now + timer });
      } else if (room.phase === "input" && (now >= st.deadline || allIn("input", cur, live.players, live.subs))) {
        if (cur.type === "quip") {
          const answers = quipAnswers(live.subs);
          if (answers.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, answers }, deadline: now + voteTime });
          else await reveal(room, st, { ...cur, answers });
        } else if (cur.type === "fib") {
          const options = fibOptions(live.subs, cur.truth);
          if (options.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, options }, deadline: now + voteTime });
          else await reveal(room, st, { ...cur, options });
        } else {
          await reveal(room, st, cur);
        }
      } else if (room.phase === "vote" && (now >= st.deadline || allIn("vote", cur, live.players, live.subs))) {
        await reveal(room, st, cur);
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

  async function reveal(room, st, cur) {
    const { deltas, view } = scoreRound(cur, live.players, live.subs);
    const list = Object.entries(deltas).map(([id, d]) => ({ id, score: d.score, sips: d.sips }));
    if (list.length && !scored.has(room.round)) await api.apply(code, token, list);
    scored.add(room.round);
    await set("reveal", room.round, { ...st, cur: { ...cur, view, deltas }, until: Date.now() + REVEAL_MS });
  }

  async function next(room, st) {
    const idx = st.idx + 1;
    if (idx >= st.plan.length) await set("final", room.round, { ...st });
    else await beginRound({ plan: st.plan, settings: st.settings, idx }, room.round + 1);
  }

  // The Landlord's cues, fired once per phase change.
  function announce(room) {
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    switch (room.phase) {
      case "intro":
        gm.say(`Round ${st.idx + 1}. ${info.title}.`);
        break;
      case "input":
        if (cur.type === "wyr") gm.say(`Would you rather ${cur.prompt[0]}? Or ${cur.prompt[1]}?`, { caption: false });
        else gm.say(cur.prompt, { caption: false });
        break;
      case "vote":
        gm.say(cur.type === "fib" ? "Now. Which one's the truth?" : "Right. Vote for the least disappointing one.", { caption: false });
        break;
      case "reveal":
        if (cur.type === "social") gm.say(cur.prompt, { caption: false });
        else roastRound(cur);
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
        if (live.players.length < 2) return toast("Need at least 2 players!");
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
        store.del("dg-host");
        location.href = location.pathname + "?host";
      } else if (act === "kick") {
        const p = live.players.find((x) => x.id === btn.dataset.id);
        if (p && confirm(`Kick ${p.name}?`)) await api.kick(code, token, p.id);
      } else if (act === "rounds" || act === "timer") {
        settings[act] = +btn.dataset.val;
        store.set("dg-settings", settings);
        render();
      } else if (["social", "filthy", "voice"].includes(act)) {
        settings[act] = !settings[act];
        store.set("dg-settings", settings);
        if (act === "voice" && settings.voice) gm.say("Testing. One, two. Can the cheap seats hear me?");
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
              <div class="setting"><span>Rounds</span>${[6, 10, 15, 20].map((n) => `<button class="pill ${settings.rounds === n ? "on" : ""}" data-act="rounds" data-val="${n}">${n}</button>`).join("")}</div>
              <div class="setting"><span>Timer</span>${[30, 45, 60, 90].map((n) => `<button class="pill ${settings.timer === n ? "on" : ""}" data-act="timer" data-val="${n}">${n}s</button>`).join("")}</div>
              <div class="setting"><span>Filth level</span>${toggle("filthy", "🔥 Filthy", "😇 Mild")}</div>
              <div class="setting"><span>Landlord voice</span>${toggle("voice", "🔊 On")}</div>
              <div class="setting"><span>Social rounds</span>${toggle("social", "On")}</div>
            </div>
            <button class="btn big" data-act="start" ${live.players.length < 2 ? "disabled" : ""}>Everybody's in — start! 🍻</button>
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
      case "vote": {
        const kind = room.phase === "input" ? "input" : "vote";
        const done = new Set(live.subs.filter((s) => s.kind === kind).map((s) => s.player_id));
        let prompt = "";
        if (cur.type === "wyr") {
          prompt = `<h2 class="kicker">Would you rather…</h2>
            <div class="wyr"><div class="wyr-opt a">${esc(cur.prompt[0])}</div><div class="or">OR</div><div class="wyr-opt b">${esc(cur.prompt[1])}</div></div>`;
        } else if (room.phase === "vote") {
          const items = cur.type === "fib" ? cur.options ?? [] : cur.answers ?? [];
          prompt = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
            <p class="kicker">${cur.type === "fib" ? "Which one is the TRUTH? Vote on your phone!" : "Vote for your favourite on your phone!"}</p>
            <div class="answers">${items.map((a, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${esc(a.text)}</div>`).join("")}</div>`;
        } else {
          const hint = {
            likely: "Vote on your phone!",
            nhie: "Answer honestly on your phone…",
            quip: "Write your funniest answer on your phone!",
            fib: "Write a convincing LIE on your phone!",
          }[cur.type];
          prompt = `<h1 class="prompt">${esc(cur.prompt)}</h1><p class="kicker">${hint}</p>`;
        }
        body = `<div class="stage">
          ${timerBar(st.deadline, kind === "vote" ? Math.min(st.settings.timer, 40) : st.settings.timer)}
          <div class="round-type">${info.emoji} ${esc(info.title)}</div>
          ${prompt}
          <div class="waiting-on">${live.players.map((p) => chip(p, done.has(p.id) ? "done" : "wait")).join("")}</div>
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
    const drinkers = Object.entries(cur.deltas ?? {}).filter(([, d]) => d.sips > 0);
    return `<div class="round-type">${info.emoji} ${esc(info.title)}</div>${main}
      ${drinkers.length ? `<div class="drink-list"><h2>🍺 Drink up!</h2>${drinkers
        .map(([id, d]) => `<div class="drink pop">${chip(byId[id])} <b>${sipsText(d.sips)}</b> <span class="muted">${esc(d.why.filter((w) => !POINT_REASONS.test(w)).join(", "))}</span></div>`)
        .join("")}</div>` : ""}`;
  }

  let lastSig = "";
  let lastPhase = null;
  watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.map((s) => s.player_id + s.kind)]);
    if (sig !== lastSig) render();
    lastSig = sig;
    const phaseKey = l.room && `${l.room.phase}:${l.room.round}`;
    if (lastPhase !== null && phaseKey !== lastPhase && l.room) announce(l.room);
    lastPhase = phaseKey;
    step();
  });
  setInterval(() => step(), 500);
  return watcher;
}
