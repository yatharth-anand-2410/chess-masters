"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, Send } from "lucide-react";
import { API_BASE } from "../lib/api";
import { streamPost } from "../lib/stream";
import UpgradePrompt from "./UpgradePrompt";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";

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
    <div className="thread flex flex-col h-full bg-[var(--ink-2)] rounded-[var(--radius-card)] border border-[var(--line-soft)] p-4">
      <div className="thread-messages flex-1 overflow-y-auto flex flex-col gap-3 min-h-[160px] max-h-[480px] pr-1">
        {messages.length === 0 && (
          <p className="thread-empty text-xs text-[var(--text-muted)] italic py-4 text-center">
            Ask a question about this game, for example: &ldquo;Why was 5...gxf5 a
            problem?&rdquo;
          </p>
        )}
        <AnimatePresence initial={false}>
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={`thread-message p-3 rounded-lg border ${
                  isUser
                    ? "bg-[var(--ink-3)] border-[var(--line-soft)] self-end max-w-[88%]"
                    : "bg-[var(--ink)] border-[var(--line)] self-start max-w-[92%]"
                }`}
              >
                <div className="mb-1">
                  <Pill tone={isUser ? "neutral" : "shell"} size="sm">
                    {isUser ? "You" : "Coach"}
                  </Pill>
                </div>
                <div className="thread-content text-xs leading-relaxed text-[var(--text)] whitespace-pre-wrap">
                  {message.content || (
                    <span className="text-[var(--text-muted)] italic">Thinking...</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {replying && (
          <div className="thread-typing flex items-center gap-2 text-xs text-[var(--gold)] font-mono py-1">
            <Loader2 size={12} className="animate-spin" />
            <span>Coach is analyzing moves...</span>
          </div>
        )}
      </div>

      {error && <div className="error-banner mt-2 text-xs">{error}</div>}

      {upgradeRequired ? (
        <div className="mt-3">
          <UpgradePrompt feature="qna" />
        </div>
      ) : limitReached ? null : (
        <form className="thread-composer mt-3 flex items-center gap-2" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about this position..."
            disabled={replying}
            className="flex-1 px-3 py-2 text-xs rounded-md bg-[var(--input-bg)] border border-[var(--input-line)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)]"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={replying || !draft.trim()}
            iconStart={replying ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          >
            Ask
          </Button>
        </form>
      )}
    </div>
  );
}