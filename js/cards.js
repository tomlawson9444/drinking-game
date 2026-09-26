// Cards Against Sobriety uses the official Cards Against Humanity cards from
// JSON Against Humanity (https://github.com/crhallberg/json-against-humanity), built into
// data/cah.json by tools/build-cards.mjs. The cards are © Cards Against Humanity LLC,
// licensed CC BY-NC-SA 4.0: free, non-commercial use with credit.

export const HAND_SIZE = 7;
export const CARDS_CREDIT = "Cards: Cards Against Humanity (CC BY-NC-SA 4.0), via JSON Against Humanity.";

let loading = null;
export function loadCards() {
  loading ??= fetch(new URL("../data/cah.json", import.meta.url)).then((r) => {
    if (!r.ok) throw new Error("Couldn't load the cards");
    return r.json();
  });
  return loading;
}

// Packs a new screen starts with: every official pack except Family Edition (or just Family
// Edition, for a mild game).
export const defaultPacks = (data, family = false) => data.packs.filter((p) => p.family === family).map((p) => p.name);

// The deck for this game, from the packs picked on the deck picker (by name).
export function cardDeck(data, names) {
  const picked = new Set(names);
  const packs = data.packs.filter((p) => picked.has(p.name));
  const white = [...new Set(packs.flatMap((p) => p.white))].map((i) => data.white[i]);
  const black = [...new Set(packs.flatMap((p) => p.black))].map((i) => data.black[i]);
  return { white, black };
}

// Group the packs for the deck picker: the main game and its big expansions first, then the rest.
const CLASSIC = /^(CAH Base Set|CAH: Main Deck|CAH: (First|Second|Third|Fourth|Fifth|Sixth) Expansion|CAH: (Red|Green|Blue) Box Expansion|CAH: (UK|Canadian) Conversion Kit|Absurd Box Expansion|CAH: Box Expansion)$/;
const PROMO = /PAX|Gen Con|Retail|Desert Bus|Jack White|Exclusive|Procedurally|Panel Cards/;
export function packGroups(data) {
  const group = (p) => (p.family ? "family" : CLASSIC.test(p.name) ? "classic" : PROMO.test(p.name) ? "promo" : "themed");
  const groups = [
    { key: "classic", title: "🃏 The classic game", blurb: "The base set and the big expansions" },
    { key: "themed", title: "🎭 Themed packs", blurb: "Small packs on one topic — Food, Weed, Dad, Nostalgia…" },
    { key: "promo", title: "🎟️ Promos & oddities", blurb: "Convention and shop freebies" },
    { key: "family", title: "😇 Family Edition", blurb: "The clean version — don't mix it with the rest" },
  ];
  return groups.map((g) => ({ ...g, packs: data.packs.filter((p) => group(p) === g.key) }));
}
