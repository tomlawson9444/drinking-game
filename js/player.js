// The phone controller: join a room, answer, vote, find out if you drink.
import { api, watchRoom, store } from "./api.js";
import { ROUND_INFO } from "./prompts.js";
import { norm, fillCard } from "./logic.js";
import { createGM } from "./gm.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast, shirt, drawingOf } from "./ui.js";

const PENS = ["#111111", "#ff4f79", "#ffb400", "#3ddc97", "#4cc9f0", "#b388ff", "#8b4513", "#ffffff"];

export function startPlayer(app, me, onLeave) {
  const { code, token, playerId } = me;
  let live = { room: null, players: [], subs: [] };
  let sending = false;
  let draft = "";
  let lastSig = "";
  // "Be the speaker": this phone reads out the Landlord's lines the TV broadcasts.
  let speakerOn = store.get("dg-speaker") === true;
  const speaker = createGM({ settings: { voice: true }, onCaption() {} });
  // Per-round scratch state for multi-step answers (Who's Who picks, Tee K.O. drawing / shirt).
  let scratch = { round: null };
  const fresh = (round) => {
    if (scratch.round !== round) scratch = { round, picks: [], img: null, pen: PENS[0], size: 6, slogan: "", make: {}, cards: [], win: null };
    return scratch;
  };

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
    if (act === "speaker") {
      speakerOn = !speakerOn;
      store.set("dg-speaker", speakerOn);
      // Speaking now (inside the tap) also unlocks speech on phones that need a user gesture.
      if (speakerOn) speaker.say("I'm the Landlord, and I'll be talking through this phone. Keep the screen on.");
      else speaker.stop();
      render();
      return;
    }
    if (act === "pick") send("input", { target: val });
    else if (act === "have") send("input", { have: val === "1" });
    else if (act === "choice") send("input", { choice: +val });
    else if (act === "vote") send("vote", { target: val });
    else if (act === "opt") send("input", { choice: val });
    else if (act === "card") {
      // Tap to select (in order, for pick-2 cards); tap again to unselect.
      const sc = fresh(live.room.round);
      const i = sc.cards.indexOf(+val);
      if (i >= 0) sc.cards.splice(i, 1);
      else if (sc.cards.length < live.room.state.cur.pick) sc.cards.push(+val);
      render();
    } else if (act === "card-play") {
      const hand = live.room.state.hands?.[playerId] ?? [];
      send("input", { cards: fresh(live.room.round).cards.map((i) => hand[i]) });
    } else if (act === "czar") {
      const sc = fresh(live.room.round);
      const plays = live.room.state.cur.plays ?? [];
      if (!sc.win) {
        sc.win = val;
        if (plays.length >= 3) render(); // now pick the least favourite
        else send("vote", { win: val });
      } else send("vote", { win: sc.win, worst: val });
    } else if (act === "czar-undo") {
      fresh(live.room.round).win = null;
      render();
    }
    else if (act === "chamber") send("vote", { pick: +val });
    else if (act === "fight") send(`m${live.room.state.cur.match.m}`, { pick: val });
    else if (act === "role-pick") {
      const sc = fresh(live.room.round);
      sc.picks.push(val);
      if (sc.picks.length >= live.room.state.cur.roles.length) send("input", { assign: sc.picks });
      else render();
    } else if (act === "role-undo") {
      fresh(live.room.round).picks.pop();
      render();
    } else if (act === "pen") {
      fresh(live.room.round).pen = val;
      render();
    } else if (act === "pen-clear") {
      fresh(live.room.round).img = null;
      render();
    } else if (act === "make-img" || act === "make-slogan") {
      fresh(live.room.round).make[act === "make-img" ? "img" : "slogan"] = val;
      render();
    } else if (act === "make-done") {
      const m = fresh(live.room.round).make;
      if (!m.img || !m.slogan) return toast("Pick a drawing AND a slogan!");
      send("vote", { img: m.img, slogan: m.slogan });
    }
    else if (act === "leave" && (!live.room || !live.players.some((p) => p.id === playerId) || confirm("Leave this game?"))) {
      store.del("dg-player");
      watcher.stop();
      onLeave();
    }
  });
  app.addEventListener("submit", (e) => {
    if (e.target.id === "year-form") {
      e.preventDefault();
      const year = parseInt($("#year-val").value, 10);
      if (!(year >= 1000 && year <= 2100)) return toast("Pick a year between 1000 and 2100");
      return send("input", { year });
    }
    if (e.target.id === "tee-form") {
      e.preventDefault();
      const sc = fresh(live.room.round);
      const slogan = $("#tee-slogan").value.trim();
      if (!sc.img) return toast("Draw something first! 🎨");
      if (!slogan) return toast("Write a slogan too!");
      return send("input", { img: sc.img, slogan });
    }
    if (e.target.id !== "quip-form") return;
    e.preventDefault();
    const text = $("#quip-text").value.trim();
    if (!text) return toast("Write something funny!");
    const cur = live.room?.state?.cur;
    if (cur?.type === "fib" && norm(text) === norm(cur.truth)) return toast("That's actually the truth! Lie better. 🤥");
    draft = "";
    send(live.room.phase === "twist" ? "twist" : "input", { text });
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "quip-text") draft = e.target.value;
    if (e.target.id === "tee-slogan") fresh(live.room.round).slogan = e.target.value;
  });

  // Finger-painting for Tee K.O. The picture is kept in scratch so re-renders don't wipe it.
  function setupCanvas() {
    const c = $("#tee-canvas");
    if (!c) return;
    const sc = fresh(live.room.round);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (sc.img) {
      const im = new Image();
      im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height);
      im.src = sc.img;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let last = null;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
    };
    const stroke = (to) => {
      ctx.strokeStyle = sc.pen;
      ctx.lineWidth = sc.pen === "#ffffff" ? 18 : sc.size;
      ctx.beginPath();
      ctx.moveTo(...last);
      ctx.lineTo(...to);
      ctx.stroke();
      last = to;
    };
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      last = pos(e);
      stroke([last[0] + 0.1, last[1] + 0.1]);
    });
    c.addEventListener("pointermove", (e) => last && stroke(pos(e)));
    const end = () => {
      if (!last) return;
      last = null;
      sc.img = c.toDataURL("image/jpeg", 0.6);
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }

  function render() {
    const room = live.room;
    const self = live.players.find((p) => p.id === playerId);
    if (room === null && live.players.length === 0 && lastSig) {
      store.del("dg-player");
      app.innerHTML = `<div class="phone center"><div class="big-emoji">🚪</div><h2>Game over — this room has closed.</h2>
        <p class="muted">The host started a fresh room. Ask for the new code to join again.</p>
        <button class="btn" data-act="leave">Back to start</button></div>`;
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
          <button class="btn ${speakerOn ? "" : "ghost"} speaker-card" data-act="speaker">${speakerOn ? "🔊 You're the speaker — tap to stop" : "🔈 Be the speaker"}</button>
          <p class="muted small">No sound from the TV? Make one phone the speaker and the Landlord talks through it. Turn the volume up and keep the screen on.</p>
        </div>`;
        break;

      case "intro":
        body = `<div class="center pop"><div class="big-emoji">${info.emoji}</div><h2>${esc(info.title)}</h2><p>${esc(info.rules)}</p></div>`;
        break;

      case "input": {
        const timer = timerBar(st.deadline, st.span ?? st.settings?.timer ?? 45);
        if (cur.type === "cards" && cur.czar === playerId) {
          body = timer + `<div class="black-card sm">${esc(cur.prompt)}</div><div class="locked pop"><div class="big-emoji">👑</div><h2>You're the Card Czar!</h2><p class="muted">Sit back while everyone plays. Then you judge.</p></div>`;
          break;
        }
        if (mySub("input")) {
          body = timer + lockedIn();
          break;
        }
        if (cur.type === "cards") {
          const sc = fresh(room.round);
          const hand = st.hands?.[playerId] ?? [];
          const preview = sc.cards.length === cur.pick ? fillCard(cur.prompt, sc.cards.map((i) => hand[i])) : null;
          body = `${timer}<div class="black-card sm">${esc(cur.prompt)}${cur.pick > 1 ? `<div class="pick">PICK ${cur.pick}</div>` : ""}</div>
            <p class="muted center-text">Tap ${cur.pick === 1 ? "your funniest card" : `${cur.pick} cards in order`}:</p>
            <div class="hand">${hand.map((c, i) => {
              const n = sc.cards.indexOf(i);
              return `<button class="white-card ${n >= 0 ? "on" : ""}" data-act="card" data-val="${i}">${n >= 0 && cur.pick > 1 ? `<span class="order">${n + 1}</span>` : ""}${esc(c)}</button>`;
            }).join("")}</div>
            ${preview ? `<p class="muted center-text">Preview: “${esc(preview)}”</p>` : ""}
            <button class="btn big" data-act="card-play" ${preview ? "" : "disabled"}>Play ${cur.pick === 1 ? "it" : "them"} 🃏</button>`;
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
        } else if (cur.type === "year") {
          body = `${timer}<p class="muted center-text">What year?</p><p class="prompt-sm">${esc(cur.prompt)}</p>
            <form id="year-form" class="quip-form"><input id="year-val" class="year-input" type="number" inputmode="numeric" min="1000" max="2100" placeholder="e.g. 1987" required>
            <button class="btn big" type="submit">Lock it in 📅</button></form>`;
        } else if (cur.type === "trivia") {
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p>
            <div class="choices">${cur.options.map((o, i) => `<button class="choice opt${i}" data-act="opt" data-val="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
        } else if (cur.type === "roles") {
          const sc = fresh(room.round);
          const i = sc.picks.length;
          const used = new Set(sc.picks);
          body = `${timer}<p class="muted center-text">${esc(cur.prompt)} (${i + 1}/${cur.roles.length})</p>
            <p class="prompt-sm">Who is <b>${esc(cur.roles[i].replace(/^The /, "the "))}</b>?${cur.roles[i] === cur.drink ? " 🍺" : ""}</p>
            <div class="choices">${live.players.filter((p) => !used.has(p.id)).map((p) => `<button class="choice" data-act="role-pick" data-val="${p.id}" style="--c:${esc(p.color)}">${avatar(p)}${esc(p.name)}${p.id === playerId ? " (you)" : ""}</button>`).join("")}</div>
            ${i ? `<button class="btn ghost sm" data-act="role-undo">↩ Undo</button>` : ""}`;
        } else if (cur.type === "tee") {
          const sc = fresh(room.round);
          const idea = cur.ideas?.[live.players.findIndex((p) => p.id === playerId) % (cur.ideas?.length || 1)];
          body = `${timer}<p class="muted center-text">Draw anything${idea ? ` — stuck? Try <b>${esc(idea)}</b>` : ""}</p>
            <canvas id="tee-canvas" class="tee-canvas" width="240" height="240"></canvas>
            <div class="pens">${PENS.map((c) => `<button class="pen ${sc.pen === c ? "on" : ""}" data-act="pen" data-val="${c}" style="--c:${c}" aria-label="${c === "#ffffff" ? "Eraser" : "Pen colour"}">${c === "#ffffff" ? "🧽" : ""}</button>`).join("")}
              <button class="btn ghost sm" data-act="pen-clear">Clear</button></div>
            <form id="tee-form" class="quip-form"><input id="tee-slogan" class="slogan-input" maxlength="50" placeholder="Now write a slogan…" value="${esc(sc.slogan)}">
            <button class="btn big" type="submit">Print it 👕</button></form>`;
        } else if (cur.type === "sti") {
          const q = cur.ask?.[playerId] ?? cur.questions?.[0];
          body = `${timer}<p class="muted center-text">Answer honestly. Nothing bad will happen. 😇</p><p class="prompt-sm">${esc(q)}</p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="120" rows="3" placeholder="Your answer…">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Send it</button></form>`;
        } else if (cur.type === "quip" || cur.type === "fib" || cur.type === "brawl") {
          const fib = cur.type === "fib";
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p>${fib ? `<p class="muted center-text">Make up a believable fake answer to fool everyone.</p>` : ""}
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="${fib ? 60 : 80}" rows="3" placeholder="${fib ? "A convincing lie…" : "Something hilarious…"}">${esc(draft)}</textarea>
            <button class="btn big" type="submit">${fib ? "Lie 🤥" : "Send it ✍️"}</button></form>`;
        }
        break;
      }

      case "twist": {
        const timer = timerBar(st.deadline, st.span ?? 45);
        const t = cur.twists?.[playerId];
        if (mySub("twist")) body = timer + lockedIn("Twisted! 😈");
        else if (!t) body = timer + lockedIn("Sit tight…");
        else
          body = `${timer}<p class="muted center-text">Someone answered:</p><p class="prompt-sm">“${esc(t.answer)}”</p>
            <p class="center-text">But it was actually posted as <b>${esc(t.context)}</b>. Write the bit that makes it make sense:</p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="100" rows="3" placeholder="e.g. the headline, the photo it was under, who it was sent to…">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Twist it 😈</button></form>`;
        break;
      }

      case "match": {
        const timer = timerBar(st.deadline, st.span ?? 15);
        const m = cur.match;
        const kind = `m${m.m}`;
        const side = (e) => (cur.type === "tee" ? shirt(drawingOf(live.subs, e.img), e.text) : esc(e.text));
        if (mySub(kind)) body = timer + lockedIn("Vote cast! 🥊");
        else if (m.a.pid === playerId || m.b.pid === playerId) body = timer + lockedIn("You're in this fight! Watch the screen 🥊");
        else
          body = `${timer}<p class="muted center-text">${esc(m.label)}</p>
            <div class="choices fight">${["a", "b"].map((k) => `<button class="choice answer-choice" data-act="fight" data-val="${k}">${side(m[k])}</button>`).join(`<div class="vs sm">VS</div>`)}</div>`;
        break;
      }

      case "vote": {
        const timer = timerBar(st.deadline, st.span ?? Math.min(st.settings?.timer ?? 45, 40));
        if (cur.type === "trivia") {
          if (!cur.chamber?.includes(playerId)) body = timer + `<div class="verdict safe pop"><div class="big-emoji">😅</div><h1>Correct! You're safe.</h1><p>Now watch the losers squirm in the Drinking Chamber.</p></div>`;
          else if (mySub("vote")) body = timer + lockedIn("Fate chosen… 💀");
          else if (cur.game === "glasses")
            body = `${timer}<h2 class="center-text">☠️ The Drinking Chamber</h2><p class="center-text">Wrong answer! Four glasses. One is spiked. Choose.</p>
              <div class="glasses">${[0, 1, 2, 3].map((i) => `<button class="choice glass" data-act="chamber" data-val="${i}">🍺<br>${i + 1}</button>`).join("")}</div>`;
          else
            body = `${timer}<h2 class="center-text">☠️ The Drinking Chamber</h2><p class="center-text">Pick a number. If anyone else picks the same one, you both drink 3.</p>
              <div class="glasses">${[1, 2, 3, 4, 5].map((n) => `<button class="choice glass" data-act="chamber" data-val="${n}">${n}</button>`).join("")}</div>`;
          break;
        }
        if (cur.type === "cards") {
          const plays = cur.plays ?? [];
          const sc = fresh(room.round);
          const czarName = live.players.find((p) => p.id === cur.czar)?.name ?? "The Czar";
          if (cur.czar !== playerId) body = timer + `<div class="locked pop"><div class="big-emoji">👑</div><h2>${esc(czarName)} is judging…</h2><p class="muted">Look at the big screen and pray.</p></div>`;
          else if (mySub("vote")) body = timer + lockedIn("Judgement passed! 👑");
          else
            body = `${timer}<div class="black-card sm">${esc(cur.prompt)}</div>
              <p class="prompt-sm">${sc.win ? "Now your LEAST favourite 💩 (they drink 2)" : "Pick your favourite 👑"}</p>
              <div class="choices">${plays.filter((p) => p.pid !== sc.win).map((p) => `<button class="choice answer-choice" data-act="czar" data-val="${p.pid}">${esc(fillCard(cur.prompt, p.cards))}</button>`).join("")}</div>
              ${sc.win ? `<button class="btn ghost sm" data-act="czar-undo">↩ Change favourite</button>` : ""}`;
          break;
        }
        if (cur.type === "tee") {
          const o = cur.offers?.[playerId];
          const mk = fresh(room.round).make;
          const sloganOf = (pid) => live.subs.find((x) => x.kind === "input" && x.player_id === pid)?.value?.slogan ?? "";
          if (mySub("vote")) body = timer + lockedIn("Shirt printed! 👕");
          else if (!o) body = timer + lockedIn("Sit tight…");
          else
            body = `${timer}<p class="prompt-sm">Make your shirt</p><p class="muted center-text">1. Pick a drawing</p>
              <div class="make-row">${o.imgs.map((pid) => `<button class="pickable ${mk.img === pid ? "on" : ""}" data-act="make-img" data-val="${pid}">${shirt(drawingOf(live.subs, pid), "")}</button>`).join("")}</div>
              <p class="muted center-text">2. Pick a slogan</p>
              <div class="choices">${o.slogans.map((pid) => `<button class="choice pickable ${mk.slogan === pid ? "on" : ""}" data-act="make-slogan" data-val="${pid}">${esc(sloganOf(pid))}</button>`).join("")}</div>
              ${mk.img && mk.slogan ? `<p class="muted center-text">Preview:</p>${shirt(drawingOf(live.subs, mk.img), sloganOf(mk.slogan))}` : ""}
              <button class="btn big" data-act="make-done">Print it 👕</button>`;
          break;
        }
        if (cur.type === "sti") {
          const choices = (cur.posts ?? []).filter((x) => x.pid !== playerId);
          if (mySub("vote")) body = timer + lockedIn("Vote cast! 🗳️");
          else if (!choices.length) body = timer + lockedIn("Sit tight — nothing for you to vote on.");
          else
            body = `${timer}<p class="muted center-text">Vote for the best twist:</p>
              <div class="choices">${choices.map((x) => `<button class="choice answer-choice" data-act="vote" data-val="${x.pid}"><small>Posted as ${esc(x.context)}:</small><br>“${esc(x.answer)}”<br><b>${esc(x.text)}</b></button>`).join("")}</div>`;
          break;
        }
        const fib = cur.type === "fib";
        const choices = fib
          ? (cur.options ?? []).filter((o) => !o.pids.includes(playerId)).map((o) => ({ val: o.key, text: o.text }))
          : (cur.answers ?? []).filter((a) => a.pid !== playerId).map((a) => ({ val: a.pid, text: a.text }));
        if (mySub("vote")) body = timer + lockedIn("Vote cast! 🗳️");
        else if (!choices.length) body = timer + lockedIn("Sit tight — nothing for you to vote on.");
        else
          body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p><p class="muted">${fib ? "Which one is the TRUTH?" : "Tap your favourite:"}</p>
            <div class="choices">${choices.map((c) => `<button class="choice answer-choice" data-act="vote" data-val="${esc(c.val)}">${esc(c.text)}</button>`).join("")}</div>`;
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
        <button class="link speaker-btn ${speakerOn ? "on" : ""}" data-act="speaker" aria-label="Be the speaker">${speakerOn ? "🔊" : "🔈"}</button>
        <button class="link" data-act="leave">✕</button></header>
      <main>${body}</main></div>`;
    setupCanvas();
    if (hadFocus) {
      const ta = $("#quip-text");
      ta?.focus();
      ta?.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  const onSay = ({ text } = {}) => speakerOn && text && speaker.say(text, { caption: false });
  const watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.filter((s) => s.player_id === playerId).map((s) => s.kind)]);
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  }, { onSay });
  return watcher;
}
