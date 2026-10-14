"use client";

import Link from "next/link";
import React, { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Usage } from "../../lib/api";
import AuthButton from "../AuthButton";
import { Pill } from "./Pill";
import { Button } from "./Button";

export type TopbarProps = {
  user: User | null;
  usage?: Usage | null;
  role?: "player" | "coach" | null;
  onAuthChange: () => void;
  onToggleRole?: () => Promise<void> | void;
  className?: string;
};

export function Topbar({
  user,
  usage,
  role,
  onAuthChange,
  onToggleRole,
}: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => setMenuOpen((prev) => !prev);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="relative w-full border-b border-[var(--line-soft)] py-3 px-1">
      <div className="flex items-center justify-between gap-4">
        {/* Brand Wordmark */}
        <Link
          href="/"
          onClick={closeMenu}
          className="inline-flex items-baseline gap-2 font-serif text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text)] hover:text-white transition-colors"
        >
          <span className="text-[var(--gold)] text-lg leading-none" aria-hidden="true">
            ♜
          </span>
          <span>Chessmasters</span>
        </Link>

        {/* Desktop Navigation (>= 560px) */}
        <div className="hidden sm:flex items-center gap-3">
          {user && (
            <>
              {usage?.plan === "free" && (
                <Pill tone="neutral" size="sm">
                  Free: {usage.analyses_remaining}/{usage.free_analysis_limit}
                </Pill>
              )}
              {role === "coach" && (
                <Link
                  href="/coach"
                  className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1 transition-colors"
                >
                  Coach
                </Link>
              )}
              <Link
                href="/history"
                className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1 transition-colors"
              >
                History
              </Link>
              <Link
                href="/subscription"
                className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1 transition-colors"
              >
                Subscription
              </Link>
            </>
          )}

          <AuthButton
            user={user}
            onAuthChange={onAuthChange}
            role={role}
            onToggleRole={onToggleRole}
          />
        </div>

        {/* Mobile Actions (< 560px) */}
        <div className="flex sm:hidden items-center gap-2">
          {!user ? (
            <AuthButton user={user} onAuthChange={onAuthChange} />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-panel"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              iconStart={menuOpen ? <X size={18} /> : <Menu size={18} />}
            />
          )}
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      <AnimatePresence>
        {menuOpen && user && (
          <motion.div
            id="mobile-nav-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="sm:hidden overflow-hidden border-t border-[var(--line-soft)] mt-3 pt-3 flex flex-col gap-3 pb-2"
          >
            {usage?.plan === "free" && (
              <div className="px-1">
                <Pill tone="neutral" size="sm">
                  Free Analyses: {usage.analyses_remaining}/{usage.free_analysis_limit}
                </Pill>
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm font-medium">
              {role === "coach" && (
                <Link
                  href="/coach"
                  onClick={closeMenu}
                  className="px-2 py-2 text-[var(--text)] hover:bg-[var(--ink-3)] rounded-md transition-colors"
                >
                  Coach Portal
                </Link>
              )}
              <Link
                href="/history"
                onClick={closeMenu}
                className="px-2 py-2 text-[var(--text)] hover:bg-[var(--ink-3)] rounded-md transition-colors"
              >
                Analysis History
              </Link>
              <Link
                href="/subscription"
                onClick={closeMenu}
                className="px-2 py-2 text-[var(--text)] hover:bg-[var(--ink-3)] rounded-md transition-colors"
              >
                Subscription & Pricing
              </Link>
            </div>

            <div className="pt-2 border-t border-[var(--line-soft)]">
              <AuthButton
                user={user}
                onAuthChange={() => {
                  closeMenu();
                  onAuthChange();
                }}
                role={role}
                onToggleRole={onToggleRole}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
