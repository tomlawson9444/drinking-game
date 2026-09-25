// "The Landlord" — the game-master voice. Speaks with the browser's built-in speech
// synthesis (free, no API keys) and shows captions. Many TV browsers have no voices, so the
// host also hands every line to onSpeak, which broadcasts it to phones acting as speakers.
import { LINES } from "./prompts.js";

export function createGM({ settings, onCaption, onSpeak }) {
  const synth = window.speechSynthesis;
  let voice = null;
  let speaking = 0;
  const recent = []; // don't repeat a line too soon

  // Whether this browser can actually talk (TV browsers often ship with no voices).
  const canSpeak = () => Boolean(synth && synth.getVoices().length);

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
    if (!settings.voice) return Promise.resolve();
    onSpeak?.(text);
    if (settings.tvVoice === false || !canSpeak()) {
      // A phone is doing the talking: hold the game for roughly as long as the line takes.
      speaking++;
      return new Promise((resolve) => setTimeout(() => (speaking--, resolve()), 1500 + text.length * 65));
    }
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

  // Pick a line for this moment and fill in {name}-style blanks. Lines whose blanks
  // can't be filled (e.g. {name} when nobody is drinking) are skipped.
  function pick(key, vars) {
    const options = (LINES[key] ?? []).filter(
      (l) => !recent.includes(l) && [...l.matchAll(/\{(\w+)\}/g)].every(([, v]) => vars[v]),
    );
    if (!options.length) return null;
    const line = options[Math.floor(Math.random() * options.length)];
    recent.push(line);
    if (recent.length > 12) recent.shift();
    return line.replace(/\{(\w+)\}/g, (_, v) => vars[v]);
  }

  return {
    say,
    canSpeak,
    busy: () => speaking > 0,
    stop: () => synth?.cancel(),
    // Say a line for this moment. Returns null when no line fits, so callers can fall back.
    line(key, vars = {}) {
      const text = pick(key, vars);
      return text ? say(text) : null;
    },
  };
}
