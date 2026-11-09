"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Menu,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  Compass,
  TrendingUp,
  BookOpen,
  Crosshair,
  Users,
  CreditCard,
  Clock,
  Zap,
  Info,
  HelpCircle,
  MessageSquare,
  ArrowUpRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiGetCached, CACHE_TTL } from "../../lib/api-cache";
import type { Usage, UserProfile } from "../../lib/api";
import { createClient } from "../../lib/supabase-client";
import { Pill } from "./Pill";
import { Button } from "./Button";

export type TopbarProps = {
  user?: User | null;
  usage?: Usage | null;
  role?: "player" | "coach" | null;
  /** Hide the free-plan credit pill (the homepage shows the quota next to the form). */
  showUsagePill?: boolean;
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
  icon: React.ComponentType<{ size?: number; className?: string }>;
  matcher: (p: string) => boolean;
  /** Rendered only for coach accounts. */
  coachOnly?: boolean;
  /** Included in the mobile bottom dock (4 primary tabs + Menu trigger). */
  dockPrimary?: boolean;
};

const BASE_NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Review",
    icon: Compass,
    matcher: (p) => p === "/" || p.startsWith("/analysis"),
    dockPrimary: true,
  },
  {
    href: "/progress",
    label: "Progress",
    icon: TrendingUp,
    matcher: (p) => p.startsWith("/progress"),
    dockPrimary: true,
  },
  {
    href: "/studies",
    label: "Studies",
    icon: BookOpen,
    matcher: (p) => p.startsWith("/studies") || p.startsWith("/study"),
    dockPrimary: true,
  },
  {
    href: "/scout",
    label: "Scout",
    icon: Crosshair,
    matcher: (p) => p.startsWith("/scout"),
    dockPrimary: true,
  },
  {
    href: "/coach",
    label: "Students",
    icon: Users,
    matcher: (p) => p.startsWith("/coach"),
    coachOnly: true,
  },
  {
    href: "/history",
    label: "History",
    icon: Clock,
    matcher: (p) => p.startsWith("/history"),
  },
  {
    href: "/tactics",
    label: "Tactics",
    icon: Zap,
    matcher: (p) => p.startsWith("/tactics"),
  },
  {
    href: "/subscription",
    label: "Subscription",
    icon: CreditCard,
    matcher: (p) => p.startsWith("/subscription") || p.startsWith("/upgrade"),
  },
  {
    href: "/about",
    label: "About",
    icon: Info,
    matcher: (p) => p.startsWith("/about"),
  },
  {
    href: "/faq",
    label: "FAQ",
    icon: HelpCircle,
    matcher: (p) => p.startsWith("/faq"),
  },
];

const SIDEBAR_COLLAPSED_KEY = "cm_sidebar_collapsed";

export function Topbar({
  user,
  usage,
  role,
  showUsagePill = true,
  onAuthChange,
  onToggleRole,
  onOpenAIDrawer,
  className = "",
}: TopbarProps) {
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [internalUser, setInternalUser] = useState<User | null>(user ?? null);
  const [internalRole, setInternalRole] = useState<"player" | "coach" | null>(role ?? null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Sync desktop sidebar collapse state with CSS variable on root so page layout adapts
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
      setSidebarCollapsed(saved);
      document.documentElement.dataset.sidebar = saved ? "collapsed" : "expanded";
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
        document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
      } catch {
        // ignore
      }
      return next;
    });
  };

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

  const navItems = useMemo(
    () => BASE_NAV_ITEMS.filter((item) => !item.coachOnly || effectiveRole === "coach"),
    [effectiveRole]
  );

  const dockItems = useMemo(
    () => navItems.filter((item) => item.dockPrimary).slice(0, 4),
    [navItems]
  );

  // Sync internal user state with Supabase session
  useEffect(() => {
    if (user !== undefined && user !== null) {
      setInternalUser(user);
      return;
    }

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

    const handleStorage = () => syncSession();
    window.addEventListener("cm_auth_changed", handleStorage);
    window.addEventListener("storage", handleStorage);

    return () => {
      unsubscribeSupabase();
      window.removeEventListener("cm_auth_changed", handleStorage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user]);

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
    <header className={`app-nav-shell z-40 ${className}`}>
      {/* Auth Alert Notice */}
      <AnimatePresence>
        {authNotice && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            className="mb-2 max-w-4xl mx-auto px-3.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3 shadow-md"
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

      {/* =====================================================================
          DESKTOP LEFT VERTICAL SIDEBAR (>= 720px / md)
         ===================================================================== */}
      <aside
        aria-label="Desktop sidebar navigation"
        className={`hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-50 bg-[var(--ink-1)]/95 backdrop-blur-md border-r border-[var(--line-soft)] transition-[width] duration-200 ${
          sidebarCollapsed ? "w-[68px]" : "w-[232px]"
        }`}
      >
        {/* Top Brand + Collapse/Expand Button */}
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-3 px-2 border-b border-[var(--line-soft)] shrink-0">
            <button
              type="button"
              onClick={toggleSidebarCollapse}
              className="w-11 h-10 rounded-lg bg-[var(--gold)]/12 border border-[var(--gold)]/35 flex items-center justify-center gap-0.5 text-[var(--gold-bright)] hover:bg-[var(--gold)]/22 transition-colors cursor-pointer"
              aria-label="Expand left sidebar"
              title="Expand sidebar"
            >
              <span className="text-sm font-serif">♜</span>
              <ChevronRight size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-3.5 h-16 border-b border-[var(--line-soft)] shrink-0">
            <Link
              href="/"
              onClick={closeMenu}
              className="inline-flex items-center gap-2.5 font-serif text-lg font-bold tracking-tight text-[var(--text)] hover:text-white transition-colors group min-w-0"
              title="Chessmasters Home"
            >
              <span className="w-8 h-8 rounded-lg bg-[var(--gold)]/12 border border-[var(--gold)]/35 flex items-center justify-center text-[var(--gold-bright)] text-base shrink-0 group-hover:scale-105 transition-transform">
                ♜
              </span>
              <span className="truncate">Chessmasters</span>
            </Link>
            <button
              type="button"
              onClick={toggleSidebarCollapse}
              className="p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-2)] transition-colors cursor-pointer shrink-0"
              aria-label="Collapse left sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}

        {/* Center Navigation Links */}
        <nav
          data-nav="primary"
          aria-label="Primary navigation"
          className="hidden md:flex flex-col flex-1 overflow-y-auto py-3 px-2.5 gap-1"
        >
          {navItems.map((item) => {
            const active = item.matcher(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={sidebarCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-2.5 py-2 text-xs font-medium rounded-[var(--radius-control)] transition-all whitespace-nowrap ${
                  sidebarCollapsed ? "justify-center" : ""
                } ${
                  active
                    ? "text-[var(--gold-bright)] bg-[var(--ink-3)] font-semibold border border-[var(--gold)]/25 shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--ink-2)] border border-transparent"
                }`}
              >
                <Icon
                  size={16}
                  className={active ? "text-[var(--gold-bright)] shrink-0" : "text-[var(--text-muted)] shrink-0"}
                />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions Container (No SoundToggle) */}
        <div className="hidden sm:flex flex-col gap-2 p-2.5 border-t border-[var(--line-soft)] shrink-0">
          {showUsagePill && usage?.plan === "free" && !sidebarCollapsed && (
            <div className="px-1">
              <Pill tone="neutral" size="sm">
                Free: {usage.analyses_remaining}/{usage.free_analysis_limit} left
              </Pill>
            </div>
          )}

          {/* Ask AI Trigger Button (⌘K) */}
          <button
            type="button"
            onClick={handleOpenAI}
            className={`inline-flex items-center ${
              sidebarCollapsed ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
            } text-xs rounded-[var(--radius-control)] bg-[var(--ink-2)] border border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--gold)]/40 transition-all cursor-pointer shadow-xs group`}
            title="Open AI Coach Drawer (⌘K)"
            aria-label="Open AI Coach Drawer (⌘K)"
          >
            <span className="inline-flex items-center gap-2">
              <MessageSquare size={13} className="text-[var(--gold-bright)]" aria-hidden="true" />
              {!sidebarCollapsed && <span className="font-medium text-xs">Ask AI Coach</span>}
            </span>
            {!sidebarCollapsed && (
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--ink-3)] border border-[var(--line)] rounded text-[var(--text-muted)] group-hover:text-[var(--gold-bright)]">
                ⌘K
              </kbd>
            )}
          </button>

          {/* Subscription Action Button */}
          {usage?.plan === "paid" ? (
            <Link
              href="/subscription"
              title="Manage Pro Subscription"
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--gold-bright)] hover:bg-[var(--gold)]/25 transition-all whitespace-nowrap cursor-pointer`}
            >
              {sidebarCollapsed ? <span>Pro</span> : <span>Pro Student</span>}
            </Link>
          ) : (
            <Link
              href="/subscription"
              title="Upgrade to Pro"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-[var(--radius-control)] bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712] shadow-[0_2px_8px_rgba(201,153,63,0.25)] hover:shadow-[0_4px_14px_rgba(226,182,95,0.45)] transition-all whitespace-nowrap cursor-pointer"
            >
              <ArrowUpRight size={14} aria-hidden="true" />
              {!sidebarCollapsed && <span>Upgrade to Pro</span>}
            </Link>
          )}

          {/* Authentication & User State Area */}
          {!effectiveUser ? (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authBusy}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 whitespace-nowrap bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 rounded-[var(--radius-control)] text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-60"
              title="Sign in with your Google Account"
            >
              <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
              {!sidebarCollapsed && (
                <span>{authBusy ? "Connecting..." : "Sign in with Google"}</span>
              )}
            </button>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserDropdownOpen((prev) => !prev)}
                className={`w-full inline-flex items-center ${
                  sidebarCollapsed ? "justify-center p-1.5" : "justify-between px-2.5 py-1.5"
                } rounded-[var(--radius-control)] bg-[var(--ink-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-xs transition-colors cursor-pointer`}
                aria-expanded={userDropdownOpen}
                aria-haspopup="true"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-[var(--gold)]/20 border border-[var(--gold)] text-[var(--gold-bright)] font-bold text-[10px] flex items-center justify-center shrink-0">
                    {initials || "U"}
                  </span>
                  {!sidebarCollapsed && (
                    <span className="text-left truncate">
                      <span className="block font-medium text-[var(--text)] leading-none truncate">
                        {displayName.split(" ")[0]}
                      </span>
                      <span className="text-[9px] font-mono text-[var(--text-muted)] leading-tight">
                        {effectiveRole === "coach" ? "Coach" : "Player"}
                      </span>
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && (
                  <ChevronDown size={13} className="text-[var(--text-muted)] shrink-0" />
                )}
              </button>

              <AnimatePresence>
                {userDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-[var(--ink-2)] border border-[var(--line)] shadow-xl py-2 z-50 text-xs"
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
                            Pro
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
                          <span>
                            {effectiveRole === "coach"
                              ? "Switch to Player view"
                              : "Switch to Coach mode"}
                          </span>
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
                          <span className="flex items-center gap-2"><Users size={14} aria-hidden="true" /> Manage Student Profiles</span>
                          <span className="text-[10px] font-mono bg-[var(--gold)]/20 px-1.5 py-0.5 rounded text-[var(--gold-bright)]">
                            Pro
                          </span>
                        </button>
                      )}

                      <Link
                        href="/progress"
                        onClick={() => setUserDropdownOpen(false)}
                        className="block px-3.5 py-2 hover:bg-[var(--ink-3)] text-[var(--text)] transition-colors"
                      >
                        Student Progress &amp; Leaks
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
      </aside>

      {/* =====================================================================
          MOBILE TOP BAR + COLLAPSIBLE LEFT SIDEBAR + BOTTOM DOCK (< 720px)
         ===================================================================== */}
      <div className="flex md:hidden items-center justify-between gap-2 w-full border-b border-[var(--line-soft)] py-2.5 px-3 bg-[var(--ink-1)]/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {/* Left Collapsible Sidebar Trigger */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-left-drawer"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            iconStart={menuOpen ? <X size={18} /> : <Menu size={18} />}
          />
          <Link
            href="/"
            onClick={closeMenu}
            className="inline-flex items-center gap-2 font-serif text-lg font-bold tracking-tight text-[var(--text)]"
          >
            <span className="w-6 h-6 rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] text-xs">
              ♜
            </span>
            <span>Chessmasters</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenAI}
            className="p-1.5 text-[var(--gold-bright)] hover:bg-[var(--ink-2)] rounded-md border border-[var(--line)] text-xs"
            title="Ask AI"
          >
            <MessageSquare size={14} aria-hidden="true" />
          </button>
          <Link
            href="/subscription"
            className="px-2.5 py-1 text-[11px] font-bold rounded bg-gradient-to-r from-[#c9993f] to-[#e2b65f] text-[#141712]"
          >
            Pro
          </Link>
        </div>
      </div>

      {/* Mobile Collapsible Left Sidebar Drawer (always collapsed by default) */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMenu}
              className="md:hidden fixed inset-0 bg-black/65 backdrop-blur-xs z-50"
              aria-hidden="true"
            />
            <motion.aside
              id="mobile-left-drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="md:hidden fixed top-0 left-0 bottom-0 w-72 max-w-[84vw] bg-[var(--ink-1)] border-r border-[var(--line)] z-50 flex flex-col justify-between p-4 overflow-y-auto shadow-2xl"
              aria-label="Mobile left navigation drawer"
            >
              <div>
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--line-soft)]">
                  <Link
                    href="/"
                    onClick={closeMenu}
                    className="inline-flex items-center gap-2 font-serif text-lg font-bold text-[var(--text)]"
                  >
                    <span className="w-7 h-7 rounded-md bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] text-sm">
                      ♜
                    </span>
                    <span>Chessmasters</span>
                  </Link>
                  <button
                    type="button"
                    onClick={closeMenu}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)]"
                    aria-label="Close left menu"
                  >
                    <X size={18} />
                  </button>
                </div>

                {usage?.plan === "free" && (
                  <div className="mb-3">
                    <Pill tone="neutral" size="sm">
                      Free Analyses: {usage.analyses_remaining}/{usage.free_analysis_limit}
                    </Pill>
                  </div>
                )}

                <div className="flex flex-col gap-1 text-sm font-medium">
                  {navItems.map((item) => {
                    const active = item.matcher(pathname);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMenu}
                        className={`px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between ${
                          active
                            ? "bg-[var(--ink-3)] text-[var(--gold-bright)] font-semibold"
                            : "text-[var(--text)] hover:bg-[var(--ink-2)]"
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon size={16} className={active ? "text-[var(--gold-bright)]" : "text-[var(--text-muted)]"} />
                          <span>{item.label}</span>
                        </span>
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
                      className="px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between text-[var(--gold-bright)] hover:bg-[var(--ink-2)] text-left"
                    >
                      <span className="flex items-center gap-2">
                        <Users size={14} aria-hidden="true" />
                        <span>Manage Students</span>
                      </span>
                      <span className="text-[10px] font-mono bg-[var(--gold)]/20 px-1.5 py-0.5 rounded text-[var(--gold-bright)]">
                        Pro
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--line-soft)] flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={handleOpenAI}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--ink-2)] border border-[var(--line)] text-xs font-semibold text-[var(--text)] hover:border-[var(--gold)]/40"
                >
                  <MessageSquare size={14} className="text-[var(--gold)]" aria-hidden="true" />
                  <span>Ask the coach (⌘K)</span>
                </button>

                {!effectiveUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      handleGoogleSignIn();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-white text-neutral-800 font-semibold rounded-lg text-xs"
                  >
                    <GoogleIcon className="w-3.5 h-3.5" />
                    <span>Sign in with Google</span>
                  </button>
                ) : (
                  <div className="p-2.5 rounded-lg bg-[var(--ink-2)] border border-[var(--line)] flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-[var(--gold)]/20 border border-[var(--gold)] text-[var(--gold-bright)] font-bold text-xs flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-[var(--text)] truncate">
                          {displayName}
                        </div>
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
                      className="text-xs text-rose-400 hover:underline shrink-0"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Dock (4 main destinations + Left Drawer Menu toggle) */}
      <nav
        data-nav="mobile-bottom-dock"
        aria-label="Mobile bottom navigation dock"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--ink-1)]/95 backdrop-blur-md border-t border-[var(--line)] px-2 py-1.5 flex items-center justify-around shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
      >
        {dockItems.map((item) => {
          const active = item.matcher(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                active
                  ? "text-[var(--gold-bright)] font-semibold"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
          aria-controls="mobile-left-drawer"
          className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
            menuOpen
              ? "text-[var(--gold-bright)] font-semibold"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <Menu size={17} />
          <span>Menu</span>
        </button>
      </nav>
    </header>
  );
}

export default Topbar;
