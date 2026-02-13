"use client";

import { useState } from "react";

type Pick = { type: "object" | "group"; ref: string };
type DialogueState = {
  selected_candidate?: Pick;
  detail_focus?: "attributes" | "location" | "text" | "count" | "all";
  turn?: number;
};

export default function Home() {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [sceneJsonText, setSceneJsonText] = useState<string>("");

  const [question, setQuestion] = useState<string>("What is on the table?");
  const [answer, setAnswer] = useState<string>("");

  // iterative UI pieces
  const [iterQuestion, setIterQuestion] = useState<string>("What is that?");
  const [iterAnswer, setIterAnswer] = useState<string>("");
  const [followUp, setFollowUp] = useState<string>("");
  const [options, setOptions] = useState<{ id: string; label: string; pick: Pick }[]>([]);
  const [state, setState] = useState<DialogueState>({ turn: 0 });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => setImageDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleParseScene() {
    if (!imageDataUrl) return;

    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "scene failed");

    setSceneJsonText(data.sceneJsonText);

    // reset answers & iterative state
    setAnswer("");
    setIterAnswer("");
    setFollowUp("");
    setOptions([]);
    setState({ turn: 0 });
  }

  async function handleAskOnePass() {
    if (!sceneJsonText) return;

    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "one_pass",
        question,
        sceneJsonText,
        state: { turn: 0 },
      }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "answer failed");
    setAnswer(data.answer || "");
  }

  async function handleStartIterative() {
    if (!sceneJsonText) return;

    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "iterative",
        question: iterQuestion,
        sceneJsonText,
        state, // initially {turn:0}
      }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "iterative failed");

    setIterAnswer(data.answer || "");
    setFollowUp(data.follow_up_question || "");
    setOptions(data.options || []);
    setState(data.updated_state || state);
  }

  async function handlePickOption(pick: Pick) {
    if (!sceneJsonText) return;

    const newState: DialogueState = {
      ...state,
      selected_candidate: pick,
      turn: (state.turn ?? 0) + 1,
    };

    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "iterative",
        question: iterQuestion,
        sceneJsonText,
        state: newState,
      }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "iterative failed");

    setIterAnswer(data.answer || "");
    setFollowUp(data.follow_up_question || "");
    setOptions(data.options || []);
    setState(data.updated_state || newState);
  }

  return (
    <main className="container">
      <header className="header">
        <h1 className="title">SURE VQA Ambiguity</h1>
        <p className="subtitle">
          One-pass answers vs. Iterative clarification for ambiguous visual questions.
        </p>
      </header>

      <div className="grid">
        {/* Left: image + scene */}
        <section className="card">
          <h2 className="cardTitle">1) Input Image</h2>

          <label className="label">
            Upload an image
            <input className="file" type="file" accept="image/*" onChange={handleImageUpload} />
          </label>

          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={handleParseScene} disabled={!imageDataUrl}>
              Parse Scene
            </button>
          </div>

          <hr className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 0 }}>
            Scene JSON
          </h3>
          <div className="mono" aria-label="Scene JSON output">
            {sceneJsonText || "Parse Scene to generate structured objects/groups."}
          </div>
        </section>

        {/* Right: Q&A */}
        <section className="card">
          <h2 className="cardTitle">2) Ask Questions</h2>

          <hr className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 0 }}>
            One-pass
          </h3>

          <label className="label">
            Question
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>

          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={handleAskOnePass} disabled={!sceneJsonText}>
              Ask (One-pass)
            </button>
          </div>

          <div className="answerBox" aria-live="polite" aria-label="One-pass answer">
            <p className="answerTitle">Answer</p>
            <p className="answerText">{answer || "—"}</p>
          </div>

          <hr className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 0 }}>
            Iterative Clarification
          </h3>

          <label className="label">
            Question
            <input className="input" value={iterQuestion} onChange={(e) => setIterQuestion(e.target.value)} />
          </label>

          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={handleStartIterative} disabled={!sceneJsonText}>
              Start (Iterative)
            </button>
          </div>

          <div className="answerBox" aria-live="polite" aria-label="Iterative response">
            <p className="answerTitle">System</p>
            <p className="answerText">{iterAnswer || "—"}</p>

            {followUp && (
              <>
                <p className="answerTitle" style={{ marginTop: 10 }}>
                  Clarification
                </p>
                <p className="answerText">{followUp}</p>
              </>
            )}
          </div>

          {options.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="answerTitle">Options</p>
              <div className="chips" role="list" aria-label="Clarification options">
                {options.map((o) => (
                  <button
                    key={o.id}
                    className="chip"
                    onClick={() => handlePickOption(o.pick)}
                    aria-label={`Select: ${o.label}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
