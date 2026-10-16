"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import { Menu, X, ChevronDown, Check, AlertCircle, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiGet } from "../../lib/api";
import { apiGetCached, CACHE_TTL } from "../../lib/api-cache";
import type { Usage, UserProfile } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import { Pill } from "./Pill";
import { Button } from "./Button";
import SoundToggle from "./SoundToggle";

export type TopbarProps = {
  user?: User | null;
  usage?: Usage | null;
  role?: "player" | "coach" | null;
  onAuthChange?: () => void;
  onToggleRole?: () => Promise<void> | void;
  onOpenAIDrawer?: () => void;
  className?: string;
};

// Official Google 'G' Logo SVG (4 brand colors)
export function GoogleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H1.02v2.33C2.5 15.91 5.51 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.4 5.4 0 0 1 3.69 9c0-.59.1-1.17.28-1.71V4.96H1.02A8.996 8.996 0 0 0 0 9c0 1.45.35 2.82 1.02 4.04l2.95-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0 5.51 0 2.5 2.09 1.02 4.96l2.95 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  matcher: (p: string) => boolean;
  /** Rendered only for coach accounts. */
  coachOnly?: boolean;
};

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Review", matcher: (p) => p === "/" || p.startsWith("/analysis") },
  { href: "/progress", label: "Progress", matcher: (p) => p.startsWith("/progress") },
  { href: "/studies", label: "Studies", matcher: (p) => p.startsWith("/studies") || p.startsWith("/study") },
  { href: "/scout", label: "Scout", matcher: (p) => p.startsWith("/scout") },
  {
    href: "/coach",
    label: "Students",
    matcher: (p) => p.startsWith("/coach"),
    coachOnly: true,
  },
  { href: "/subscription", label: "Subscription", matcher: (p) => p.startsWith("/subscription") || p.startsWith("/upgrade") },
  { href: "/history", label: "History", matcher: (p) => p.startsWith("/history") },
  { href: "/tactics", label: "Tactics", matcher: (p) => p.startsWith("/tactics") },
  { href: "/about", label: "About", matcher: (p) => p.startsWith("/about") },
  { href: "/faq", label: "FAQ", matcher: (p) => p.startsWith("/faq") },
];

export function Topbar({
  user,
  usage,
  role,
  onAuthChange,
  onToggleRole,
  onOpenAIDrawer,
  className = "",
}: TopbarProps) {
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [internalUser, setInternalUser] = useState<User | null>(user ?? null);
  const [internalRole, setInternalRole] = useState<"player" | "coach" | null>(role ?? null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  /**
   * Pages that don't pass `role` (Progress, History, Studies, …) still need the
   * Students tab for coach accounts — and the bottom dock resolves the role the
   * same way, so the two surfaces can never disagree.
   */
  useEffect(() => {
    if (role) {
      setInternalRole(role);
      return;
    }
    let cancelled = false;
    const loadRole = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (!cancelled) {
            setInternalRole(null);
          }
          return;
        }
        const profile = await apiGetCached<UserProfile>("/api/account/profile", token, {
          ttlMs: CACHE_TTL.account,
        }).catch(() => null);
        if (!cancelled) {
          setInternalRole(profile?.role ?? null);
        }
      } catch {
        if (!cancelled) {
          setInternalRole(null);
        }
      }
    };
    void loadRole();
    const handler = () => void loadRole();
    window.addEventListener("cm_auth_changed", handler);
    window.addEventListener("cm_students_changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("cm_auth_changed", handler);
      window.removeEventListener("cm_students_changed", handler);
    };
  }, [role]);

  const effectiveRole = role ?? internalRole;

  // "Students" replaces the old "Coach" entry and is only for coach accounts.
  const navItems = useMemo(
    () => BASE_NAV_ITEMS.filter((item) => !item.coachOnly || effectiveRole === "coach"),
    [effectiveRole]
  );

  // Sync internal user state with Supabase session and localStorage demo state
  useEffect(() => {
    // If user prop was explicitly passed and non-null, prioritize it
    if (user !== undefined && user !== null) {
      setInternalUser(user);
      return;
    }

    // Check for query parameter auth errors (e.g. from /auth/callback)
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const urlError = searchParams.get("auth_error");
      if (urlError) {
        setAuthNotice(decodeURIComponent(urlError));
      }
    }

    const syncSession = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) {
          setInternalUser(data.session.user);
          return;
        }
      } catch {
        // Ignore offline or Supabase initialization errors
      }

      if (user === undefined) {
        setInternalUser(null);
      }
    };

    syncSession();

    // Listen for Supabase session changes
    let unsubscribeSupabase = () => {};
    try {
      const supabase = createClient();
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setInternalUser(session?.user ?? null);
      });
      unsubscribeSupabase = () => sub.subscription.unsubscribe();
    } catch {
      // Ignore
    }

    // Cross-tab and in-tab synchronization via custom event and storage
    const handleStorage = () => syncSession();
    window.addEventListener("cm_auth_changed", handleStorage);
    window.addEventListener("storage", handleStorage);

    return () => {
      unsubscribeSupabase();
      window.removeEventListener("cm_auth_changed", handleStorage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user]);

  // Active user is either prop user or internally synchronized user
  const effectiveUser = user || internalUser;

  const toggleMenu = () => setMenuOpen((prev) => !prev);
  const closeMenu = () => setMenuOpen(false);

  const handleOpenAI = () => {
    closeMenu();
    if (onOpenAIDrawer) {
      onOpenAIDrawer();
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("open-ai-coach-drawer"));
    }
  };

  const handleGoogleSignIn = useCallback(async () => {
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      const supabase = createClient();
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";
      const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(currentPath)}`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          // No extra Google params on purpose: Supabase manages offline access
          // and the refresh token itself, and injecting access_type/prompt here
          // is what produced Google's "Error 400: invalid_request" (the
          // deployed production request carries neither).
        },
      });

      if (error) {
        console.warn("Google OAuth error:", error.message);
        setAuthNotice(error.message);
      } else if (data?.url) {
        window.location.assign(data.url);
      }
    } catch (err) {
      console.warn("Exception during Google sign in:", err);
      setAuthNotice("Could not reach Google Auth. Please check your connection.");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Ignore
    } finally {
      setInternalUser(null);
      setUserDropdownOpen(false);
      setAuthBusy(false);
      onAuthChange?.();
    }
  }, [onAuthChange]);

  const displayName =
    effectiveUser?.user_metadata?.full_name ??
    effectiveUser?.email?.split("@")[0] ??
    "Player";
  const initials = displayName
    .split(" ")
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className={`relative w-full border-b border-[var(--line-soft)] py-2.5 px-3 sm:px-6 bg-[var(--ink-1)]/95 backdrop-blur-md z-40 ${className}`}>
      {/* Top Banner Notice for Auth Alerts */}
      <AnimatePresence>
        {authNotice && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            className="mb-2 max-w-7xl mx-auto px-3.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3 shadow-md"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={15} className="text-amber-400 shrink-0" />
              <span className="truncate">{authNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAuthNotice(null)}
              className="text-amber-400/80 hover:text-amber-200 text-sm px-1.5 py-0.5 rounded hover:bg-amber-500/20"
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-2 md:gap-4 max-w-[1440px] mx-auto flex-wrap">
        {/* Left: Brand Wordmark */}
        <div className="flex items-center gap-3 lg:gap-6 min-w-0 flex-1 xl:flex-none">
          <Link
            href="/"
            onClick={closeMenu}
            className="shrink-0 inline-flex items-center gap-2 font-serif text-lg sm:text-xl font-bold tracking-tight text-[var(--text)] hover:text-white transition-colors group"
          >
            <span className="w-7 h-7 rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] text-sm group-hover:scale-105 transition-transform">
              ♜
            </span>
            <span className="hidden sm:inline">Chessmasters</span>
          </Link>
        </div>

        {/* Navigation Links — the full tab set. Below lg it takes its own row
            under the brand + actions so nothing is clipped. */}
        <nav data-nav="primary" className="hidden md:flex items-center flex-wrap gap-0.5 order-last w-full xl:order-none xl:w-auto xl:flex-1 xl:justify-center">
          {navItems.map((item) => {
            const active = item.matcher(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-1.5 py-1.5 text-xs font-medium rounded-[var(--radius-control)] transition-all whitespace-nowrap ${
                  active
                    ? "text-[var(--gold-bright)] bg-[var(--ink-3)] font-semibold shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-2)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Actions Container (>= 560px Desktop Container required by e2e-audit) */}
        <div className="hidden sm:flex items-center gap-2 lg:gap-3 shrink-0">
          {/* Interface sound toggle — same preference as the bottom dock */}
          <SoundToggle />

          {/* Free Tier Usage Pill */}
          {usage?.plan === "free" && (
            <Pill tone="neutral" size="sm">
              Free: {usage.analyses_remaining}/{usage.free_analysis_limit}
            </Pill>
          )}

          {/* Ask AI Trigger Button (⌘K) */}
          <button
            type="button"
            onClick={handleOpenAI}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full whitespace-nowrap bg-[var(--ink-2)] border border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--gold)]/40 transition-all cursor-pointer shadow-xs group"
            title="Open AI Coach Drawer (⌘K)"
            aria-label="Open AI Coach Drawer (⌘K)"
          >
            <span className="text-[var(--gold-bright)] text-xs">✦</span>
            <span className="font-medium text-xs">Ask AI</span>
            <kbd className="px-1.5 py-0.2 text-[9px] font-mono bg-[var(--ink-3)] border border-[var(--line)] rounded text-[var(--text-muted)] group-hover:text-[var(--gold-bright)]">
              ⌘K
            </kbd>
          </button>

          {/* Subscription Action Button */}
          {usage?.plan === "paid" ? (
            <Link
              href="/subscription"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--gold-bright)] hover:bg-[var(--gold)]/25 transition-all whitespace-nowrap cursor-pointer"
            >
              <span>👑 Pro Active</span>
            </Link>
          ) : (
            <Link
              href="/subscription"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-[var(--radius-control)] bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] shadow-[0_2px_8px_rgba(201,153,63,0.25)] hover:shadow-[0_4px_14px_rgba(226,182,95,0.45)] hover:-translate-y-0.5 active:translate-y-0 transition-all whitespace-nowrap cursor-pointer"
            >
              <span>👑 Upgrade to Pro</span>
            </Link>
          )}

          {/* Authentication & User State Area */}
          {!effectiveUser ? (
            <div className="flex items-center gap-2">
              {/* Official Google Sign-in Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={authBusy}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 whitespace-nowrap bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 rounded-[var(--radius-control)] text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-60"
                title="Sign in with your Google Account"
              >
                <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
                <span>{authBusy ? "Connecting..." : "Sign in with Google"}</span>
              </button>
            </div>
          ) : (
            /* Signed In User Menu */
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserDropdownOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-[var(--ink-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-xs transition-colors cursor-pointer"
                aria-expanded={userDropdownOpen}
                aria-haspopup="true"
              >
                <div className="w-6 h-6 rounded-full bg-[var(--gold)]/20 border border-[var(--gold)] text-[var(--gold-bright)] font-bold text-[10px] flex items-center justify-center">
                  {initials || "U"}
                </div>
                <div className="text-left hidden md:block">
                  <span className="block font-medium text-[var(--text)] leading-none">
                    {displayName.split(" ")[0]}
                  </span>
                  <span className="text-[9px] font-mono text-[var(--text-muted)] leading-tight">
                    {effectiveRole === "coach" ? "Coach" : "Player"}
                  </span>
                </div>
                <ChevronDown size={13} className="text-[var(--text-muted)]" />
              </button>

              {/* User State Dropdown Popover */}
              <AnimatePresence>
                {userDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-xl py-2 z-50 text-xs"
                  >
                    <div className="px-3.5 py-2 border-b border-[var(--line-soft)]">
                      <div className="font-semibold text-[var(--text)]">{displayName}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">
                        {effectiveUser.email ?? ""}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {effectiveRole === "coach" ? "Coach Account" : "Player Account"}
                        </span>
                        {usage?.plan === "paid" && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--gold)]/15 text-[var(--gold-bright)] border border-[var(--gold)]/30">
                            👑 Pro Active
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="py-1">
                      {onToggleRole && (
                        <button
                          type="button"
                          onClick={() => {
                            onToggleRole();
                            setUserDropdownOpen(false);
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-3)] text-[var(--text)] transition-colors flex items-center justify-between"
                        >
                          <span>{effectiveRole === "coach" ? "Switch to Player view" : "Switch to Coach mode"}</span>
                          <Check size={12} className="text-[var(--gold)]" />
                        </button>
                      )}

                      {usage?.plan === "paid" && (
                        <button
                          type="button"
                          onClick={() => {
                            setUserDropdownOpen(false);
                            if (typeof window !== "undefined") {
                              window.dispatchEvent(new CustomEvent("open-manage-students"));
                            }
                          }}
                          className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-3)] text-[var(--gold-bright)] transition-colors flex items-center justify-between"
                        >
                          <span>👥 Manage Student Profiles</span>
                          <span className="text-[10px] font-mono bg-[var(--gold)]/20 px-1.5 py-0.5 rounded text-[var(--gold-bright)]">Pro</span>
                        </button>
                      )}

                      <Link
                        href="/progress"
                        onClick={() => setUserDropdownOpen(false)}
                        className="block px-3.5 py-2 hover:bg-[var(--ink-3)] text-[var(--text)] transition-colors"
                      >
                        Student Progress & Leaks
                      </Link>

                      <Link
                        href="/history"
                        onClick={() => setUserDropdownOpen(false)}
                        className="block px-3.5 py-2 hover:bg-[var(--ink-3)] text-[var(--text)] transition-colors"
                      >
                        Analysis History
                      </Link>
                    </div>

                    <div className="border-t border-[var(--line-soft)] pt-1">
                      {/* Sign Out */}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={authBusy}
                        className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-3)] text-rose-400 transition-colors"
                      >
                        {authBusy ? "Signing out..." : "Sign out"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Mobile Actions Container (< 560px required by e2e-audit) */}
        <div className="flex sm:hidden items-center gap-2">
          {/* Ask AI Pill Mobile */}
          <button
            type="button"
            onClick={handleOpenAI}
            className="p-1.5 text-[var(--gold-bright)] hover:bg-[var(--ink-2)] rounded-md border border-[var(--line)]"
            title="Ask AI"
          >
            ✦
          </button>

          {/* Upgrade to Pro Mobile */}
          <Link
            href="/subscription"
            className="px-2 py-1 text-[11px] font-bold rounded bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712]"
          >
            👑 Pro
          </Link>

          {/* Hamburger Menu Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            iconStart={menuOpen ? <X size={18} /> : <Menu size={18} />}
          />
        </div>
      </div>

      {/* Mobile Drawer Navigation (< 560px) */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-nav-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="sm:hidden overflow-hidden border-t border-[var(--line-soft)] mt-3 pt-3 flex flex-col gap-3 pb-3"
          >
            {usage?.plan === "free" && (
              <div className="px-1">
                <Pill tone="neutral" size="sm">
                  Free Analyses: {usage.analyses_remaining}/{usage.free_analysis_limit}
                </Pill>
              </div>
            )}

            {/* Mobile Nav Links: All 7 requested routes */}
            <div className="flex flex-col gap-1 text-sm font-medium">
              {navItems.map((item) => {
                const active = item.matcher(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closeMenu}
                    className={`px-3 py-2 rounded-md transition-colors flex items-center justify-between ${
                      active
                        ? "bg-[var(--ink-3)] text-[var(--gold-bright)] font-semibold"
                        : "text-[var(--text)] hover:bg-[var(--ink-2)]"
                    }`}
                  >
                    <span>{item.label}</span>
                    {active && <span className="text-[var(--gold)] text-xs">●</span>}
                  </Link>
                );
              })}

              {usage?.plan === "paid" && (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("open-manage-students"));
                    }
                  }}
                  className="px-3 py-2 rounded-md transition-colors flex items-center justify-between text-[var(--gold-bright)] hover:bg-[var(--ink-2)] text-left"
                >
                  <span className="flex items-center gap-2">
                    <span>👥</span>
                    <span>Manage Students</span>
                  </span>
                  <span className="text-[10px] font-mono bg-[var(--gold)]/20 px-1.5 py-0.5 rounded text-[var(--gold-bright)]">Pro</span>
                </button>
              )}
            </div>

            {/* Mobile Actions: Ask AI & Google Sign-in / User State */}
            <div className="pt-3 border-t border-[var(--line-soft)] flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenAI}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--ink-2)] border border-[var(--line)] text-xs font-semibold text-[var(--text)] hover:border-[var(--gold)]/40"
              >
                <span className="text-[var(--gold)]">✦</span>
                <span>Ask AI Assistant (⌘K)</span>
              </button>

              {!effectiveUser ? (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      handleGoogleSignIn();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-white text-neutral-800 font-medium rounded-lg text-xs"
                  >
                    <GoogleIcon className="w-3.5 h-3.5" />
                    <span>Sign in with Google</span>
                  </button>
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-[var(--ink-2)] border border-[var(--line)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-[var(--gold)]/20 border border-[var(--gold)] text-[var(--gold-bright)] font-bold text-xs flex items-center justify-center">
                      {initials}
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-[var(--text)]">{displayName}</div>
                      <div className="text-[10px] text-[var(--gold-bright)] font-mono">
                        {effectiveRole ? effectiveRole.toUpperCase() : "PLAYER"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleSignOut();
                      closeMenu();
                    }}
                    className="text-xs text-rose-400 hover:underline"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export default Topbar;
