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
  return `<span class="avatar ${size}" style="--c:${esc(p.color)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>`;
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
