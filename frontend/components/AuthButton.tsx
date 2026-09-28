"use client";

import { useCallback, useState } from "react";
import { createClient } from "../lib/supabase-client";
import type { User } from "@supabase/supabase-js";

type AuthButtonProps = {
  user: User | null;
  onAuthChange: () => void;
};

export default function AuthButton({ user, onAuthChange }: AuthButtonProps) {
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

  if (user) {
    return (
      <div className="user-menu">
        <span className="user-name">
          {user.user_metadata?.full_name ?? user.email ?? "Signed in"}
        </span>
        <button type="button" className="btn btn-ghost" onClick={signOut} disabled={busy}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="btn" onClick={signIn} disabled={busy}>
      {busy ? "Signing in..." : "Sign in with Google"}
    </button>
  );
}