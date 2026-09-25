// Pure game rules: building the round plan and scoring a round.
// No DOM or network here so it can be tested with plain Node.
import { MILD, FILTHY, FIBS, YEARS, TRIVIA, ROLE_SETS, TEE_IDEAS, STI_QUESTIONS, STI_CONTEXTS, shuffle } from "./prompts.js";
import { HAND_SIZE } from "./cards.js";

const WEIGHTS = { quip: 3, likely: 3, fib: 2, wyr: 2, nhie: 2, year: 2, trivia: 2, roles: 2, brawl: 1, tee: 1, sti: 2, social: 1 };

// A stable key for a prompt, used to remember what a group has already played.
export const promptKey = (p) => (typeof p === "string" ? p : Array.isArray(p) ? p.join(" / ") : p.q ?? p.title ?? p.text ?? JSON.stringify(p));

// opts: { filthy, names: [player names], seen: Set of promptKeys already played on this screen,
//         cards: the Cards Against Sobriety deck { white, black } }
export function buildPlan(rounds, types, opts = {}) {
  const seen = opts.seen ?? new Set();
  // Deck order (last = drawn first): unseen prompts before seen ones, and in filthy mode the
  // filthy pack before the mild one. Each tier is shuffled.
  const tiers = (t) => {
    const packs = { fib: [FIBS], year: [YEARS], trivia: [TRIVIA], roles: [ROLE_SETS.filter((r) => opts.filthy || !r.filthy)],
      cards: [opts.cards?.black ?? []] }[t] ??
      (opts.filthy ? [FILTHY[t], MILD[t]] : [MILD[t]]);
    const fresh = packs.map((pack) => pack.filter((p) => !seen.has(promptKey(p))));
    const stale = packs.map((pack) => pack.filter((p) => seen.has(promptKey(p))));
    return [...fresh, ...stale].reverse().flatMap((tier) => shuffle(tier));
  };
  const decks = {};
  const draw = (t) => {
    if (!decks[t]?.length) decks[t] = tiers(t);
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
    // Pub Brawl answers quip prompts, so it shares the quip deck.
    const p = type === "tee" || type === "sti" ? null : draw(type === "brawl" ? "quip" : type);
    const key = p ? promptKey(p) : null;
    if (type === "fib") plan.push({ type, prompt: p.q, truth: p.a });
    else if (type === "year") plan.push({ type, prompt: p.q, year: p.year });
    else if (type === "trivia") plan.push({ type, prompt: p.q, answer: p.options[0], options: shuffle(p.options) });
    else if (type === "roles") {
      // One role per player (up to the size of the set), always including the drinking role.
      const n = Math.max(2, Math.min(names.length, p.roles.length));
      const others = shuffle(p.roles.filter((r) => r !== p.drink)).slice(0, n - 1);
      plan.push({ type, prompt: p.title, roles: shuffle([p.drink, ...others]), drink: p.drink });
    } else if (type === "tee") plan.push({ type, prompt: "Design a T-shirt", ideas: shuffle(TEE_IDEAS) });
    else if (type === "sti") plan.push({ type, prompt: "Out of Context", questions: shuffle(STI_QUESTIONS), contexts: shuffle(STI_CONTEXTS) });
    else if (type === "cards") plan.push({ type, prompt: p.text, pick: p.pick ?? blanks(p.text) });
    else if (type === "wyr") plan.push({ type, prompt: p.map(fill) });
    else plan.push({ type, prompt: fill(p) });
    if (key) plan[plan.length - 1].key = key;
    last = type;
  }
  return plan;
}

export const norm = (s) => String(s ?? "").toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "");

// Who we're waiting on in the current phase.
export function expected(phase, round, players) {
  // Cards Against Sobriety: everyone but the Czar plays; only the Czar judges.
  if (phase === "input" && round.type === "cards") return { kind: "input", ids: players.filter((p) => p.id !== round.czar).map((p) => p.id) };
  if (phase === "vote" && round.type === "cards") return { kind: "vote", ids: players.filter((p) => p.id === round.czar).map((p) => p.id) };
  if (phase === "input") return { kind: "input", ids: players.map((p) => p.id) };
  if (phase === "vote" && round.type === "quip") {
    // Everyone votes, except someone whose own answer is the only one they could pick.
    const answers = round.answers ?? [];
    return { kind: "vote", ids: players.filter((p) => answers.some((a) => a.pid !== p.id)).map((p) => p.id) };
  }
  if (phase === "vote" && round.type === "fib") return { kind: "vote", ids: players.map((p) => p.id) };
  // Pub Quiz of Doom: only the wrong-answerers are in the Drinking Chamber.
  if (phase === "vote" && round.type === "trivia") return { kind: "vote", ids: players.filter((p) => round.chamber?.includes(p.id)).map((p) => p.id) };
  // Tee K.O.: everyone who was offered parts makes a shirt.
  if (phase === "vote" && round.type === "tee") return { kind: "vote", ids: players.filter((p) => round.offers?.[p.id]).map((p) => p.id) };
  // Out of Context: everyone given someone's answer twists it, then everyone votes on the twists.
  if (phase === "twist") return { kind: "twist", ids: players.filter((p) => round.twists?.[p.id]).map((p) => p.id) };
  if (phase === "vote" && round.type === "sti") {
    const posts = round.posts ?? [];
    return { kind: "vote", ids: players.filter((p) => posts.some((x) => x.pid !== p.id)).map((p) => p.id) };
  }
  // Knockout matches: everyone votes except the two entries' owners.
  if (phase === "match" && round.match) {
    const owners = [round.match.a.pid, round.match.b.pid];
    return { kind: `m${round.match.m}`, ids: players.filter((p) => !owners.includes(p.id)).map((p) => p.id) };
  }
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

// ------------------------------------------------------------------ knockout brackets
// Used by Pub Brawl (answers) and Tee K.O. (shirts). Entries are { pid (owner), text, ... }.

export function brawlInit(entries) {
  const current = shuffle(entries);
  return { current, next: [], history: [], m: 0, size: current.length };
}

const bracketLabel = (size) => (size <= 2 ? "The Final" : size <= 4 ? "Semi-final" : size <= 8 ? "Quarter-final" : "First round");

// Next match in the bracket, or the champion when only one entry is left. Byes go straight through.
export function brawlNext(br) {
  let { current, next, size } = br;
  current = [...current];
  next = [...next];
  for (;;) {
    if (current.length >= 2) {
      const [a, b, ...rest] = current;
      return { br: { ...br, current: rest, next, size }, match: { a, b, m: br.m, label: bracketLabel(size) } };
    }
    if (current.length === 1) next.push(current.pop());
    if (next.length <= 1) return { br: { ...br, current: [], next: [], size }, champion: next[0] ?? null };
    current = next;
    next = [];
    size = current.length;
  }
}

// Settle a match from its votes (a tie is a coin toss) and move the winner on.
export function brawlRecord(br, match, subs) {
  const votes = subs.filter((s) => s.kind === `m${match.m}`);
  const va = votes.filter((v) => v.value?.pick === "a").map((v) => v.player_id);
  const vb = votes.filter((v) => v.value?.pick === "b").map((v) => v.player_id);
  const aWins = va.length > vb.length || (va.length === vb.length && Math.random() < 0.5);
  const [winner, loser] = aWins ? [match.a, match.b] : [match.b, match.a];
  return {
    ...br,
    next: [...br.next, winner],
    history: [...br.history, { m: match.m, label: match.label, a: match.a, b: match.b, va, vb, winner: winner.pid, loser: loser.pid }],
    m: br.m + 1,
  };
}

// Tee K.O.: give each player two drawings and two slogans made by other people.
export function teeOffers(subs, players) {
  const made = subs.filter((s) => s.kind === "input" && (s.value?.img || String(s.value?.slogan ?? "").trim()));
  const imgs = made.filter((s) => s.value.img).map((s) => s.player_id);
  const slogans = made.filter((s) => String(s.value.slogan ?? "").trim()).map((s) => s.player_id);
  if (!imgs.length || !slogans.length) return null;
  const pickTwo = (pool, me) => {
    const others = shuffle(pool.filter((id) => id !== me));
    return (others.length >= 2 ? others : [...others, ...shuffle(pool.filter((id) => id === me))]).slice(0, 2);
  };
  return Object.fromEntries(players.map((p) => [p.id, { imgs: pickTwo(imgs, p.id), slogans: pickTwo(slogans, p.id) }]));
}

// Shirts from the "make" votes: { pid: maker, img: drawer's pid, by: slogan writer's pid, text: slogan }.
export function teeShirts(subs, offers) {
  const sloganOf = (pid) => String(subs.find((s) => s.kind === "input" && s.player_id === pid)?.value?.slogan ?? "").trim().slice(0, 60);
  return subs
    .filter((s) => s.kind === "vote" && offers?.[s.player_id])
    .filter((s) => offers[s.player_id].imgs.includes(s.value?.img) && offers[s.player_id].slogans.includes(s.value?.slogan))
    .map((s) => ({ pid: s.player_id, img: s.value.img, by: s.value.slogan, text: sloganOf(s.value.slogan) }));
}

// Out of Context: hand every player someone else's answer (and a place it was "posted").
export function stiTwists(subs, players, contexts) {
  const answers = shuffle(subs.filter((s) => s.kind === "input" && String(s.value?.text ?? "").trim()));
  if (answers.length < 2) return null;
  const twists = {};
  shuffle(players).forEach((p, i) => {
    // Round-robin through the answers, skipping the player's own.
    let a = answers[i % answers.length];
    if (a.player_id === p.id) a = answers[(i + 1) % answers.length];
    twists[p.id] = { from: a.player_id, answer: String(a.value.text).trim().slice(0, 120), context: contexts[i % contexts.length] };
  });
  return twists;
}

export function stiPosts(subs, twists) {
  return shuffle(
    subs
      .filter((s) => s.kind === "twist" && twists?.[s.player_id] && String(s.value?.text ?? "").trim())
      .map((s) => ({ pid: s.player_id, ...twists[s.player_id], text: String(s.value.text).trim().slice(0, 100) })),
  );
}

// ------------------------------------------------------------------ Cards Against Sobriety

// How many white cards a black card needs (one per blank; a question needs one).
export const blanks = (text) => Math.max(1, (String(text).match(/___/g) ?? []).length);

// Fill a black card's blanks with the played white cards (as plain text; callers escape).
export function fillCard(text, cards) {
  const whites = cards.map((c) => String(c).replace(/[.!?]$/, ""));
  if (!String(text).includes("___")) return `${text} ${whites.join(" / ")}.`;
  let i = 0;
  return String(text).replace(/___/g, () => whites[i++] ?? "___");
}

// A fresh draw pile of white cards: ones this screen hasn't dealt before first, then the rest.
export function whitePile(whites, seen = new Set()) {
  return [...shuffle(whites.filter((c) => seen.has(c))), ...shuffle(whites.filter((c) => !seen.has(c)))].reverse();
}

// Top every player's hand back up to HAND_SIZE from the front of the pile.
// `restock` supplies a fresh pile if it runs out.
export function dealHands(hands, pile, players, restock) {
  const next = {};
  let rest = [...pile];
  for (const p of players) {
    const hand = [...(hands?.[p.id] ?? [])];
    while (hand.length < HAND_SIZE) {
      if (!rest.length) rest = restock();
      hand.push(rest.shift());
    }
    next[p.id] = hand;
  }
  return { hands: next, pile: rest };
}

// The valid plays this round: exactly `pick` distinct cards, all from the player's own hand.
export function cardPlays(subs, hands, round) {
  return shuffle(
    subs
      .filter((s) => s.kind === "input" && s.player_id !== round.czar)
      .map((s) => ({ pid: s.player_id, cards: (s.value?.cards ?? []).map(String) }))
      .filter((p) => p.cards.length === round.pick && new Set(p.cards).size === p.cards.length && p.cards.every((c) => hands?.[p.pid]?.includes(c))),
  );
}

// Take played cards out of hands (they get topped up next round).
export function discardPlays(hands, plays) {
  const next = { ...hands };
  for (const p of plays ?? []) next[p.pid] = (next[p.pid] ?? []).filter((c) => !p.cards.includes(c));
  return next;
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
    case "year": {
      const guesses = Object.entries(byPlayer)
        .filter(([, v]) => Number.isFinite(v?.year))
        .map(([pid, v]) => ({ pid, year: v.year, miss: Math.abs(v.year - round.year) }))
        .sort((a, b) => a.miss - b.miss);
      const misses = [...new Set(guesses.map((g) => g.miss))];
      const worst = misses.length > 1 ? misses[misses.length - 1] : null; // nobody's "furthest" if all tie
      guesses.forEach((g) => {
        const rank = misses.indexOf(g.miss);
        if (g.miss === 0) add(g.pid, 500, 0, "Bang on!");
        else if (g.miss === worst) add(g.pid, 0, 2, "Furthest off");
        else if (rank < 3) add(g.pid, [300, 200, 100][rank], 0, rank === 0 ? "Closest" : "Close-ish");
      });
      slowpokes.forEach((id) => add(id, 0, 1, "Too slow"));
      view.guesses = guesses;
      break;
    }
    case "trivia": {
      const correct = Object.keys(byPlayer).filter((pid) => byPlayer[pid]?.choice === round.answer);
      correct.forEach((pid) => add(pid, 200, 0, "Correct"));
      const chamber = round.chamber ?? [];
      const picks = Object.fromEntries(votes.map((v) => [v.player_id, v.value?.pick]));
      const results = chamber.map((pid) => {
        const pick = picks[pid];
        let dead;
        if (pick === undefined) dead = "Froze in the chamber";
        else if (round.game === "glasses") dead = pick === round.spiked ? "Picked the spiked glass" : null;
        else dead = chamber.filter((o) => o !== pid && picks[o] === pick).length ? `Clashed on ${pick}` : null;
        if (dead) add(pid, 0, 3, dead);
        return { pid, pick, dead };
      });
      view.correct = correct;
      view.results = results;
      break;
    }
    case "roles": {
      const roles = round.roles ?? [];
      const crowned = roles.map((role, i) => {
        const tally = {};
        for (const [pid, v] of Object.entries(byPlayer)) {
          const target = v?.assign?.[i];
          if (ids.includes(target)) (tally[target] ??= []).push(pid);
        }
        const max = Math.max(0, ...Object.values(tally).map((t) => t.length));
        const holders = Object.keys(tally).filter((t) => tally[t].length === max && max > 0);
        holders.forEach((h) => tally[h].forEach((voter) => add(voter, 100, 0, "Agreed with the group")));
        if (role === round.drink) holders.forEach((h) => add(h, 0, 2, `Crowned ${role}`));
        return { role, holders, tally };
      });
      // Anyone whose picks matched nobody's is the odd one out.
      for (const pid of Object.keys(byPlayer)) {
        if (!(deltas[pid]?.why ?? []).includes("Agreed with the group")) add(pid, 0, 1, "Odd one out");
      }
      slowpokes.forEach((id) => add(id, 0, 1, "Too slow"));
      view.crowned = crowned;
      break;
    }
    case "sti": {
      const posts = round.posts ?? [];
      const got = Object.fromEntries(posts.map((x) => [x.pid, []]));
      for (const v of votes) {
        const target = v.value?.target;
        if (target in got && target !== v.player_id) got[target].push(v.player_id);
      }
      const top = Math.max(0, ...Object.values(got).map((g) => g.length));
      for (const x of posts) {
        const n = got[x.pid].length;
        if (n) {
          add(x.pid, 100 * n, 0, `${n} vote${n === 1 ? "" : "s"}`);
          add(x.from, 50 * n, 0, "Your answer got twisted");
        } else if (posts.length > 1) add(x.pid, 0, 2, "Zero votes");
      }
      const twisted = new Set(posts.map((x) => x.pid));
      Object.keys(round.twists ?? {}).filter((id) => !twisted.has(id)).forEach((id) => add(id, 0, 1, "No twist"));
      slowpokes.forEach((id) => add(id, 0, 1, "No answer"));
      view.results = posts
        .map((x) => ({ ...x, voters: got[x.pid], winner: top > 0 && got[x.pid].length === top }))
        .sort((a, b) => b.voters.length - a.voters.length);
      break;
    }
    case "cards": {
      const plays = round.plays ?? [];
      const judged = votes.find((v) => v.player_id === round.czar)?.value;
      const win = plays.find((p) => p.pid === judged?.win);
      const worst = plays.length >= 3 ? plays.find((p) => p.pid === judged?.worst && p.pid !== win?.pid) : null;
      if (win) add(win.pid, 100, 0, "Czar's favourite");
      if (worst) add(worst.pid, 0, 2, "Czar's least favourite");
      if (!judged && plays.length) add(round.czar, 0, 2, "Czar fell asleep");
      const played = new Set(plays.map((p) => p.pid));
      ids.filter((id) => id !== round.czar && !played.has(id)).forEach((id) => add(id, 0, 1, "Didn't play"));
      view.win = win?.pid ?? null;
      view.worst = worst?.pid ?? null;
      view.plays = plays;
      break;
    }
    case "brawl":
    case "tee": {
      const history = round.br?.history ?? [];
      const tee = round.type === "tee";
      for (const h of history) {
        const winVotes = h.winner === h.a.pid ? h.va : h.vb;
        const win = h.winner === h.a.pid ? h.a : h.b;
        if (winVotes.length) add(win.pid, 100 * winVotes.length, 0, `${winVotes.length} vote${winVotes.length === 1 ? "" : "s"}`);
        if (tee && winVotes.length) {
          add(win.img, 50 * winVotes.length, 0, "Drew a winner");
          add(win.by, 50 * winVotes.length, 0, "Wrote a winner");
        }
        add(h.loser, 0, 1, "Knocked out");
      }
      const champ = round.champion;
      if (champ) {
        add(champ.pid, tee ? 300 : 500, 0, "Champion");
        if (tee) {
          add(champ.img, 100, 0, "Champion drawing");
          add(champ.by, 100, 0, "Champion slogan");
        }
      }
      const entered = new Set((round.entries ?? []).map((e) => e.pid));
      ids.filter((id) => !entered.has(id)).forEach((id) => add(id, 0, 2, tee ? "No shirt" : "No answer"));
      view.history = history;
      view.champion = champ;
      break;
    }
    default:
      break;
  }
  return { deltas, view };
}
