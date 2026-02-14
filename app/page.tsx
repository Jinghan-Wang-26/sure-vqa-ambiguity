"use client";

import { useState } from "react";

type DialogueState = { turn?: number };

export default function Home() {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [sceneJsonText, setSceneJsonText] = useState<string>("");

  const [question, setQuestion] = useState<string>("What is this item on the table? How does it look?");
  const [answer, setAnswer] = useState<string>("");

  const [iterQuestion, setIterQuestion] = useState<string>("What is this item on the table?");
  const [iterAnswer, setIterAnswer] = useState<string>("");
  const [followUp, setFollowUp] = useState<string>("");
  const [clarificationInput, setClarificationInput] = useState<string>("");
  const [state, setState] = useState<DialogueState>({ turn: 0 });

  const [isParsing, setIsParsing] = useState(false);

  async function parseSceneAuto(dataUrl: string) {
    setIsParsing(true);
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });

      const text = await res.text();
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error || "scene failed");

      setSceneJsonText(data.sceneJsonText);

      // reset outputs on new image
      setAnswer("");
      setIterAnswer("");
      setFollowUp("");
      setClarificationInput("");
      setState({ turn: 0 });
    } finally {
      setIsParsing(false);
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setImageDataUrl(dataUrl);
      await parseSceneAuto(dataUrl); // ✅ 上传后自动解析
    };
    reader.readAsDataURL(file);
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
        state,
      }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "iterative failed");

    setIterAnswer(data.answer || "");
    setFollowUp(data.follow_up_question || "");
    setState({ turn: (state.turn ?? 0) + 1 });
  }

  async function handleSendClarification() {
    if (!sceneJsonText) return;
    const clarification = clarificationInput.trim();
    if (!clarification) return;

    const res = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "iterative",
        question: iterQuestion,
        clarification,
        sceneJsonText,
        state: { turn: (state.turn ?? 0) + 1 },
      }),
    });

    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "iterative failed");

    setIterAnswer(data.answer || "");
    setFollowUp(data.follow_up_question || "");
    setClarificationInput("");
    setState({ turn: (state.turn ?? 0) + 1 });
  }

  return (
    <main className="container">
      <header className="header">
        <h1 className="title">SURE VQA Ambiguity</h1>
        <p className="subtitle">One-pass vs. iterative clarification (BLV-friendly).</p>
      </header>

      <div className="grid">
        {/* Left: Image preview only (no Parse button, no Scene JSON shown) */}
        <section className="card">
          <h2 className="cardTitle">1) Input Image</h2>

          <label className="label">
            Upload an image (auto-parse)
            <input className="file" type="file" accept="image/*" onChange={handleImageUpload} />
          </label>

          {imageDataUrl && (
            <div style={{ marginTop: 12 }}>
              <p className="answerTitle">Preview</p>
              <img
                src={imageDataUrl}
                alt="Uploaded image preview"
                style={{ width: "100%", borderRadius: 12, border: "1px solid #eee" }}
              />
            </div>
          )}

          {isParsing && (
            <div className="answerBox" aria-live="polite">
              <p className="answerText">Parsing scene…</p>
            </div>
          )}
        </section>

        {/* Right: Q&A */}
        <section className="card">
          <h2 className="cardTitle">2) Ask Questions</h2>

          <hr className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 0 }}>One-pass</h3>
          <label className="label">
            Question
            <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={handleAskOnePass} disabled={!sceneJsonText || isParsing}>
              Ask (One-pass)
            </button>
          </div>
          <div className="answerBox" aria-live="polite">
            <p className="answerTitle">Answer</p>
            <p className="answerText">{answer || "—"}</p>
          </div>

          <hr className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 0 }}>Iterative Clarification</h3>
          <label className="label">
            Question
            <input className="input" value={iterQuestion} onChange={(e) => setIterQuestion(e.target.value)} />
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="btn btnPrimary" onClick={handleStartIterative} disabled={!sceneJsonText || isParsing}>
              Start (Iterative)
            </button>
          </div>

          <div className="answerBox" aria-live="polite">
            <p className="answerTitle">System</p>
            <p className="answerText">{iterAnswer || "—"}</p>
            {followUp && (
              <>
                <p className="answerTitle" style={{ marginTop: 10 }}>Clarification</p>
                <p className="answerText">{followUp}</p>
              </>
            )}
          </div>

          {followUp && (
            <div style={{ marginTop: 10 }}>
              <p className="answerTitle">Your reply</p>
              <input
                className="input"
                value={clarificationInput}
                onChange={(e) => setClarificationInput(e.target.value)}
                placeholder='e.g., "Tell me more about the bottle."'
              />
              <div style={{ marginTop: 8 }}>
                <button className="btn btnPrimary" onClick={handleSendClarification} disabled={!clarificationInput.trim()}>
                  Send
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
