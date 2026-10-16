"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase-client";
import { apiGet } from "../../lib/api";
import type { UserProfile } from "../../lib/api";
import { playSound } from "../../lib/sound";
import SoundToggle from "./SoundToggle";

type DockItem = {
  href: string;
  label: string;
  active: (path: string) => boolean;
  /** Only rendered for coach-role accounts (same rule as the top nav). */
  coachOnly?: boolean;
};

/** Mirrors the top navigation: every tab lives there, the dock mirrors it. */
const DOCK_ITEMS: DockItem[] = [
  { href: "/", label: "Review", active: (p) => p === "/" || p.startsWith("/analysis") },
  { href: "/progress", label: "Progress", active: (p) => p.startsWith("/progress") },
  { href: "/studies", label: "Studies", active: (p) => p.startsWith("/studies") || p.startsWith("/study") },
  { href: "/scout", label: "Scout", active: (p) => p.startsWith("/scout") },
  { href: "/coach", label: "Students", active: (p) => p.startsWith("/coach"), coachOnly: true },
  {
    href: "/subscription",
    label: "Subscription",
    active: (p) => p.startsWith("/subscription") || p.startsWith("/upgrade"),
  },
  { href: "/history", label: "History", active: (p) => p.startsWith("/history") },
  { href: "/tactics", label: "Tactics", active: (p) => p.startsWith("/tactics") },
  { href: "/about", label: "About", active: (p) => p.startsWith("/about") },
  { href: "/faq", label: "FAQ", active: (p) => p.startsWith("/faq") },
];

export default function Dock() {
  const pathname = usePathname() || "/";
  const [role, setRole] = useState<"player" | "coach" | null>(null);

  const syncRole = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setRole(null);
        return;
      }
      const profile = await apiGet<UserProfile>("/api/account/profile", token).catch(() => null);
      setRole(profile?.role ?? null);
    } catch {
      setRole(null);
    }
  }, []);

  useEffect(() => {
    void syncRole();
    const handler = () => void syncRole();
    window.addEventListener("cm_auth_changed", handler);
    window.addEventListener("cm_students_changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("cm_auth_changed", handler);
      window.removeEventListener("cm_students_changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, [syncRole]);

  const items = useMemo(
    () => DOCK_ITEMS.filter((item) => !item.coachOnly || role === "coach"),
    [role]
  );

  // The share portal (/s/{token}) is deliberately chrome-free: no dock there.
  if (pathname.startsWith("/s/")) {
    return null;
  }

  return (
    <nav className="app-dock" aria-label="Quick page switcher">
      <span className="app-dock-label">Page Switcher:</span>
      {items.map((item) => {
        const active = item.active(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`app-dock-btn${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => playSound("click")}
          >
            {item.label}
          </Link>
        );
      })}
      <span className="app-dock-divider" aria-hidden="true" />
      <SoundToggle withLabel />
    </nav>
  );
}
