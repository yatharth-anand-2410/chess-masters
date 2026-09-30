"use client";

import { useState } from "react";
import { API_BASE } from "../lib/api";
import { streamPost } from "../lib/stream";
import UpgradePrompt from "./UpgradePrompt";

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type AnalysisThreadProps = {
  analysisId: string;
  token: string;
  initialMessages: ThreadMessage[];
};

export default function AnalysisThread({
  analysisId,
  token,
  initialMessages,
}: AnalysisThreadProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState("");
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || replying) {
      return;
    }
    setDraft("");
    setError("");
    setReplying(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: question,
        created_at: new Date().toISOString(),
      },
    ]);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-answer-${Date.now()}`,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    let answerBuffer = "";
    await streamPost(
      `${API_BASE}/api/analyses/${analysisId}/messages/stream`,
      token,
      { content: question },
      {
        onEvent: (eventName, data) => {
          if (eventName === "content_chunk") {
            const text = (data as { text?: string })?.text ?? "";
            answerBuffer += text;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.content = answerBuffer;
              }
              return next;
            });
          }
          if (eventName === "error") {
            const payload = data as { message?: string; code?: string };
            if (payload?.code === "upgrade_required") {
              setUpgradeRequired(true);
            } else if (payload?.code === "limit_reached") {
              setLimitReached(true);
              setError(payload?.message ?? "You've reached your analysis limit.");
            } else {
              setError(payload?.message ?? "Something went wrong.");
            }
          }
        },
        onError: (message, code) => {
          if (code === "upgrade_required") {
            setUpgradeRequired(true);
          } else if (code === "limit_reached") {
            setLimitReached(true);
            setError(message);
          } else {
            setError(message);
          }
        },
      }
    );
    setReplying(false);
  };

  return (
    <div className="thread">
      <div className="thread-messages">
        {messages.length === 0 && (
          <p className="thread-empty">
            Ask a question about this game, for example: &ldquo;Why was 5...gxf5 a
            problem?&rdquo;
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`thread-message role-${message.role}`}>
            <span className="thread-author">
              {message.role === "user" ? "You" : "Coach"}
            </span>
            <div className="thread-content">{message.content}</div>
          </div>
        ))}
        {replying && (
          <div className="thread-typing">
            <span className="spinner" aria-hidden="true" />
            Coach is thinking...
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {upgradeRequired ? (
        <UpgradePrompt feature="qna" />
      ) : limitReached ? null : (
        <form className="thread-composer" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this game..."
            disabled={replying}
          />
          <button type="submit" className="btn" disabled={replying || !draft.trim()}>
            Ask
          </button>
        </form>
      )}
    </div>
  );
}