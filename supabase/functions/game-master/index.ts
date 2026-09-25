// The Landlord: AI game master for Last Orders.
// Keeps the Anthropic API key server-side. Only the host of a live room (proved by the
// room's host token) can call it, and each room gets a capped number of calls.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5";
const MAX_CALLS_PER_ROOM = 150;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PERSONA = `You are "The Landlord", the host of Last Orders — a Jackbox-style drinking game played by a group of adult friends in a living room. Your lines are read aloud by text-to-speech on the TV, so write only the spoken words: no stage directions, no emojis, no quotation marks around the whole line, no laughing at your own jokes.

Style: a British stand-up roasting the room, in the vein of Jimmy Carr — deadpan, dark, filthy, merciless one-liners. Short setup, sharp twist, done. Misdirection and double meanings over shock for its own sake. Roast the players by name for what they actually did: their answers, their votes, their confessions, how much they're drinking, their love lives, their life choices. Swearing and sexual innuendo are fine; these are consenting adults who asked for it.

Hard limits: never joke about race, ethnicity, religion, disability, sexuality or gender identity; nothing sexual involving minors; never push dangerous drinking (no "down the bottle" — sips only, and water counts). Punch at choices, not at who people are.`;

const FILTH = {
  true: "Filth level: FILTHY. Go as crude as you like within the hard limits.",
  false: "Filth level: MILD. Cheeky and savage, but keep it pre-watershed — no explicit sex.",
};

const TASKS: Record<string, string> = {
  welcome: "Open the game. Greet the players and roast at least two of them by name based on nothing but their names and the fact they turned up. 2-3 sentences, max 50 words.",
  reveal: "React to what just happened this round. Pick the funniest detail — a terrible answer, a guilty confession, someone who got fooled, whoever is drinking — and roast them by name. 1-2 sentences, max 40 words.",
  final: "The game is over. Crown the winner with a backhanded compliment, and roast whoever drank the most and whoever came last. 2-3 sentences, max 60 words.",
};

const PROMPTS_TASK = `Write fresh, original prompts for tonight's game, personalised for this group — work the players' names into about half of them (use their exact names). Make them funnier and more specific than generic party-game prompts.
- quips: 8 fill-in-the-blank prompts, each containing ___ exactly once (e.g. "The real reason Dave got banned from Wetherspoons: ___").
- likely: 6 "Who is most likely to…?" questions.
- nhie: 6 "Never have I ever…" statements.
- wyr: 5 would-you-rather dilemmas, each with two short options (no "would you rather" in the option text).`;

const PROMPTS_SCHEMA = {
  type: "object",
  properties: {
    quips: { type: "array", items: { type: "string" } },
    likely: { type: "array", items: { type: "string" } },
    nhie: { type: "array", items: { type: "string" } },
    wyr: {
      type: "array",
      items: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
        additionalProperties: false,
      },
    },
  },
  required: ["quips", "likely", "nhie", "wyr"],
  additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "not_configured" }, 503);

  let body: { code?: string; hostToken?: string; kind?: string; facts?: string; history?: string[]; filthy?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const { code = "", hostToken = "", kind = "", facts = "", history = [], filthy = true } = body;
  if (!(kind in TASKS) && kind !== "prompts") return json({ error: "bad_kind" }, 400);

  // Only the room's host may spend API credit, and only so much per room.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: calls, error: gateError } = await db.rpc("dg_gm_tick", { p_code: code, p_host_token: hostToken });
  if (gateError) return json({ error: "forbidden" }, 403);
  if (calls > MAX_CALLS_PER_ROOM) return json({ error: "limit" }, 429);

  const client = new Anthropic();
  const system = `${PERSONA}\n\n${FILTH[String(Boolean(filthy)) as "true" | "false"]}`;

  try {
    if (kind === "prompts") {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: PROMPTS_SCHEMA } },
        system,
        messages: [{ role: "user", content: `${PROMPTS_TASK}\n\n${String(facts).slice(0, 1000)}` }],
      });
      if (response.stop_reason === "refusal") return json({ prompts: null });
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const p = JSON.parse(text);
      return json({
        prompts: {
          quip: p.quips.filter((q: string) => q.includes("___")).slice(0, 12),
          likely: p.likely.slice(0, 10),
          nhie: p.nhie.slice(0, 10),
          wyr: p.wyr.map((w: { a: string; b: string }) => [w.a, w.b]).slice(0, 8),
        },
      });
    }

    const recent = history.slice(-8).map((l) => `- ${String(l).slice(0, 300)}`).join("\n");
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: [
        {
          role: "user",
          content: `${TASKS[kind]}\n\nWhat happened:\n${String(facts).slice(0, 3000)}\n\n${
            recent ? `Your earlier lines tonight (don't repeat them; call back to them only if it's funnier):\n${recent}\n\n` : ""
          }Reply with the spoken line only.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return json({ line: null });
    const line = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return json({ line: line || null });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (err instanceof Anthropic.APIError) {
      console.error("anthropic error", err.status, err.message);
      return json({ error: "upstream" }, 502);
    }
    console.error(err);
    return json({ error: "server" }, 500);
  }
});
