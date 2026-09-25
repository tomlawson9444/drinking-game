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

// The deck for this game: the Family Edition pack in mild mode, every other official pack otherwise.
export function cardDeck(data, family) {
  const packs = data.packs.filter((p) => p.family === family);
  const white = [...new Set(packs.flatMap((p) => p.white))].map((i) => data.white[i]);
  const black = [...new Set(packs.flatMap((p) => p.black))].map((i) => data.black[i]);
  return { white, black };
}
