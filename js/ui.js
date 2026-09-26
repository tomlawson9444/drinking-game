export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function avatar(p, size = "") {
  if (!p) return "";
  const photo = safeImg(p.photo);
  return photo
    ? `<span class="avatar photo ${size}" style="--c:${esc(p.color)}"><img src="${photo}" alt=""></span>`
    : `<span class="avatar ${size}" style="--c:${esc(p.color)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
}

export function chip(p, extra = "") {
  if (!p) return "";
  return `<span class="chip ${extra}" style="--c:${esc(p.color)}">${avatar(p, "sm")}${esc(p.name)}</span>`;
}

export function sipsText(n) {
  return `${n} sip${n === 1 ? "" : "s"}`;
}

// Timer bar that animates itself from a deadline (ms epoch).
export function timerBar(deadline, total) {
  if (!deadline) return "";
  const left = Math.max(0, deadline - Date.now());
  const pct = Math.min(100, (left / (total * 1000)) * 100);
  return `<div class="timer"><div class="timer-fill" style="width:${pct}%;animation-duration:${left}ms"></div>
          <span class="timer-num" data-deadline="${deadline}">${Math.ceil(left / 1000)}</span></div>`;
}

export function tickTimers() {
  document.querySelectorAll(".timer-num[data-deadline]").forEach((el) => {
    el.textContent = Math.max(0, Math.ceil((+el.dataset.deadline - Date.now()) / 1000));
  });
}
setInterval(tickTimers, 250);

// Only ever render drawings / photos that are plain image data URLs.
export const safeImg = (src) => (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src ?? "") ? src : "");

// Tee K.O. shirt: a drawing on a T-shirt with a slogan underneath.
export function shirt(src, slogan, extra = "") {
  const img = safeImg(src);
  return `<div class="shirt ${extra}"><svg class="tee" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M30 8 L42 4 Q50 12 58 4 L70 8 L94 24 L84 40 L74 34 L74 96 L26 96 L26 34 L16 40 L6 24 Z"/></svg>
    <div class="tee-print">${img ? `<img src="${img}" alt="">` : ""}<div class="tee-slogan">${esc(slogan)}</div></div></div>`;
}

// The drawing for a pid from this round's input submissions.
export const drawingOf = (subs, pid) => subs.find((s) => s.kind === "input" && s.player_id === pid)?.value?.img;

// A playing card (Kings Cup). No card = face down.
export function playingCard(card, extra = "") {
  if (!card) return `<div class="pcard back ${extra}"><span>🍺</span></div>`;
  const red = card.suit === "♥" || card.suit === "♦" ? "red" : "";
  const face = `${esc(card.rank)}${esc(card.suit)}`;
  return `<div class="pcard ${red} ${extra}"><span class="pc-corner">${face}</span><span class="pc-mid">${card.rank === "K" ? "👑" : esc(card.suit)}</span>
    <span class="pc-corner br">${face}</span></div>`;
}

// Fastest Finger: light up the pad once this screen's own random wait is over. `seen` remembers
// when each test first appeared here, so re-renders don't restart the wait.
export function armFast(seen, key) {
  const el = document.querySelector(".fast-pad");
  if (!el) return;
  seen[key] ??= performance.now();
  const left = +el.dataset.delay - (performance.now() - seen[key]);
  const go = () => document.querySelector(`.fast-pad[data-key="${key}"]`)?.classList.add("go");
  if (left <= 0) go();
  else setTimeout(go, left);
}
