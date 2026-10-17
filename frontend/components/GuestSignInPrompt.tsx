"use client";

import { useEffect, useRef } from "react";
import AuthButton from "./AuthButton";

type GuestSignInPromptProps = {
  onClose: () => void;
};

export default function GuestSignInPrompt({ onClose }: GuestSignInPromptProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // A modal dialog gets a keyboard exit and starts focus on its close control.
  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="guest-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="guest-modal">
        <button
          ref={closeRef}
          type="button"
          className="guest-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <h2 id="guest-modal-title">You have 4 free game analyses left!</h2>
        <p>Sign in with Google to claim them and save your progress.</p>
        <AuthButton user={null} onAuthChange={onClose} />
      </div>
    </div>
  );
}
