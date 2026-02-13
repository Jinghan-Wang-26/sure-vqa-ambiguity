// lib/types.ts
export type SceneObject = {
  id: string;              // "o1"
  name: string;            // "bottle"
  count_guess: number;     // 1
  location: string;        // "right-middle", "center", "top-left", etc.
  attributes: string[];    // ["transparent", "blue cap"]
  visible_text: string[];  // ["Coke"] if any
  confidence: number;      // 0..1
};

export type SceneGroup = {
  group_name: string;      // "left cluster"
  object_ids: string[];
  spatial_summary: string; // "Several items clustered on the left side..."
};

export type AmbiguityCandidate = {
  candidate_type: "object" | "group";
  ref: string;             // object id OR group_name
  why_ambiguous: string;   // short reason
};

export type SceneJSON = {
  objects: SceneObject[];
  salient_groups: SceneGroup[];
  ambiguity_candidates: AmbiguityCandidate[];
};

export type Mode = "one_pass" | "iterative";

export type DialogueState = {
  // iterative 用：用户已经选了哪个 candidate（对象 or group）
  selected_candidate?: { type: "object" | "group"; ref: string };

  // iterative 用：用户还想要什么维度的细节
  detail_focus?: "attributes" | "location" | "text" | "count" | "all";

  // 你可以记录轮次，避免无限追问
  turn?: number;
};

export type AnswerResponse =
  | {
      mode: "one_pass";
      answer: string;          // 给用户读的最终文本
      ambiguity_note: string;  // 一句话强调 ambiguity
    }
  | {
      mode: "iterative";
      answer: string;          // 本轮回答/简述
      follow_up_question: string; // 下一句澄清问题
      options: { id: string; label: string; pick: { type: "object" | "group"; ref: string } }[];
      updated_state: DialogueState;
    };
