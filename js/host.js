// The "TV" screen: creates the room, shows the prompts, runs the game clock and
// gives The Landlord (the game-master voice) his cues.
import { api, watchRoom, newToken, store } from "./api.js";
import { ROUND_INFO, PARTY_GAMES, RULES, WHEEL, shuffle } from "./prompts.js";
import { buildPlan, allIn, expected, quipAnswers, fibOptions, scoreRound, brawlInit, brawlNext, brawlRecord, teeOffers, teeShirts, stiTwists, stiPosts, whitePile, dealHands, cardPlays, discardPlays, fillCard,
  isBlank, wheelSpin, hotVictim, hotQuestions, applyBuddies, buddyRounds, spikedPick, jobBanks, jobAnswers, sortTeams, sortAnswer } from "./logic.js";
import { createGM } from "./gm.js";
import { loadCards, cardDeck, CARDS_CREDIT } from "./cards.js";
import { $, esc, avatar, chip, sipsText, timerBar, toast, shirt, drawingOf, safeImg } from "./ui.js";

const INTRO_MS = 5000;
const REVEAL_MS = 12000;
const SCORES_MS = 6000;
const MAX_HOLD_MS = 30000; // longest we'll wait for the Landlord to finish talking
const MATCH_S = 15; // each knockout match
const CHAMBER_S = 20; // the Drinking Chamber
const DRAW_S = 90; // minimum time to draw a Tee K.O. shirt
const HOTQ_S = 40; // each Hot Seat question
const RULE_S = 30; // the Rule Maker's time to choose
const RULE_EVERY = 3; // a Rule Maker every few rounds
const RULE_ROUNDS = 3; // how long a house rule lasts
const HOL_S = 12; // each Higher or Lower question
const BUDDY_S = 30; // the buddy-round winner's time to choose
const RAP_MATCH_S = 40; // each rap battle (the Landlord raps both verses first)
const SORT_S = 60; // minimum time for the Pub Sort captains
const JOB_S = 75; // minimum time to build an interview answer
const ROUND_LENGTHS = [[6, "Quick"], [10, "Standard"], [20, "Session"], [40, "All night"]];
const POINT_REASONS = /^\d+ votes?$|crowd|majority|Unanimous|Found the truth|Fooled someone|Correct|Agreed|Closest|Close-ish|Bang on|Champion|Drew|Wrote|twisted|Czar's favourite|Believed|Pity points|Spotted|Undercover|Good drawing|^Right$|Nailed|Close poll|Not bad|Called it|Got away|hired|right place|Team win/;

const DEFAULT_SETTINGS = {
  mode: "party", rounds: 10, target: 7, timer: 45, filthy: true, voice: true, tvVoice: true, rules: true, buddies: true,
  games: PARTY_GAMES.map((g) => g.type), // Party Mix games picked on the game-picker screen
};
// Games that existed before `known` was saved: anything newer starts switched on.
const OLD_GAMES = ["quip", "likely", "wyr", "nhie", "fib", "year", "trivia", "roles", "sti", "brawl", "tee", "imposter", "drawful", "hol", "hot", "wheel", "social"];
const MAX_CARD_ROUNDS = 150; // Cards Against Sobriety ends when someone collects `target` black cards
// Cards Against Sobriety needs a Czar plus at least two players.
const minPlayers = (mode) => (mode === "cards" ? 3 : 2);

export async function startHost(app) {
  // Every load of the host screen (including a refresh) starts a fresh room. The previous
  // room is closed, which cancels its game and sends everyone in it back to the start.
  const old = store.get("dg-host");
  if (old) await api.closeRoom(old.code, old.token).catch(() => {});
  store.del("dg-host");
  const token = newToken();
  const code = await api.createRoom(token);
  store.set("dg-host", { code, token });
  history.replaceState(null, "", `?host=${code}`);

  let live = { room: null, players: [], subs: [] };
  let busy = false;
  let watcher = null;
  const scored = new Set(); // rounds whose points/sips were already applied
  const settings = { ...DEFAULT_SETTINGS, ...store.get("dg-settings") };
  // New games added since this screen last saved its picks are switched on.
  const known = settings.known ?? OLD_GAMES;
  settings.games = [...settings.games, ...PARTY_GAMES.map((g) => g.type).filter((t) => !known.includes(t) && !settings.games.includes(t))];
  settings.known = PARTY_GAMES.map((g) => g.type);

  const caption = $("#gm");
  let captionTimer = null;
  const gm = createGM({
    settings,
    onSpeak: (text) => watcher?.say({ text }),
    onCaption(text) {
      caption.innerHTML = `<span class="gm-name">🎙️ The Landlord</span><span class="gm-text">${esc(text)}</span>`;
      caption.classList.add("show");
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => caption.classList.remove("show"), 6000 + text.length * 60);
    },
  });

  let moved = false;
  let pending = null; // the phase we just wrote and haven't seen come back yet
  const set = (phase, round, state) => {
    moved = true;
    pending = { phase, round, at: Date.now() };
    return api.setState(code, token, phase, round, state);
  };

  // Remember what this screen has played, so the next game night serves fresh prompts first.
  const seenSet = () => new Set(store.get("dg-seen") ?? []);
  const markSeen = (keys) => store.set("dg-seen", [...(store.get("dg-seen") ?? []), ...keys.filter(Boolean)].slice(-5000));

  // Cards Against Sobriety: the deck and the draw pile live on this screen only (the room just
  // holds each player's hand), so the room's data stays small.
  let deck = null;
  let pile = [];
  let picking = false; // showing the Party Mix game picker

  // Games that can be played with the current number of players.
  const playableGames = () => PARTY_GAMES.filter((g) => live.players.length >= (g.min ?? 2));

  // The Party Mix game picker: tap games in or out, then start.
  function renderPicker() {
    const n = live.players.length;
    const chosen = PARTY_GAMES.filter((g) => settings.games.includes(g.type) && n >= (g.min ?? 2)).length;
    return `<div class="stage picker">
      <h1>Pick your games</h1>
      <p class="kicker">Tap to switch games in or out. ${chosen} of ${PARTY_GAMES.length} selected · ${settings.rounds} rounds</p>
      <div class="row"><button class="btn ghost sm" data-act="pick-all">✅ Select all</button><button class="btn ghost sm" data-act="pick-none">✖ Clear</button>
        <button class="btn sm" data-act="start" ${chosen ? "" : "disabled"}>Let's go! 🍻</button></div>
      <div class="game-grid">${PARTY_GAMES.map((g) => {
        const info = ROUND_INFO[g.type];
        const tooFew = n < (g.min ?? 2);
        const on = settings.games.includes(g.type) && !tooFew;
        return `<button class="game-card ${on ? "on" : ""} ${tooFew ? "off" : ""}" data-act="pick-game" data-val="${g.type}" ${tooFew ? "disabled" : ""}>
          <span class="game-emoji">${info.emoji}</span><b>${esc(info.title)}</b><span class="game-blurb">${esc(g.blurb)}</span>
          <span class="game-tick">${tooFew ? `Needs ${g.min}+ players` : on ? "✓ In" : "Out"}</span></button>`;
      }).join("")}</div>
      <div class="row"><button class="btn ghost" data-act="pick-back">← Back</button>
        <button class="btn big" data-act="start" ${chosen ? "" : "disabled"}>Let's go! 🍻</button></div>
    </div>`;
  }

  async function startGame() {
    const names = live.players.map((p) => p.name);
    const cards = settings.mode === "cards";
    if (cards) {
      deck = cardDeck(await loadCards(), !settings.filthy);
      pile = whitePile(deck.white, seenSet());
    }
    // Party Mix: the games ticked on the picker (the knockout games need 3+ players).
    const types = cards ? ["cards"] : playableGames().map((g) => g.type).filter((t) => settings.games.includes(t));
    const plan = buildPlan(cards ? MAX_CARD_ROUNDS : settings.rounds, types, { filthy: settings.filthy, names, seen: seenSet(), cards: deck });
    // A couple of Party Mix rounds are buddy rounds: the winner chains a drinking buddy.
    if (!cards && settings.buddies && names.length >= 3) for (const i of buddyRounds(plan)) plan[i].buddy = true;
    markSeen(plan.map((r) => r.key));
    await api.reset(code, token);
    scored.clear();
    const [name, other] = shuffle(names);
    gm.line("welcome", { name, other });
    const extra = cards ? { hands: {}, won: {} } : {};
    await beginRound({ plan, settings: { ...settings }, idx: 0, ...extra }, 1);
  }

  async function beginRound(base, roundNo) {
    const r = base.plan[base.idx];
    if (r.type === "cards") {
      // Top up everyone's hand, and pass the Czar round the room in joining order.
      if (!deck) deck = cardDeck(await loadCards(), !base.settings.filthy);
      const dealt = dealHands(base.hands, pile, live.players, () => whitePile(deck.white));
      markSeen(pile.slice(0, pile.length - dealt.pile.length));
      pile = dealt.pile;
      const hands = dealt.hands;
      const czar = live.players[base.idx % live.players.length]?.id;
      await set("intro", roundNo, { ...base, hands, cur: { ...r, czar }, until: Date.now() + INTRO_MS });
      return;
    }
    await set("intro", roundNo, { ...base, cur: { ...r }, until: Date.now() + INTRO_MS });
  }

  // Timed phases wait for the Landlord to finish his line (up to a limit).
  const ready = (until, now) => now >= until && (!gm.busy() || now >= until + MAX_HOLD_MS);

  async function step() {
    const room = live.room;
    if (!room || busy) return;
    // Never act on a stale copy of the room: wait until our last write is visible.
    if (pending) {
      if (room.phase === pending.phase && room.round === pending.round) pending = null;
      else if (Date.now() - pending.at < 5000) return;
    }
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const now = Date.now();
    const timer = (st.settings?.timer ?? 45) * 1000;
    const voteTime = Math.min(timer, 40000);
    busy = true;
    moved = false;
    try {
      if (room.phase === "intro" && ready(st.until, now)) {
        if (cur.type === "social") await set("reveal", room.round, { ...st, cur: { ...cur, view: {} }, until: now + REVEAL_MS });
        else if (cur.type === "wheel") await reveal(room, st, { ...cur, spin: wheelSpin(live.players) });
        else if (cur.type === "imposter") {
          const imposter = shuffle(live.players)[0].id;
          await set("input", room.round, { ...st, cur: { ...cur, imposter }, deadline: now + timer, span: timer / 1000 });
        } else if (cur.type === "drawful") {
          const drawer = hotVictim(live.players, st.drawSeen);
          const secs = Math.max(75, timer / 1000);
          await set("input", room.round, { ...st, drawSeen: [...(st.drawSeen ?? []), drawer], cur: { ...cur, drawer }, deadline: now + secs * 1000, span: secs });
        } else if (cur.type === "hol") {
          await set("hol", room.round, { ...st, cur: { ...cur, q: cur.qs[0] }, deadline: now + HOL_S * 1000, span: HOL_S });
        }
        else if (cur.type === "poll") {
          const pollster = hotVictim(live.players, st.pollSeen);
          await set("input", room.round, { ...st, pollSeen: [...(st.pollSeen ?? []), pollster], cur: { ...cur, pollster }, deadline: now + timer, span: timer / 1000 });
        } else if (cur.type === "sort") {
          const { teams, captains } = sortTeams(live.players, st.sortSeen);
          const secs = Math.max(SORT_S, timer / 1000);
          await set("input", room.round, { ...st, sortSeen: [...(st.sortSeen ?? []), ...captains], cur: { ...cur, teams, captains }, deadline: now + secs * 1000, span: secs });
        } else if (cur.type === "spiked") {
          await set("input", room.round, { ...st, cur: { ...cur, spiked: spikedPick(live.players) }, deadline: now + timer, span: timer / 1000 });
        } else if (cur.type === "hot") {
          const victim = hotVictim(live.players, st.hotSeen);
          await set("input", room.round, { ...st, hotSeen: [...(st.hotSeen ?? []), victim], cur: { ...cur, victim }, deadline: now + timer, span: timer / 1000 });
        } else {
          const secs = cur.type === "tee" ? Math.max(DRAW_S, timer / 1000) : timer / 1000;
          // Out of Context: everyone gets their own innocent question.
          // (Bullsh*t Interview hands out icebreakers, and Rap Battle opening lines, the same way.)
          const deal = { sti: cur.questions, job: cur.ice, rap: cur.openers }[cur.type];
          const extra = deal ? { ask: Object.fromEntries(live.players.map((p, i) => [p.id, deal[i % deal.length]])) } : {};
          await set("input", room.round, { ...st, cur: { ...cur, ...extra }, deadline: now + secs * 1000, span: secs });
        }
      } else if (room.phase === "input" && (now >= st.deadline || allIn("input", cur, live.players, live.subs))) {
        if (cur.type === "quip") {
          const answers = quipAnswers(live.subs);
          if (answers.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, answers }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, answers });
        } else if (cur.type === "sti") {
          const twists = stiTwists(live.subs, live.players, cur.contexts);
          if (twists) await set("twist", room.round, { ...st, cur: { ...cur, twists }, deadline: now + timer, span: timer / 1000 });
          else await reveal(room, st, { ...cur, posts: [] });
        } else if (cur.type === "cards") {
          const plays = cardPlays(live.subs, st.hands, cur);
          const czarHere = live.players.some((p) => p.id === cur.czar);
          if (plays.length && czarHere) await set("vote", room.round, { ...st, cur: { ...cur, plays }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, plays });
        } else if (cur.type === "imposter" || cur.type === "spiked") {
          await set("vote", room.round, { ...st, deadline: now + voteTime, span: voteTime / 1000 });
        } else if (cur.type === "poll") {
          // No guess in time? The pollster gets 50% and a sip.
          const pct = Number(live.subs.find((x) => x.kind === "input" && x.player_id === cur.pollster)?.value?.pct);
          const guessed = Number.isFinite(pct);
          const guess = guessed ? Math.max(0, Math.min(100, Math.round(pct))) : 50;
          await set("vote", room.round, { ...st, cur: { ...cur, guess, guessed }, deadline: now + voteTime, span: voteTime / 1000 });
        } else if (cur.type === "sort") {
          await reveal(room, st, cur);
        } else if (cur.type === "job") {
          const banks = jobBanks(live.subs, live.players);
          const secs = Math.max(JOB_S, timer / 1000);
          if (banks) await set("twist", room.round, { ...st, cur: { ...cur, banks }, deadline: now + secs * 1000, span: secs });
          else await reveal(room, st, { ...cur, answers: [] });
        } else if (cur.type === "rap") {
          await startBracket(room, st, { ...cur, entries: quipAnswers(live.subs).map((a) => ({ ...a, opener: cur.ask?.[a.pid] })) });
        } else if (cur.type === "drawful") {
          const hasDrawing = live.subs.some((x) => x.kind === "input" && x.player_id === cur.drawer && x.value?.img);
          if (hasDrawing) await set("twist", room.round, { ...st, cur: { ...cur, hasDrawing }, deadline: now + timer, span: timer / 1000 });
          else await reveal(room, st, { ...cur, hasDrawing, options: [] });
        } else if (cur.type === "hot") {
          const qs = hotQuestions(live.subs, cur.victim);
          if (qs.length) await set("hotq", room.round, { ...st, cur: { ...cur, qs, q: qs[0] }, deadline: now + HOTQ_S * 1000, span: HOTQ_S });
          else await reveal(room, st, { ...cur, qs });
        } else if (cur.type === "brawl") {
          await startBracket(room, st, { ...cur, entries: quipAnswers(live.subs) });
        } else if (cur.type === "tee") {
          const offers = teeOffers(live.subs, live.players);
          if (offers) await set("vote", room.round, { ...st, cur: { ...cur, offers }, deadline: now + timer, span: timer / 1000 });
          else await reveal(room, st, { ...cur, entries: [] });
        } else if (cur.type === "trivia") {
          // Everyone who got it wrong (or didn't answer) goes into the Drinking Chamber.
          const right = new Set(live.subs.filter((x) => x.kind === "input" && x.value?.choice === cur.answer).map((x) => x.player_id));
          const chamber = live.players.map((p) => p.id).filter((id) => !right.has(id));
          if (chamber.length) {
            const game = chamber.length <= 2 || Math.random() < 0.5 ? "glasses" : "unique";
            const spiked = Math.floor(Math.random() * 4);
            await set("vote", room.round, { ...st, cur: { ...cur, chamber, game, spiked }, deadline: now + CHAMBER_S * 1000, span: CHAMBER_S });
          } else await reveal(room, st, { ...cur, chamber });
        } else if (cur.type === "fib") {
          const options = fibOptions(live.subs, cur.truth);
          if (options.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, options }, deadline: now + voteTime, span: voteTime / 1000 });
          else await reveal(room, st, { ...cur, options });
        } else {
          await reveal(room, st, cur);
        }
      } else if (room.phase === "vote" && (now >= st.deadline || allIn("vote", cur, live.players, live.subs))) {
        if (cur.type === "tee") await startBracket(room, st, { ...cur, entries: teeShirts(live.subs, cur.offers) });
        else await reveal(room, st, cur);
      } else if (room.phase === "twist" && cur.type === "job" && (now >= st.deadline || allIn("twist", cur, live.players, live.subs))) {
        const answers = jobAnswers(live.subs, cur.banks);
        if (answers.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, answers }, deadline: now + voteTime, span: voteTime / 1000 });
        else await reveal(room, st, { ...cur, answers });
      } else if (room.phase === "twist" && cur.type === "drawful" && (now >= st.deadline || allIn("twist", cur, live.players, live.subs))) {
        const options = fibOptions(live.subs, cur.prompt, "twist");
        if (options.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, options }, deadline: now + voteTime, span: voteTime / 1000 });
        else await reveal(room, st, { ...cur, options });
      } else if (room.phase === "hol" && (now >= st.deadline || allIn("hol", cur, live.players, live.subs))) {
        const nextQ = cur.qs[cur.q.i + 1];
        if (nextQ) await set("hol", room.round, { ...st, cur: { ...cur, q: nextQ }, deadline: now + HOL_S * 1000, span: HOL_S });
        else await reveal(room, st, cur);
      } else if (room.phase === "buddy" && (now >= st.deadline || allIn("buddy", cur, live.players, live.subs))) {
        await finishBuddy(room, st);
      } else if (room.phase === "twist" && (now >= st.deadline || allIn("twist", cur, live.players, live.subs))) {
        const posts = stiPosts(live.subs, cur.twists);
        if (posts.length >= 2) await set("vote", room.round, { ...st, cur: { ...cur, posts }, deadline: now + voteTime, span: voteTime / 1000 });
        else await reveal(room, st, { ...cur, posts });
      } else if (room.phase === "hotq" && (now >= st.deadline || allIn("hotq", cur, live.players, live.subs) || live.subs.some((x) => x.kind === `m${cur.q.i}` && x.player_id === cur.victim && x.value?.refuse))) {
        // Next question, or the verdicts.
        const nextQ = cur.qs[cur.q.i + 1];
        if (nextQ) await set("hotq", room.round, { ...st, cur: { ...cur, q: nextQ }, deadline: now + HOTQ_S * 1000, span: HOTQ_S });
        else await reveal(room, st, cur);
      } else if (room.phase === "rule" && (now >= st.deadline || allIn("rule", cur, live.players, live.subs))) {
        await finishRule(room, st);
      } else if (room.phase === "match" && (now >= st.deadline || (allIn("match", cur, live.players, live.subs) && (cur.type !== "rap" || !gm.busy())))) {
        await nextMatch(room, st, { ...cur, br: brawlRecord(cur.br, cur.match, live.subs) });
      } else if (room.phase === "reveal" && ready(st.until, now)) {
        await set("scores", room.round, { ...st, until: now + SCORES_MS });
      } else if (room.phase === "scores" && now >= st.until) {
        await next(room, st);
      }
      // Pull the new state before the next tick so we never act on a stale phase.
      if (moved) await watcher?.refresh();
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  // Knockout bracket (Pub Brawl answers / Tee K.O. shirts): one match per phase until a champion.
  async function startBracket(room, st, cur) {
    await nextMatch(room, st, { ...cur, br: brawlInit(cur.entries) });
  }

  async function nextMatch(room, st, cur) {
    const n = brawlNext(cur.br);
    if (n.match) {
      const secs = cur.type === "rap" ? RAP_MATCH_S : MATCH_S;
      await set("match", room.round, { ...st, cur: { ...cur, br: n.br, match: n.match }, deadline: Date.now() + secs * 1000, span: secs });
    } else {
      await reveal(room, st, { ...cur, br: n.br, match: null, champion: n.champion });
    }
  }

  async function reveal(room, st, cur) {
    if (cur.type === "cards") st = { ...st, hands: discardPlays(st.hands, cur.plays) };
    const { deltas, view } = scoreRound(cur, live.players, live.subs);
    // Drinking buddies drink whenever their chainer does.
    applyBuddies(deltas, st.buddies, live.players.map((p) => p.id));
    // Wheel of Doom "double points next round".
    if (st.double === st.idx) for (const d of Object.values(deltas)) if (d.score > 0) (d.score *= 2), d.why.push("Double points!");
    if (cur.type === "wheel" && view.segment?.effect === "double") st = { ...st, double: st.idx + 1 };
    // The Czar's favourite collects the black card.
    if (cur.type === "cards" && view.win) st = { ...st, won: { ...st.won, [view.win]: [...(st.won?.[view.win] ?? []), cur.prompt] } };
    const list = Object.entries(deltas).map(([id, d]) => ({ id, score: d.score, sips: d.sips }));
    if (list.length && !scored.has(room.round)) await api.apply(code, token, list);
    scored.add(room.round);
    await set("reveal", room.round, { ...st, cur: { ...cur, view, deltas }, until: Date.now() + REVEAL_MS });
  }

  // State that lives across rounds (the rest of `st` belongs to the current round).
  const carry = (st) => ({
    plan: st.plan, settings: st.settings, idx: st.idx, hands: st.hands, won: st.won,
    rules: st.rules, double: st.double, hotSeen: st.hotSeen, ruleDone: st.ruleDone,
    buddies: st.buddies, buddyDone: st.buddyDone, drawSeen: st.drawSeen, pollSeen: st.pollSeen, sortSeen: st.sortSeen,
  });

  async function next(room, st) {
    const idx = st.idx + 1;
    // Cards Against Sobriety: first to the target number of black cards wins.
    const champ = st.won && Object.values(st.won).some((cards) => cards.length >= (st.settings.target ?? 7));
    if (idx >= st.plan.length || champ) return set("final", room.round, { ...st });
    // Buddy round: its winner chains a drinking buddy before we move on.
    if (st.cur?.buddy && st.buddyDone !== st.idx) {
      const best = Object.entries(st.cur?.deltas ?? {}).sort((a, b) => b[1].score - a[1].score)[0];
      if (best && best[1].score > 0 && live.players.some((p) => p.id === best[0])) {
        return set("buddy", room.round, {
          ...carry(st), buddyDone: st.idx, cur: { type: "buddy", maker: best[0], deltas: st.cur.deltas },
          deadline: Date.now() + BUDDY_S * 1000, span: BUDDY_S,
        });
      }
    }
    // Every few rounds, the last round's best player makes a house rule first.
    if (st.settings.rules && idx % RULE_EVERY === 0 && st.ruleDone !== st.idx && live.players.length >= 2) {
      const best = Object.entries(st.cur?.deltas ?? {}).sort((a, b) => b[1].score - a[1].score)[0];
      const maker = best && best[1].score > 0 ? best[0] : shuffle(live.players)[0].id;
      return set("rule", room.round, {
        ...carry(st), ruleDone: st.idx, cur: { type: "rule", maker, options: shuffle(RULES).slice(0, 4) },
        deadline: Date.now() + RULE_S * 1000, span: RULE_S,
      });
    }
    await beginRound({ ...carry(st), idx }, room.round + 1);
  }

  // The buddy-round winner has chosen (or run out of time): chain the buddy, then carry on.
  async function finishBuddy(room, st) {
    const cur = st.cur;
    const others = live.players.filter((p) => p.id !== cur.maker);
    const pick = live.subs.find((x) => x.kind === "buddy" && x.player_id === cur.maker)?.value?.target;
    const buddy = others.find((p) => p.id === pick) ?? shuffle(others)[0];
    const nameOf = (id) => live.players.find((p) => p.id === id)?.name;
    const buddies = buddy ? [...(st.buddies ?? []), { a: cur.maker, b: buddy.id }] : st.buddies;
    if (buddy) gm.line("buddy", { name: nameOf(cur.maker), buddy: buddy.name });
    await next(room, { ...st, buddies, buddyDone: st.idx });
  }

  // The Rule Maker has chosen (or run out of time): add the rule, then carry on.
  async function finishRule(room, st) {
    const cur = st.cur;
    const sub = live.subs.find((x) => x.kind === "rule" && x.player_id === cur.maker);
    const text = String(sub?.value?.text ?? "").trim().slice(0, 120) || cur.options[0];
    const rules = [...(st.rules ?? []).filter((r) => r.until > st.idx + 1), { text, by: cur.maker, until: st.idx + 1 + RULE_ROUNDS }];
    gm.line("rule", { name: live.players.find((p) => p.id === cur.maker)?.name ?? "The Rule Maker", rule: text });
    await beginRound({ ...carry(st), rules, idx: st.idx + 1 }, room.round + 1);
  }

  // The Landlord's cues, fired once per phase change.
  function announce(room) {
    const nameOf = (id) => live.players.find((p) => p.id === id)?.name;
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    switch (room.phase) {
      case "intro":
        gm.say(`Round ${st.idx + 1}. ${info.title}${/[?!.]$/.test(info.title) ? "" : "."}${cur.buddy ? " And it's a buddy round. Win it, and you choose a drinking buddy." : ""}`);
        break;
      case "input":
        if (cur.type === "wyr") gm.say(`Would you rather ${cur.prompt[0]}? Or ${cur.prompt[1]}?`, { caption: false });
        else if (cur.type === "year") gm.say(`What year? ${cur.prompt}`, { caption: false });
        else if (cur.type === "tee") gm.say("Draw something on your phone, and write a slogan. Filth encouraged.", { caption: false });
        else if (cur.type === "sti") gm.say("Answer the question on your phone. Honestly. What could possibly go wrong?", { caption: false });
        else if (cur.type === "cards") gm.say(`${nameOf(cur.czar) ?? "The Czar"} is the Card Czar. ${cur.prompt}`, { caption: false });
        else if (cur.type === "imposter") gm.say("Check your phones. One of you is the imposter. Give me a one-word clue.", { caption: false });
        else if (cur.type === "drawful") gm.say(`${nameOf(cur.drawer) ?? "Someone"} is drawing. Everyone else, look away from their phone.`, { caption: false });
        else if (cur.type === "hot") gm.say(`${nameOf(cur.victim) ?? "Someone"} is in the hot seat. Everyone else, write them a question.`, { caption: false });
        else if (cur.type === "poll") gm.say(`${nameOf(cur.pollster) ?? "Someone"} is taking the poll. ${cur.prompt}`, { caption: false });
        else if (cur.type === "spiked") gm.say("Check your phones and answer the question. One of you has been spiked, with a different question. Blend in.", { caption: false });
        else if (cur.type === "sort") gm.say(`Team captains: ${nameOf(cur.captains?.[0]) ?? "red"} and ${nameOf(cur.captains?.[1]) ?? "blue"}. ${cur.prompt}`, { caption: false });
        else if (cur.type === "job") gm.say("Welcome to your job interview. First, a little icebreaker. Answer in full sentences. Your words will be used against you.", { caption: false });
        else if (cur.type === "rap") gm.say(`Rap battle! Tonight's theme: ${cur.prompt}. Finish your verse on your phone. And make it rhyme.`, { caption: false });
        else gm.say(cur.prompt, { caption: false });
        break;
      case "vote": {
        const lines = {
          fib: "Now. Which one's the truth?",
          trivia: "Wrong answers, welcome to the Drinking Chamber.",
          tee: "Now make a shirt out of someone else's rubbish.",
          sti: "Vote for the most out-of-context. No mercy.",
          imposter: "Right. Who's the imposter?",
          drawful: "Which one's the real title?",
          cards: "Card Czar. Pick your favourite. And the one you hate.",
          spiked: "Right. Read the answers. Who's been spiked?",
          job: "Who gets the job? Vote now.",
          poll: `${nameOf(cur.pollster) ?? "The pollster"} says ${cur.guess} percent. Higher, or lower?`,
        };
        gm.say(lines[cur.type] ?? "Right. Vote for the least disappointing one.", { caption: false });
        break;
      }
      case "match":
        if (cur.type === "rap" && cur.match) {
          // The Landlord raps both verses (deadpan), then the room votes.
          const verse = (e) => `${e.opener?.line ?? ""}. ${e.text}.`;
          gm.say(`${cur.match.label}. In the red corner, ${nameOf(cur.match.a.pid) ?? "someone"}. ${verse(cur.match.a)} And in the blue corner, ${nameOf(cur.match.b.pid) ?? "someone"}. ${verse(cur.match.b)} Vote!`, { caption: false });
        } else gm.say(`${cur.match?.label ?? "Next match"}. Fight!`, { caption: false });
        break;
      case "hotq":
        gm.say(cur.q.text, { caption: false });
        break;
      case "hol":
        gm.say(`${cur.q.q}. Higher or lower than ${cur.q.than}?`, { caption: false });
        break;
      case "buddy":
        gm.say(`${nameOf(cur.maker) ?? "Someone"} won the buddy round. Choose your drinking buddy. Choose badly.`, { caption: false });
        break;
      case "rule":
        gm.say(`${nameOf(cur.maker) ?? "Someone"} is the Rule Maker. Choose wisely. Or cruelly.`, { caption: false });
        break;
      case "twist":
        if (cur.type === "drawful") {
          gm.say("What is it? Give it a title. A convincing, lying title.", { caption: false });
          break;
        }
        if (cur.type === "job") {
          gm.say(`Now, the interview. ${cur.prompt} Build your answer out of everyone else's words.`, { caption: false });
          break;
        }
        gm.say("Now for the fun part. You've been given someone else's answer. Tell us where it was really posted.", { caption: false });
        break;
      case "reveal":
        if (cur.type === "social") gm.say(cur.prompt, { caption: false });
        else if (cur.type === "wheel") {
          // Let the wheel stop spinning first.
          const seg = cur.view?.segment;
          const who = nameOf(cur.spin?.victim) ?? "Someone";
          setTimeout(() => gm.say((seg?.say ?? seg?.label ?? "").replace("{name}", who)), 4300);
        }
        else if (cur.type === "cards" && cur.view?.win) {
          const win = cur.view.plays.find((p) => p.pid === cur.view.win);
          gm.say(fillCard(cur.prompt, win.cards), { caption: false }).then(() => roastRound(cur));
        } else roastRound(cur);
        break;
      case "final": {
        const ranked = [...live.players].sort((a, b) => b.score - a.score);
        const thirsty = [...live.players].sort((a, b) => b.sips - a.sips)[0];
        const last = ranked.length > 1 ? ranked[ranked.length - 1] : null;
        gm.line("final", { winner: ranked[0]?.name, thirsty: thirsty?.sips ? thirsty.name : null, last: last?.name });
        break;
      }
    }
  }

  // The Landlord's reaction to a round: roast the most relevant person, falling back
  // to anyone who's drinking, then to a generic line.
  function roastRound(cur) {
    const nameOf = (id) => live.players.find((p) => p.id === id)?.name;
    const any = (ids) => shuffle((ids ?? []).map(nameOf).filter(Boolean))[0];
    const v = cur.view ?? {};
    const deltas = Object.entries(cur.deltas ?? {});
    const drinking = (why) => deltas.filter(([, d]) => d.sips > 0 && (!why || d.why.includes(why))).map(([id]) => id);
    let key = cur.type;
    let vars = {};
    switch (cur.type) {
      case "likely":
        vars = { name: any(v.losers) };
        break;
      case "nhie":
        if (!v.have?.length) key = "nhie_none";
        vars = { name: any(v.have) };
        break;
      case "wyr":
        if (v.tie) key = "wyr_tie";
        vars = { name: any(drinking("In the minority")) };
        break;
      case "quip":
        vars = { winner: any((v.results ?? []).filter((a) => a.winner).map((a) => a.pid)), name: any(drinking("Zero votes")) };
        break;
      case "fib": {
        const fooled = shuffle((v.options ?? []).filter((o) => !o.truth && o.pickers.length))[0];
        vars = { liar: any(fooled?.pids), name: any(fooled?.pickers) };
        break;
      }
      case "year": {
        const g = v.guesses ?? [];
        const worst = g.filter((x) => (cur.deltas?.[x.pid]?.why ?? []).includes("Furthest off"));
        vars = { winner: nameOf(g[0]?.pid), name: nameOf(worst[0]?.pid), miss: worst[0]?.miss };
        break;
      }
      case "trivia":
        if (!(v.results ?? []).some((r) => r.dead)) key = "trivia_clean";
        vars = { name: any((v.results ?? []).filter((r) => r.dead).map((r) => r.pid)) };
        break;
      case "roles": {
        const c = (v.crowned ?? []).find((x) => x.role === cur.drink);
        vars = { name: any(c?.holders), role: cur.drink.replace(/^The /, "the ") };
        break;
      }
      case "brawl":
      case "tee":
        vars = { winner: nameOf(v.champion?.pid), name: nameOf(v.history?.[0]?.loser) };
        break;
      case "cards":
        vars = { winner: nameOf(v.win), name: nameOf(v.worst), czar: nameOf(cur.czar) };
        break;
      case "imposter":
        key = v.caught ? "imposter_caught" : "imposter_escaped";
        vars = { name: nameOf(cur.imposter) };
        break;
      case "drawful": {
        const truth = (v.options ?? []).find((o) => o.truth);
        if (truth && !truth.pickers.length) vars = { name: nameOf(cur.drawer), answer: cur.prompt };
        else key = "drink";
        if (key === "drink") vars = { name: any(drinking()) };
        break;
      }
      case "hol":
        vars = { name: any(drinking("Wrong")) };
        break;
      case "hot": {
        const busted = (v.results ?? []).some((q) => q.refused || q.lie.length > q.truth.length);
        if (!busted) key = "hot_clean";
        vars = { name: nameOf(cur.victim) };
        break;
      }
      case "poll":
        if (v.miss <= 10) key = "poll_close";
        vars = { name: nameOf(cur.pollster), guess: `${v.guess}`, answer: `${cur.pct} percent` };
        break;
      case "spiked":
        key = v.caught?.length ? "spiked_caught" : "spiked_escaped";
        vars = { name: v.caught?.length ? any(v.caught) : any(cur.spiked) };
        break;
      case "job":
        vars = { winner: any((v.results ?? []).filter((a) => a.winner).map((a) => a.pid)), name: any(drinking("Zero votes")) };
        break;
      case "sort":
        if (v.winner === null || v.winner === undefined) key = "sort_tie";
        else vars = { team: ["Red", "Blue"][v.winner], name: nameOf(cur.captains?.[1 - v.winner]) };
        break;
      case "rap":
        vars = { winner: nameOf(v.champion?.pid), name: nameOf(v.history?.[0]?.loser) };
        break;
      case "sti": {
        const top = (v.results ?? []).find((x) => x.winner);
        vars = { winner: nameOf(top?.pid), victim: nameOf(top?.from), name: any(drinking("Zero votes")) };
        break;
      }
    }
    gm.line(key, vars) ?? gm.line("drink", { name: any(drinking()) }) ?? gm.line("none");
  }

  // Host controls
  app.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === "start") {
        if (live.players.length < minPlayers(settings.mode)) return toast(`Need at least ${minPlayers(settings.mode)} players!`);
        // Party Mix: choose the games first.
        if (settings.mode !== "cards" && !picking) {
          picking = true;
          render();
          return;
        }
        if (settings.mode !== "cards" && !playableGames().some((g) => settings.games.includes(g.type))) return toast("Pick at least one game!");
        picking = false;
        btn.disabled = true;
        await startGame();
      } else if (act === "pick-game") {
        const t = btn.dataset.val;
        settings.games = settings.games.includes(t) ? settings.games.filter((x) => x !== t) : [...settings.games, t];
        store.set("dg-settings", settings);
        render();
      } else if (act === "pick-all" || act === "pick-none") {
        settings.games = act === "pick-all" ? PARTY_GAMES.map((g) => g.type) : [];
        store.set("dg-settings", settings);
        render();
      } else if (act === "pick-back") {
        picking = false;
        render();
      } else if (act === "skip") {
        // Fast-forward whatever is on screen (and shut the Landlord up).
        gm.stop();
        const st = live.room.state;
        await set(live.room.phase, live.room.round, { ...st, deadline: 0, until: 0 });
      } else if (act === "end") {
        // Finish early: skip the remaining rounds and go straight to the final scores.
        if (!confirm("End the game now and show the final scores?")) return;
        gm.stop();
        await set("final", live.room.round, { ...live.room.state });
      } else if (act === "lobby") {
        gm.stop();
        await api.reset(code, token);
      } else if (act === "new-room") {
        if (!confirm("Close this room and start a new one? Everyone will need the new code.")) return;
        location.href = location.pathname + "?host"; // loading the host screen closes this room
      } else if (act === "kick") {
        const p = live.players.find((x) => x.id === btn.dataset.id);
        if (p && confirm(`Kick ${p.name}?`)) await api.kick(code, token, p.id);
      } else if (act === "mode") {
        settings.mode = btn.dataset.val;
        store.set("dg-settings", settings);
        render();
      } else if (act === "rounds" || act === "timer" || act === "target") {
        settings[act] = +btn.dataset.val;
        store.set("dg-settings", settings);
        render();
      } else if (["social", "filthy", "voice", "tvVoice", "rules", "buddies"].includes(act)) {
        settings[act] = !settings[act];
        store.set("dg-settings", settings);
        if ((act === "voice" || act === "tvVoice") && settings.voice) gm.say("Testing. One, two. Can the cheap seats hear me?");
        if (act === "voice" && !settings.voice) gm.stop();
        render();
      }
    } catch (err) {
      toast(err.message);
    }
  });

  const joinUrl = `${location.origin}${location.pathname}?room=${code}`;
  const toggle = (key, on, off = "Off") =>
    `<button class="pill ${settings[key] ? "on" : ""}" data-act="${key}">${settings[key] ? on : off}</button>`;

  function render() {
    const room = live.room;
    if (!room) {
      app.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
      return;
    }
    const st = room.state ?? {};
    const cur = st.cur ?? {};
    const info = ROUND_INFO[cur.type] ?? {};
    const byId = Object.fromEntries(live.players.map((p) => [p.id, p]));
    const header = `<header class="host-head">
        <div class="logo sm">Last Orders</div>
        <div class="roomcode">Join at <b>${esc(location.host + location.pathname)}</b> · code <b class="code">${code}</b></div>
        ${room.phase === "lobby" ? "" : st.settings?.mode === "cards"
          ? `<div class="round-no">Round ${st.idx + 1} · first to ${st.settings.target ?? 7} 🃏</div>`
          : `<div class="round-no">Round ${st.idx + 1}/${st.plan?.length ?? "?"}</div>`}
      </header>`;
    const controls = room.phase === "lobby" ? "" : `<footer class="host-foot">
        <button class="btn ghost sm" data-act="voice">${settings.voice ? "🔊 Voice on" : "🔇 Voice off"}</button>
        ${room.phase === "final" ? "" : `<button class="btn ghost sm" data-act="skip">Skip ⏭</button>
        <button class="btn ghost sm" data-act="lobby">Back to lobby</button>
        <button class="btn danger sm" data-act="end">🏁 End game</button>`}
      </footer>`;
    let body = "";

    switch (room.phase) {
      case "lobby":
        if (picking) {
          body = renderPicker();
          break;
        }
        body = `<div class="lobby">
          <div class="join-card">
            <div class="logo">Last Orders</div>
            <p class="tag">The party drinking game. Grab your phones!</p>
            <div id="qr" class="qr"></div>
            <p>Go to <b>${esc(location.host + location.pathname)}</b><br>and enter code</p>
            <div class="bigcode">${code}</div>
          </div>
          <div class="lobby-side">
            <h2>Players (${live.players.length}/12)</h2>
            <div class="player-grid">
              ${live.players.map((p) => `<div class="player-card" style="--c:${esc(p.color)}">${avatar(p, "lg")}<span>${esc(p.name)}</span>
                <button class="kick" data-act="kick" data-id="${p.id}" aria-label="Kick ${esc(p.name)}">✕ Kick</button></div>`).join("") || `<p class="muted">Waiting for players to join…</p>`}
            </div>
            <div class="settings">
              <div class="setting"><span>Game</span>
                <button class="pill ${settings.mode !== "cards" ? "on" : ""}" data-act="mode" data-val="party">🎉 Party Mix</button>
                <button class="pill ${settings.mode === "cards" ? "on" : ""}" data-act="mode" data-val="cards">🃏 Cards Against Sobriety</button></div>
              ${settings.mode === "cards" ? `<p class="muted small">Everyone holds 7 white cards on their phone. Each round one player's phone is the 👑 Card Czar (it passes round the room). Play a card, draw back up to 7. The Czar's favourite wins the black card — first to ${settings.target} black cards wins. Needs 3+ players.<br>${esc(CARDS_CREDIT)}</p>` : ""}
              ${settings.mode === "cards"
                ? `<div class="setting"><span>First to</span>${[5, 7, 10].map((n) => `<button class="pill ${settings.target === n ? "on" : ""}" data-act="target" data-val="${n}">${n} 🃏</button>`).join("")}</div>`
                : `<div class="setting"><span>Game length</span>${ROUND_LENGTHS.map(([n, label]) => `<button class="pill ${settings.rounds === n ? "on" : ""}" data-act="rounds" data-val="${n}">${label} · ${n}</button>`).join("")}</div>`}
              <div class="setting"><span>Timer</span>${[30, 45, 60, 90].map((n) => `<button class="pill ${settings.timer === n ? "on" : ""}" data-act="timer" data-val="${n}">${n}s</button>`).join("")}</div>
              <div class="setting"><span>${settings.mode === "cards" ? "Deck" : "Filth level"}</span>${settings.mode === "cards" ? toggle("filthy", "🔥 Full deck (4,000+ cards)", "😇 Family Edition") : toggle("filthy", "🔥 Filthy", "😇 Mild")}</div>
              ${settings.mode === "cards" ? "" : `<div class="setting"><span>Drinking buddies</span>${toggle("buddies", "🤝 On")}<span class="muted small">win a 🤝 buddy round to chain someone to your drinking</span></div>`}
              <div class="setting"><span>Rule Maker</span>${toggle("rules", "📜 On")}<span class="muted small">every ${RULE_EVERY} rounds the best player makes a house rule</span></div>
              <div class="setting"><span>Landlord voice</span>${toggle("voice", "🔊 On")}${settings.voice ? toggle("tvVoice", "📺 TV speaks", "📺 TV silent") : ""}</div>
              ${settings.voice ? `<p class="muted small">${gm.canSpeak() ? "" : "⚠️ This TV browser has no voice. "}No sound from the TV? On one phone, tap <b>🔈 Be the speaker</b> and the Landlord talks through that phone instead (or a Bluetooth speaker connected to it).</p>` : ""}
            </div>
            <button class="btn big" data-act="start" ${live.players.length < minPlayers(settings.mode) ? "disabled" : ""}>Everybody's in — start! 🍻</button>
            <p class="muted small">Adults only — ${settings.filthy ? "filthy mode is very much not safe for your nan" : "mild mode is safe-ish for your nan"}. Host wants to play too? Join from your phone as well. Drink responsibly — a "sip" can be anything, water counts.</p>
            <button class="btn ghost sm" data-act="new-room">New room</button>
          </div>
        </div>`;
        break;

      case "intro":
        body = `<div class="intro pop">
          <div class="intro-emoji">${info.emoji ?? "🍺"}</div>
          <h1>${esc(info.title)}</h1>
          <p class="rules">${esc(info.rules)}</p>
          ${cur.buddy ? `<p class="buddy-banner">🤝 BUDDY ROUND — win this and you choose a drinking buddy!</p>` : ""}
        </div>`;
        break;

      case "input":
      case "vote":
      case "twist":
      case "hotq":
      case "rule":
      case "hol":
      case "buddy":
      case "match": {
        const { kind, ids } = expected(room.phase, cur, live.players);
        const who = live.players.filter((p) => ids.includes(p.id));
        const done = new Set(live.subs.filter((x) => x.kind === (kind ?? "input")).map((x) => x.player_id));
        body = `<div class="stage">
          ${timerBar(st.deadline, st.span ?? st.settings.timer)}
          <div class="round-type">${info.emoji} ${esc(info.title)}</div>
          ${hostStage(room, cur, byId)}
          <div class="waiting-on">${who.map((p) => chip(p, done.has(p.id) ? "done" : "wait")).join("")}</div>
        </div>`;
        break;
      }

      case "reveal":
        body = `<div class="stage">${renderReveal(cur, info, byId)}</div>`;
        break;

      case "scores":
      case "final": {
        const cardsGame = st.settings?.mode === "cards";
        const wins = (p) => (cardsGame ? st.won?.[p.id]?.length ?? 0 : p.score);
        const ranked = [...live.players].sort((a, b) => wins(b) - wins(a));
        const thirsty = [...live.players].sort((a, b) => b.sips - a.sips)[0];
        const final = room.phase === "final";
        const winners = ranked.filter((p) => ranked[0] && wins(p) === wins(ranked[0]));
        body = `<div class="stage">
          <h1>${final ? "🏆 Final scores 🏆" : "Leaderboard"}</h1>
          ${final && winners.length ? `<div class="winner pop"><div class="row">${winners.map((p) => avatar(p, "xl")).join("")}</div>
            <div><b>${winners.map((p) => esc(p.name)).join(" & ")}</b> win${winners.length === 1 ? "s" : ""}!</div></div>` : ""}
          <ol class="board">${ranked.map((p, i) => `<li class="pop" style="animation-delay:${i * 60}ms">
              <span class="rank">${i + 1}</span>${avatar(p)}<span class="name">${esc(p.name)}</span>
              <span class="sips">🍺 ${p.sips}</span><span class="score">${cardsGame ? `${st.won?.[p.id]?.length ?? 0} 🃏` : p.score}</span></li>`).join("")}</ol>
          ${final && cardsGame && winners[0] ? `<div class="won-cards">${(st.won?.[winners[0].id] ?? []).map((t) => `<div class="black-card xs">${esc(t)}</div>`).join("")}</div>` : ""}
          ${final && thirsty?.sips ? `<p class="award">🍺 Thirstiest player: <b>${esc(thirsty.name)}</b> with ${sipsText(thirsty.sips)}</p>` : ""}
          ${final ? `<div class="row"><button class="btn big" data-act="lobby">Play again</button><button class="btn ghost" data-act="new-room">New room</button></div>` : ""}
        </div>`;
        break;
      }
    }
    app.innerHTML = `<div class="host">${header}<main>${body}</main>${room.phase === "lobby" ? "" : rulesBanner(st)}${controls}</div>`;

    const qr = $("#qr");
    if (qr && window.qrcode) {
      const q = window.qrcode(0, "M");
      q.addData(joinUrl);
      q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }
  }

  // What the TV shows while phones are busy (answering, voting, fighting).
  function hostStage(room, cur, byId) {
    const phase = room.phase;
    const name = (id) => esc(byId[id]?.name ?? "?");
    const cards = (items) => `<div class="answers">${items.map((t, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${esc(t)}</div>`).join("")}</div>`;
    const themed = newGameStage(phase, cur, byId);
    if (themed) return themed;
    if (phase === "match") {
      const m = cur.match;
      const side = (e) => (cur.type === "tee" ? shirt(drawingOf(live.subs, e.img), e.text) : `<div class="answer">${esc(e.text)}</div>`);
      return `<h2 class="kicker">${esc(m.label)}</h2>${cur.type === "brawl" ? `<h2 class="prompt sm">${esc(cur.prompt)}</h2>` : ""}
        <div class="versus"><div class="fighter a pop">${side(m.a)}</div><div class="vs">VS</div><div class="fighter b pop">${side(m.b)}</div></div>
        <p class="kicker">Tap your favourite on your phone!</p>`;
    }
    if (phase === "buddy") {
      return `<div class="spotlight pop">${avatar(byId[cur.maker], "xl")}<div>🤝 ${name(cur.maker)} won the buddy round!</div></div>
        <p class="rules">They're choosing a drinking buddy on their phone. Whenever ${name(cur.maker)} drinks, their buddy drinks too — for the rest of the game.</p>`;
    }
    if (phase === "hol") {
      return `<p class="muted">Question ${cur.q.i + 1} of ${cur.qs.length}</p><h1 class="prompt">${esc(cur.q.q)}</h1>
        <p class="kicker hol-than">Higher or lower than <b>${esc(cur.q.than)}</b>?</p>`;
    }
    if (cur.type === "drawful" && phase !== "input") {
      const art = shirtless(drawingOf(live.subs, cur.drawer));
      if (phase === "twist") return `${art}<p class="kicker">🎨 By ${name(cur.drawer)}. What is it? Write a fake title on your phone!</p>`;
      if (phase === "vote") return `${art}<p class="kicker">Which is the REAL title? Vote on your phone!</p>
        <div class="answers">${(cur.options ?? []).map((o, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${esc(o.text)}</div>`).join("")}</div>`;
    }
    if (cur.type === "imposter" && phase === "vote") {
      const clues = live.subs.filter((x) => x.kind === "input");
      return `<h2 class="prompt sm">🕵️ Category: ${esc(cur.prompt)}</h2><p class="kicker">Here are the clues. Who's the imposter? Vote on your phone!</p>
        <div class="answers">${live.players.map((p, i) => {
          const c = clues.find((x) => x.player_id === p.id)?.value?.text;
          return `<div class="answer pop" style="animation-delay:${i * 80}ms"><div class="a-meta">${chip(p)}</div><div class="a-text">${esc(c ?? "…nothing")}</div></div>`;
        }).join("")}</div>`;
    }
    if (phase === "rule") {
      return `<div class="spotlight pop">${avatar(byId[cur.maker], "xl")}<div>📜 ${name(cur.maker)} is the Rule Maker!</div></div>
        <p class="rules">They're choosing a house rule on their phone. It lasts ${RULE_ROUNDS} rounds. Break it and anyone can snitch.</p>`;
    }
    if (phase === "hotq") {
      return `<div class="spotlight pop">${avatar(byId[cur.victim], "xl")}<div>🔥 ${name(cur.victim)} is in the Hot Seat</div></div>
        <p class="muted">Question ${cur.q.i + 1} of ${cur.qs.length} · anonymous</p>
        <h1 class="prompt">${esc(cur.q.text)}</h1>
        <p class="kicker">${name(cur.victim)}, answer out loud! Everyone else: truth 😇 or lie 🤥?</p>`;
    }
    if (phase === "twist")
      return netWindow(`<div class="net-hero"><h1>Everyone's been handed someone else's answer…</h1><p>Now say where it was <b>really</b> posted.</p></div>`,
        "Twist someone's answer on your phone. Make it hurt. 😈", "twist");
    if (phase === "vote") {
      switch (cur.type) {
        case "fib":
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">Which one is the TRUTH? Vote on your phone!</p>${cards((cur.options ?? []).map((o) => o.text))}`;
        case "trivia":
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">✅ ${esc(cur.answer)}</p>
            <h1 class="chamber-title">☠️ THE DRINKING CHAMBER ☠️</h1>
            <p class="rules">${cur.game === "glasses" ? "Four glasses. One is spiked. Pick one on your phone — whoever picks the spiked glass drinks 3." : "Pick a number from 1 to 5. If anyone else picks the same number, you both drink 3."}</p>`;
        case "tee":
          return `<h1 class="prompt">Make your shirt!</h1><p class="kicker">Pick a drawing and a slogan — made by your mates — on your phone.</p>`;
        case "sti":
          return netWindow(stiCards(cur.posts ?? [], byId, false), "Vote for the most out-of-context post on your phone!", "social-media");
        case "cards":
          return `${blackCard(cur.prompt, cur.pick)}<p class="kicker">👑 ${name(cur.czar)} is choosing…</p>
            <div class="answers">${(cur.plays ?? []).map((p, i) => `<div class="answer pop" style="animation-delay:${i * 80}ms">${filled(cur.prompt, p.cards)}</div>`).join("")}</div>`;
        default:
          return `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">Vote for your favourite on your phone!</p>${cards((cur.answers ?? []).map((a) => a.text))}`;
      }
    }
    // Answering.
    switch (cur.type) {
      case "wyr":
        return `<h2 class="kicker">Would you rather…</h2>
          <div class="wyr"><div class="wyr-opt a">${esc(cur.prompt[0])}</div><div class="or">OR</div><div class="wyr-opt b">${esc(cur.prompt[1])}</div></div>`;
      case "year":
        return `<h2 class="kicker">What year?</h2><h1 class="prompt">${esc(cur.prompt)}</h1><p class="kicker">Type your guess on your phone!</p>`;
      case "trivia":
        return `<h1 class="prompt">${esc(cur.prompt)}</h1>${cards(cur.options)}<p class="kicker">Get it wrong and you enter the Drinking Chamber…</p>`;
      case "roles":
        return `<h1 class="prompt">${esc(cur.prompt)}</h1><div class="role-list">${cur.roles.map((r) => `<span class="role ${r === cur.drink ? "drink-role" : ""}">${esc(r)}${r === cur.drink ? " 🍺" : ""}</span>`).join("")}</div>
          <p class="kicker">Match each one to a mate on your phone!</p>`;
      case "tee":
        return `<h1 class="prompt">Design a T-shirt!</h1><p class="kicker">Draw a picture and write a slogan on your phone. Everything gets mixed up later…</p>`;
      case "sti":
        return netWindow(`<div class="net-hero"><h1>Answer your question on your phone.</h1><p>Honestly. Innocently. What could possibly go wrong?</p></div>`,
          "Answer honestly on your phone 📱", "welcome");
      case "imposter":
        return `<h1 class="prompt">🕵️ One of you is the imposter…</h1><p class="kicker">Check your phone for the secret word, and type a one-word clue. Imposter: blend in.</p>`;
      case "drawful":
        return `<div class="spotlight pop">${avatar(byId[cur.drawer], "xl")}<div>🎨 ${name(cur.drawer)} is drawing something secret…</div></div><p class="kicker">No peeking at their phone!</p>`;
      case "hot":
        return `<div class="spotlight pop">${avatar(byId[cur.victim], "xl")}<div>🔥 ${name(cur.victim)} is in the Hot Seat!</div></div>
          <p class="kicker">Everyone else: write them a question on your phone. Make it hurt.</p>`;
      case "cards":
        return `${blackCard(cur.prompt, cur.pick)}<p class="kicker">👑 Card Czar: ${name(cur.czar)} — everyone else, play ${cur.pick === 1 ? "a card" : `${cur.pick} cards`} from your phone!</p>`;
      default: {
        const hint = {
          likely: "Vote on your phone!",
          nhie: "Answer honestly on your phone…",
          quip: "Write your funniest answer on your phone!",
          brawl: "Write an answer — then they fight!",
          fib: "Write a convincing LIE on your phone!",
        }[cur.type];
        return `<h1 class="prompt">${esc(cur.prompt)}</h1><p class="kicker">${hint ?? ""}</p>`;
      }
    }
  }

  // ------------------------------------------------------------ Pub Poll, Spiked, Interview, Sort, Rap

  // A pie chart for Pub Poll: `pct` filled, with a big number in the middle.
  const pie = (pct, label, cls = "") =>
    `<div class="pie pop ${cls}" style="--p:${pct ?? 0}"><div class="pie-in"><b>${pct === null ? "?" : `${esc(pct)}%`}</b>${label ? `<small>${label}</small>` : ""}</div></div>`;

  const TEAM = [{ name: "Red", cls: "red", emoji: "🔴" }, { name: "Blue", cls: "blue", emoji: "🔵" }];

  // Pub Sort: a team's panel (players, with a crown on the captain), optionally with their order.
  function sortTeam(cur, t, byId, order = null, correct = null) {
    const team = cur.teams?.[t] ?? [];
    return `<div class="sort-team ${TEAM[t].cls} pop">
      <h2>${TEAM[t].emoji} ${TEAM[t].name} team</h2>
      <div class="sort-players">${team.map((id) => `${id === cur.captains?.[t] ? "👑" : ""}${chip(byId[id])}`).join(" ")}</div>
      ${order && !order.length ? `<p class="muted">❄️ The captain froze</p>` : ""}
      ${order?.length ? `<ol class="sort-list">${order.map((i, pos) => `<li class="${correct[pos] === i ? "ok" : "bad"}">${correct[pos] === i ? "✅" : "❌"} ${esc(cur.items[i].name)}</li>`).join("")}</ol>` : ""}
    </div>`;
  }

  // A rap verse: the opening line plus the player's line.
  const verse = (e) => `<div class="verse"><span class="verse-open">${esc(e.opener?.line ?? "")}</span><span class="verse-line">${esc(e.text)}</span></div>`;

  // The TV while phones are busy, for the newer games (null = not one of these).
  function newGameStage(phase, cur, byId) {
    const name = (id) => esc(byId[id]?.name ?? "?");
    switch (cur.type) {
      case "poll":
        if (phase === "input")
          return `<div class="poll-board"><div class="poll-head">📊 THE PUB POLL</div><h1 class="prompt">${esc(cur.prompt)}</h1>
            <div class="poll-row">${pie(null, "")}<div class="spotlight pop">${avatar(byId[cur.pollster], "xl")}<div>${name(cur.pollster)} is guessing…</div></div></div></div>`;
        if (phase === "vote")
          return `<div class="poll-board"><div class="poll-head">📊 THE PUB POLL</div><h1 class="prompt">${esc(cur.prompt)}</h1>
            <div class="poll-row">${pie(cur.guess, `${name(cur.pollster)}'s guess`)}
            <p class="kicker poll-ask">${cur.guessed ? `${name(cur.pollster)} says <b>${cur.guess}%</b>` : `${name(cur.pollster)} fell asleep, so it's <b>50%</b>`}.<br>Higher ⬆️ or lower ⬇️? Call it on your phone!</p></div></div>`;
        return null;
      case "spiked":
        if (phase === "input")
          return `<div class="lab pop"><div class="lab-emoji">🧪</div><h1 class="prompt">Someone's been spiked…</h1>
            <p class="kicker">Answer the question on your phone. One of you got a <b>different</b> question. Blend in.</p></div>`;
        if (phase === "vote") {
          const answers = live.subs.filter((x) => x.kind === "input");
          return `<div class="lab-q">The question was: <b>${esc(cur.prompt)}</b></div>
            <p class="kicker">One of these answers doesn't fit. Who's been spiked? Vote on your phone!</p>
            <div class="lab-grid">${live.players.map((p, i) => {
              const a = answers.find((x) => x.player_id === p.id)?.value?.text;
              return `<div class="lab-card pop" style="--c:${esc(p.color)};animation-delay:${i * 90}ms">${avatar(p, "net")}<div><div class="net-name">${esc(p.name)}</div><div class="lab-answer">${esc(a ?? "…nothing")}</div></div></div>`;
            }).join("")}</div>`;
        }
        return null;
      case "sort":
        if (phase === "input")
          return `<h1 class="prompt">${esc(cur.prompt)}</h1>
            <div class="sort-board">${sortTeam(cur, 0, byId)}
              <div class="sort-items">${cur.items.map((it, i) => `<div class="sort-item pop" style="animation-delay:${i * 90}ms">${esc(it.name)}</div>`).join("")}</div>
              ${sortTeam(cur, 1, byId)}</div>
            <p class="kicker">👑 Captains: sort them on your phone. Everyone else: SHOUT at your captain!</p>`;
        return null;
      case "job":
        if (phase === "input")
          return `<div class="cv pop"><div class="cv-head">💼 BULLSH*T INTERVIEW · Application form</div>
            <h1>First, a few icebreakers…</h1><p>Answer yours on your phone in <b>full sentences</b>.<br>Your words will be used against you.</p></div>`;
        if (phase === "twist")
          return `<div class="cv pop"><div class="cv-head">💼 BULLSH*T INTERVIEW · The interview</div>
            <p class="cv-label">The panel asks:</p><h1>${esc(cur.prompt)}</h1>
            <p>Build your answer on your phone — using only your mates' words.</p></div>`;
        if (phase === "vote")
          return `<div class="cv-q">💼 <b>${esc(cur.prompt)}</b></div><p class="kicker">Who gets the job? Vote on your phone!</p>
            <div class="cv-grid">${(cur.answers ?? []).map((a, i) => `<div class="cv-card pop" style="animation-delay:${i * 100}ms">“${esc(a.text)}”</div>`).join("")}</div>`;
        return null;
      case "rap":
        if (phase === "input")
          return `<div class="rap-stage pop"><div class="rap-mic">🎤</div><p class="rap-label">Tonight's theme</p><h1 class="prompt">${esc(cur.prompt)}</h1>
            <p class="kicker">Finish your verse on your phone. It has to rhyme!</p></div>`;
        if (phase === "match" && cur.match) {
          const m = cur.match;
          return `<div class="rap-stage"><p class="rap-label">${esc(m.label)} · ${esc(cur.prompt)}</p>
            <div class="rap-versus"><div class="rap-side red pop">${avatar(byId[m.a.pid], "lg")}<b>${name(m.a.pid)}</b>${verse(m.a)}</div>
            <div class="vs">VS</div>
            <div class="rap-side blue pop">${avatar(byId[m.b.pid], "lg")}<b>${name(m.b.pid)}</b>${verse(m.b)}</div></div>
            <p class="kicker">Listen to the Landlord, then vote on your phone! 🎤</p></div>`;
        }
        return null;
    }
    return null;
  }

  // Wheel of Doom: an SVG wheel that spins to land on segment `index` (the pointer is at the top).
  function wheelSvg(index) {
    const n = WHEEL.length;
    const slice = 360 / n;
    const colours = ["#ff4f79", "#ffb400", "#3ddc97", "#4cc9f0", "#b388ff", "#ff8a3d"];
    const seg = (i) => {
      const a0 = ((i * slice - 90) * Math.PI) / 180;
      const a1 = (((i + 1) * slice - 90) * Math.PI) / 180;
      const mid = (((i + 0.5) * slice - 90) * Math.PI) / 180;
      return `<path d="M100 100 L${100 + 95 * Math.cos(a0)} ${100 + 95 * Math.sin(a0)} A95 95 0 0 1 ${100 + 95 * Math.cos(a1)} ${100 + 95 * Math.sin(a1)} Z" fill="${colours[i % colours.length]}" stroke="#1a0b2e" stroke-width="1.5"/>
        <text x="${100 + 64 * Math.cos(mid)}" y="${100 + 64 * Math.sin(mid)}" font-size="16" text-anchor="middle" dominant-baseline="middle">${WHEEL[i].emoji}</text>`;
    };
    // Five full turns, then stop with the chosen segment's middle under the pointer.
    const turn = 5 * 360 + (360 - (index + 0.5) * slice);
    return `<div class="wheel-wrap"><div class="wheel-pointer">▼</div>
      <svg class="wheel" viewBox="0 0 200 200" style="--turn:${turn}deg">${WHEEL.map((_, i) => seg(i)).join("")}<circle cx="100" cy="100" r="14" fill="#1a0b2e"/></svg></div>`;
  }
  const wheelLabel = (seg, spin, byId) => String(seg?.label ?? "").replace("{name}", byId[spin?.victim]?.name ?? "Someone");

  // A What is it? drawing, framed.
  const shirtless = (src, extra = "") => {
    const img = safeImg(src);
    return img ? `<div class="drawing pop ${extra}"><img src="${img}" alt="The drawing"></div>` : `<p class="muted">(no drawing)</p>`;
  };

  // House rules and drinking buddies in force, shown in the corner of the TV.
  function rulesBanner(st) {
    const active = (st.rules ?? []).filter((r) => r.until > st.idx);
    const byId = Object.fromEntries(live.players.map((p) => [p.id, p]));
    const buddies = (st.buddies ?? []).filter((b) => byId[b.a] && byId[b.b]);
    if (!active.length && !buddies.length) return "";
    return `<aside class="rules-banner">${active.length ? `<b>📜 House rules</b>${active.map((r) => `<div class="rule-item">${esc(r.text)}
      <small>— ${esc(byId[r.by]?.name ?? "?")} · ${r.until - st.idx} round${r.until - st.idx === 1 ? "" : "s"} left</small></div>`).join("")}` : ""}
      ${buddies.length ? `<b>🤝 Drinking buddies</b>${buddies.map((b) => `<div class="rule-item">${esc(byId[b.b].name)} drinks when ${esc(byId[b.a].name)} drinks</div>`).join("")}` : ""}</aside>`;
  }

  // Cards Against Sobriety: the black card, and a black card filled in with white cards.
  function blackCard(text, pick) {
    return `<div class="black-card pop">${esc(text).replace(/___/g, "<span class=\"blank\">______</span>")}${pick > 1 ? `<div class="pick">PICK ${pick}</div>` : ""}</div>`;
  }
  function filled(text, cards) {
    const whites = cards.map((c) => `<b class="white-fill">${esc(String(c).replace(/[.!?]$/, ""))}</b>`);
    if (!String(text).includes("___")) return `${esc(text)} ${whites.join(" / ")}`;
    let i = 0;
    return esc(text).replace(/___/g, () => whites[i++] ?? "___");
  }

  // Out of Context is dressed as an old web browser (like Survive the Internet), big enough to read
  // from the sofa: a title bar, an address bar with the room code, the page, and a banner along the bottom.
  function netWindow(inner, banner, page) {
    return `<div class="net-window pop">
      <div class="net-title"><span>📱 Out of Context</span><span class="net-btns"><i>–</i><i>✕</i></span></div>
      <div class="net-bar"><span class="net-nav">◀ ▶ ✖ ⟳ 🏠</span>
        <div class="net-url">🌐 www.outofcontext.lol/${esc(page)}</div><div class="net-code"><small>join code</small>${code}</div></div>
      <div class="net-body">${inner}</div>
      ${banner ? `<div class="net-banner">${banner}</div>` : ""}
    </div>`;
  }

  // One card per post: whose innocent answer it was, what they said, and the twist in big letters.
  function stiCards(posts, byId, reveal) {
    const cols = posts.length > 4 ? 3 : 2;
    return `<div class="net-grid" style="--cols:${cols}">${posts.map((x, i) => {
      const p = byId[x.from];
      return `<div class="net-card pop ${reveal && x.winner ? "win" : ""}" style="--c:${esc(p?.color ?? "#888")};animation-delay:${i * 120}ms">
        <div class="net-head">${avatar(p, "net")}<div><div class="net-name">${esc(p?.name ?? "Someone")}</div><div class="net-answer">${esc(x.answer)}</div></div></div>
        <div class="net-ctx">↳ posted as ${esc(x.context)}</div>
        <div class="net-twist">${esc(x.text)}</div>
        ${reveal ? `<div class="net-meta">twisted by ${chip(byId[x.pid])} · <b>${x.voters.length}</b> vote${x.voters.length === 1 ? "" : "s"} ${x.winner ? "👑" : ""}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function renderReveal(cur, info, byId) {
    const name = (id) => esc(byId[id]?.name ?? "?");
    const v = cur.view ?? {};
    let main = "";
    switch (cur.type) {
      case "social":
        return `<div class="intro pop"><div class="intro-emoji">🍻</div><h1 class="prompt">${esc(cur.prompt)}</h1></div>`;
      case "likely":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          ${v.losers?.length ? `<div class="spotlight pop">${v.losers.map((id) => avatar(byId[id], "xl")).join("")}
            <div>${v.losers.map(name).join(" & ")}!</div></div>` : `<p>Nobody voted?!</p>`}
          <div class="tally">${(v.tally ?? []).map((t) => `<div class="tally-row">${chip(byId[t.pid])}
            <span class="bar" style="--n:${t.voters.length}"></span><span class="voters">${t.voters.map(name).join(", ")}</span></div>`).join("")}</div>`;
        break;
      case "nhie":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="split"><div><h3>I have 🍺</h3>${(v.have ?? []).map((id) => chip(byId[id])).join("") || `<p class="muted">Liars, all of you.</p>`}</div>
          <div><h3>Never 😇</h3>${(v.never ?? []).map((id) => chip(byId[id])).join("") || `<p class="muted">Nobody!</p>`}</div></div>`;
        break;
      case "wyr":
        main = `<div class="split">${[0, 1].map((i) => `<div><h3>${esc(cur.prompt[i])}</h3>
          <div class="count">${v.sides?.[i]?.length ?? 0}</div>${(v.sides?.[i] ?? []).map((id) => chip(byId[id])).join("")}</div>`).join("")}</div>
          ${v.tie ? `<p class="kicker">Dead even! Everyone drinks!</p>` : ""}`;
        break;
      case "quip":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="answers results">${(v.results ?? []).map((a, i) => `<div class="answer pop ${a.winner ? "win" : ""}" style="animation-delay:${i * 150}ms">
            <div class="a-text">${esc(a.text)}</div>
            <div class="a-meta">${chip(byId[a.pid])} <b>${a.voters.length}</b> vote${a.voters.length === 1 ? "" : "s"} ${a.winner ? "👑" : ""}</div></div>`).join("") || `<p>No answers?! Everybody drinks.</p>`}</div>`;
        break;
      case "fib":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="answers results">${(v.options ?? []).map((o, i) => `<div class="answer pop ${o.truth ? "truth" : ""}" style="animation-delay:${i * 150}ms">
            <div class="a-text">${o.truth ? "✅ " : "🤥 "}${esc(o.text)}</div>
            <div class="a-meta">${o.truth ? "<b>THE TRUTH</b>" : `Lie by ${o.pids.map((id) => chip(byId[id])).join("")}`}</div>
            <div class="a-meta small">${o.pickers.length ? `Picked by ${o.pickers.map(name).join(", ")}` : "Nobody fell for it"}</div></div>`).join("")}</div>`;
        break;
    }
    switch (cur.type) {
      case "year":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2><div class="bigyear pop">${cur.year}</div>
          <div class="tally">${(v.guesses ?? []).map((g) => `<div class="tally-row">${chip(byId[g.pid])} <b>${g.year}</b>
            <span class="voters">${g.miss === 0 ? "BANG ON!" : `${g.miss} year${g.miss === 1 ? "" : "s"} out`}</span></div>`).join("") || `<p>No guesses?!</p>`}</div>`;
        break;
      case "trivia":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2><p class="kicker">✅ ${esc(cur.answer)}</p>
          ${v.correct?.length ? `<p>Got it right: ${v.correct.map((id) => chip(byId[id])).join("")}</p>` : ""}
          ${(v.results ?? []).length ? `<h2 class="chamber-title">☠️ The Drinking Chamber</h2>
            ${cur.game === "glasses" ? `<p class="muted">The spiked glass was number ${cur.spiked + 1}.</p>` : ""}
            <div class="tally">${v.results.map((r) => `<div class="tally-row">${chip(byId[r.pid])}
              <span>${r.pick === undefined ? "—" : cur.game === "glasses" ? `glass ${r.pick + 1}` : `picked ${r.pick}`}</span>
              <b>${r.dead ? `💀 ${esc(r.dead)}` : "😅 Survived"}</b></div>`).join("")}</div>` : `<p class="kicker">Everyone survived!</p>`}`;
        break;
      case "roles":
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="tally">${(v.crowned ?? []).map((c) => `<div class="tally-row"><span class="role ${c.role === cur.drink ? "drink-role" : ""}">${esc(c.role)}</span>
            ${c.holders.length ? c.holders.map((h) => chip(byId[h])).join("") : `<span class="muted">nobody</span>`}
            <span class="voters">${c.holders.map((h) => `${c.tally[h].length} vote${c.tally[h].length === 1 ? "" : "s"}`).join(", ")}</span></div>`).join("")}</div>`;
        break;
      case "brawl":
      case "tee": {
        const tee = cur.type === "tee";
        const c = v.champion;
        main = `${tee ? "" : `<h2 class="prompt sm">${esc(cur.prompt)}</h2>`}
          ${c ? `<div class="spotlight pop">🏆 CHAMPION 🏆</div>${tee ? shirt(drawingOf(live.subs, c.img), c.text, "big") : `<div class="answer win">${esc(c.text)}</div>`}
            <p>${tee ? `Made by ${chip(byId[c.pid])} · drawn by ${chip(byId[c.img])} · slogan by ${chip(byId[c.by])}` : `by ${chip(byId[c.pid])}`}</p>` : `<p>No entries?! Everybody drinks.</p>`}
          <div class="tally">${(v.history ?? []).map((h) => `<div class="tally-row"><span class="muted">${esc(h.label)}</span> ${chip(byId[h.winner])} beat ${chip(byId[h.loser])}
            <span class="voters">${Math.max(h.va.length, h.vb.length)}–${Math.min(h.va.length, h.vb.length)}</span></div>`).join("")}</div>`;
        break;
      }
      case "sti":
        main = netWindow((v.results ?? []).length ? stiCards(v.results, byId, true) : `<div class="net-hero"><h1>No twists?!</h1><p>Everybody drinks.</p></div>`,
          (v.results ?? []).find((x) => x.winner) ? `👑 Most out of context: ${esc(byId[v.results.find((x) => x.winner).pid]?.name ?? "?")}` : "The internet has spoken.", "results");
        break;
      case "hot":
        main = `<div class="spotlight pop">${avatar(byId[cur.victim], "xl")}<div>🔥 ${name(cur.victim)}'s verdicts</div></div>
          <div class="tally">${(v.results ?? []).map((q) => `<div class="tally-row"><span class="hot-q">${esc(q.text)}</span>
            <b>${q.refused ? "🍺 Refused" : q.lie.length > q.truth.length ? `🤥 LIE (${q.lie.length}–${q.truth.length})` : `😇 Truth (${q.truth.length}–${q.lie.length})`}</b></div>`).join("") || `<p>Nobody asked anything?! Cowards. Everybody drinks.</p>`}</div>`;
        break;
      case "imposter":
        main = `<h2 class="prompt sm">The word was <b>${esc(cur.word)}</b> (${esc(cur.prompt)})</h2>
          <div class="spotlight pop">${avatar(byId[cur.imposter], "xl")}<div>🕵️ ${name(cur.imposter)} was the imposter — ${v.caught ? "CAUGHT!" : "and got away with it!"}</div></div>
          <div class="tally">${(v.clues ?? []).map((c) => `<div class="tally-row">${chip(byId[c.pid])}<b>${esc(c.text)}</b>
            <span class="voters">${(v.tally ?? []).find((t) => t.pid === c.pid)?.voters.length ?? 0} vote(s)</span></div>`).join("")}</div>`;
        break;
      case "drawful":
        main = `${shirtless(drawingOf(live.subs, cur.drawer), "sm")}<p class="kicker">It was: <b>${esc(cur.prompt)}</b> — drawn by ${chip(byId[cur.drawer])}</p>
          <div class="answers results">${(v.options ?? []).map((o, i) => `<div class="answer pop ${o.truth ? "truth" : ""}" style="animation-delay:${i * 150}ms">
            <div class="a-text">${o.truth ? "✅ " : "🤥 "}${esc(o.text)}</div>
            <div class="a-meta">${o.truth ? "<b>THE REAL ONE</b>" : `Fake by ${o.pids.map((id) => chip(byId[id])).join("")}`}</div>
            <div class="a-meta small">${o.pickers.length ? `Picked by ${o.pickers.map(name).join(", ")}` : "Nobody picked it"}</div></div>`).join("")}</div>`;
        break;
      case "poll": {
        const who = (ids) => ids.map((id) => chip(byId[id])).join("") || `<span class="muted">nobody</span>`;
        main = `<div class="poll-board"><div class="poll-head">📊 THE PUB POLL — RESULTS</div><h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="poll-row">${pie(v.guess, `${name(cur.pollster)}'s guess`, "small")}<div class="poll-arrow">${v.truth === "higher" ? "⬆️" : v.truth === "lower" ? "⬇️" : "🎯"}</div>${pie(cur.pct, "the real answer", "truth")}</div>
          ${cur.note ? `<p class="muted">${esc(cur.note)}</p>` : ""}
          <div class="split"><div><h3>⬆️ Higher</h3>${who(v.calls?.higher ?? [])}</div><div><h3>⬇️ Lower</h3>${who(v.calls?.lower ?? [])}</div></div></div>`;
        break;
      }
      case "spiked": {
        const spiked = cur.spiked ?? [];
        main = `<div class="lab-q">The crew were asked: <b>${esc(cur.prompt)}</b><br>🧪 The spiked question: <b>${esc(cur.alt)}</b></div>
          <div class="spotlight pop">${spiked.map((id) => avatar(byId[id], "xl")).join("")}<div>🧪 ${spiked.map(name).join(" & ")} ${spiked.length === 1 ? "was" : "were"} spiked — ${v.caught?.length === spiked.length ? "CAUGHT!" : v.caught?.length ? "one got caught!" : "and got away with it!"}</div></div>
          <div class="lab-grid">${(v.answers ?? []).map((a) => `<div class="lab-card ${spiked.includes(a.pid) ? "spiked" : ""}" style="--c:${esc(byId[a.pid]?.color ?? "#888")}">
            ${avatar(byId[a.pid], "net")}<div><div class="net-name">${name(a.pid)} ${spiked.includes(a.pid) ? "🧪" : ""}</div><div class="lab-answer">${esc(a.text)}</div>
            <div class="muted small">${(v.tally?.[a.pid] ?? []).length} vote(s)</div></div></div>`).join("")}</div>`;
        break;
      }
      case "job":
        main = `<div class="cv-q">💼 <b>${esc(cur.prompt)}</b></div>
          <div class="cv-grid">${(v.results ?? []).map((a, i) => `<div class="cv-card pop ${a.winner ? "win" : ""}" style="animation-delay:${i * 150}ms">“${esc(a.text)}”
            <div class="a-meta">${chip(byId[a.pid])} <b>${a.voters.length}</b> vote${a.voters.length === 1 ? "" : "s"} ${a.winner ? "💼 HIRED" : ""}</div>
            ${a.from?.length ? `<div class="a-meta small muted">words by ${a.from.map(name).join(", ")}</div>` : ""}</div>`).join("") || `<p>Nobody applied?! Everybody drinks.</p>`}</div>`;
        break;
      case "sort": {
        const correct = v.correct ?? [];
        main = `<h2 class="prompt sm">${esc(cur.prompt)}</h2>
          <div class="sort-board">${sortTeam(cur, 0, byId, v.res?.[0]?.order ?? [], correct)}
            <div class="sort-items answer-key"><h3>The right order</h3>${correct.map((i, pos) => `<div class="sort-item pop" style="animation-delay:${pos * 120}ms"><b>${pos + 1}.</b> ${esc(cur.items[i].name)} <small>${esc(String(cur.items[i].v))}${esc(cur.unit ?? "")}</small></div>`).join("")}</div>
            ${sortTeam(cur, 1, byId, v.res?.[1]?.order ?? [], correct)}</div>
          <div class="spotlight pop">${v.winner === null ? "🤝 Dead heat! Everybody drinks." : `${TEAM[v.winner].emoji} ${TEAM[v.winner].name} team wins, ${v.res[v.winner].right}–${v.res[1 - v.winner].right}!`}</div>`;
        break;
      }
      case "rap": {
        const c = v.champion;
        main = `<div class="rap-stage">${c ? `<div class="spotlight pop">🎤 RAP BATTLE CHAMPION 🎤</div>
          <div class="rap-side win pop">${avatar(byId[c.pid], "xl")}<b>${name(c.pid)}</b>${verse(c)}</div>` : `<p>No verses?! Everybody drinks.</p>`}
          <div class="tally">${(v.history ?? []).map((h) => `<div class="tally-row"><span class="muted">${esc(h.label)}</span> ${chip(byId[h.winner])} beat ${chip(byId[h.loser])}
            <span class="voters">${Math.max(h.va.length, h.vb.length)}–${Math.min(h.va.length, h.vb.length)}</span></div>`).join("")}</div></div>`;
        break;
      }
      case "hol":
        main = `<div class="tally">${(v.results ?? []).map((q) => `<div class="tally-row hol-row"><span class="hot-q">${esc(q.q)}: ${q.answer === "higher" ? "⬆️ HIGHER" : "⬇️ LOWER"} than ${esc(q.than)} <small class="muted">(${esc(q.fact)})</small></span>
          <span>✅ ${q.right.map(name).join(", ") || "nobody"}</span><span>❌ ${q.wrong.map(name).join(", ") || "nobody"}</span></div>`).join("")}</div>`;
        break;
      case "wheel":
        main = wheelSvg(cur.spin?.index ?? 0) + `<div class="wheel-result pop">${esc((v.segment?.emoji ?? "") + " " + wheelLabel(v.segment, cur.spin, byId))}</div>`;
        break;
      case "cards": {
        const plays = [...(v.plays ?? [])].sort((a, b) => (b.pid === v.win) - (a.pid === v.win) || (a.pid === v.worst) - (b.pid === v.worst));
        main = `<p class="kicker">👑 Czar: ${chip(byId[cur.czar])}</p>
          <div class="answers results">${plays.map((p, i) => `<div class="answer pop ${p.pid === v.win ? "win" : ""} ${p.pid === v.worst ? "worst" : ""}" style="animation-delay:${i * 120}ms">
            <div class="a-text">${filled(cur.prompt, p.cards)}</div>
            <div class="a-meta">${chip(byId[p.pid])} ${p.pid === v.win ? "👑 Czar's favourite" : p.pid === v.worst ? "💩 Czar's least favourite" : ""}</div></div>`).join("") || `<p>Nobody played a card?!</p>`}</div>`;
        break;
      }
    }
    const drinkers = Object.entries(cur.deltas ?? {}).filter(([, d]) => d.sips > 0);
    return `<div class="round-type">${info.emoji} ${esc(info.title)}</div>${main}
      ${drinkers.length ? `<div class="drink-list"><h2>🍺 Drink up!</h2>${drinkers
        .map(([id, d]) => `<div class="drink pop">${chip(byId[id])} <b>${sipsText(d.sips)}</b> <span class="muted">${esc(d.why.filter((w) => !POINT_REASONS.test(w)).join(", "))}</span></div>`)
        .join("")}</div>` : ""}`;
  }

  // A phone reports a rule-breaker: announce it and add a sip (one snitch per phone every 20s).
  const lastSnitch = new Map();
  async function onSnitch({ by, target } = {}) {
    const st = live.room?.state ?? {};
    const byP = live.players.find((p) => p.id === by);
    const target_ = live.players.find((p) => p.id === target);
    if (!byP || !target_ || by === target || !(st.rules ?? []).some((r) => r.until > st.idx)) return;
    if (Date.now() - (lastSnitch.get(by) ?? 0) < 20000) return;
    lastSnitch.set(by, Date.now());
    gm.line("snitch", { by: byP.name, name: target_.name });
    await api.apply(code, token, [{ id: target, score: 0, sips: 1 }]).catch(() => {});
  }

  let lastSig = "";
  let lastPhase = null;
  // Voices load asynchronously; refresh the lobby's "can this TV talk?" hint when they arrive.
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => live.room?.phase === "lobby" && render());

  watcher = watchRoom(code, (l) => {
    live = l;
    const sig = JSON.stringify([l.room, l.players, l.subs.map((s) => s.player_id + s.kind)]);
    if (sig !== lastSig) render();
    lastSig = sig;
    const phaseKey = l.room && `${l.room.phase}:${l.room.round}:${l.room.state?.cur?.match?.m ?? ""}:${l.room.state?.cur?.q?.i ?? ""}`;
    if (lastPhase !== null && phaseKey !== lastPhase && l.room) announce(l.room);
    lastPhase = phaseKey;
    step();
  }, { onSnitch });
  setInterval(() => step(), 500);
  return watcher;
}
