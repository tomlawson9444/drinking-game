// Pure game rules: building the round plan and scoring a round.
// No DOM or network here so it can be tested with plain Node.
import { MILD, FILTHY, FIBS, shuffle } from "./prompts.js";

const WEIGHTS = { quip: 3, likely: 3, fib: 2, wyr: 2, nhie: 2, social: 1 };

// opts: { filthy, names: [player names], ai: {quip, likely, nhie, wyr} (optional AI-written prompts) }
export function buildPlan(rounds, types, opts = {}) {
  const base = opts.filthy ? FILTHY : MILD;
  const source = (t) => {
    if (t === "fib") return FIBS;
    const ai = opts.ai?.[t] ?? [];
    return ai.length ? [...ai, ...base[t]] : base[t];
  };
  const decks = {};
  const draw = (t) => {
    // AI prompts go first (they're personalised), the rest shuffled behind them.
    if (!decks[t]?.length) {
      const ai = (opts.ai?.[t] ?? []).slice();
      decks[t] = [...shuffle(source(t).slice(ai.length)), ...shuffle(ai)];
    }
    return decks[t].pop();
  };
  const names = opts.names?.length ? opts.names : ["someone"];
  const fill = (s) => s.replace(/\{player\}/g, () => names[Math.floor(Math.random() * names.length)]);

  const bag = types.flatMap((t) => Array(WEIGHTS[t] ?? 1).fill(t));
  const plan = [];
  let last = null;
  for (let i = 0; i < rounds; i++) {
    let options = bag.filter((t) => t !== last);
    if (!options.length) options = bag;
    const type = options[Math.floor(Math.random() * options.length)];
    const p = draw(type);
    if (type === "fib") plan.push({ type, prompt: p.q, truth: p.a });
    else if (type === "wyr") plan.push({ type, prompt: p.map(fill) });
    else plan.push({ type, prompt: fill(p) });
    last = type;
  }
  return plan;
}

export const norm = (s) => String(s ?? "").toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "");

// Who we're waiting on in the current phase.
export function expected(phase, round, players) {
  if (phase === "input") return { kind: "input", ids: players.map((p) => p.id) };
  if (phase === "vote" && round.type === "quip") {
    // Everyone votes, except someone whose own answer is the only one they could pick.
    const answers = round.answers ?? [];
    return { kind: "vote", ids: players.filter((p) => answers.some((a) => a.pid !== p.id)).map((p) => p.id) };
  }
  if (phase === "vote" && round.type === "fib") return { kind: "vote", ids: players.map((p) => p.id) };
  return { kind: null, ids: [] };
}

export function allIn(phase, round, players, subs) {
  const { kind, ids } = expected(phase, round, players);
  if (!kind || !ids.length) return false;
  const done = new Set(subs.filter((s) => s.kind === kind).map((s) => s.player_id));
  return ids.every((id) => done.has(id));
}

// Build the quip ballot from input submissions.
export function quipAnswers(subs) {
  return shuffle(
    subs
      .filter((s) => s.kind === "input" && String(s.value?.text ?? "").trim())
      .map((s) => ({ pid: s.player_id, text: String(s.value.text).trim().slice(0, 80) })),
  );
}

// Lie Detector ballot: the truth plus every distinct lie (identical lies are merged).
export function fibOptions(subs, truth) {
  const byText = new Map();
  for (const s of subs) {
    const text = String(s.value?.text ?? "").trim().slice(0, 60);
    const key = norm(text);
    if (s.kind !== "input" || !key || key === norm(truth)) continue;
    if (!byText.has(key)) byText.set(key, { text, pids: [], truth: false });
    byText.get(key).pids.push(s.player_id);
  }
  // Keys come from the text, not the shuffle order, so a ballot rebuilt from the same answers
  // still matches votes already cast.
  const lies = [...byText.entries()].map(([key, o]) => ({ ...o, key: `lie:${key}` }));
  return shuffle([...lies, { text: truth, pids: [], truth: true, key: "truth" }]);
}

// Returns { deltas: {pid: {score, sips, why[]}}, view: {...type specific display data} }
export function scoreRound(round, players, subs) {
  const ids = players.map((p) => p.id);
  const deltas = {};
  const add = (pid, score, sips, why) => {
    if (!ids.includes(pid)) return;
    const d = (deltas[pid] ??= { score: 0, sips: 0, why: [] });
    d.score += score;
    d.sips += sips;
    if (why) d.why.push(why);
  };
  const inputs = subs.filter((s) => s.kind === "input" && ids.includes(s.player_id));
  const votes = subs.filter((s) => s.kind === "vote" && ids.includes(s.player_id));
  const byPlayer = Object.fromEntries(inputs.map((s) => [s.player_id, s.value]));
  const slowpokes = ids.filter((id) => !(id in byPlayer));
  const view = { slowpokes };

  switch (round.type) {
    case "likely": {
      const tally = {};
      for (const [pid, v] of Object.entries(byPlayer)) {
        if (ids.includes(v?.target)) (tally[v.target] ??= []).push(pid);
      }
      const max = Math.max(0, ...Object.values(tally).map((v) => v.length));
      const losers = Object.keys(tally).filter((t) => tally[t].length === max && max > 0);
      losers.forEach((t) => add(t, 0, 2, "Most likely!"));
      for (const t of losers) tally[t].forEach((voter) => add(voter, 100, 0, "Voted with the crowd"));
      slowpokes.forEach((id) => add(id, 0, 1, "Too slow"));
      view.tally = Object.entries(tally)
        .map(([pid, voters]) => ({ pid, voters }))
        .sort((a, b) => b.voters.length - a.voters.length);
      view.losers = losers;
      break;
    }
    case "nhie": {
      const have = Object.keys(byPlayer).filter((pid) => byPlayer[pid]?.have);
      have.forEach((pid) => add(pid, 50, 1, "Guilty!"));
      slowpokes.forEach((id) => add(id, 0, 1, "Too slow"));
      view.have = have;
      view.never = Object.keys(byPlayer).filter((pid) => !byPlayer[pid]?.have);
      break;
    }
    case "wyr": {
      const sides = [[], []];
      for (const [pid, v] of Object.entries(byPlayer)) if (v?.choice === 0 || v?.choice === 1) sides[v.choice].push(pid);
      const [a, b] = sides;
      if (a.length && a.length === b.length) {
        [...a, ...b].forEach((pid) => add(pid, 0, 1, "Split decision"));
        view.tie = true;
      } else if (a.length && b.length) {
        const [minor, major] = a.length < b.length ? [a, b] : [b, a];
        minor.forEach((pid) => add(pid, 0, 1, "In the minority"));
        major.forEach((pid) => add(pid, 100, 0, "With the majority"));
      } else {
        [...a, ...b].forEach((pid) => add(pid, 100, 0, "Unanimous!"));
      }
      slowpokes.forEach((id) => add(id, 0, 1, "Too slow"));
      view.sides = sides;
      break;
    }
    case "quip": {
      const answers = round.answers ?? [];
      const got = Object.fromEntries(answers.map((a) => [a.pid, []]));
      for (const v of votes) {
        const target = v.value?.target;
        if (target in got && target !== v.player_id) got[target].push(v.player_id);
      }
      const top = Math.max(0, ...Object.values(got).map((v) => v.length));
      for (const a of answers) {
        const n = got[a.pid].length;
        if (n) add(a.pid, 100 * n, 0, `${n} vote${n === 1 ? "" : "s"}`);
        else if (answers.length > 1) add(a.pid, 0, 2, "Zero votes");
      }
      const answered = new Set(answers.map((a) => a.pid));
      ids.filter((id) => !answered.has(id)).forEach((id) => add(id, 0, 2, "No answer"));
      const voted = new Set(votes.map((v) => v.player_id));
      ids.filter((id) => answered.size > 1 && !voted.has(id)).forEach((id) => add(id, 0, 1, "Didn't vote"));
      view.results = answers
        .map((a) => ({ ...a, voters: got[a.pid], winner: top > 0 && got[a.pid].length === top }))
        .sort((x, y) => y.voters.length - x.voters.length);
      view.slowpokes = ids.filter((id) => !answered.has(id));
      break;
    }
    case "fib": {
      const options = round.options ?? [];
      const byKey = Object.fromEntries(options.map((o) => [o.key, { ...o, pickers: [] }]));
      for (const v of votes) {
        const o = byKey[v.value?.target];
        if (!o || o.pids.includes(v.player_id)) continue; // can't pick your own lie
        o.pickers.push(v.player_id);
        if (o.truth) add(v.player_id, 200, 0, "Found the truth");
        else {
          add(v.player_id, 0, 1, "Fooled!");
          o.pids.forEach((liar) => add(liar, 100, 0, "Fooled someone"));
        }
      }
      const lied = new Set(options.flatMap((o) => o.pids));
      ids.filter((id) => !lied.has(id)).forEach((id) => add(id, 0, 1, "No lie"));
      const voted = new Set(votes.map((v) => v.player_id));
      ids.filter((id) => !voted.has(id)).forEach((id) => add(id, 0, 1, "Didn't vote"));
      view.options = Object.values(byKey).sort((a, b) => Number(b.truth) - Number(a.truth) || b.pickers.length - a.pickers.length);
      break;
    }
    default:
      break;
  }
  return { deltas, view };
}

// Plain-English summary of a round for the AI host to riff on.
export function describeRound(round, players, deltas) {
  const name = (id) => players.find((p) => p.id === id)?.name ?? "someone";
  const names = (ids) => (ids?.length ? ids.map(name).join(", ") : "nobody");
  const v = round.view ?? {};
  const lines = [];
  switch (round.type) {
    case "likely":
      lines.push(`Most Likely To: "${round.prompt}"`);
      (v.tally ?? []).forEach((t) => lines.push(`${name(t.pid)} got ${t.voters.length} vote(s) from ${names(t.voters)}`));
      break;
    case "nhie":
      lines.push(`Never Have I Ever: "${round.prompt}"`, `Admitted they HAVE: ${names(v.have)}`, `Claimed they never have: ${names(v.never)}`);
      break;
    case "wyr":
      lines.push(`Would You Rather: "${round.prompt[0]}" (${names(v.sides?.[0])}) OR "${round.prompt[1]}" (${names(v.sides?.[1])})`);
      break;
    case "quip":
      lines.push(`Fill-in-the-blank: "${round.prompt}"`);
      (v.results ?? []).forEach((a) => lines.push(`${name(a.pid)} wrote "${a.text}" and got ${a.voters.length} vote(s)`));
      break;
    case "fib":
      lines.push(`Lie Detector: "${round.prompt}" The true answer was "${round.truth}".`);
      (v.options ?? []).filter((o) => !o.truth).forEach((o) => lines.push(`${names(o.pids)} lied "${o.text}" and fooled ${names(o.pickers)}`));
      lines.push(`Found the truth: ${names((v.options ?? []).find((o) => o.truth)?.pickers)}`);
      break;
  }
  if (v.slowpokes?.length) lines.push(`Too slow to answer: ${names(v.slowpokes)}`);
  const drinkers = Object.entries(deltas ?? {}).filter(([, d]) => d.sips > 0);
  lines.push(`Drinking now: ${drinkers.length ? drinkers.map(([id, d]) => `${name(id)} (${d.sips} sips)`).join(", ") : "nobody"}`);
  return lines.join("\n");
}

export function describeStandings(players) {
  return [...players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => `${i + 1}. ${p.name}: ${p.score} pts, ${p.sips} sips drunk`)
    .join("\n");
}
