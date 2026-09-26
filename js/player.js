// The phone controller: join a room, answer, vote, find out if you drink.
import { api, watchRoom, store } from "./api.js";
import { ROUND_INFO } from "./prompts.js";
import { norm, fillCard, isBlank, JOB_MAX_WORDS } from "./logic.js";
import { HOT_IDEAS } from "./prompts.js";
import { createGM } from "./gm.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast, shirt, drawingOf, safeImg } from "./ui.js";

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
    if (scratch.round !== round) scratch = { round, picks: [], img: null, pen: PENS[0], size: 6, slogan: "", make: {}, cards: [], win: null, blanks: {}, words: [], sort: [] };
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
    if (act === "photo") {
      $("#photo-input")?.click();
      return;
    }
    if (act === "hot-vote") return send(`m${live.room.state.cur.q.i}`, { verdict: val });
    if (act === "hot-refuse") {
      if (confirm("Refuse to answer and drink 3?")) send(`m${live.room.state.cur.q.i}`, { refuse: true });
      return;
    }
    if (act === "rule-pick") return send("rule", { text: live.room.state.cur.options[+val] });
    if (act === "hol") return send(`m${live.room.state.cur.q.i}`, { pick: val });
    if (act === "buddy-pick") return send("buddy", { target: val });
    if (act === "poll-hl") return send("vote", { pick: val });
    if (act === "sort-pick" || act === "sort-undo") {
      const sc = fresh(live.room.round);
      if (act === "sort-undo") sc.sort.pop();
      else if (!sc.sort.includes(+val)) sc.sort.push(+val);
      if (sc.sort.length === live.room.state.cur.items.length) return send("input", { order: sc.sort });
      return render();
    }
    if (act === "job-word" || act === "job-undo") {
      const sc = fresh(live.room.round);
      if (act === "job-undo") sc.words.pop();
      else if (sc.words.length < JOB_MAX_WORDS) sc.words.push(+val);
      else toast(`That's ${JOB_MAX_WORDS} words — keep it snappy!`);
      return render();
    }
    if (act === "job-send") {
      const words = fresh(live.room.round).words;
      if (!words.length) return toast("Tap some words first! 💼");
      return send("twist", { idx: words });
    }
    if (act === "snitch") {
      scratch.snitching = !scratch.snitching;
      render();
      return;
    }
    if (act === "snitch-on") {
      watcher.snitch({ by: playerId, target: val });
      scratch.snitching = false;
      toast("Snitched! 🐀 The Landlord has been informed.");
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
      const sc = fresh(live.room.round);
      const texts = sc.cards.map((i) => (isBlank(hand[i]) ? String(sc.blanks[i] ?? "").trim() : hand[i]));
      if (texts.some((t) => !t)) return toast("Write something on your blank card! ✏️");
      send("input", { cards: sc.cards.map((i) => hand[i]), texts });
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
    if (e.target.id === "draw-form") {
      e.preventDefault();
      const sc = fresh(live.room.round);
      if (!sc.img) return toast("Draw something first! 🎨");
      return send("input", { img: sc.img });
    }
    if (e.target.id === "poll-form") {
      e.preventDefault();
      return send("input", { pct: +$("#poll-val").value });
    }
    if (e.target.id === "rule-form") {
      e.preventDefault();
      const text = $("#rule-text").value.trim();
      if (!text) return toast("Write a rule!");
      return send("rule", { text });
    }
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
    if (cur?.type === "drawful" && norm(text) === norm(cur.prompt)) return toast("Ha — that's actually what it is! Lie better. 🤥");
    draft = "";
    send(live.room.phase === "twist" ? "twist" : "input", { text });
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "quip-text") draft = e.target.value;
    if (e.target.dataset.blank) fresh(live.room.round).blanks[e.target.dataset.blank] = e.target.value;
    if (e.target.id === "tee-slogan") fresh(live.room.round).slogan = e.target.value;
    if (e.target.id === "poll-val") $("#poll-show").textContent = `${e.target.value}%`;
  });

  // House rules in force, with a snitch button.
  function rulesBar(st) {
    const active = (st.rules ?? []).filter((r) => r.until > st.idx);
    if (!active.length || live.room?.phase === "lobby") return "";
    return `<div class="rules-bar"><div>📜 ${active.map((r) => esc(r.text)).join("<br>📜 ")}</div>
      <button class="btn danger sm" data-act="snitch">🚨 Snitch</button>
      ${scratch.snitching ? `<div class="snitch-list">${live.players.filter((p) => p.id !== playerId).map((p) => `<button class="choice" data-act="snitch-on" data-val="${p.id}">${avatar(p)}${esc(p.name)} broke it!</button>`).join("")}</div>` : ""}</div>`;
  }

  // Selfie: centre-crop to a small square JPEG before uploading.
  app.addEventListener("change", async (e) => {
    if (e.target.id !== "photo-input" || !e.target.files?.[0]) return;
    try {
      const url = URL.createObjectURL(e.target.files[0]);
      const img = await new Promise((ok, fail) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = fail;
        im.src = url;
      });
      const size = 128;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const side = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      await api.setPhoto(code, token, c.toDataURL("image/jpeg", 0.7));
      toast("Looking good 📸");
      await watcher.refresh();
    } catch (err) {
      toast(err.message || "Couldn't use that photo");
    }
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
          <button class="btn ghost" data-act="photo">${self.photo ? "📸 Retake your selfie" : "📸 Add a selfie"}</button>
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
        if (cur.type === "imposter") {
          const imp = cur.imposter === playerId;
          if (mySub("input")) {
            body = timer + lockedIn("Clue in! 🕵️");
            break;
          }
          body = `${timer}${imp
            ? `<div class="secret imposter pop"><div class="big-emoji">🕵️</div><h2>You're the IMPOSTER!</h2><p>Category: <b>${esc(cur.prompt)}</b></p><p class="muted">You don't know the word. Blend in.</p></div>`
            : `<div class="secret pop"><p class="muted">Category: ${esc(cur.prompt)}</p><p>The secret word is</p><h1>${esc(cur.word)}</h1><p class="muted">One of you doesn't know it. Don't make it too obvious.</p></div>`}
            <form id="quip-form" class="quip-form"><input id="quip-text" class="slogan-input" maxlength="24" placeholder="Your one-word clue" autocomplete="off">
            <button class="btn big" type="submit">Give clue</button></form>`;
          break;
        }
        if (cur.type === "drawful") {
          const drawer = live.players.find((p) => p.id === cur.drawer);
          if (cur.drawer !== playerId) {
            body = timer + `<div class="locked pop"><div class="big-emoji">🎨</div><h2>${esc(drawer?.name ?? "Someone")} is drawing…</h2><p class="muted">No peeking at their phone.</p></div>`;
            break;
          }
          if (mySub("input")) {
            body = timer + lockedIn("Masterpiece submitted! 🖼️");
            break;
          }
          const sc = fresh(room.round);
          body = `${timer}<p class="muted center-text">Draw this — don't write words!</p><p class="prompt-sm">🤫 ${esc(cur.prompt)}</p>
            <canvas id="tee-canvas" class="tee-canvas" width="240" height="240"></canvas>
            <div class="pens">${PENS.map((c) => `<button class="pen ${sc.pen === c ? "on" : ""}" data-act="pen" data-val="${c}" style="--c:${c}" aria-label="${c === "#ffffff" ? "Eraser" : "Pen colour"}">${c === "#ffffff" ? "🧽" : ""}</button>`).join("")}
              <button class="btn ghost sm" data-act="pen-clear">Clear</button></div>
            <form id="draw-form" class="quip-form"><button class="btn big" type="submit">Done 🖼️</button></form>`;
          break;
        }
        if (cur.type === "hot") {
          const victim = live.players.find((p) => p.id === cur.victim);
          if (cur.victim === playerId) {
            body = timer + `<div class="locked pop"><div class="big-emoji">🔥</div><h2>You're in the Hot Seat!</h2><p class="muted">Everyone's writing you a question. Get your poker face on.</p></div>`;
            break;
          }
          const ideas = HOT_IDEAS[st.settings?.filthy ? "filthy" : "mild"];
          body = `${timer}<p class="prompt-sm">Ask ${esc(victim?.name ?? "them")} anything 🔥</p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="140" rows="3" placeholder="e.g. ${esc(ideas[Math.floor(Math.random() * ideas.length)])}">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Ask it</button></form><p class="muted center-text small">It's anonymous. Probably.</p>`;
          break;
        }
        if (cur.type === "cards") {
          const sc = fresh(room.round);
          const hand = st.hands?.[playerId] ?? [];
          const shown = (i) => (isBlank(hand[i]) ? sc.blanks[i] || "____" : hand[i]);
          const preview = sc.cards.length === cur.pick ? fillCard(cur.prompt, sc.cards.map(shown)) : null;
          body = `${timer}<div class="black-card sm">${esc(cur.prompt)}${cur.pick > 1 ? `<div class="pick">PICK ${cur.pick}</div>` : ""}</div>
            <p class="muted center-text">Tap ${cur.pick === 1 ? "your funniest card" : `${cur.pick} cards in order`}:</p>
            <div class="hand">${hand.map((c, i) => {
              const n = sc.cards.indexOf(i);
              const order = n >= 0 && cur.pick > 1 ? `<span class="order">${n + 1}</span>` : "";
              if (isBlank(c))
                return `<div class="white-card blank ${n >= 0 ? "on" : ""}"><button class="link blank-pick" data-act="card" data-val="${i}">${order}✏️ Blank card — write your own</button>
                  ${n >= 0 ? `<input class="blank-input" data-blank="${i}" maxlength="80" placeholder="Your answer…" value="${esc(sc.blanks[i] ?? "")}">` : ""}</div>`;
              return `<button class="white-card ${n >= 0 ? "on" : ""}" data-act="card" data-val="${i}">${order}${esc(c)}</button>`;
            }).join("")}</div>
            ${preview ? `<p class="muted center-text">Preview: “${esc(preview)}”</p>` : ""}
            <button class="btn big" data-act="card-play" ${preview ? "" : "disabled"}>Play ${cur.pick === 1 ? "it" : "them"} 🃏</button>`;
          break;
        }
        const nameOf = (id) => esc(live.players.find((p) => p.id === id)?.name ?? "Someone");
        if (cur.type === "poll") {
          if (cur.pollster !== playerId) body = timer + `<div class="locked pop"><div class="big-emoji">📊</div><h2>${nameOf(cur.pollster)} is taking the poll…</h2><p class="muted">${esc(cur.prompt)}</p><p class="muted">Get ready to call higher or lower.</p></div>`;
          else
            body = `${timer}<h2 class="center-text">📊 You're the pollster!</h2><p class="prompt-sm">${esc(cur.prompt)}</p>
              <form id="poll-form" class="quip-form"><div id="poll-show" class="poll-show">50%</div>
              <input id="poll-val" class="poll-slider" type="range" min="0" max="100" step="1" value="50">
              <button class="btn big" type="submit">That's my guess 📊</button></form>`;
          break;
        }
        if (cur.type === "sort") {
          const t = cur.teams?.findIndex((team) => team.includes(playerId)) ?? -1;
          const team = ["🔴 Red", "🔵 Blue"][t] ?? "";
          if (cur.captains?.[t] !== playerId) {
            body = `${timer}<h2 class="center-text">${team} team</h2><p class="prompt-sm">${esc(cur.prompt)}</p>
              <div class="choices">${cur.items.map((it) => `<div class="choice static">${esc(it.name)}</div>`).join("")}</div>
              <p class="center-text">👑 <b>${nameOf(cur.captains?.[t])}</b> is sorting for your team. Shout at them!</p>`;
            break;
          }
          const sc = fresh(room.round);
          body = `${timer}<h2 class="center-text">👑 ${team} captain</h2><p class="prompt-sm">${esc(cur.prompt)}</p>
            <p class="muted center-text">Tap them in order — ${sc.sort.length + 1} of ${cur.items.length}</p>
            ${sc.sort.length ? `<ol class="sort-picked">${sc.sort.map((i) => `<li>${esc(cur.items[i].name)}</li>`).join("")}</ol>` : ""}
            <div class="choices">${cur.items.map((it, i) => (sc.sort.includes(i) ? "" : `<button class="choice" data-act="sort-pick" data-val="${i}">${esc(it.name)}</button>`)).join("")}</div>
            ${sc.sort.length ? `<button class="btn ghost sm" data-act="sort-undo">↩ Undo</button>` : ""}`;
          break;
        }
        if (cur.type === "spiked") {
          const me = cur.spiked?.includes(playerId);
          body = `${timer}${me
            ? `<div class="secret imposter pop"><div class="big-emoji">🧪</div><h2>You've been SPIKED!</h2><p>Everyone else has a different question. Blend in.</p></div>`
            : `<p class="muted center-text">Someone has a different question. Don't be too obvious… or too vague.</p>`}
            <p class="prompt-sm">${esc(me ? cur.alt : cur.prompt)}</p>
            <form id="quip-form" class="quip-form"><input id="quip-text" class="slogan-input" maxlength="60" placeholder="Your answer" autocomplete="off" value="${esc(draft)}">
            <button class="btn big" type="submit">Send it</button></form>`;
          break;
        }
        if (cur.type === "job") {
          body = `${timer}<p class="muted center-text">💼 Icebreaker — answer in full sentences. Your words will be used against you.</p>
            <p class="prompt-sm">${esc(cur.ask?.[playerId] ?? cur.ice?.[0])}</p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="150" rows="4" placeholder="Go on, tell us everything…">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Send it 💼</button></form>`;
          break;
        }
        if (cur.type === "rap") {
          const o = cur.ask?.[playerId] ?? cur.openers?.[0];
          body = `${timer}<p class="muted center-text">🎤 Theme: <b>${esc(cur.prompt)}</b></p>
            <div class="rap-open"><span>${esc(o.line)}…</span></div>
            <p class="center-text">Finish the verse. Rhyme with <b class="rhyme">${esc(o.rhyme.toUpperCase())}</b></p>
            <form id="quip-form" class="quip-form"><textarea id="quip-text" maxlength="80" rows="2" placeholder="Your killer line…">${esc(draft)}</textarea>
            <button class="btn big" type="submit">Drop it 🎤</button></form>`;
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

      case "hol": {
        const timer = timerBar(st.deadline, st.span ?? 12);
        if (mySub(`m${cur.q.i}`)) body = timer + lockedIn("Locked in! ⬆️⬇️");
        else
          body = `${timer}<p class="muted center-text">Question ${cur.q.i + 1} of ${cur.qs.length}</p><p class="prompt-sm">${esc(cur.q.q)}</p>
            <p class="center-text">Higher or lower than <b>${esc(cur.q.than)}</b>?</p>
            <div class="choices two"><button class="choice cool" data-act="hol" data-val="higher">⬆️ Higher</button>
            <button class="choice hot" data-act="hol" data-val="lower">⬇️ Lower</button></div>`;
        break;
      }

      case "buddy": {
        const timer = timerBar(st.deadline, st.span ?? 30);
        const maker = live.players.find((p) => p.id === cur.maker);
        if (cur.maker !== playerId) body = timer + `<div class="locked pop"><div class="big-emoji">🤝</div><h2>${esc(maker?.name ?? "Someone")} is choosing a drinking buddy…</h2><p class="muted">Look innocent.</p></div>`;
        else if (mySub("buddy")) body = timer + lockedIn("Buddy chained! 🤝");
        else
          body = `${timer}<h2 class="center-text">🤝 You won the buddy round!</h2><p class="muted center-text">Pick a drinking buddy. Whenever you drink, they drink — all game.</p>
            <div class="choices">${live.players.filter((p) => p.id !== playerId).map((p) => `<button class="choice" data-act="buddy-pick" data-val="${p.id}" style="--c:${esc(p.color)}">${avatar(p)}${esc(p.name)}</button>`).join("")}</div>`;
        break;
      }

      case "hotq": {
        const timer = timerBar(st.deadline, st.span ?? 40);
        const kind = `m${cur.q.i}`;
        const victim = live.players.find((p) => p.id === cur.victim);
        if (cur.victim === playerId)
          body = `${timer}<p class="muted center-text">Question ${cur.q.i + 1} of ${cur.qs.length}</p><p class="prompt-sm">${esc(cur.q.text)}</p>
            <div class="locked"><div class="big-emoji">🗣️</div><h2>Answer out loud!</h2></div>
            ${mySub(kind) ? "" : `<button class="btn danger big" data-act="hot-refuse">🍺 Refuse — drink 3</button>`}`;
        else if (mySub(kind)) body = timer + lockedIn("Verdict in! ⚖️");
        else
          body = `${timer}<p class="prompt-sm">${esc(cur.q.text)}</p><p class="muted center-text">Is ${esc(victim?.name ?? "they")} telling the truth?</p>
            <div class="choices two"><button class="choice cool" data-act="hot-vote" data-val="truth">😇 Truth</button>
            <button class="choice hot" data-act="hot-vote" data-val="lie">🤥 Lie</button></div>`;
        break;
      }

      case "rule": {
        const timer = timerBar(st.deadline, st.span ?? 30);
        const maker = live.players.find((p) => p.id === cur.maker);
        if (cur.maker !== playerId) body = timer + `<div class="locked pop"><div class="big-emoji">📜</div><h2>${esc(maker?.name ?? "Someone")} is making a rule…</h2><p class="muted">Be afraid.</p></div>`;
        else if (mySub("rule")) body = timer + lockedIn("Rule made! 📜");
        else
          body = `${timer}<h2 class="center-text">📜 You're the Rule Maker!</h2><p class="muted center-text">Pick a house rule for the next 3 rounds:</p>
            <div class="choices">${cur.options.map((r, i) => `<button class="choice" data-act="rule-pick" data-val="${i}">${esc(r)}</button>`).join("")}</div>
            <form id="rule-form" class="quip-form"><input id="rule-text" class="slogan-input" maxlength="120" placeholder="…or write your own rule">
            <button class="btn" type="submit">Make it law ⚖️</button></form>`;
        break;
      }

      case "twist": {
        const timer = timerBar(st.deadline, st.span ?? 45);
        if (cur.type === "drawful") {
          if (cur.drawer === playerId) body = timer + `<div class="locked pop"><div class="big-emoji">🎨</div><h2>They're writing fake titles for your masterpiece…</h2></div>`;
          else if (mySub("twist")) body = timer + lockedIn("Fake title in! 🤥");
          else {
            const img = safeImg(live.subs.find((x) => x.kind === "input" && x.player_id === cur.drawer)?.value?.img);
            body = `${timer}${img ? `<div class="drawing sm"><img src="${img}" alt="The drawing"></div>` : ""}
              <p class="prompt-sm">What is it? Write a fake title to fool everyone.</p>
              <form id="quip-form" class="quip-form"><input id="quip-text" class="slogan-input" maxlength="60" placeholder="A convincing title…" autocomplete="off">
              <button class="btn big" type="submit">Submit 🤥</button></form>`;
          }
          break;
        }
        if (cur.type === "job") {
          const bank = cur.banks?.[playerId];
          const sc = fresh(room.round);
          if (mySub("twist")) body = timer + lockedIn("Application sent! 💼");
          else if (!bank) body = timer + lockedIn("Sit tight…");
          else {
            const text = sc.words.map((i) => bank[i].w).join(" ");
            body = `${timer}<p class="muted center-text">The panel asks:</p><p class="prompt-sm">${esc(cur.prompt)}</p>
              <div class="job-answer">${text ? `“${esc(text.charAt(0).toUpperCase() + text.slice(1))}”` : `<span class="muted">Tap words to build your answer…</span>`}</div>
              <div class="tiles">${bank.map((x, i) => `<button class="tile ${x.pid ? "" : "filler"}" data-act="job-word" data-val="${i}">${esc(x.w)}</button>`).join("")}</div>
              <div class="row"><button class="btn ghost sm" data-act="job-undo" ${sc.words.length ? "" : "disabled"}>↩ Undo</button>
              <button class="btn big" data-act="job-send" ${sc.words.length ? "" : "disabled"}>Submit answer 💼</button></div>`;
          }
          break;
        }
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
        const side = (e) => (cur.type === "tee" ? shirt(drawingOf(live.subs, e.img), e.text)
          : cur.type === "rap" ? `<span class="muted">${esc(e.opener?.line ?? "")}…</span><br>${esc(e.text)}` : esc(e.text));
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
        if (cur.type === "poll") {
          const pollster = live.players.find((p) => p.id === cur.pollster);
          if (cur.pollster === playerId) body = timer + `<div class="locked pop"><div class="big-emoji">📊</div><h2>You said ${cur.guess}%</h2><p class="muted">Everyone's deciding if you're too high or too low…</p></div>`;
          else if (mySub("vote")) body = timer + lockedIn("Called it! 📊");
          else
            body = `${timer}<p class="prompt-sm">${esc(cur.prompt)}</p><p class="center-text">${esc(pollster?.name ?? "The pollster")} says <b>${cur.guess}%</b>. The real answer is…</p>
              <div class="choices two"><button class="choice cool" data-act="poll-hl" data-val="higher">⬆️ Higher</button>
              <button class="choice hot" data-act="poll-hl" data-val="lower">⬇️ Lower</button></div>`;
          break;
        }
        if (cur.type === "imposter" || cur.type === "spiked") {
          const spiked = cur.type === "spiked";
          if (mySub("vote")) body = timer + lockedIn("Accusation made! 🕵️");
          else
            body = `${timer}<p class="prompt-sm">${spiked ? "Who's been spiked? 🧪" : "Who's the imposter? 🕵️"}</p><p class="muted center-text">${spiked ? "Check the answers on the TV." : "Check the clues on the TV."}</p>
              <div class="choices">${live.players.filter((p) => p.id !== playerId).map((p) => `<button class="choice" data-act="vote" data-val="${p.id}" style="--c:${esc(p.color)}">${avatar(p)}${esc(p.name)}</button>`).join("")}</div>`;
          break;
        }
        if (cur.type === "drawful") {
          const choices = (cur.options ?? []).filter((o) => !o.pids.includes(playerId));
          if (cur.drawer === playerId) body = timer + `<div class="locked pop"><div class="big-emoji">🎨</div><h2>They're guessing your masterpiece…</h2></div>`;
          else if (mySub("vote")) body = timer + lockedIn("Guess locked in! 🎨");
          else
            body = `${timer}<p class="prompt-sm">Which is the REAL title?</p>
              <div class="choices">${choices.map((o) => `<button class="choice answer-choice" data-act="vote" data-val="${esc(o.key)}">${esc(o.text)}</button>`).join("")}</div>`;
          break;
        }
        if (cur.type === "sti") {
          const choices = (cur.posts ?? []).filter((x) => x.pid !== playerId);
          if (mySub("vote")) body = timer + lockedIn("Vote cast! 🗳️");
          else if (!choices.length) body = timer + lockedIn("Sit tight — nothing for you to vote on.");
          else
            body = `${timer}<p class="muted center-text">Vote for the best twist:</p>
              <div class="choices">${choices.map((x) => {
                const p = live.players.find((q) => q.id === x.from);
                return `<button class="choice net-card phone" data-act="vote" data-val="${x.pid}" style="--c:${esc(p?.color ?? "#888")}">
                  <div class="net-head">${avatar(p, "sm")}<div><div class="net-name">${esc(p?.name ?? "Someone")}</div><div class="net-answer">${esc(x.answer)}</div></div></div>
                  <div class="net-ctx">↳ posted as ${esc(x.context)}</div><div class="net-twist">${esc(x.text)}</div></button>`;
              }).join("")}</div>`;
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
      <header class="phone-head" style="--c:${esc(self.color)}"><button class="link avatar-btn" data-act="photo" aria-label="Change photo">${avatar(self, "sm")}</button><b>${esc(self.name)}</b>
        <span class="muted">· ${code}</span><span class="spacer"></span><span class="mini">${st.settings?.mode === "cards" ? `🃏 ${st.won?.[playerId]?.length ?? 0}/${st.settings.target ?? 7}` : `${self.score} pts`} · 🍺${self.sips}</span>
        <button class="link speaker-btn ${speakerOn ? "on" : ""}" data-act="speaker" aria-label="Be the speaker">${speakerOn ? "🔊" : "🔈"}</button>
        <button class="link" data-act="leave">✕</button></header>
      ${rulesBar(st)}
      <main>${body}</main></div>
      <input type="file" id="photo-input" accept="image/*" capture="user" hidden>`;
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
