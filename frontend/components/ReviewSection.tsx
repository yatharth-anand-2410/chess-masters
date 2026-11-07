"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { MessageSquarePlus, Star, CheckCircle2 } from "lucide-react";
import {
  apiPost,
  type ReviewsResponse,
  type ReviewSubmissionResponse,
} from "../lib/api";
import { apiGetCached, CACHE_TTL } from "../lib/api-cache";
import AuthButton from "./AuthButton";

type ReviewSectionProps = {
  user: User | null;
  token: string;
  onAuthChange: () => void;
};

function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[var(--gold-bright)] text-xs"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={star <= rounded ? "text-[var(--gold-bright)]" : "text-[var(--text-muted)]/30"}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function getInitials(name: string): string {
  const parts = (name || "Player").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isShortOrEmojiComment(text?: string | null): boolean {
  const cleaned = (text || "").trim();
  return cleaned.length <= 4;
}

export default function ReviewSection({ user, token, onAuthChange }: ReviewSectionProps) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false, options?: { force?: boolean }) => {
      const id = ++requestId.current;
      if (!silent) {
        setLoading(true);
      }
      try {
        let result: ReviewsResponse | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            result = await apiGetCached<ReviewsResponse>("/api/reviews", token || undefined, {
              ttlMs: CACHE_TTL.account,
              force: options?.force ?? false,
            });
            break;
          } catch (err) {
            if (id !== requestId.current || attempt === 1) {
              throw err;
            }
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
        if (id !== requestId.current || !result) {
          return;
        }
        setData(result);
        setError("");
        setRetryable(false);
        if (result.mine) {
          setRating(result.mine.rating);
          setComment(result.mine.comment ?? "");
        } else {
          setRating(0);
          setComment("");
        }
      } catch {
        if (id !== requestId.current) {
          return;
        }
        setError("Couldn't load reviews. Check your connection and try again.");
        setRetryable(true);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !token) {
      setError("Please sign in to submit a review.");
      setRetryable(false);
      return;
    }
    if (rating < 1) {
      setError("Pick a rating from 1 to 5 stars.");
      setRetryable(false);
      return;
    }
    setSubmitting(true);
    setError("");
    setRetryable(false);
    try {
      await apiPost<ReviewSubmissionResponse>("/api/reviews", token, {
        rating,
        comment: comment.trim() || null,
      });
      await load(true, { force: true });
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your review.");
      setRetryable(false);
    } finally {
      setSubmitting(false);
    }
  };

  const summary = data?.summary;
  const reviews = data?.reviews ?? [];
  const hasReview = Boolean(data?.mine);

  // Sort substantive text reviews first so the top row always reads like a rich testimonial wall
  const sortedReviews = [...reviews].sort((a, b) => {
    const aLen = (a.comment || "").trim().length;
    const bLen = (b.comment || "").trim().length;
    if ((aLen > 4) !== (bLen > 4)) {
      return aLen > 4 ? -1 : 1;
    }
    return bLen - aLen;
  });

  return (
    <section className="review-panel landing-section">
      {/* Compact Header Bar */}
      <div className="rounded-2xl bg-[#0a1014]/90 backdrop-blur-xl border border-[var(--line)] p-6 mb-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-serif font-bold text-[var(--text)] m-0">
            Player Reviews
          </h2>
          {summary && summary.count > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-xs font-mono">
              <Stars value={summary.average ?? 0} />
              <span className="font-bold text-[var(--gold-bright)]">
                {(summary.average ?? 0).toFixed(1)}
              </span>
              <span className="text-[var(--text-muted)]">
                ({summary.count} {summary.count === 1 ? "review" : "reviews"})
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user && token ? (
            <button
              type="button"
              onClick={() => setShowForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-control)] bg-[var(--ink-3)] border border-[var(--gold)]/40 text-xs font-semibold text-[var(--gold-bright)] hover:bg-[var(--gold)]/15 transition-colors cursor-pointer"
            >
              <MessageSquarePlus size={14} />
              <span>{hasReview ? "Edit Your Review" : "Write a Review"}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-[var(--text-muted)] hidden sm:inline">
                Analyzed a game?
              </span>
              <AuthButton user={user} onAuthChange={onAuthChange} />
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Review Form (for signed-in users when toggled) */}
      {user && token && showForm && (
        <form
          className="review-form mb-5 rounded-2xl bg-[#0c1317]/95 backdrop-blur-md border border-[var(--gold)]/40 p-5 shadow-xl"
          onSubmit={submit}
        >
          <div className="review-form-head flex items-center justify-between gap-2 mb-3">
            <span className="review-form-label text-sm font-semibold text-[var(--text)]">
              {hasReview ? "Update your review" : "Rate your Chessmasters experience"}
            </span>
            <div className="star-input" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === rating}
                  className={`star-button ${
                    value <= (hovered || rating) ? "active" : ""
                  }`}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHovered(value)}
                  onMouseLeave={() => setHovered(0)}
                  onFocus={() => setHovered(value)}
                  onBlur={() => setHovered(0)}
                  onClick={() => setRating(value)}
                  disabled={submitting}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What did you think of your coaching report? (optional)"
            maxLength={500}
            rows={3}
            disabled={submitting}
          />
          <div className="review-form-actions mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn"
                disabled={submitting || rating < 1}
              >
                {submitting ? "Saving..." : hasReview ? "Update review" : "Submit review"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
            {comment.length > 0 && (
              <span className="review-char-count text-xs text-[var(--text-muted)]">
                {comment.length}/500
              </span>
            )}
          </div>
        </form>
      )}

      {error && (
        <div className="error-banner review-error mb-4" role="alert">
          <span>{error}</span>
          {retryable && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => load(false)}
              disabled={loading}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-[#0c1317]/95 border border-[var(--line)] p-6 text-xs text-[var(--text-muted)]">
          Loading player reviews...
        </div>
      ) : sortedReviews.length === 0 ? (
        !error && (
          <div className="rounded-2xl bg-[#0c1317]/95 border border-[var(--line)] p-6 text-xs text-[var(--text-muted)]">
            No reviews yet. Be the first to rate Chessmasters!
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedReviews.map((review) => {
            const shortEmoji = isShortOrEmojiComment(review.comment);
            const initials = getInitials(review.display_name);
            return (
              <article
                key={review.id}
                className="rounded-2xl bg-[#0c1317]/95 backdrop-blur-md border border-[var(--line)] hover:border-[var(--gold)]/35 p-5 flex flex-col justify-between gap-4 shadow-md transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/45 text-[var(--gold-bright)] font-mono font-bold text-xs flex items-center justify-center shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text)] truncate">
                        {review.display_name}
                      </div>
                      <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={11} />
                        <span>Verified Player</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Stars value={review.rating} />
                  </div>
                </div>

                {shortEmoji ? (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--line-soft)] text-xs text-[var(--text-muted)]">
                    <span>Rated {review.rating}.0 / 5.0 after game analysis</span>
                    {review.comment && (
                      <span className="text-base leading-none">{review.comment}</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm text-[var(--text)] leading-relaxed m-0 pt-2 border-t border-[var(--line-soft)]">
                    &ldquo;{review.comment}&rdquo;
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
