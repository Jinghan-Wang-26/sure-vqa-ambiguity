import OpenAI from "openai";
import { SceneJSON } from "@/lib/types";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isCountingQuestion(q: string): boolean {
  const s = (q ?? "").toLowerCase();
  return (
    s.includes("how many") ||
    s.includes("count") ||
    s.includes("number of") ||
    s.includes("how much") ||
    s.includes("total")
  );
}

export async function POST(req: Request) {
  const body = await req.json();

  const mode: "one_pass" | "iterative" = body.mode;
  const question: string = body.question ?? "";
  const clarification: string = body.clarification ?? "";
  const sceneJsonText: string = body.sceneJsonText ?? "{}";
  const imageDataUrl: string = body.imageDataUrl ?? ""; // ✅ 新增：用于计数重看图

  const scene = safeJsonParse<SceneJSON>(sceneJsonText);
  if (!scene || !scene.objects) {
    return Response.json({ error: "Invalid sceneJsonText; cannot parse SceneJSON." }, { status: 400 });
  }

  // ---------- ONE-PASS: (still grounded in SCENE JSON) ----------
  if (mode === "one_pass") {
    const prompt = `
You are an accessibility-focused visual assistant.

You will be given SCENE JSON and a USER QUESTION (may be ambiguous).
Write a SINGLE response in ONE PASS that matches the style of this example:

- Start with: "The image contains N objects."
- Then describe ALL relevant objects/entities that could plausibly answer the question.
- Use natural paragraphs (NOT bullet points).
- Include: object name, key attributes, visible text (if any), and spatial relations using words like "next to", "between", "in front of", "behind", "to the left/right of".
- Do NOT ask clarifying questions.
- Do NOT say "Which item do you mean?".

Important grounding rule:
Only use information from SCENE JSON. Do not invent unseen objects or text.

SCENE JSON:
${sceneJsonText}

USER QUESTION:
${question}
`;

    const r = await openai.responses.create({
      model: "gpt-5.1-chat-latest",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      reasoning: { effort: "medium" },
    });

    const answerText = (r.output_text ?? "").trim();

    return Response.json({
      mode: "one_pass",
      answer: answerText || "I couldn't generate an answer from the scene information.",
    });
  }

  // ---------- ITERATIVE: no clarification yet ----------
  if (!clarification.trim()) {
    const prompt = `
You are in Iterative Clarification Mode.

Goal: mimic this interaction pattern:
System: "There are several objects detected: A, B, C. Which one are you referring to?"

Instructions:
- Write ONE short system message listing 2–4 plausible referents (objects) using SCENE JSON names.
- Then ask ONE clarification question the user can answer in free text.
- Do NOT provide buttons or options.
- Keep it concise and screen-reader friendly.
Return JSON ONLY:

{
  "answer": "...",
  "follow_up_question": "..."
}

SCENE JSON:
${sceneJsonText}

USER QUESTION:
${question}
`;

    const r = await openai.responses.create({
      model: "gpt-5.1-chat-latest",
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      reasoning: { effort: "medium" },
    });

    const text = (r.output_text ?? "").trim();
    const parsed = safeJsonParse<{ answer: string; follow_up_question: string }>(text) ?? {
      answer: "There are several objects detected in the scene.",
      follow_up_question: "Which one are you referring to? You can describe it by location or appearance.",
    };

    return Response.json({
      mode: "iterative",
      answer: parsed.answer,
      follow_up_question: parsed.follow_up_question,
    });
  }

  // ---------- ITERATIVE: clarified ----------
  // ✅ Special handling for counting questions: re-check the IMAGE directly (more reliable than Scene JSON).
  if (isCountingQuestion(question) && imageDataUrl) {
    const countPrompt = `
You are a careful visual assistant. The user is asking a COUNTING question.

Look at the image and count ONLY the target described by the user's clarification.
- If the target is partially occluded or densely packed, give an approximate count and say it is approximate.
- If multiple similar groups exist, count only the one implied by the clarification.

Return JSON ONLY:
{ "answer": "..." }

USER QUESTION:
${question}

USER CLARIFICATION:
${clarification}
`;

    const r2 = await openai.responses.create({
      model: "gpt-5.1-chat-latest",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: countPrompt },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ],
        },
      ],
      reasoning: { effort: "medium" },
    });

    const text2 = (r2.output_text ?? "").trim();
    const parsed2 = safeJsonParse<{ answer: string }>(text2);

    return Response.json({
      mode: "iterative",
      answer: parsed2?.answer ?? "I couldn't reliably count the requested items from the image.",
      follow_up_question: "",
    });
  }

  // Default clarified path (still grounded in SCENE JSON)
  const prompt = `
You are an accessibility-focused visual assistant.

You are given:
- SCENE JSON
- USER QUESTION
- USER CLARIFICATION (free text)

Task:
Answer the question ONLY about the referent implied by USER CLARIFICATION.
Use ONLY information from SCENE JSON. Do not invent.
Do NOT ask a follow-up question. Return JSON ONLY:

{ "answer": "..." }

SCENE JSON:
${sceneJsonText}

USER QUESTION:
${question}

USER CLARIFICATION:
${clarification}
`;

  const r = await openai.responses.create({
    model: "gpt-5.1-chat-latest",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    reasoning: { effort: "medium" },
  });

  const text = (r.output_text ?? "").trim();
  const parsed = safeJsonParse<{ answer: string }>(text);

  return Response.json({
    mode: "iterative",
    answer: parsed?.answer ?? "I couldn't determine the intended item from your clarification.",
    follow_up_question: "",
  });
}
