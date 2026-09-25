// Pure game rules: building the round plan and scoring a round.
// No DOM or network here so it can be tested with plain Node.
import { LIKELY, NHIE, WYR, QUIPS, SOCIAL, shuffle } from "./prompts.js";

const DECKS = { likely: LIKELY, nhie: NHIE, wyr: WYR, quip: QUIPS, social: SOCIAL };
const WEIGHTS = { quip: 3, likely: 3, wyr: 2, nhie: 2, social: 1 };

export function buildPlan(rounds, types) {
  const decks = Object.fromEntries(Object.entries(DECKS).map(([k, v]) => [k, shuffle(v)]));
  const bag = types.flatMap((t) => Array(WEIGHTS[t]).fill(t));
  const plan = [];
  let last = null;
  for (let i = 0; i < rounds; i++) {
    let options = bag.filter((t) => t !== last);
    if (!options.length) options = bag;
    const type = options[Math.floor(Math.random() * options.length)];
    if (!decks[type].length) decks[type] = shuffle(DECKS[type]);
    plan.push({ type, prompt: decks[type].pop() });
    last = type;
  }
  return plan;
}

// Which submission kind the current phase is waiting for, and from whom.
export function expected(phase, type, players, subs, answers) {
  if (phase === "input") return { kind: "input", ids: players.map((p) => p.id) };
  if (phase === "vote" && type === "quip") {
    // Everyone votes, except someone whose own answer is the only one they could pick.
    const ids = players.filter((p) => answers.some((a) => a.pid !== p.id)).map((p) => p.id);
    return { kind: "vote", ids };
  }
  return { kind: null, ids: [] };
}

export function allIn(phase, type, players, subs, answers) {
  const { kind, ids } = expected(phase, type, players, subs, answers);
  if (!kind || !ids.length) return false;
  const done = new Set(subs.filter((s) => s.kind === kind).map((s) => s.player_id));
  return ids.every((id) => done.has(id));
}

// Build the quip vote ballot from input submissions.
export function quipAnswers(subs) {
  return shuffle(
    subs
      .filter((s) => s.kind === "input" && String(s.value?.text ?? "").trim())
      .map((s) => ({ pid: s.player_id, text: String(s.value.text).trim().slice(0, 80) })),
  );
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
      const votes = subs.filter((s) => s.kind === "vote" && ids.includes(s.player_id));
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
    default:
      break;
  }
  return { deltas, view };
}
