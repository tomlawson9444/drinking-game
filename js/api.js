import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } },
});

export function newToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?exception:\s*/i, ""));
  return data;
}

export const api = {
  createRoom: (hostToken) => rpc("dg_create_room", { p_host_token: hostToken }),
  joinRoom: (code, name, token) => rpc("dg_join_room", { p_code: code, p_name: name, p_token: token }),
  submit: (code, token, round, kind, value) =>
    rpc("dg_submit", { p_code: code, p_token: token, p_round: round, p_kind: kind, p_value: value }),
  setState: (code, hostToken, phase, round, state) =>
    rpc("dg_host_set_state", { p_code: code, p_host_token: hostToken, p_phase: phase, p_round: round, p_state: state }),
  apply: (code, hostToken, deltas) => rpc("dg_host_apply", { p_code: code, p_host_token: hostToken, p_deltas: deltas }),
  reset: (code, hostToken) => rpc("dg_host_reset", { p_code: code, p_host_token: hostToken }),
  closeRoom: (code, hostToken) => rpc("dg_close_room", { p_code: code, p_host_token: hostToken }),
  setPhoto: (code, token, photo) => rpc("dg_set_photo", { p_code: code, p_token: token, p_photo: photo }),
  kick: (code, hostToken, playerId) => rpc("dg_host_kick", { p_code: code, p_host_token: hostToken, p_player: playerId }),

  async room(code) {
    const { data, error } = await sb.from("dg_rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    return data;
  },
  async players(code) {
    // Photos are fetched separately (and cached) so the frequent refreshes stay small.
    const { data, error } = await sb
      .from("dg_players")
      .select("id,room_code,name,color,score,sips,joined_at,photo_v")
      .eq("room_code", code)
      .order("joined_at");
    if (error) throw error;
    return data;
  },
  async submissions(code, round) {
    const { data, error } = await sb.from("dg_submissions").select("*").eq("room_code", code).eq("round", round);
    if (error) throw error;
    return data;
  },
};

// Keeps a live copy of room, players and current-round submissions.
// Realtime pushes changes; a slow poll covers dropped sockets / sleeping phones.
// onSay: called with lines the host broadcasts for phones acting as the Landlord's speaker.
// onSnitch: called on the host when a phone reports a rule-breaker.
const photoCache = new Map(); // player id -> { v, photo }

async function withPhotos(players) {
  const stale = players.filter((p) => p.photo_v && photoCache.get(p.id)?.v !== p.photo_v).map((p) => p.id);
  if (stale.length) {
    const { data } = await sb.from("dg_players").select("id,photo,photo_v").in("id", stale);
    for (const r of data ?? []) photoCache.set(r.id, { v: r.photo_v, photo: r.photo });
  }
  return players.map((p) => ({ ...p, photo: p.photo_v ? photoCache.get(p.id)?.photo ?? null : null }));
}

export function watchRoom(code, onChange, { onSay, onSnitch } = {}) {
  const live = { room: null, players: [], subs: [] };
  let stopped = false;
  let seq = 0;
  let latest = Promise.resolve();

  function refresh() {
    latest = load(++seq);
    return latest;
  }

  async function load(mine) {
    if (stopped) return;
    try {
      const [room, players] = await Promise.all([api.room(code), api.players(code).then(withPhotos)]);
      const subs = room ? await api.submissions(code, room.round) : [];
      // A newer refresh started: drop this stale result, but let callers wait for the fresh one.
      if (mine !== seq) return latest;
      live.room = room;
      live.players = players;
      live.subs = subs;
      onChange(live);
    } catch (e) {
      console.warn("refresh failed", e);
    }
  }

  let pending = null;
  const soon = () => {
    clearTimeout(pending);
    pending = setTimeout(refresh, 80);
  };

  const channel = sb
    .channel(`room-${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "dg_rooms", filter: `code=eq.${code}` }, soon)
    .on("postgres_changes", { event: "*", schema: "public", table: "dg_players", filter: `room_code=eq.${code}` }, soon)
    .on("postgres_changes", { event: "*", schema: "public", table: "dg_submissions", filter: `room_code=eq.${code}` }, soon)
    .on("broadcast", { event: "say" }, (msg) => onSay?.(msg?.payload))
    .on("broadcast", { event: "snitch" }, (msg) => onSnitch?.(msg?.payload))
    .subscribe();

  const poll = setInterval(refresh, 4000);
  const onVis = () => document.visibilityState === "visible" && refresh();
  document.addEventListener("visibilitychange", onVis);
  refresh();

  return {
    live,
    refresh,
    // Broadcast a Landlord line to the room's phones (no database write).
    say(payload) {
      channel.send({ type: "broadcast", event: "say", payload }).catch(() => {});
    },
    // A phone reporting a rule-breaker to the host screen.
    snitch(payload) {
      channel.send({ type: "broadcast", event: "snitch", payload }).catch(() => {});
    },
    stop() {
      stopped = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      sb.removeChannel(channel);
    },
  };
}

export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};
