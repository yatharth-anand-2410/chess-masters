"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  apiGet,
  apiPost,
  type ReviewsResponse,
  type ReviewSubmissionResponse,
} from "../lib/api";
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
      className="stars"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= rounded ? "star filled" : "star"}>
          ★
        </span>
      ))}
    </span>
  );
}

export default function ReviewSection({ user, token, onAuthChange }: ReviewSectionProps) {
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) {
        setLoading(true);
      }
      try {
        let result: ReviewsResponse | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            result = await apiGet<ReviewsResponse>("/api/reviews", token || undefined);
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
      await load(true);
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

  return (
    <section className="review-panel">
      <div className="section-head">
        <h2>Player reviews</h2>
        {summary && summary.count > 0 && (
          <span className="review-summary">
            <Stars value={summary.average ?? 0} />
            <span>
              {(summary.average ?? 0).toFixed(1)} · {summary.count}{" "}
              {summary.count === 1 ? "review" : "reviews"}
            </span>
          </span>
        )}
      </div>

      {user && token ? (
        <form className="review-form" onSubmit={submit}>
          <div className="review-form-head">
            <span className="review-form-label">
              {hasReview ? "Update your review" : "Rate Chessmasters"}
            </span>
            <div className="star-input" role="group" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`star-button ${
                    value <= (hovered || rating) ? "active" : ""
                  }`}
                  aria-label={`${value} star${value === 1 ? "" : "s"}`}
                  aria-pressed={value <= rating}
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
          <div className="review-form-actions">
            <button
              type="submit"
              className="btn"
              disabled={submitting || rating < 1}
            >
              {submitting ? "Saving..." : hasReview ? "Update review" : "Submit review"}
            </button>
            {comment.length > 0 && (
              <span className="review-char-count">{comment.length}/500</span>
            )}
          </div>
        </form>
      ) : (
        <div className="review-signin">
          <p>Sign in to rate Chessmasters and share your experience.</p>
          <AuthButton user={null} onAuthChange={onAuthChange} />
        </div>
      )}

      {error && (
        <div className="error-banner review-error">
          <span>{error}</span>
          {retryable && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => load()}
              disabled={loading}
            >
              {loading ? "Retrying..." : "Retry"}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="history-empty">Loading reviews...</p>
      ) : reviews.length > 0 ? (
        <div className="review-list">
          {reviews.map((review) => (
            <article
              key={review.id}
              className={`review-card${review.is_mine ? " review-card-mine" : ""}`}
            >
              <div className="review-card-head">
                <Stars value={review.rating} />
                <span className="review-author">{review.display_name}</span>
                {review.is_mine && <span className="review-mine-badge">Your review</span>}
              </div>
              <p className="review-comment">{review.comment}</p>
            </article>
          ))}
        </div>
      ) : error ? null : (
        <p className="history-empty">
          No reviews yet. Be the first to rate Chessmasters.
        </p>
      )}
    </section>
  );
}
