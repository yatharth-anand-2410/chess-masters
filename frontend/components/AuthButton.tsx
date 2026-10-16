"use client";

import { useCallback, useState } from "react";
import { createClient } from "../lib/supabase-client";
import type { User } from "@supabase/supabase-js";
import { GoogleIcon } from "./ui/Topbar";

type AuthButtonProps = {
  user: User | null;
  onAuthChange: () => void;
  /**
   * Coach mode: when provided alongside `role`, the signed-in menu offers the
   * one-click switch between the player and coach experiences.
   */
  role?: "player" | "coach" | null;
  onToggleRole?: () => Promise<void> | void;
};

export default function AuthButton({ user, onAuthChange, role, onToggleRole }: AuthButtonProps) {
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  const signIn = useCallback(async () => {
    setBusy(true);
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      console.error("Sign in failed:", error.message);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
    onAuthChange();
  }, [supabase, onAuthChange]);

  const toggleRole = useCallback(async () => {
    if (!onToggleRole) {
      return;
    }
    setBusy(true);
    try {
      await onToggleRole();
    } finally {
      setBusy(false);
    }
  }, [onToggleRole]);

  if (user) {
    return (
      <div className="user-menu">
        <span className="user-name">
          {user.user_metadata?.full_name ?? user.email ?? "Signed in"}
        </span>
        {onToggleRole && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={toggleRole}
            disabled={busy}
          >
            {role === "coach" ? "Switch to player view" : "Enable coach mode"}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={signOut} disabled={busy}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn inline-flex items-center gap-2"
      onClick={signIn}
      disabled={busy}
    >
      <GoogleIcon className="w-4 h-4 shrink-0" />
      <span>{busy ? "Signing in..." : "Sign in with Google"}</span>
    </button>
  );
}