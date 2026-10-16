"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { X, Sparkles, Send, Bot, User as UserIcon, RotateCcw, ChevronRight, Zap } from "lucide-react";

export type AICoachDrawerProps = {
  isOpen?: boolean;
  onClose?: () => void;
  currentGameId?: string;
};

export type ChatMessage = {
  id: string;
  sender: "coach" | "user";
  timestamp: string;
  content: string;
  isStreaming?: boolean;
};

import { createClient } from "../lib/supabase-client";
import { apiPost } from "../lib/api";
import type { User } from "@supabase/supabase-js";

export const QUICK_QUERY_CHIPS = [
  {
    id: "turning_point",
    label: "⚡ Analyze this game's turning point",
    prompt: "What was the critical turning point in this game, and how could it have been saved?",
  },
  {
    id: "last_3_games",
    label: "📊 Analyze my recent games",
    prompt: "Analyze my recent games and identify my most frequent error patterns.",
  },
  {
    id: "most_mistakes",
    label: "🎯 Where am I making the most mistakes?",
    prompt: "Where am I losing the most evaluation points: opening, middlegame, or endgame?",
  },
  {
    id: "what_practice",
    label: "🏋️ What should I practice right now?",
    prompt: "What specific tactical motifs or drills should I practice right now?",
  },
  {
    id: "nav_progress",
    label: "🧭 Navigate to my Progress & Leaks",
    prompt: "Navigate to my Progress & Leaks",
  },
] as const;

function playAudioFeedback(type: "move" | "brilliant" | "click") {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === "move" || type === "click") {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.05);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === "brilliant") {
      osc.frequency.setValueAtTime(587, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch {
    // Audio unsupported or blocked by browser policy; fail silently
  }
}

export function AICoachDrawer({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
  currentGameId,
}: AICoachDrawerProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isControlled = controlledIsOpen !== undefined;
  const open = isControlled ? controlledIsOpen : internalOpen;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (session) {
        setToken(session.access_token);
      }
    });
  }, []);

  const setOpen = useCallback(
    (nextState: boolean) => {
      if (isControlled) {
        if (!nextState && controlledOnClose) {
          controlledOnClose();
        }
      } else {
        setInternalOpen(nextState);
      }
    },
    [isControlled, controlledOnClose]
  );

  const initialMessage: ChatMessage = {
    id: "welcome",
    sender: "coach",
    timestamp: "Now",
    content: `Welcome to your AI Chess Coach Copilot.\n\nI can analyze your games, highlight critical turning points, identify recurring tactical motifs (pins, forks, back-rank weaknesses), and diagnose time trouble habits.\n\nAsk me anything about your current position, your game history, or what you should practice next.`,
  };

  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);

  // Global keyboard shortcut (⌘K / Ctrl+K) and custom event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };

    const handleCustomOpen = () => setOpen(true);
    const handleCustomToggle = () => setOpen(!open);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-ai-coach-drawer", handleCustomOpen);
    window.addEventListener("toggle-ai-coach-drawer", handleCustomToggle);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-ai-coach-drawer", handleCustomOpen);
      window.removeEventListener("toggle-ai-coach-drawer", handleCustomToggle);
    };
  }, [open, setOpen]);

  // Auto scroll to bottom of chat thread
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, isTyping]);

  const handleReset = () => {
    setMessages([initialMessage]);
    playAudioFeedback("click");
  };

  const executeCopilotQuery = async (queryText: string) => {
    playAudioFeedback("move");
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      timestamp: "Now",
      content: queryText,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const response = await apiPost<{
        answer: string;
        suggested_actions?: string[];
        anchored_facts?: string[];
      }>(
        "/api/copilot/query",
        token || undefined,
        {
          query: queryText,
          user_id: user?.id,
          analysis_id: currentGameId,
        }
      );

      let reply = response.answer;
      if (response.suggested_actions && response.suggested_actions.length > 0) {
        reply += "\n\n**Suggested Actions:**\n" + response.suggested_actions.map((a) => `• ${a}`).join("\n");
      }

      const coachMsg: ChatMessage = {
        id: `coach-${Date.now()}`,
        sender: "coach",
        timestamp: "Now",
        content: reply,
      };

      setMessages((prev) => [...prev, coachMsg]);
      playAudioFeedback("brilliant");
    } catch {
      // Clean fallback if copilot endpoint is unavailable
      const fallbackReply = `### ♟ Coach Analysis\n\nWhen evaluating "${queryText}", focus on two core pillars:\n\n1. **Tactical Vigilance:** Always scan for uncoordinated pieces, pins along open files, and knight forks before committing to a pawn break.\n2. **Time Management:** In critical positions, allocate calculation time proportional to the complexity rather than playing on intuition.\n\nReview your full game analysis on the workspace to see move-by-move engine evaluations.`;
      const coachMsg: ChatMessage = {
        id: `coach-${Date.now()}`,
        sender: "coach",
        timestamp: "Now",
        content: fallbackReply,
      };
      setMessages((prev) => [...prev, coachMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleQueryChip = (chipId: (typeof QUICK_QUERY_CHIPS)[number]["id"]) => {
    const chip = QUICK_QUERY_CHIPS.find((c) => c.id === chipId);
    if (!chip) return;

    if (chipId === "nav_progress") {
      setOpen(false);
      router.push("/progress");
      return;
    }

    executeCopilotQuery(chip.prompt);
  };

  const handleSendMessage = () => {
    const text = inputMessage.trim();
    if (!text) return;
    setInputMessage("");
    executeCopilotQuery(text);
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end" role="dialog" aria-modal="true" aria-label="AI Coach Assistant">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            aria-hidden="true"
          />

          {/* Slide-over Drawer Panel */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 350, damping: 35 }}
            className="relative w-full max-w-md sm:max-w-lg h-full bg-[var(--ink-1)] border-l border-[var(--line)] shadow-2xl flex flex-col z-10 text-[var(--text)] font-sans"
          >
            {/* Drawer Header */}
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--line-soft)] bg-[var(--ink-2)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--gold)]/10 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] text-base">
                  ♟
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold tracking-tight text-[var(--text)]">
                      AI Coach & Copilot
                    </h2>
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--gold-bright)] tracking-tight">
                    {user ? `${user.user_metadata?.full_name || user.email?.split("@")[0] || "Player"} · Live Context` : "Real-time Telemetry & Guidance"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-3)] rounded-md transition-colors"
                  title="Reset conversation"
                  aria-label="Reset conversation"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-3)] rounded-md transition-colors"
                  title="Close assistant (Esc)"
                  aria-label="Close assistant"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* Current Game Telemetry Strip */}
            <div className="px-5 py-2 bg-[var(--ink-0)] border-b border-[var(--line-soft)] flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <Zap size={13} className="text-[var(--gold)]" />
                <span>Najdorf #842</span>
                <span className="text-emerald-400">+4.8 → Move 28</span>
              </div>
              <span className="text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 text-[10px]">
                Re8?? (14s)
              </span>
            </div>

            {/* Quick Action Chips Section */}
            <div className="p-4 border-b border-[var(--line-soft)] bg-[var(--ink-2)]/60">
              <span className="block text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">
                Suggested Queries with Your Data:
              </span>
              <div className="flex flex-col gap-1.5">
                {QUICK_QUERY_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => handleQueryChip(chip.id)}
                    className="flex items-center justify-between text-left px-3 py-2 text-xs rounded-lg bg-[var(--ink-3)] hover:bg-[var(--ink)] border border-[var(--line-soft)] hover:border-[var(--gold)]/40 text-[var(--text)] hover:text-white transition-all group cursor-pointer"
                  >
                    <span className="font-medium text-[var(--text)] group-hover:text-[var(--gold-bright)]">
                      {chip.label}
                    </span>
                    <ChevronRight size={13} className="text-[var(--gold)] opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive Chat Message Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.sender === "coach" && (
                    <div className="w-7 h-7 rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] shrink-0 mt-0.5">
                      <Bot size={15} />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-xs leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-[var(--line)] text-[var(--text)] border border-[var(--line-strong)]"
                        : "bg-[var(--ink-2)] text-[var(--text)] border border-[var(--line-soft)] shadow-sm"
                    }`}
                  >
                    {msg.sender === "coach" && (
                      <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-[var(--line-soft)] text-[10px] font-mono text-[var(--gold-bright)]">
                        <span>Coach Gemini & Stockfish 17</span>
                        <span className="text-[var(--text-muted)]">{msg.timestamp}</span>
                      </div>
                    )}

                    <div className="space-y-1.5 whitespace-pre-wrap">
                      {msg.content.split("\n\n").map((para, i) => {
                        if (para.startsWith("### ")) {
                          return (
                            <h4 key={i} className="text-sm font-semibold text-[var(--gold-bright)] mt-1">
                              {para.replace("### ", "")}
                            </h4>
                          );
                        }
                        return <p key={i}>{para}</p>;
                      })}
                    </div>
                  </div>

                  {msg.sender === "user" && (
                    <div className="w-7 h-7 rounded-full bg-[var(--ink-3)] border border-[var(--line)] flex items-center justify-center text-[var(--text-muted)] shrink-0 mt-0.5">
                      <UserIcon size={14} />
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] px-3 py-2 bg-[var(--ink-2)] rounded-lg w-fit border border-[var(--line-soft)]">
                  <Sparkles size={14} className="text-[var(--gold)] animate-spin" />
                  <span>Coach Gemini & Stockfish 17 calculating lines...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Input Form */}
            <footer className="p-3.5 border-t border-[var(--line-soft)] bg-[var(--ink-2)]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ask coach anything about your games..."
                  className="flex-1 px-3.5 py-2.5 text-xs bg-[var(--ink-3)] border border-[var(--line)] rounded-[var(--radius-control)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] transition-colors"
                />
                <button
                  type="submit"
                  disabled={!inputMessage.trim() || isTyping}
                  className="px-3.5 py-2.5 rounded-[var(--radius-control)] bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] font-semibold text-xs flex items-center gap-1.5 hover:opacity-95 disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed shadow-[0_2px_8px_rgba(201,153,63,0.25)]"
                >
                  <span>Send</span>
                  <Send size={12} />
                </button>
              </form>
              <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-[var(--text-muted)] font-mono">
                <span>Press ↵ to send</span>
                <span>{user ? `User: ${user.email}` : "Context: Active Game"}</span>
              </div>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

export default AICoachDrawer;
