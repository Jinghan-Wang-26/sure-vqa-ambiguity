import OpenAI from "openai";
import { AnswerResponse, DialogueState, Mode, SceneJSON } from "@/lib/types";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function buildOptionLabel(scene: SceneJSON, pick: { type: "object" | "group"; ref: string }): string {
  if (pick.type === "group") {
    const g = scene.salient_groups.find(x => x.group_name === pick.ref);
    return g ? `${g.group_name} (${g.spatial_summary})` : pick.ref;
  }
  const o = scene.objects.find(x => x.id === pick.ref);
  if (!o) return pick.ref;
  const attrs = o.attributes?.slice(0, 2).join(", ");
  const txt = o.visible_text?.length ? `text: ${o.visible_text.slice(0, 1).join(", ")}` : "";
  const extras = [attrs, txt].filter(Boolean).join("; ");
  return `${o.name} (${o.location}${extras ? `; ${extras}` : ""})`;
}

function topCandidates(scene: SceneJSON, k: number): { type: "object" | "group"; ref: string }[] {
  const picks: { type: "object" | "group"; ref: string }[] = [];
  for (const c of scene.ambiguity_candidates ?? []) {
    if (c.candidate_type === "object") picks.push({ type: "object", ref: c.ref });
    else picks.push({ type: "group", ref: c.ref });
  }
  // fallback: if candidates missing, pick top confident objects
  if (picks.length === 0) {
    const sorted = [...(scene.objects ?? [])].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    for (const o of sorted.slice(0, k)) picks.push({ type: "object", ref: o.id });
  }
  return picks.slice(0, k);
}

export async function POST(req: Request) {
  const body = await req.json();

  const mode: Mode = body.mode;
  const question: string = body.question ?? "";
  const sceneJsonText: string = body.sceneJsonText ?? "{}";
  const state: DialogueState = body.state ?? { turn: 0 };

  const scene = safeJsonParse<SceneJSON>(sceneJsonText);
  if (!scene || !scene.objects) {
    return Response.json({ error: "Invalid sceneJsonText; cannot parse SceneJSON." }, { status: 400 });
  }

  // One-pass: we can let the model write the final structured answer
  if (mode === "one_pass") {
    const onePassPrompt = body.onePassPrompt ?? null; // optional override

    const prompt = onePassPrompt ?? `
You will be given SCENE JSON and QUESTION.
Follow One-Pass instructions.

SCENE JSON:
${sceneJsonText}

QUESTION:
${question}
`;

    const r = await openai.responses.create({
      model: "gpt-5.1-chat-latest",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      reasoning: { effort: "low" },
    });

    const answerText = (r.output_text ?? "").trim();

    const resp: AnswerResponse = {
      mode: "one_pass",
      ambiguity_note: answerText.toLowerCase().includes("ambig")
        ? "Ambiguity noted in answer."
        : "If the question is ambiguous, the answer includes multiple plausible interpretations.",
      answer: answerText || "I couldn't generate an answer from the scene information.",
    };
    return Response.json(resp);
  }

  // Iterative: if user hasn't selected a candidate yet, we generate options + a follow-up question
  const turn = (state.turn ?? 0) + 1;
  const hasPick = !!state.selected_candidate;

  if (!hasPick) {
    const candidates = topCandidates(scene, 5);
    const options = candidates.map((p, i) => ({
      id: `opt${i + 1}`,
      label: buildOptionLabel(scene, p),
      pick: p,
    }));

    // Let model produce short “ambiguity surfacing” + follow-up question, but we control the options list
    const iterativePrompt = body.iterativePrompt ?? null;

    const prompt = iterativePrompt ?? `
You are in Iterative Clarification Mode.

SCENE JSON:
${sceneJsonText}

USER QUESTION:
${question}

The user has NOT specified which object/region they mean.
Write:
- a short initial answer that surfaces ambiguity
- a follow-up clarification question

Keep it concise and BLV-friendly.
Return JSON ONLY:

{
  "answer": "...",
  "follow_up_question": "..."
}
`;

    const r = await openai.responses.create({
      model: "gpt-5.1-chat-latest",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      reasoning: { effort: "low" },
    });

    const text = (r.output_text ?? "").trim();
    const partial = safeJsonParse<{ answer: string; follow_up_question: string }>(text) ?? {
      answer: "I see multiple possible things you could mean in the image.",
      follow_up_question: "Which one do you mean?",
    };

    const updated_state: DialogueState = { ...state, turn };

    const resp: AnswerResponse = {
      mode: "iterative",
      answer: partial.answer,
      follow_up_question: partial.follow_up_question,
      options,
      updated_state,
    };
    return Response.json(resp);
  }

  // If selected_candidate exists: give targeted detail
  const pick = state.selected_candidate!;
  const focus = state.detail_focus ?? "all";

  // Build a small grounded context from scene (no model hallucination)
  let targetSummary = "";
  if (pick.type === "object") {
    const o = scene.objects.find(x => x.id === pick.ref);
    if (o) {
      targetSummary =
        `Target object: ${o.name}\n` +
        `Location: ${o.location}\n` +
        `Count guess: ${o.count_guess}\n` +
        `Attributes: ${(o.attributes ?? []).join(", ") || "none"}\n` +
        `Visible text: ${(o.visible_text ?? []).join(", ") || "none"}\n` +
        `Confidence: ${o.confidence}`;
    } else {
      targetSummary = `Target object id not found: ${pick.ref}`;
    }
  } else {
    const g = scene.salient_groups.find(x => x.group_name === pick.ref);
    if (g) {
      const objs = g.object_ids.map(id => scene.objects.find(o => o.id === id)).filter(Boolean);
      targetSummary =
        `Target group: ${g.group_name}\n` +
        `Spatial summary: ${g.spatial_summary}\n` +
        `Objects in group:\n` +
        objs.map(o => `- ${(o as any).name} (${(o as any).location}) attrs: ${((o as any).attributes ?? []).slice(0,2).join(", ")}`).join("\n");
    } else {
      targetSummary = `Target group not found: ${pick.ref}`;
    }
  }

  const prompt = `
You are an accessibility-focused VQA assistant.
The user has selected a specific target (object or group).
Give a targeted answer to the user question, using ONLY the grounded target summary.

User question: ${question}

Detail focus: ${focus}

Grounded target summary:
${targetSummary}

Write a concise answer.
Then ask: "Do you want more detail (attributes/location/text) or are you satisfied?"
Return JSON ONLY:

{
  "answer": "...",
  "follow_up_question": "...",
  "options": [
    {"id":"more_attributes","label":"More about attributes","pick":{"type":"detail","ref":"attributes"}},
    {"id":"more_location","label":"More about location","pick":{"type":"detail","ref":"location"}},
    {"id":"more_text","label":"Read visible text","pick":{"type":"detail","ref":"text"}},
    {"id":"satisfied","label":"I'm satisfied","pick":{"type":"detail","ref":"done"}}
  ],
  "updated_state": { ... }
}
`;

  const r = await openai.responses.create({
    model: "gpt-5.1-chat-latest",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    reasoning: { effort: "low" },
  });

  const text = (r.output_text ?? "").trim();
  const parsed = safeJsonParse<any>(text);

  const updated_state: DialogueState = { ...state, turn };

  const resp: AnswerResponse = {
    mode: "iterative",
    answer: parsed?.answer ?? "Here are details about the selected item.",
    follow_up_question: parsed?.follow_up_question ?? "Do you want more detail, or are you satisfied?",
    options:
      (parsed?.options ?? []).map((o: any) => ({
        id: String(o.id ?? "opt"),
        label: String(o.label ?? "Option"),
        pick:
          o.pick?.type === "detail"
            ? // 前端会把 detail pick 翻译成 state.detail_focus 的更新
              ({ type: "object", ref: pick.ref } as any)
            : o.pick,
      })) || [],
    updated_state,
  };

  return Response.json(resp);
}
