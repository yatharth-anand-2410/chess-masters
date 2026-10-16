"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Download,
  RefreshCw,
  Share2,
} from "lucide-react";
import { Topbar } from "../../components/ui/Topbar";
import { Button } from "../../components/ui/Button";
import { Pill } from "../../components/ui/Pill";
import { createClient } from "../../lib/supabase-client";
import { apiGetCached, invalidateApiCache, CACHE_TTL } from "../../lib/api-cache";
import {
  apiPost,
  shareUrl,
  type ProgressReport,
  type ShareStatus,
  type SpeedBucket,
  type StudentSummary,
  type Usage,
} from "../../lib/api";
import PersonaHero from "../../components/progress/PersonaHero";
import PillarCards from "../../components/progress/PillarCards";
import MovementMatrix from "../../components/progress/MovementMatrix";
import RadarOverlay from "../../components/progress/RadarOverlay";
import EloTrajectoryChart from "../../components/progress/EloTrajectoryChart";
import AccuracyAcplChart from "../../components/progress/AccuracyAcplChart";
import PhaseAccuracyChart from "../../components/progress/PhaseAccuracyChart";
import PanicCurve from "../../components/progress/PanicCurve";
import RootCauseDistribution from "../../components/progress/RootCauseDistribution";
import FocusRules from "../../components/progress/FocusRules";
import ProgressFilterBar from "../../components/progress/ProgressFilterBar";
import CoachStudentRibbon from "../../components/progress/CoachStudentRibbon";
import EmptyPanel from "../../components/progress/EmptyPanel";
import {
  buildProgressQuery,
  daysLabel,
  parseDaysParam,
  parseSpeedsParam,
  serializeSpeeds,
  speedsLabel,
} from "../../components/progress/progressUtils";

function ProgressLoadingShell({ label }: { label: string }) {
  return (
    <main className="progress-page">
      <Topbar />
      <div className="progress-loading" role="status">
        {label}
      </div>
    </main>
  );
}

function ProgressPageContent() {
  const router = useRouter();
  const pathname = usePathname() || "/progress";
  const searchParams = useSearchParams();

  // --- Session bootstrapping (same pattern as the rest of the app) ---
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootReady, setBootReady] = useState(false);

  // --- Coach mode ---
  const [isCoach, setIsCoach] = useState(false);
  const [coachStudents, setCoachStudents] = useState<StudentSummary[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  /** True once the viewing target (student or self) has been decided. */
  const [studentResolved, setStudentResolved] = useState(false);
  const studentInitialized = useRef(false);
  const appliedStudentParam = useRef("");

  // --- Progress report ---
  // The report is stored with the request key it belongs to so a stale payload
  // can never be rendered under a different student or filter selection.
  const [reportState, setReportState] = useState<{ key: string; data: ProgressReport } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // --- Share / export ---
  const [shareBusy, setShareBusy] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Filters live in the URL: ?speeds=blitz,rapid&days=90&student=<id>
  const speedsParam = searchParams.get("speeds");
  const daysParam = searchParams.get("days");
  const studentParam = searchParams.get("student");

  const selectedSpeeds = useMemo(() => parseSpeedsParam(speedsParam), [speedsParam]);
  const windowDays = useMemo(() => parseDaysParam(daysParam), [daysParam]);
  const requestKey = `${selectedStudentId || "self"}::${serializeSpeeds(selectedSpeeds)}::${
    windowDays ?? "all"
  }::${reloadKey}`;
  const report = reportState && reportState.key === requestKey ? reportState.data : null;
  const reportPending = reportLoading || (reportState !== null && report === null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        const session = data.session;
        setUser(session?.user ?? null);
        if (!session) {
          setBootLoading(false);
          setBootReady(true);
          return;
        }
        setToken(session.access_token);
        const usageRes = await apiGetCached<Usage>("/api/account/usage", session.access_token, {
          ttlMs: CACHE_TTL.account,
        }).catch(() => null);
        if (cancelled) return;
        setUsage(usageRes);

        const declaredCoach =
          usageRes?.plan_tier === "coach" ||
          (usageRes?.plan_tier == null && usageRes?.plan === "paid");
        if (declaredCoach) {
          const roster = await apiGetCached<StudentSummary[]>(
            "/api/coach/students",
            session.access_token,
            { ttlMs: CACHE_TTL.account }
          ).catch(() => null);
          if (cancelled) return;
          if (roster) {
            setIsCoach(true);
            setCoachStudents(roster);
          }
        }

        setBootLoading(false);
        setBootReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setBootLoading(false);
          setBootReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the roster when students are created/renamed elsewhere in the app.
  useEffect(() => {
    if (!token || !isCoach) return;
    const handleStudentsChange = async () => {
      try {
        const list = await apiGetCached<StudentSummary[]>("/api/coach/students", token, {
          force: true,
        });
        setCoachStudents(list || []);
      } catch {
        // roster refresh is best-effort
      }
    };
    window.addEventListener("cm_students_changed", handleStudentsChange);
    return () => window.removeEventListener("cm_students_changed", handleStudentsChange);
  }, [token, isCoach]);

  // Adopt ?student=<id> from the URL once and validate it against the roster.
  useEffect(() => {
    if (!bootReady || !isCoach) return;
    if (studentParam && studentParam !== appliedStudentParam.current && coachStudents.length > 0) {
      const requested = coachStudents.find((student) => student.id === studentParam);
      if (requested) {
        appliedStudentParam.current = studentParam;
        studentInitialized.current = true;
        setSelectedStudentId(requested.id);
        setStudentResolved(true);
        return;
      }
    }
    if (studentResolved || studentInitialized.current) return;
    if (coachStudents.length === 0) {
      // Nothing to select — the coach sees their own report.
      setStudentResolved(true);
      return;
    }
    // No usable ?student= → default to the first roster entry once (same as before).
    studentInitialized.current = true;
    appliedStudentParam.current = studentParam ?? "";
    setSelectedStudentId(coachStudents[0].id);
    setStudentResolved(true);
  }, [bootReady, isCoach, coachStudents, studentParam, studentResolved]);

  // Keep the selection valid if the roster changes underneath us.
  useEffect(() => {
    if (!isCoach || coachStudents.length === 0) return;
    if (selectedStudentId && !coachStudents.some((student) => student.id === selectedStudentId)) {
      setSelectedStudentId(coachStudents[0].id);
    }
  }, [isCoach, coachStudents, selectedStudentId]);

  const updateQuery = useCallback(
    (next: { speeds?: SpeedBucket[] | null; days?: number | null; student?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.speeds !== undefined) {
        if (next.speeds === null || next.speeds.length === 0) {
          params.delete("speeds");
        } else {
          params.set("speeds", serializeSpeeds(next.speeds));
        }
      }
      if (next.days !== undefined) {
        if (!next.days) {
          params.delete("days");
        } else {
          params.set("days", String(next.days));
        }
      }
      if (next.student !== undefined) {
        if (!next.student) {
          params.delete("student");
        } else {
          params.set("student", next.student);
        }
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleSpeedsChange = useCallback(
    (next: SpeedBucket[]) => updateQuery({ speeds: next }),
    [updateQuery]
  );
  const handleDaysChange = useCallback(
    (next: number | null) => updateQuery({ days: next }),
    [updateQuery]
  );
  const handleStudentChange = useCallback(
    (studentId: string) => {
      studentInitialized.current = true;
      setSelectedStudentId(studentId);
      updateQuery({ student: studentId || null });
    },
    [updateQuery]
  );

  const viewingStudent = useMemo(
    () => coachStudents.find((student) => student.id === selectedStudentId) ?? null,
    [coachStudents, selectedStudentId]
  );

  // Fetch the ProgressReport for the active target + filter combination.
  useEffect(() => {
    if (!bootReady || !token) return;
    if (isCoach) {
      if (!studentResolved) return;
      if (selectedStudentId && !coachStudents.some((student) => student.id === selectedStudentId)) {
        return;
      }
    }
    let cancelled = false;
    const query = buildProgressQuery(selectedSpeeds, windowDays);
    const path = selectedStudentId
      ? `/api/coach/students/${encodeURIComponent(selectedStudentId)}/progress${query}`
      : `/api/progress${query}`;
    setReportLoading(true);
    setReportError(null);
    apiGetCached<ProgressReport>(path, token, { ttlMs: CACHE_TTL.data })
      .then((data) => {
        if (!cancelled) setReportState({ key: requestKey, data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReportState(null);
        setReportError(err instanceof Error ? err.message : "Failed to load the progress report.");
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // requestKey folds in the student, filters and retry counter; the explicit
    // deps keep the closure honest about the values it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bootReady,
    token,
    isCoach,
    coachStudents,
    selectedStudentId,
    selectedSpeeds,
    windowDays,
    requestKey,
  ]);

  const handleShare = useCallback(async () => {
    if (!selectedStudentId || !token) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const status = await apiPost<ShareStatus>(
        `/api/coach/students/${encodeURIComponent(selectedStudentId)}/share`,
        token
      );
      if (!status?.url_path) {
        setShareError("The share link could not be created.");
        return;
      }
      const absolute = shareUrl(status.url_path);
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(absolute);
        setShareToast("Share link copied to clipboard");
        window.setTimeout(() => setShareToast(null), 2600);
      } else {
        setShareError(`Share link: ${absolute}`);
      }
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : "Could not create the share link.");
    } finally {
      setShareBusy(false);
    }
  }, [selectedStudentId, token]);

  const clearFilters = useCallback(() => {
    updateQuery({ speeds: [], days: null });
  }, [updateQuery]);

  if (bootLoading) {
    return <ProgressLoadingShell label="Loading player telemetry..." />;
  }

  if (!user) {
    return (
      <main className="progress-page">
        <Topbar user={user} usage={usage} />
        <div className="progress-gate">
          <Activity size={48} className="progress-gate-icon" aria-hidden="true" />
          <h2>Sign In to View Your Progress Matrix</h2>
          <p>
            Sign in with your Google account to track your multi-game rating trajectory,
            centipawn loss drift, and psychological leak breakdown over time.
          </p>
          <Link href="/" className="progress-cta-button is-primary">
            Go to Workspace
          </Link>
        </div>
      </main>
    );
  }

  // The backend uses "Student <id-prefix>" as a placeholder for unnamed
  // roster entries; for the player's own view prefer real name sources.
  const rawStudentName = report?.student_name;
  const displayName =
    (rawStudentName && !/^Student [0-9a-f]{6}$/i.test(rawStudentName)
      ? rawStudentName
      : null) ||
    viewingStudent?.display_name ||
    user?.user_metadata?.full_name ||
    (user?.email ? user.email.split("@")[0] : "Player");

  const gamesUsed = report && typeof report.games_used === "number" ? report.games_used : null;
  const insufficient = report?.insufficient === true;
  const noGamesAtAll = report ? (report.identity?.total_games ?? 0) === 0 : false;
  const noGamesInFilter = report ? gamesUsed === 0 && !noGamesAtAll : false;

  return (
    <main className="progress-page">
      <Topbar user={user} usage={usage} />

      {isCoach ? (
        <CoachStudentRibbon
          students={coachStudents}
          selectedId={selectedStudentId}
          onSelect={handleStudentChange}
        />
      ) : null}

      <header className="progress-header">
        <div className="progress-header-copy">
          <nav className="progress-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Workspace</Link>
            <span aria-hidden="true">/</span>
            <span>Analytics</span>
            <span aria-hidden="true">/</span>
            <span className="is-current">{displayName}</span>
          </nav>
          <div className="progress-title-row">
            <h1 className="progress-title">Player Progress &amp; Leak Matrix</h1>
            {report ? (
              <Pill tone="shell" size="sm" dot>
                {report.games_used} games used
              </Pill>
            ) : null}
          </div>
          <p
            className="progress-header-sub"
            title={
              report?.identity
                ? `Applied by server: ${speedsLabel(report.identity.speeds ?? [])} · ${daysLabel(
                    report.identity.days ?? null
                  )}`
                : undefined
            }
          >
            {speedsLabel(selectedSpeeds)} · {daysLabel(windowDays)}
            {report?.identity?.accounts?.length
              ? ` · ${report.identity.accounts.length} tracked ${
                  report.identity.accounts.length === 1 ? "account" : "accounts"
                }`
              : ""}
          </p>
        </div>

        <div className="progress-header-actions">
          {shareToast ? (
            <span className="progress-toast is-ok" role="status">
              <Check size={13} aria-hidden="true" /> {shareToast}
            </span>
          ) : null}
          {shareError ? (
            <span className="progress-toast is-error" role="alert">
              <AlertTriangle size={13} aria-hidden="true" /> {shareError}
            </span>
          ) : null}
          {selectedStudentId ? (
            <Button
              variant="ghost"
              size="sm"
              busy={shareBusy}
              onClick={handleShare}
              iconStart={<Share2 size={14} />}
            >
              Share Student Dossier
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") window.print();
            }}
            iconStart={<Download size={14} />}
          >
            Export PDF
          </Button>
        </div>
      </header>

      <ProgressFilterBar
        speeds={selectedSpeeds}
        days={windowDays}
        matchedGames={report ? report.identity?.filtered_games ?? null : null}
        totalGames={report ? report.identity?.total_games ?? null : null}
        onSpeedsChange={handleSpeedsChange}
        onDaysChange={handleDaysChange}
      />

      <div className="progress-body">
        {reportPending && !report ? (
          <div className="progress-card progress-loading" role="status">
            Loading progress telemetry…
          </div>
        ) : reportError ? (
          <div className="progress-card progress-error" role="alert">
            <AlertTriangle size={26} className="progress-error-icon" aria-hidden="true" />
            <h2>Progress data unavailable</h2>
            <p>{reportError}</p>
            <p className="progress-error-hint">
              The progress endpoint may not be available on this backend yet. Your analyses are
              safe — retry once the backend is updated.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                // An explicit retry must not be answered from the cache.
                invalidateApiCache("/api/progress");
                invalidateApiCache("/api/coach/students/");
                setReloadKey((value) => value + 1);
              }}
              iconStart={<RefreshCw size={14} />}
            >
              Retry
            </Button>
          </div>
        ) : !report ? (
          <div className="progress-card">
            <EmptyPanel message="No progress report was returned for this selection." />
          </div>
        ) : noGamesAtAll ? (
          <div className="progress-gate">
            <BarChart3 size={48} className="progress-gate-icon" aria-hidden="true" />
            <h2>{selectedStudentId ? `${displayName} has no analyzed games yet` : "No Games Analyzed Yet"}</h2>
            <p>
              {selectedStudentId
                ? `In the Review tab, pick "${displayName}" in the Attach to Student dropdown and run an analysis to populate their progress matrix.`
                : "Analyze your chess games on the workspace to generate your longitudinal telemetry."}
            </p>
            {selectedStudentId ? (
              <Link href="/" className="progress-cta-button is-primary">
                Go to Review &amp; Analyze Game
              </Link>
            ) : (
              <Link href="/" className="progress-cta-button is-primary">
                Analyze Your First Game
              </Link>
            )}
          </div>
        ) : (
          <>
            {noGamesInFilter ? (
              <div className="progress-notice" role="status">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  No games match the current filters. Widen the window or clear the game-type chips
                  to unlock the panels below.
                </span>
                <button type="button" className="progress-notice-action" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : null}

            <PersonaHero report={report} fallbackName={viewingStudent?.display_name} />
            <PillarCards report={report} />
            <MovementMatrix report={report} />
            <RadarOverlay report={report} />

            <section className="progress-telemetry-grid" aria-label="Longitudinal telemetry">
              <EloTrajectoryChart elo={report.elo} insufficient={insufficient} />
              <AccuracyAcplChart
                accuracy={report.accuracy}
                acpl={report.acpl}
                insufficient={insufficient}
              />
              <PhaseAccuracyChart
                phases={report.phases}
                insufficient={insufficient}
                gamesUsed={report.games_used}
              />
              <PanicCurve panic={report.panic} insufficient={insufficient} gamesUsed={report.games_used} />
            </section>

            <RootCauseDistribution
              rootCauses={report.root_causes}
              insufficient={insufficient}
              gamesUsed={report.games_used}
            />

            <FocusRules rules={report.focus_rules} playerName={displayName} />
          </>
        )}
      </div>
    </main>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<ProgressLoadingShell label="Loading player telemetry..." />}>
      <ProgressPageContent />
    </Suspense>
  );
}
