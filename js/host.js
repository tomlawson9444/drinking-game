// The "TV" screen: creates the room, shows the prompts and runs the game clock.
import { api, watchRoom, newToken, store } from "./api.js";
import { ROUND_INFO } from "./prompts.js";
import { buildPlan, allIn, quipAnswers, scoreRound } from "./logic.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast } from "./ui.js";

const INTRO_MS = 5000;
const REVEAL_MS = 14000;
const SCORES_MS = 7000;

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
  const settings = store.get("dg-settings") ?? { rounds: 10, timer: 45, social: true };

  let moved = false;
  const set = (phase, round, state) => {
    moved = true;
    return api.setState(code, token, phase, round, state);
  };

  async function startGame() {
    const types = ["quip", "likely", "wyr", "nhie", ...(settings.social ? ["social"] : [])];
    const plan = buildPlan(settings.rounds, types);
    await api.reset(code, token);
    scored.clear();
    await beginRound({ plan, settings, idx: 0 }, 1);
  }

  async function beginRound(base, roundNo) {
    const r = base.plan[base.idx];
    await set("intro", roundNo, { ...base, cur: { ...r }, until: Date.now() + INTRO_MS });
  }

  async function step() {
    const room = live.room;
    if (!room || busy) return;
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const now = Date.now();
    const timer = (st.settings?.timer ?? 45) * 1000;
    busy = true;
    moved = false;
    try {
      if (room.phase === "intro" && now >= st.until) {
        if (cur.type === "social") await set("reveal", room.round, { ...st, cur: { ...cur, view: {} }, until: now + REVEAL_MS });
        else await set("input", room.round, { ...st, deadline: now + timer });
      } else if (room.phase === "input" && (now >= st.deadline || allIn("input", cur.type, live.players, live.subs))) {
        if (cur.type === "quip") {
          const answers = quipAnswers(live.subs);
          if (answers.length >= 2) {
            await set("vote", room.round, { ...st, cur: { ...cur, answers }, deadline: now + Math.min(timer, 40000) });
            return;
          }
          await reveal(room, st, { ...cur, answers });
        } else {
          await reveal(room, st, cur);
        }
      } else if (room.phase === "vote" && (now >= st.deadline || allIn("vote", cur.type, live.players, live.subs, cur.answers ?? []))) {
        await reveal(room, st, cur);
      } else if (room.phase === "reveal" && now >= st.until) {
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
        // Fast-forward whatever is on screen.
        const st = live.room.state;
        const patch = live.room.phase === "input" || live.room.phase === "vote" ? { deadline: 0 } : { until: 0 };
        await set(live.room.phase, live.room.round, { ...st, ...patch });
      } else if (act === "lobby") {
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
      } else if (act === "social") {
        settings.social = !settings.social;
        store.set("dg-settings", settings);
        render();
      }
    } catch (err) {
      toast(err.message);
    }
  });

  const joinUrl = `${location.origin}${location.pathname}?room=${code}`;

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
    const controls = room.phase === "lobby" || room.phase === "final" ? "" : `<footer class="host-foot">
        <button class="btn ghost sm" data-act="skip">Skip ⏭</button>
        <button class="btn ghost sm" data-act="lobby">Back to lobby</button>
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
              ${live.players.map((p) => `<button class="player-card pop" data-act="kick" data-id="${p.id}" title="Click to kick" style="--c:${esc(p.color)}">${avatar(p, "lg")}<span>${esc(p.name)}</span></button>`).join("") || `<p class="muted">Waiting for players to join…</p>`}
            </div>
            <div class="settings">
              <div class="setting"><span>Rounds</span>${[6, 10, 15, 20].map((n) => `<button class="pill ${settings.rounds === n ? "on" : ""}" data-act="rounds" data-val="${n}">${n}</button>`).join("")}</div>
              <div class="setting"><span>Timer</span>${[30, 45, 60, 90].map((n) => `<button class="pill ${settings.timer === n ? "on" : ""}" data-act="timer" data-val="${n}">${n}s</button>`).join("")}</div>
              <div class="setting"><span>Social rounds</span><button class="pill ${settings.social ? "on" : ""}" data-act="social">${settings.social ? "On" : "Off"}</button></div>
            </div>
            <button class="btn big" data-act="start" ${live.players.length < 2 ? "disabled" : ""}>Everybody's in — start! 🍻</button>
            <p class="muted small">Host wants to play too? Join from your phone as well. Drink responsibly — a "sip" can be anything, water counts.</p>
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
          prompt = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
            <p class="kicker">Vote for your favourite on your phone!</p>
            <div class="answers">${(cur.answers ?? []).map((a, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${esc(a.text)}</div>`).join("")}</div>`;
        } else {
          const hint = { likely: "Vote on your phone!", nhie: "Answer honestly on your phone…", quip: "Write your funniest answer on your phone!" }[cur.type];
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
          <div class="split"><div><h3>I have 🍺</h3>${(v.have ?? []).map((id) => chip(byId[id])).join("") || `<p class="muted">Saints, all of you.</p>`}</div>
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
    }
    const drinkers = Object.entries(cur.deltas ?? {}).filter(([, d]) => d.sips > 0);
    return `<div class="round-type">${info.emoji} ${esc(info.title)}</div>${main}
      ${drinkers.length ? `<div class="drink-list"><h2>🍺 Drink up!</h2>${drinkers
        .map(([id, d]) => `<div class="drink pop">${chip(byId[id])} <b>${sipsText(d.sips)}</b> <span class="muted">${esc(d.why.filter((w) => !/vote|crowd|majority|Unanimous/.test(w) || /Zero/.test(w)).join(", "))}</span></div>`)
        .join("")}</div>` : ""}`;
  }

  let lastSig = "";
  watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.map((s) => s.player_id + s.kind)]);
    if (sig !== lastSig) render();
    lastSig = sig;
    step();
  });
  setInterval(() => step(), 500);
  return watcher;
}
