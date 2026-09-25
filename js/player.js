// The phone controller: join a room, answer, vote, find out if you drink.
import { api, watchRoom, store } from "./api.js";
import { ROUND_INFO } from "./prompts.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast } from "./ui.js";

export function startPlayer(app, me, onLeave) {
  const { code, token, playerId } = me;
  let live = { room: null, players: [], subs: [] };
  let sending = false;
  let draft = "";
  let lastSig = "";

  async function send(kind, value) {
    if (sending) return;
    sending = true;
    try {
      await api.submit(code, token, live.room.round, kind, value);
      navigator.vibrate?.(30);
      await watcher.refresh();
    } catch (e) {
      toast(e.message);
    } finally {
      sending = false;
    }
  }

  app.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, val } = btn.dataset;
    if (act === "pick") send("input", { target: val });
    else if (act === "have") send("input", { have: val === "1" });
    else if (act === "choice") send("input", { choice: +val });
    else if (act === "vote") send("vote", { target: val });
    else if (act === "leave" && confirm("Leave this game?")) {
      store.del("dg-player");
      watcher.stop();
      onLeave();
    }
  });
  app.addEventListener("submit", (e) => {
    if (e.target.id !== "quip-form") return;
    e.preventDefault();
    const text = $("#quip-text").value.trim();
    if (!text) return toast("Write something funny!");
    draft = "";
    send("input", { text });
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "quip-text") draft = e.target.value;
  });

  function render() {
    const room = live.room;
    const self = live.players.find((p) => p.id === playerId);
    if (room === null && live.players.length === 0 && lastSig) {
      app.innerHTML = `<div class="phone center"><h2>This room has closed.</h2><button class="btn" data-act="leave">Back</button></div>`;
      return;
    }
    if (!room) {
      app.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
      return;
    }
    if (!self) {
      store.del("dg-player");
      app.innerHTML = `<div class="phone center"><h2>You've been removed from the room 😢</h2><button class="btn" data-act="leave">Back</button></div>`;
      return;
    }

    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    const mySub = (kind) => live.subs.find((s) => s.player_id === playerId && s.kind === kind);
    const lockedIn = (msg = "Locked in! 🔒") => `<div class="locked pop"><div class="big-emoji">✅</div><h2>${msg}</h2><p class="muted">Look at the big screen…</p></div>`;
    let body = "";

    switch (room.phase) {
      case "lobby":
        body = `<div class="center">
          <div class="big-emoji wobble">🍻</div>
          <h2>You're in!</h2>
          <p class="muted">Waiting for the host to start. ${live.players.length} player${live.players.length === 1 ? "" : "s"} so far.</p>
          <div class="waiting-on">${live.players.map((p) => chip(p)).join("")}</div>
        </div>`;
        break;

      case "intro":
        body = `<div class="center pop"><div class="big-emoji">${info.emoji}</div><h2>${esc(info.title)}</h2><p>${esc(info.rules)}</p></div>`;
        break;

      case "input": {
        const timer = timerBar(st.deadline, st.settings?.timer ?? 45);
        if (mySub("input")) {
          body = timer + lockedIn();
          break;
        }
        if (cur.type === "likely") {
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p>
            <div class="choices">${live.players.map((p) => `<button class="choice" data-act="pick" data-val="${p.id}" style="--c:${esc(p.color)}">${avatar(p)}${esc(p.name)}${p.id === playerId ? " (you)" : ""}</button>`).join("")}</div>`;
        } else if (cur.type === "nhie") {
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p>
            <div class="choices two"><button class="choice hot" data-act="have" data-val="1">🍺 I have</button>
            <button class="choice cool" data-act="have" data-val="0">😇 Never</button></div>`;
        } else if (cur.type === "wyr") {
          body = `${timer}<p class="prompt-sm">Would you rather…</p>
            <div class="choices two"><button class="choice a" data-act="choice" data-val="0">${esc(cur.prompt[0])}</button>
            <button class="choice b" data-act="choice" data-val="1">${esc(cur.prompt[1])}</button></div>`;
        } else if (cur.type === "quip") {
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="80" rows="3" placeholder="Something hilarious…">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Send it ✍️</button></form>`;
        }
        break;
      }

      case "vote": {
        const timer = timerBar(st.deadline, Math.min(st.settings?.timer ?? 45, 40));
        const choices = (cur.answers ?? []).filter((a) => a.pid !== playerId);
        if (mySub("vote")) body = timer + lockedIn("Vote cast! 🗳️");
        else if (!choices.length) body = timer + lockedIn("Sit tight — nothing for you to vote on.");
        else
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p><p class="muted">Tap your favourite:</p>
            <div class="choices">${choices.map((a) => `<button class="choice answer-choice" data-act="vote" data-val="${a.pid}">${esc(a.text)}</button>`).join("")}</div>`;
        break;
      }

      case "reveal": {
        if (cur.type === "social") {
          body = `<div class="center pop"><div class="big-emoji">🍻</div><h2>${esc(cur.prompt)}</h2></div>`;
          break;
        }
        const d = cur.deltas?.[playerId];
        if (d?.sips) {
          body = `<div class="verdict drink pop"><div class="big-emoji shake">🍺</div><h1>DRINK ${sipsText(d.sips).toUpperCase()}!</h1>
            <p>${esc(d.why.join(" · "))}</p>${d.score ? `<p class="pts">+${d.score} pts</p>` : ""}</div>`;
        } else {
          body = `<div class="verdict safe pop"><div class="big-emoji">😇</div><h1>You're safe!</h1>
            ${d?.score ? `<p class="pts">+${d.score} pts</p><p>${esc(d.why.join(" · "))}</p>` : ""}</div>`;
        }
        break;
      }

      case "scores":
      case "final": {
        const ranked = [...live.players].sort((a, b) => b.score - a.score);
        // Ties share a rank.
        const rank = ranked.filter((p) => p.score > self.score).length + 1;
        body = `<div class="center pop">
          <div class="big-emoji">${room.phase === "final" ? (rank === 1 ? "🏆" : "🎉") : "📊"}</div>
          <h2>${room.phase === "final" ? (rank === 1 ? "You won!" : "Game over!") : "Scores"}</h2>
          <p class="stat">#${rank} of ${ranked.length}</p>
          <div class="stats"><div><b>${self.score}</b><span>points</span></div><div><b>${self.sips}</b><span>sips</span></div></div>
        </div>`;
        break;
      }
    }

    const hadFocus = document.activeElement?.id === "quip-text";
    app.innerHTML = `<div class="phone">
      <header class="phone-head" style="--c:${esc(self.color)}">${avatar(self, "sm")}<b>${esc(self.name)}</b>
        <span class="muted">· ${code}</span><span class="spacer"></span><span class="mini">${self.score} pts · 🍺${self.sips}</span>
        <button class="link" data-act="leave">✕</button></header>
      <main>${body}</main></div>`;
    if (hadFocus) {
      const ta = $("#quip-text");
      ta?.focus();
      ta?.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  const watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.filter((s) => s.player_id === playerId).map((s) => s.kind)]);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  });
  return watcher;
}
