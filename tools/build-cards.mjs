// Builds data/cah.json from JSON Against Humanity (https://github.com/crhallberg/json-against-humanity).
// Keeps the official Cards Against Humanity packs only, and black cards needing 1–3 answers.
//   git clone --depth 1 https://github.com/crhallberg/json-against-humanity /tmp/jah
//   node tools/build-cards.mjs /tmp/jah/cah-all-compact.json
// The cards are © Cards Against Humanity LLC, licensed CC BY-NC-SA 4.0 (non-commercial use, with credit).
import fs from "node:fs";

const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const white = [];
const black = [];
const wIndex = new Map();
const bIndex = new Map();
const packs = [];

for (const pack of src.packs.filter((p) => p.official)) {
  const w = [];
  const b = [];
  for (const i of pack.white) {
    const text = String(src.white[i]).trim();
    if (!text) continue;
    if (!wIndex.has(text)) wIndex.set(text, white.push(text) - 1);
    w.push(wIndex.get(text));
  }
  for (const i of pack.black) {
    const card = src.black[i];
    if (!(card.pick >= 1 && card.pick <= 3)) continue;
    const text = String(card.text).trim().replace(/_+/g, "___");
    if (!text) continue;
    if (!bIndex.has(text)) bIndex.set(text, black.push({ text, pick: card.pick }) - 1);
    b.push(bIndex.get(text));
  }
  if (w.length || b.length) packs.push({ name: pack.name, family: /Family Edition/i.test(pack.name), white: [...new Set(w)], black: [...new Set(b)] });
}

const out = {
  source: "https://github.com/crhallberg/json-against-humanity",
  license: "Cards Against Humanity cards, CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)",
  packs,
  white,
  black,
};
fs.writeFileSync(new URL("../data/cah.json", import.meta.url), JSON.stringify(out));
console.log(`${packs.length} packs, ${white.length} white, ${black.length} black`);
