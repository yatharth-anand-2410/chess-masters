import type { User } from "@supabase/supabase-js";

export const DEMO_USER_STORAGE_KEY = "cm_demo_user";

/**
 * Production: No mock/demo user. Only real authenticated Supabase sessions.
 */
export function getStoredDemoUser(): User | null {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  return null;
}

export function setStoredDemoUser(_user: User | null): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
    } catch {
      // Ignore
    }
    window.dispatchEvent(new CustomEvent("cm_auth_changed", { detail: null }));
  }
}

export function isDemoUser(_user: User | null | undefined): boolean {
  return false;
}
