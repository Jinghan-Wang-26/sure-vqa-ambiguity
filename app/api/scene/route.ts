// app/api/scene/route.ts
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { imageDataUrl } = await req.json(); // "data:image/png;base64,...."

  const prompt = `
You are an accessibility-focused VQA system.
Return JSON ONLY, matching this schema:

{
  "objects": [
    {
      "id": "o1",
      "name": "bottle",
      "count_guess": 1,
      "location": "right-middle",
      "attributes": ["transparent", "blue cap"],
      "visible_text": [],
      "confidence": 0.0
    }
  ],
  "salient_groups": [
    { "group_name": "right cluster", "object_ids": ["o1"], "spatial_summary": "..." }
  ],
  "ambiguity_candidates": [
    { "candidate_type": "object", "ref": "o1", "why_ambiguous": "multiple similar items" }
  ]
}
`;

  const r = await openai.responses.create({
    model: "gpt-5.1-chat-latest",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl, detail: "low" }
        ],
      },
    ],
    // 你之后可以调成 low/high 来模拟 Instant vs Thinking
    reasoning: { effort: "medium" },
  });

  // r.output_text 是拼出来的文本；我们期望它是 JSON 字符串
  const text = r.output_text?.trim() ?? "{}";

  return Response.json({ sceneJsonText: text });
}
