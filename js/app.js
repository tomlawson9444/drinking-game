import { api, newToken, store } from "./api.js";
import { SUPABASE_URL } from "./config.js";
import { startHost } from "./host.js";
import { startPlayer } from "./player.js";
import { $, esc, toast } from "./ui.js";

const app = $("#app");
const params = new URLSearchParams(location.search);

function home() {
  history.replaceState(null, "", location.pathname + (params.get("room") ? `?room=${params.get("room")}` : ""));
  const saved = store.get("dg-player");
  const lastName = store.get("dg-name") ?? "";
  const code = (params.get("room") ?? saved?.code ?? "").toUpperCase();
  app.innerHTML = `<div class="home">
    <div class="logo huge wobble">Last Orders</div>
    <p class="tag">A party drinking game for you and your mates.<br>One big screen, everyone plays on their phone.</p>
    <form id="join" class="card">
      <label>Room code<input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(code)}" placeholder="ABCD" required></label>
      <label>Your name<input id="name" maxlength="16" autocomplete="nickname" value="${esc(lastName)}" placeholder="Name" required></label>
      <button class="btn big" type="submit">Join game 🍺</button>
    </form>
    <div class="or-line"><span>or</span></div>
    <a class="btn ghost" href="?host">📺 Host on this screen</a>
    <p class="muted small">Host on a TV or laptop everyone can see. Please drink responsibly — a "sip" can be any drink you like.</p>
  </div>`;

  $("#join").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#code").value.trim().toUpperCase();
    const name = $("#name").value.trim();
    const btn = e.submitter ?? $("#join button");
    btn.disabled = true;
    try {
      const prev = store.get("dg-player");
      const token = prev?.code === code ? prev.token : newToken();
      const playerId = await api.joinRoom(code, name, token);
      const me = { code, token, playerId };
      store.set("dg-player", me);
      store.set("dg-name", name);
      play(me);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
}

function play(me) {
  history.replaceState(null, "", `?room=${me.code}`);
  params.delete("room");
  // Full reload on leave so no listeners from the old game linger.
  startPlayer(app, me, () => location.replace(location.pathname));
}

async function boot() {
  if (SUPABASE_URL.includes("YOUR-PROJECT")) {
    app.innerHTML = `<div class="home"><div class="logo">Last Orders</div><p>Set your Supabase URL and key in <code>js/config.js</code>.</p></div>`;
    return;
  }
  try {
    if (params.has("host")) {
      const want = params.get("host");
      const saved = store.get("dg-host");
      if (want && saved && saved.code !== want) toast("That room belongs to another screen — starting a new one.");
      await startHost(app);
      return;
    }
    const saved = store.get("dg-player");
    const code = params.get("room")?.toUpperCase();
    if (saved && (!code || code === saved.code)) {
      // Rejoin automatically after a refresh / phone lock.
      const room = await api.room(saved.code).catch(() => null);
      if (room) return play(saved);
      store.del("dg-player");
    }
    home();
  } catch (err) {
    app.innerHTML = `<div class="home"><div class="logo">Last Orders</div><p>Something went wrong: ${esc(err.message)}</p><a class="btn" href="./">Try again</a></div>`;
  }
}

boot();
