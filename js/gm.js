// "The Landlord" — the game-master voice. Speaks through the host screen with the
// browser's built-in speech synthesis, and gets its material from Claude via the
// `game-master` Supabase Edge Function (the Anthropic key never reaches the browser).
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { CANNED } from "./prompts.js";

const FN_URL = `${SUPABASE_URL}/functions/v1/game-master`;

export function createGM({ code, hostToken, settings, onCaption, onNotice }) {
  const synth = window.speechSynthesis;
  let voice = null;
  let speaking = 0;
  let fetching = 0;
  let aiDead = false;
  const history = []; // recent lines, so it doesn't repeat itself

  function pickVoice() {
    const voices = synth?.getVoices() ?? [];
    const prefs = [/Google UK English Male/i, /Daniel/i, /Arthur/i, /Ryan.*Online/i, /en-GB.*male/i, /en-GB/i, /^en/i];
    for (const re of prefs) {
      const v = voices.find((x) => re.test(`${x.name} ${x.lang}`));
      if (v) return v;
    }
    return voices[0] ?? null;
  }
  if (synth) {
    voice = pickVoice();
    synth.addEventListener?.("voiceschanged", () => (voice = pickVoice()));
  }

  function say(text, { caption = true } = {}) {
    if (!text) return Promise.resolve();
    if (caption) onCaption(text);
    if (!settings.voice || !synth) return new Promise((r) => setTimeout(r, Math.min(9000, 1500 + text.length * 45)));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.replace(/___/g, "blank"));
      if (voice) u.voice = voice;
      u.rate = 1.02;
      u.pitch = 0.85;
      speaking++;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speaking--;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // Some browsers never fire onend; don't let that stall the game.
      setTimeout(finish, 4000 + text.length * 90);
      synth.speak(u);
    });
  }

  async function ask(kind, facts) {
    if (!settings.ai || aiDead) return null;
    fetching++;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), kind === "prompts" ? 60000 : 20000);
      const res = await fetch(FN_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ code, hostToken, kind, facts, history: history.slice(-8), filthy: settings.filthy }),
      });
      clearTimeout(timer);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === "not_configured" || res.status === 404) {
          aiDead = true;
          onNotice("AI host isn't set up yet (add the ANTHROPIC_API_KEY secret) — using the backup Landlord.");
        } else if (body.error === "limit") {
          aiDead = true;
          onNotice("The Landlord has had enough for one night (AI call limit reached for this room).");
        }
        return null;
      }
      return body;
    } catch (e) {
      console.warn("game master failed", e);
      return null;
    } finally {
      fetching--;
    }
  }

  const canned = (k) => CANNED[k][Math.floor(Math.random() * CANNED[k].length)];

  return {
    say,
    busy: () => speaking > 0 || fetching > 0,
    stop: () => synth?.cancel(),
    // Commentary for game events. facts: plain-English description of what happened.
    async line(kind, facts) {
      const body = await ask(kind, facts);
      const text = body?.line || (CANNED[kind] ? canned(kind) : null);
      if (!text) return;
      history.push(text);
      await say(text);
    },
    // AI-written, personalised prompt decks for this group. Null if unavailable.
    async prompts(names) {
      const body = await ask("prompts", `Players: ${names.join(", ")}`);
      return body?.prompts ?? null;
    },
  };
}
