"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase-client";
import { apiGet, type Usage, type StudentSummary, type StudentDetail } from "../../lib/api";
import type { User } from "@supabase/supabase-js";
import {
  TrendingUp,
  TrendingDown,
  Award,
  Target,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Share2,
  Download,
  Copy,
  Check,
  Zap,
  Swords,
  ChevronRight,
  Activity,
  Layers,
  BarChart3,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Users,
} from "lucide-react";
import { Topbar } from "../../components/ui/Topbar";
import { Card } from "../../components/ui/Card";
import { Pill } from "../../components/ui/Pill";
import { Button } from "../../components/ui/Button";

// ==========================================
// TYPE DEFINITIONS & STATIC DATASET
// ==========================================

export interface GameTelemetryPoint {
  gameIndex: number;
  gameId: string;
  date: string;
  opponent: string;
  opponentElo: number;
  result: "win" | "draw" | "loss";
  playerColor: "white" | "black";
  opening: string;
  elo: number;
  eloDelta: number;
  caps2: number;
  acpl: number;
  phaseOpening: number;
  phaseMiddlegame: number;
  phaseEndgame: number;
  timeTroubleMoves: number;
  timeTroubleBlunders: number;
}

export interface PsychologicalDimension {
  id: string;
  label: string;
  shortLabel: string;
  baseline: number;
  current: number;
  delta: number;
  status: "Mastered" | "Improving" | "Developing";
  evidence: string;
  recommendation: string;
}

export interface RootCauseBlunder {
  theme: string;
  percentage: number;
  count: number;
  severity: "critical" | "warning" | "moderate";
  color: string;
  mechanism: string;
  prescription: string;
  studySlug: string;
}

export interface MasteryPillarItem {
  id: string;
  title: string;
  badge: string;
  metric: string;
  lift: string;
  summary: string;
  lessonRule: string;
  recommendedDrill: string;
  drillUrl: string;
}

// Baseline default telemetry
const SPRINT_GAMES: GameTelemetryPoint[] = [];

// 6 Psychological Dimensions (Ghost Radar Dataset)
const PSYCH_DIMENSIONS: PsychologicalDimension[] = [
  {
    id: "tactical_vigilance",
    label: "Tactical Vigilance",
    shortLabel: "Tactics",
    baseline: 52,
    current: 86,
    delta: 34,
    status: "Mastered",
    evidence: "Spotting 2-ply tactics 91% of turns; zero missed fork oversights in last 12 games.",
    recommendation: "Maintain pattern recall by solving 5 high-speed deflection puzzles daily.",
  },
  {
    id: "time_management",
    label: "Time Management",
    shortLabel: "Clock",
    baseline: 42,
    current: 64,
    delta: 22,
    status: "Improving",
    evidence: "Average time in moves 20-30 decreased from 64s to 38s; clock scramble blunder rate down from 58% to 38%.",
    recommendation: "Apply the 15-second baseline rule when entering critical rook endings.",
  },
  {
    id: "endgame_conversion",
    label: "Endgame Conversion",
    shortLabel: "Endgame",
    baseline: 48,
    current: 74,
    delta: 26,
    status: "Improving",
    evidence: "Converted 8 of last 9 +1.5 pawn majorities into full points without losing tempo.",
    recommendation: "Work on Lucena & Philidor rook cutoff geometry to eliminate hesitant king steps.",
  },
  {
    id: "opening_discipline",
    label: "Opening Discipline",
    shortLabel: "Opening",
    baseline: 70,
    current: 89,
    delta: 19,
    status: "Mastered",
    evidence: "Achieved 88.0% average CAPS2 in plies 1-14 with Sicilian Najdorf and King's Indian repertoire.",
    recommendation: "Repertoire fully solidified; explore English Attack 6.Be3 e5 subtleties.",
  },
  {
    id: "tilt_resistance",
    label: "Tilt Resistance",
    shortLabel: "Emotional",
    baseline: 44,
    current: 78,
    delta: 34,
    status: "Mastered",
    evidence: "Follow-up accuracy after a loss rose from 71.2% to 85.4%; no post-loss blunder cascade.",
    recommendation: "Continue pre-move breathing protocol between game transitions.",
  },
  {
    id: "defensive_tenacity",
    label: "Defensive Tenacity",
    shortLabel: "Defense",
    baseline: 58,
    current: 82,
    delta: 24,
    status: "Mastered",
    evidence: "Pin defense efficiency jumped to 94%; held 2 fortresses from -1.8 evaluation.",
    recommendation: "Focus on proactive luft creation (h3/h6) prior to committing rooks to the 7th rank.",
  },
];

// Clock Panic Distribution Data
const CLOCK_PANIC_BUCKETS = [
  { bucket: "> 180s", moves: 132, blunders: 5, rate: 3.8, label: "Comfort Baseline", color: "#22c55e" },
  { bucket: "120s - 180s", moves: 154, blunders: 10, rate: 6.5, label: "Deep Calculation", color: "#22c55e" },
  { bucket: "60s - 120s", moves: 118, blunders: 14, rate: 11.9, label: "Pre-Squeeze Transition", color: "#f59e0b" },
  { bucket: "30s - 60s", moves: 92, blunders: 18, rate: 19.6, label: "Scramble Advisory", color: "#f59e0b" },
  { bucket: "< 30s", moves: 76, blunders: 29, rate: 38.2, label: "CRITICAL PANIC ZONE", color: "#ef4444" },
];

// Blunder Root Cause Distribution
const ROOT_CAUSE_BLUNDERS: RootCauseBlunder[] = [
  {
    theme: "Deflections & Defender Removal",
    percentage: 38,
    count: 16,
    severity: "critical",
    color: "#ef4444",
    mechanism: "Overloading crucial guarding pieces. Knights or rooks drawn off the 8th rank or king's shelter by tactical decoys.",
    prescription: "15 Deflection & Decoy Tactical Arena puzzles with 30-second increment timer.",
    studySlug: "deflection-removal-mastery",
  },
  {
    theme: "Relative & Absolute Pins",
    percentage: 24,
    count: 10,
    severity: "warning",
    color: "#f59e0b",
    mechanism: "Moving pieces that shield higher-value pieces along open c-file or diagonals without evaluating subsequent check tempo.",
    prescription: "Pin Exploitation & Shielding Drills (success rate already lifted from 68% to 94%).",
    studySlug: "pin-defense-and-counterstrike",
  },
  {
    theme: "Back-Rank Luft Neglect",
    percentage: 20,
    count: 8,
    severity: "warning",
    color: "#06b6d4",
    mechanism: "Failing to play h3/h6 prior to launching heavy-piece queenside counter-attacks, inviting sudden corridor mates.",
    prescription: "Early King Luft Timing & Corridor Defense thematic exercises.",
    studySlug: "back-rank-air-discipline",
  },
  {
    theme: "Endgame King Inactivity",
    percentage: 18,
    count: 7,
    severity: "moderate",
    color: "#8b9c9c",
    mechanism: "Hesitating to march King to the active center before pawn majorities clash in equal rook endgames.",
    prescription: "King Centralization & Distant Opposition drills in 4v3 pawn structures.",
    studySlug: "endgame-king-march",
  },
];

// 3-Pillar Mastery Tracker Data
const MASTERY_PILLARS = {
  mastered: [
    {
      id: "pin_defense",
      title: "Pin Defense & Counter-Exploitation",
      badge: "Mastered",
      metric: "94% Defense Rate",
      lift: "+26% Lift",
      summary: "Completely eliminated habitual piece-loss when queen or bishop is pinned against royal squares. Responded correctly in 16 of 17 recent pin puzzles.",
      lessonRule: "Rule: When pinned along an open diagonal, break the pin proactively via a counter-threat before opponent doubles rooks.",
      recommendedDrill: "Grandmaster Pin Counter-Strikes",
      drillUrl: "/tactics#pins",
    },
    {
      id: "sicilian_opening",
      title: "Sicilian Najdorf Opening Discipline",
      badge: "Mastered",
      metric: "88.0% CAPS2",
      lift: "+8.8% Lift",
      summary: "Book accuracy sustained across ply 14. Fluent understanding of typical d5 breaks and exchange sacrifices on c3 in 6.Be3 English Attack setups.",
      lessonRule: "Rule: In the Najdorf, delayed king castling is permissible only if queenside counterplay on c-file produces immediate pressure.",
      recommendedDrill: "Najdorf 6.Be3 Interactive Repertoire",
      drillUrl: "/study/najdorf-english-attack",
    },
    {
      id: "fork_detection",
      title: "Fork Detection in Crowded Positions",
      badge: "Mastered",
      metric: "0 Fork Blunders",
      lift: "12 Games Clean",
      summary: "Knight landing vectors (specifically e7, d5, c7) are consistently calculated 2 plies in advance during dense middlegame struggles.",
      lessonRule: "Rule: Always scan undefended pieces on diagonal knight leap coordinates before releasing pawn tension.",
      recommendedDrill: "Advanced Knight Vector Anticipation",
      drillUrl: "/tactics#forks",
    },
  ],
  improving: [
    {
      id: "clock_budgeting",
      title: "Time Budgeting in Complex Endgames",
      badge: "In Progress",
      metric: "38% Scramble Error",
      lift: "-20% Choke Reduction",
      summary: "Significant improvement from the initial 58% blunder choke rate. However, when clock dips under 30s, error spikes remain sharp.",
      lessonRule: "Rule: Maintain at least 45 seconds reserve before entering queen & pawn endgames; trade into simple rook endings when short on time.",
      recommendedDrill: "Blitz Clock Preservation Scenarios",
      drillUrl: "/tactics#clock-management",
    },
    {
      id: "fortress_defense",
      title: "Queen & Minor Piece Fortress Defense",
      badge: "In Progress",
      metric: "64% Endgame CAPS2",
      lift: "+11.9% Lift",
      summary: "Endgame accuracy improved from 52% to 64%. Successfully converted or held fortress draws against two 2150+ opponents this sprint.",
      lessonRule: "Rule: In queen vs rook+minor piece, keep the minor piece anchored to the king to prevent decisive deflection checks.",
      recommendedDrill: "Technical Fortress Tenacity",
      drillUrl: "/study/queen-fortress-mechanics",
    },
    {
      id: "outpost_anchoring",
      title: "Knight Outpost Anchoring (c5/d5 Clamps)",
      badge: "In Progress",
      metric: "76% Conversion",
      lift: "+14% Lift",
      summary: "Securing knight outposts on d5 in Sicilian and c5 in King's Indian. Needs work on rejecting premature trades by the opponent.",
      lessonRule: "Rule: Support the outpost with adjacent pawns (b6/e6); do not exchange the active knight unless receiving clear passed pawns in return.",
      recommendedDrill: "Outpost Domination Masterclass",
      drillUrl: "/study/outpost-conversion",
    },
  ],
  criticalLeaks: [
    {
      id: "deflection_blitz",
      title: "Deflection Blindspots Under Blitz Scramble",
      badge: "Critical Leak",
      metric: "38% of Blunders",
      lift: "16 Fatal Errors",
      summary: "The single largest tactical vulnerability. Overloading defenders on the 8th rank leads to catastrophic deflection rook sacrifices when clock drops under 30s.",
      lessonRule: "Rule: Before playing a fast move under 30 seconds, verify if the moving piece was the sole defender of a key back-rank square.",
      recommendedDrill: "Emergency Deflection Spotting (<15s)",
      drillUrl: "/tactics#deflection",
    },
    {
      id: "back_rank_luft",
      title: "Back-Rank Luft Neglect in Sharp Attacks",
      badge: "Critical Leak",
      metric: "20% of Losses",
      lift: "8 Mates Conceded",
      summary: "Launching queenside pawn storms without creating an escaping flight square (h3 or h6) for the king, resulting in corridor counter-chokes.",
      lessonRule: "Rule: Invest one move for King safety (h3/g3) before shifting both heavy rooks away from your defensive baseline.",
      recommendedDrill: "King Flight Square Timing Audit",
      drillUrl: "/tactics#back-rank",
    },
    {
      id: "premature_simplification",
      title: "Premature Simplification when Ahead in Material",
      badge: "Critical Leak",
      metric: "-1.8 cp Eval Leak",
      lift: "Moves 28-34",
      summary: "When up a clean exchange or pawn, rushing to trade queens too eagerly gives opponent an active outside passed pawn or active rook on the 7th.",
      lessonRule: "Rule: When winning material, first restrict opponent counterplay and consolidate squares; do not trade into a dynamically active enemy rook.",
      recommendedDrill: "Material Advantage Consolidation",
      drillUrl: "/study/advantage-conversion-discipline",
    },
  ],
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function StudentProgressPage() {
  const [activeTimeframe, setActiveTimeframe] = useState<"14g" | "30d" | "all">("14g");
  const [selectedGameIdx, setSelectedGameIdx] = useState<number>(0);
  const [activeChartTab, setActiveChartTab] = useState<"all" | "elo" | "accuracy" | "acpl" | "phases" | "clock">("all");
  const [copiedToast, setCopiedToast] = useState(false);
  const [selectedRadarDimension, setSelectedRadarDimension] = useState<string>("tactical_vigilance");

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [userAnalyses, setUserAnalyses] = useState<any[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);

  // Coach Student Mode (Pro users)
  const [coachStudents, setCoachStudents] = useState<StudentSummary[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null);
  const [studentAnalyses, setStudentAnalyses] = useState<any[]>([]);
  const [loadingStudent, setLoadingStudent] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setUser(session?.user ?? null);
      if (session) {
        setToken(session.access_token);
        try {
          const [analysesRes, usageRes] = await Promise.all([
            apiGet<any[]>("/api/analyses?standalone=true&limit=100", session.access_token).catch(() => []),
            apiGet<Usage>("/api/account/usage", session.access_token).catch(() => null),
          ]);
          setUserAnalyses(analysesRes || []);
          if (usageRes) {
            setUsage(usageRes);
            if (usageRes.plan === "paid") {
              try {
                const studentList = await apiGet<StudentSummary[]>("/api/coach/students", session.access_token);
                setCoachStudents(studentList || []);
                const searchParamStudent = typeof window !== "undefined"
                  ? new URLSearchParams(window.location.search).get("student")
                  : null;
                const initialId = searchParamStudent && studentList.some((s) => s.id === searchParamStudent)
                  ? searchParamStudent
                  : (studentList[0]?.id || "");
                setSelectedStudentId(initialId);
              } catch {
                // not a coach or error
              }
            }
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    });
  }, []);

  // Fetch student specific analyses whenever selectedStudentId changes
  useEffect(() => {
    if (!selectedStudentId || !token) {
      setSelectedStudent(null);
      setStudentAnalyses([]);
      return;
    }
    const studentObj = coachStudents.find((s) => s.id === selectedStudentId) || null;
    setSelectedStudent(studentObj);
    setLoadingStudent(true);
    apiGet<StudentDetail>(`/api/coach/students/${selectedStudentId}`, token)
      .then((detail) => {
        if (detail?.analyses) {
          setStudentAnalyses(detail.analyses);
        }
      })
      .catch(() => {
        setStudentAnalyses([]);
      })
      .finally(() => {
        setLoadingStudent(false);
      });
  }, [selectedStudentId, token, coachStudents]);

  // Listen for student updates
  useEffect(() => {
    const handleStudentsChange = async () => {
      if (!token || !usage || usage.plan !== "paid") return;
      try {
        const list = await apiGet<StudentSummary[]>("/api/coach/students", token);
        setCoachStudents(list || []);
      } catch {
        // ignore
      }
    };
    window.addEventListener("cm_students_changed", handleStudentsChange);
    return () => window.removeEventListener("cm_students_changed", handleStudentsChange);
  }, [token, usage]);

  const isPaid = usage?.plan === "paid";
  const targetAnalyses = isPaid ? studentAnalyses : userAnalyses;

  const activeGames = useMemo<GameTelemetryPoint[]>(() => {
    if (targetAnalyses && targetAnalyses.length > 0) {
      let prevElo = 1500;
      return targetAnalyses.map((a, i) => {
        const isWin = a.result && (a.result.includes("1-0") || a.result.includes("win"));
        const isLoss = a.result && (a.result.includes("0-1") || a.result.includes("loss"));
        const isWhite = (a.player_color || "white").toLowerCase() === "white";
        const pgn = a.pgn || "";

        const wMatch = pgn.match(/\[WhiteElo\s+"(\d+)"\]/);
        const bMatch = pgn.match(/\[BlackElo\s+"(\d+)"\]/);
        const wElo = wMatch ? parseInt(wMatch[1], 10) : null;
        const bElo = bMatch ? parseInt(bMatch[1], 10) : null;

        let userElo = isWhite ? wElo : bElo;
        const oppElo = isWhite ? bElo : wElo;

        if (!userElo && oppElo) {
          userElo = oppElo;
        } else if (!userElo) {
          const deltaEst = isWin ? 15 : (isLoss ? -12 : 1);
          userElo = prevElo + deltaEst;
        }

        const delta = i === 0 ? 0 : userElo - prevElo;
        prevElo = userElo;

        const weaknesses = a.insights?.weakness_moments || [];
        const acpl =
          weaknesses.length > 0
            ? Math.round(
                weaknesses.reduce((sum: number, w: any) => sum + (w.centipawn_loss || 40), 0) /
                  weaknesses.length
              )
            : 35;

        const blunders = weaknesses.filter(
          (w: any) => w.quality === "blunder" || (w.centipawn_loss || 0) >= 200
        ).length;

        return {
          gameIndex: i + 1,
          gameId: a.game_id || (a.id ? a.id.slice(0, 8) : `g-${i + 1}`),
          date: a.created_at
            ? new Date(a.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : `Game ${i + 1}`,
          opponent: a.platform === "lichess" ? "Lichess Player" : "Chess.com Player",
          opponentElo: oppElo || (userElo - 15),
          result: isWin ? "win" : isLoss ? "loss" : "draw",
          playerColor: (a.player_color as "white" | "black") || "white",
          opening: a.opening_name || "Chess Opening",
          elo: userElo,
          eloDelta: delta,
          caps2: Math.max(55, Math.min(98, 100 - Math.round(acpl / 3.5))),
          acpl: Math.min(120, acpl),
          phaseOpening: 84,
          phaseMiddlegame: 72,
          phaseEndgame: 66,
          timeTroubleMoves: 4,
          timeTroubleBlunders: blunders,
        };
      });
    }
    return [];
  }, [targetAnalyses]);

  const selectedGame = useMemo(() => {
    return activeGames[selectedGameIdx] || activeGames[activeGames.length - 1] || null;
  }, [activeGames, selectedGameIdx]);

  const handleCopyShareLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2600);
    }
  };

  const displayName = isPaid
    ? (selectedStudent?.display_name || (coachStudents.length > 0 ? "Select Student" : "No Students"))
    : (user?.user_metadata?.full_name || (user?.email ? user.email.split("@")[0] : "Player"));
  const initials = isPaid
    ? (selectedStudent ? selectedStudent.display_name.slice(0, 2).toUpperCase() : "ST")
    : (displayName.slice(0, 2) || "P").toUpperCase();
  const planLabel = isPaid ? "Coach Pro" : "Free Plan";
  const currentElo = activeGames.length > 0 ? activeGames[activeGames.length - 1]?.elo : 1500;
  const startingElo = activeGames.length > 0 ? activeGames[0]?.elo : 1500;
  const netGain = currentElo - startingElo;
  const winsCount = activeGames.filter((g) => g.result === "win").length;
  const drawsCount = activeGames.filter((g) => g.result === "draw").length;
  const lossesCount = activeGames.filter((g) => g.result === "loss").length;
  const winRate = activeGames.length > 0 ? ((winsCount / activeGames.length) * 100).toFixed(1) : "0.0";
  const peakElo = activeGames.length > 0 ? Math.max(...activeGames.map((g) => g.elo)) : 1500;

  if (loading || (isPaid && coachStudents.length > 0 && (!selectedStudent || loadingStudent))) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />
        <div className="flex items-center justify-center p-20 text-[var(--text-muted)] font-mono text-sm">
          Loading player telemetry...
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />
        <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-2xl space-y-4">
          <Activity size={48} className="text-[var(--gold)]" />
          <h2 className="font-serif text-2xl font-bold text-[var(--text)]">Sign In to View Your Progress Matrix</h2>
          <p className="text-[var(--text-muted)] max-w-md text-sm">
            Sign in with your Google account to track your multi-game rating trajectory, centipawn loss drift, and psychological leak breakdown over time.
          </p>
          <Link href="/" className="px-5 py-2.5 rounded-lg bg-[var(--gold)] text-[#0c1214] font-semibold text-sm hover:opacity-90">
            Go to Workspace
          </Link>
        </div>
      </main>
    );
  }

  // Coach Pro with zero students in roster
  if (isPaid && coachStudents.length === 0) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />
        <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-2xl space-y-4">
          <Users size={48} className="text-[var(--gold)]" />
          <h2 className="font-serif text-2xl font-bold text-[var(--text)]">Coach Roster is Empty</h2>
          <p className="text-[var(--text-muted)] max-w-md text-sm">
            You have Pro Coach access active! Add your first student profile to start tracking their rating trajectory, opening stability, and tactical blunder motifs.
          </p>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("open-manage-students"));
              }
            }}
            className="px-5 py-2.5 rounded-lg bg-[var(--gold)] text-[#0c1214] font-semibold text-sm hover:opacity-90 cursor-pointer"
          >
            + Create Student Profile
          </button>
        </div>
      </main>
    );
  }

  // Coach Pro with student, but 0 analyzed games
  if (isPaid && activeGames.length === 0) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />

        {/* Coach Student Selector Ribbon */}
        <div className="p-4 rounded-2xl bg-[var(--ink-2)] border border-[var(--gold)]/35 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] shrink-0">
              <Users size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--gold-bright)] uppercase tracking-wider font-mono">
                  Coach Mode Active
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--gold)]/20 text-[var(--gold-bright)] border border-[var(--gold)]/30">
                  Pro
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <label htmlFor="coach-student-picker-empty" className="text-xs font-medium text-[var(--text-muted)]">
                  Select Student:
                </label>
                <select
                  id="coach-student-picker-empty"
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-[var(--text)] focus:outline-hidden focus:border-[var(--gold)] cursor-pointer"
                >
                  {coachStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name} ({s.analysis_count} {s.analysis_count === 1 ? "game" : "games"}) {s.chesscom_username ? `· @${s.chesscom_username}` : s.lichess_username ? `· @${s.lichess_username}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("open-manage-students"));
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--gold)]/20 hover:bg-[var(--gold)]/30 text-[var(--gold-bright)] border border-[var(--gold)]/40 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Users size={13} />
              <span>Manage Student Profiles</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-2xl space-y-4">
          <BarChart3 size={48} className="text-[var(--gold)]" />
          <h2 className="font-serif text-2xl font-bold text-[var(--text)]">
            No Games for {selectedStudent ? selectedStudent.display_name : "Selected Student"}
          </h2>
          <p className="text-[var(--text-muted)] max-w-md text-sm">
            No games have been analyzed yet for {selectedStudent ? selectedStudent.display_name : "this student"}. In the Review tab, select &quot;{selectedStudent ? selectedStudent.display_name : "this student"}&quot; in the Attach to Student dropdown and run an analysis to populate their progress matrix!
          </p>
          <div className="flex items-center gap-3">
            <Link href="/" className="px-5 py-2.5 rounded-lg bg-[var(--gold)] text-[#0c1214] font-semibold text-sm hover:opacity-90">
              Go to Review &amp; Analyze Game
            </Link>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("open-manage-students"));
                }
              }}
              className="px-4 py-2.5 rounded-lg border border-[var(--line)] text-[var(--text)] text-sm hover:bg-[var(--ink-3)] cursor-pointer"
            >
              Manage Students
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Non-coach with 0 games
  if (!isPaid && activeGames.length === 0) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />
        <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-2xl space-y-4">
          <BarChart3 size={48} className="text-[var(--gold)]" />
          <h2 className="font-serif text-2xl font-bold text-[var(--text)]">No Games Analyzed Yet</h2>
          <p className="text-[var(--text-muted)] max-w-md text-sm">
            Welcome, {displayName}! Analyze your chess games on the workspace or import your Lichess / Chess.com profile to generate your longitudinal telemetry.
          </p>
          <Link href="/" className="px-5 py-2.5 rounded-lg bg-[var(--gold)] text-[#0c1214] font-semibold text-sm hover:opacity-90">
            Analyze Your First Game
          </Link>
        </div>
      </main>
    );
  }

  // Absolute safety fallback: if activeGames.length is 0, never render the graphs
  if (activeGames.length === 0) {
    return (
      <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
        <Topbar />
        <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-2xl space-y-4">
          <BarChart3 size={48} className="text-[var(--gold)]" />
          <h2 className="font-serif text-2xl font-bold text-[var(--text)]">No Games Analyzed Yet</h2>
          <p className="text-[var(--text-muted)] max-w-md text-sm">
            Analyze your chess games on the workspace or import your Lichess / Chess.com profile to generate your longitudinal telemetry.
          </p>
          <Link href="/" className="px-5 py-2.5 rounded-lg bg-[var(--gold)] text-[#0c1214] font-semibold text-sm hover:opacity-90">
            Analyze Your First Game
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-8">
      {/* Top Navigation */}
      <Topbar />

      {/* Coach Mode: Mandatory Student Selector Ribbon (Pro Plan) */}
      {isPaid && (
        <div className="p-4 rounded-2xl bg-[var(--ink-2)] border border-[var(--gold)]/35 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--gold)]/15 border border-[var(--gold)]/30 flex items-center justify-center text-[var(--gold-bright)] shrink-0">
              <Users size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--gold-bright)] uppercase tracking-wider font-mono">
                  Coach Mode Active
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--gold)]/20 text-[var(--gold-bright)] border border-[var(--gold)]/30">
                  Pro
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <label htmlFor="coach-student-picker-main" className="text-xs font-medium text-[var(--text-muted)]">
                  Select Student:
                </label>
                <select
                  id="coach-student-picker-main"
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--ink-3)] border border-[var(--line)] text-[var(--text)] focus:outline-hidden focus:border-[var(--gold)] cursor-pointer"
                >
                  {coachStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name} ({s.analysis_count} {s.analysis_count === 1 ? "game" : "games"}) {s.chesscom_username ? `· @${s.chesscom_username}` : s.lichess_username ? `· @${s.lichess_username}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("open-manage-students"));
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--gold)]/20 hover:bg-[var(--gold)]/30 text-[var(--gold-bright)] border border-[var(--gold)]/40 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Users size={13} />
              <span>Manage Student Profiles</span>
            </button>
          </div>
        </div>
      )}

      {/* Breadcrumb & Header Action Ribbon */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--line-soft)]">
        <div>
          <nav className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] mb-1" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-[var(--text)] transition-colors">Workspace</Link>
            <span>/</span>
            <Link href="/history" className="hover:text-[var(--text)] transition-colors">Analytics</Link>
            <span>/</span>
            <span className="text-[var(--gold-bright)]">{displayName}</span>
          </nav>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[var(--text)]">
              Player Progress &amp; Leak Matrix
            </h1>
            <Pill tone="shell" size="sm" dot>
              {activeGames.length} Games Tracked
            </Pill>
          </div>
        </div>

        {/* Global Page Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Timeframe selector */}
          <div className="inline-flex items-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-lg p-0.5 text-xs font-mono">
            <button
              onClick={() => setActiveTimeframe("14g")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTimeframe === "14g"
                  ? "bg-[var(--gold)] text-[#0c1214] font-bold shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              14-Game Sprint
            </button>
            <button
              onClick={() => setActiveTimeframe("30d")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTimeframe === "30d"
                  ? "bg-[var(--gold)] text-[#0c1214] font-bold shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => setActiveTimeframe("all")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTimeframe === "all"
                  ? "bg-[var(--gold)] text-[#0c1214] font-bold shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Cohort 90d
            </button>
          </div>

          {/* Share Dossier Link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyShareLink}
            iconStart={copiedToast ? <Check size={14} className="text-[var(--green)]" /> : <Share2 size={14} />}
          >
            {copiedToast ? "Copied to Clipboard" : "Share Dossier"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.print()}
            iconStart={<Download size={14} />}
            className="hidden sm:inline-flex"
          >
            Export PDF
          </Button>
        </div>
      </header>

      {/* ================================================================
          SECTION 1: DYNAMIC STUDENT CULMINATION PROFILE
          ================================================================ */}
      <section aria-labelledby="student-profile-heading" className="space-y-4">
        <h2 id="student-profile-heading" className="sr-only">Student Culmination Profile</h2>
        
        <Card surface="shell" pad="none" className="overflow-hidden border border-[var(--line-soft)] bg-gradient-to-br from-[var(--ink-2)] via-[var(--ink)] to-[#091114]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left Identity Column */}
              <div className="flex items-start sm:items-center gap-4 sm:gap-6">
                {/* Visual Avatar with Gold Ring Badge */}
                <div className="relative shrink-0">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-[#1a262c] to-[#0c1417] border-2 border-[var(--gold)] flex items-center justify-center text-xl sm:text-2xl font-serif font-bold text-[var(--gold-bright)] shadow-lg shadow-black/40">
                    {initials}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-[var(--ink)] border border-[var(--line)] rounded-full p-1" title="Active Account">
                    <Award size={14} className="text-[var(--gold-bright)]" />
                  </div>
                </div>

                {/* Identity & Badges */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="font-serif text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight">
                      {displayName}
                    </h3>
                    <Pill tone="shell" size="sm" className="font-bold">
                      {planLabel}
                    </Pill>
                    {/* Win Rate Badge */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-[rgba(34,197,94,0.14)] text-[#22c55e] border border-[rgba(34,197,94,0.35)] shadow-sm">
                      <TrendingUp size={13} />
                      {winRate}% Win Rate
                    </span>
                  </div>

                  <p className="text-sm text-[var(--text-muted)] flex items-center gap-2 flex-wrap font-mono">
                    {isPaid && selectedStudent ? (
                      <>
                        <span>Student Profile</span>
                        <span className="text-[var(--line-strong)]">·</span>
                        {selectedStudent.chesscom_username && (
                          <span>Chess.com: @{selectedStudent.chesscom_username}</span>
                        )}
                        {selectedStudent.lichess_username && (
                          <span>Lichess: @{selectedStudent.lichess_username}</span>
                        )}
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>Analyses: {activeGames.length} Tracked</span>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>Coach: {user.email}</span>
                      </>
                    ) : (
                      <>
                        <span>User: {user.email}</span>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>Analyses: {activeGames.length} Tracked</span>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>Status: {isPaid ? "Pro Plan" : "Free Plan"}</span>
                      </>
                    )}
                  </p>

                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {isPaid && selectedStudent ? (
                      <Pill tone="neutral" size="sm">
                        Coach Account: <span className="text-[var(--text)] ml-1 font-semibold">{user.email}</span>
                      </Pill>
                    ) : (
                      <Pill tone="neutral" size="sm">
                        Account: <span className="text-[var(--text)] ml-1 font-semibold">{user.email}</span>
                      </Pill>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Rating & Archetype Column */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 sm:gap-6 bg-[var(--ink-3)]/60 border border-[var(--line-soft)] rounded-xl p-4 sm:p-5">
                {/* Elo Big Stat */}
                <div className="space-y-0.5 min-w-[130px]">
                  <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                    Current Rating
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-3xl sm:text-4xl font-extrabold text-[var(--gold-bright)] tabular-nums">
                      {currentElo}
                    </span>
                    <span className="text-xs font-mono text-[var(--text-muted)]">Elo</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--green)]">
                    <ArrowUpRight size={13} />
                    <span>{netGain >= 0 ? `+${netGain}` : netGain} Net Drift</span>
                  </div>
                </div>

                {/* Vertical Divider */}
                <div className="hidden sm:block w-px h-14 bg-[var(--line-soft)]" />

                {/* Archetype Description Card */}
                <div className="space-y-1 max-w-[280px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                      Player Archetype
                    </span>
                    <span className="text-xs font-mono font-bold text-[#06b6d4]">
                      Dynamic Tactical Competitor
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    Longitudinal telemetry calculated from your real game history. Tactical conversion and phase consistency across openings and endgames.
                  </p>
                  {/* Archetype mini breakdown meter */}
                  <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-[var(--ink-2)] mt-1.5">
                    <div style={{ width: "42%" }} className="bg-[#06b6d4]" title="Activist: 42%" />
                    <div style={{ width: "36%" }} className="bg-[var(--gold)]" title="Pragmatist: 36%" />
                    <div style={{ width: "14%" }} className="bg-[#a855f7]" title="Theorist: 14%" />
                    <div style={{ width: "8%" }} className="bg-[var(--text-muted)]" title="Reflector: 8%" />
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Cohort Progress Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 mt-5 border-t border-[var(--line-soft)]">
              <div className="p-2.5 rounded-lg bg-[var(--ink-3)]/30 border border-[var(--line-soft)]">
                <span className="text-[0.7rem] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                  Analyzed Games
                </span>
                <span className="text-lg font-mono font-bold text-[var(--text)] tabular-nums">
                  {activeGames.length} Total
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--ink-3)]/30 border border-[var(--line-soft)]">
                <span className="text-[0.7rem] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                  Win Rate
                </span>
                <span className="text-lg font-mono font-bold text-[var(--green)] tabular-nums">
                  {winRate}% <span className="text-xs font-normal text-[var(--text-muted)]">({winsCount}W / {drawsCount}D / {lossesCount}L)</span>
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--ink-3)]/30 border border-[var(--line-soft)]">
                <span className="text-[0.7rem] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                  Peak Rating
                </span>
                <span className="text-lg font-mono font-bold text-[var(--gold-bright)] tabular-nums">
                  {peakElo} Elo
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--ink-3)]/30 border border-[var(--line-soft)]">
                <span className="text-[0.7rem] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                  Milestone Target
                </span>
                <span className="text-lg font-mono font-bold text-[#06b6d4] tabular-nums">
                  {currentElo + (100 - (currentElo % 100))} Elo <span className="text-xs font-normal text-[var(--text-muted)]">({100 - (currentElo % 100)} to go)</span>
                </span>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ================================================================
          SECTION 2: TRANSPARENT STUDENT MOVEMENT MATRIX
          ================================================================ */}
      <section aria-labelledby="movement-matrix-heading" className="space-y-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap pb-2 border-b border-[var(--line-soft)]">
          <div className="flex items-baseline gap-3">
            <h2 id="movement-matrix-heading" className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              Transparent Movement Matrix
            </h2>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              Baseline (Sep 15) vs Current Form (Oct 15)
            </span>
          </div>
          <Pill tone="accent" size="sm">
            4 Core Strategic Shifts
          </Pill>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Movement Metric 1: Rating Drift */}
          <Card surface="shell" pad="sm" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)] hover:border-[var(--line-strong)] transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Rating Drift
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[var(--green)] bg-[rgba(34,197,94,0.12)] px-2 py-0.5 rounded-full border border-[rgba(34,197,94,0.3)]">
                <ArrowUpRight size={12} />
                +68 Elo (+3.3%)
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1 font-mono">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Before</span>
                <span className="text-xl font-bold text-[var(--text-muted)] line-through decoration-[var(--line-strong)]">
                  2077
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--gold-bright)] block">Current</span>
                <span className="text-2xl font-extrabold text-[var(--gold-bright)]">
                  2145
                </span>
              </div>
            </div>

            {/* Visual Movement Bar */}
            <div className="space-y-1">
              <div className="h-2 w-full bg-[var(--ink-3)] rounded-full overflow-hidden relative">
                {/* Baseline marker at 2077 (mapped relative to 2050-2200 range) */}
                <div style={{ width: "18%" }} className="h-full bg-[var(--line)]" />
                <div style={{ width: "63.3%" }} className="h-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-bright)] rounded-full" />
              </div>
              <div className="flex justify-between text-[0.68rem] font-mono text-[var(--text-muted)]">
                <span>2050 Baseline</span>
                <span className="text-[var(--gold-bright)] font-semibold">2145 Elo</span>
                <span>2200 Target</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed pt-1 border-t border-[var(--line-soft)] font-sans">
              Consistent upward drift with +12 Elo above the FIDE AIM sprint milestone band.
            </p>
          </Card>

          {/* Movement Metric 2: ACPL Centipawn Loss */}
          <Card surface="shell" pad="sm" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)] hover:border-[var(--line-strong)] transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Avg Centipawn Loss
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[var(--green)] bg-[rgba(34,197,94,0.12)] px-2 py-0.5 rounded-full border border-[rgba(34,197,94,0.3)]">
                <ArrowDownRight size={12} />
                -13.9 cp (Sharper)
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1 font-mono">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Before</span>
                <span className="text-xl font-bold text-[var(--text-muted)] line-through decoration-[var(--line-strong)]">
                  42.1 cp
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-[#06b6d4] block">Current</span>
                <span className="text-2xl font-extrabold text-[#06b6d4]">
                  28.2 cp
                </span>
              </div>
            </div>

            {/* Visual Movement Bar */}
            <div className="space-y-1">
              <div className="h-2 w-full bg-[var(--ink-3)] rounded-full overflow-hidden flex">
                <div style={{ width: "45%" }} className="h-full bg-[#06b6d4] rounded-full" />
              </div>
              <div className="flex justify-between text-[0.68rem] font-mono text-[var(--text-muted)]">
                <span>0 (Stockfish)</span>
                <span className="text-[#06b6d4] font-semibold">&lt;30 Master Zone</span>
                <span>60 cp Club</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed pt-1 border-t border-[var(--line-soft)] font-sans">
              Crossed the critical master threshold of &lt;30 cp loss; moves are considerably sharper.
            </p>
          </Card>

          {/* Movement Metric 3: Time Trouble Blunders */}
          <Card surface="shell" pad="sm" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)] hover:border-[var(--line-strong)] transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Time Trouble Blunders
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[var(--green)] bg-[rgba(34,197,94,0.12)] px-2 py-0.5 rounded-full border border-[rgba(34,197,94,0.3)]">
                <ArrowDownRight size={12} />
                -20.0% Reduction
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1 font-mono">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Before (&lt;30s)</span>
                <span className="text-xl font-bold text-[var(--text-muted)] line-through decoration-[var(--line-strong)]">
                  58.0%
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-[#f59e0b] block">Current</span>
                <span className="text-2xl font-extrabold text-[#f59e0b]">
                  38.0%
                </span>
              </div>
            </div>

            {/* Visual Movement Bar */}
            <div className="space-y-1">
              <div className="h-2 w-full bg-[var(--ink-3)] rounded-full overflow-hidden flex">
                <div style={{ width: "38%" }} className="h-full bg-gradient-to-r from-[var(--green)] to-[#f59e0b] rounded-full" />
              </div>
              <div className="flex justify-between text-[0.68rem] font-mono text-[var(--text-muted)]">
                <span>0% Calm</span>
                <span className="text-[#f59e0b] font-semibold">38% Scramble</span>
                <span>100% Choke</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed pt-1 border-t border-[var(--line-soft)] font-sans">
              Panic blunder choke rate fell by 20 points, though &lt;30s remains the primary leak zone.
            </p>
          </Card>

          {/* Movement Metric 4: Pin Defense & Exploitation */}
          <Card surface="shell" pad="sm" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)] hover:border-[var(--line-strong)] transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                Pin Defense Rate
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[var(--green)] bg-[rgba(34,197,94,0.12)] px-2 py-0.5 rounded-full border border-[rgba(34,197,94,0.3)]">
                <ArrowUpRight size={12} />
                +26.0% Mastery
              </span>
            </div>

            <div className="flex items-baseline justify-between pt-1 font-mono">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Before</span>
                <span className="text-xl font-bold text-[var(--text-muted)] line-through decoration-[var(--line-strong)]">
                  68.0%
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-[var(--green)] block">Current</span>
                <span className="text-2xl font-extrabold text-[var(--green)]">
                  94.0%
                </span>
              </div>
            </div>

            {/* Visual Movement Bar */}
            <div className="space-y-1">
              <div className="h-2 w-full bg-[var(--ink-3)] rounded-full overflow-hidden flex">
                <div style={{ width: "94%" }} className="h-full bg-[var(--green)] rounded-full" />
              </div>
              <div className="flex justify-between text-[0.68rem] font-mono text-[var(--text-muted)]">
                <span>50% Leaky</span>
                <span>80% Solid</span>
                <span className="text-[var(--green)] font-semibold">94% Mastered</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed pt-1 border-t border-[var(--line-soft)] font-sans">
              16 of 17 tactical pin tests navigated flawlessly; relative pin leaks almost eliminated.
            </p>
          </Card>
        </div>
      </section>

      {/* ================================================================
          SECTION 3: RICH MULTIPLE TIME-SERIES VISUAL GRAPHS
          ================================================================ */}
      <section aria-labelledby="time-series-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 pb-2 border-b border-[var(--line-soft)]">
          <div>
            <h2 id="time-series-heading" className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              Rich Time-Series Trajectories
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)]">
              Per-game metrics across the 14-game active sprint with milestone targets
            </p>
          </div>

          {/* Chart View Mode Tabs */}
          <div className="inline-flex items-center bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-lg p-0.5 text-xs font-mono overflow-x-auto">
            <button
              onClick={() => setActiveChartTab("all")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "all" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              All 5 Trajectories
            </button>
            <button
              onClick={() => setActiveChartTab("elo")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "elo" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Elo Trajectory
            </button>
            <button
              onClick={() => setActiveChartTab("accuracy")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "accuracy" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Accuracy (CAPS2)
            </button>
            <button
              onClick={() => setActiveChartTab("acpl")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "acpl" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Centipawn Loss
            </button>
            <button
              onClick={() => setActiveChartTab("phases")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "phases" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Game Phases
            </button>
            <button
              onClick={() => setActiveChartTab("clock")}
              className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
                activeChartTab === "clock" ? "bg-[var(--gold)] text-[#0c1214] font-bold" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Clock Panic
            </button>
          </div>
        </div>

        {/* Selected Game Quick Telemetry Strip */}
        {selectedGame && (
          <div className="bg-[var(--ink-2)] border border-[var(--line-soft)] rounded-xl p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-[var(--gold-bright)]">
                Inspecting Game #{selectedGame.gameIndex} ({selectedGame.date})
              </span>
              <span className="text-[var(--line-strong)]">|</span>
              <span className="text-[var(--text)]">vs {selectedGame.opponent} ({selectedGame.opponentElo})</span>
              <span className="text-[var(--line-strong)]">|</span>
              <span className={selectedGame.result === "win" ? "text-[var(--green)] font-bold uppercase" : selectedGame.result === "loss" ? "text-[var(--red)] font-bold uppercase" : "text-[var(--amber)] font-bold uppercase"}>
                {selectedGame.result} as {selectedGame.playerColor}
              </span>
              <span className="text-[var(--line-strong)]">|</span>
              <span className="text-[var(--text-muted)]">{selectedGame.opening}</span>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="text-[var(--text-muted)]">Elo: </span>
                <span className="text-[var(--gold-bright)] font-bold">{selectedGame.elo}</span>
                <span className={(selectedGame.eloDelta ?? 0) >= 0 ? "text-[var(--green)] ml-1" : "text-[var(--red)] ml-1"}>
                  {((selectedGame.eloDelta ?? 0) >= 0 ? `+${selectedGame.eloDelta}` : selectedGame.eloDelta)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Accuracy: </span>
                <span className="text-[#06b6d4] font-bold">{(selectedGame.caps2 ?? 0).toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">ACPL: </span>
                <span className="text-[var(--text)] font-bold">{(selectedGame.acpl ?? 0).toFixed(1)} cp</span>
              </div>
            </div>
          </div>
        )}

        {/* Graph 1: Elo Rating Trajectory with Milestone Target Band */}
        {(activeChartTab === "all" || activeChartTab === "elo") && (
          <Card surface="shell" pad="md" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-serif text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                  <span>1. Elo Rating Trajectory</span>
                  <Pill tone="shell" size="sm">{startingElo} → {currentElo} ({netGain >= 0 ? `+${netGain}` : netGain})</Pill>
                </h3>
                <p className="text-xs text-[var(--text-muted)] font-mono">
                  {activeGames.length}-game progression trajectory with real game-by-game ratings
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[var(--gold-bright)]" />
                  <span className="text-[var(--gold-bright)]">{displayName} ({currentElo})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-[#06b6d4]" />
                  <span className="text-[#06b6d4]">{currentElo + 100} Target Band</span>
                </div>
              </div>
            </div>

            {/* SVG Elo Spline */}
            <div className="w-full overflow-x-auto">
              <div className="min-w-[680px]">
                <svg viewBox="0 0 760 260" className="w-full h-auto select-none font-mono" role="img" aria-label="Elo Rating Trajectory graph">
                  <defs>
                    <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c9993f" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#c9993f" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="targetBandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {/* Shaded Target Corridor */}
                  <rect x="50" y="20" width="670" height="50" fill="url(#targetBandGrad)" />
                  <line x1="50" y1="20" x2="720" y2="20" stroke="#06b6d4" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
                  <text x="715" y="16" fill="#06b6d4" fontSize="10" textAnchor="end">Master Milestone Corridor</text>

                  {/* Dynamic Gridlines */}
                  {(() => {
                    const minElo = Math.min(...activeGames.map((g) => g.elo));
                    const maxElo = Math.max(...activeGames.map((g) => g.elo));
                    const yMin = Math.floor((minElo - 20) / 20) * 20;
                    const yMax = Math.ceil((maxElo + 20) / 20) * 20;
                    const yRange = Math.max(40, yMax - yMin);
                    const stepR = Math.round(yRange / 4);
                    const gridRatings = [yMin, yMin + stepR, yMin + stepR * 2, yMin + stepR * 3, yMax];

                    return gridRatings.map((rating) => {
                      const y = 220 - ((rating - yMin) / yRange) * 180;
                      return (
                        <g key={rating}>
                          <line x1="50" y1={y} x2="720" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                          <text x="42" y={y + 3} fill="var(--text-muted)" fontSize="10" textAnchor="end">
                            {rating}
                          </text>
                        </g>
                      );
                    });
                  })()}

                  {/* Plot Rating Line */}
                  {(() => {
                    const minElo = Math.min(...activeGames.map((g) => g.elo));
                    const maxElo = Math.max(...activeGames.map((g) => g.elo));
                    const yMin = Math.floor((minElo - 20) / 20) * 20;
                    const yMax = Math.ceil((maxElo + 20) / 20) * 20;
                    const yRange = Math.max(40, yMax - yMin);
                    const stepX = activeGames.length > 1 ? 650 / (activeGames.length - 1) : 325;

                    const points = activeGames.map((g, i) => {
                      const x = 60 + i * stepX;
                      const y = 220 - ((g.elo - yMin) / yRange) * 180;
                      return { x, y, game: g };
                    });

                    // Build smooth cubic bezier path
                    let pathD = `M ${points[0].x} ${points[0].y}`;
                    for (let i = 0; i < points.length - 1; i++) {
                      const p0 = points[i];
                      const p1 = points[i + 1];
                      const cpX = (p0.x + p1.x) / 2;
                      pathD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
                    }

                    const areaD = `${pathD} L ${points[points.length - 1].x} 220 L ${points[0].x} 220 Z`;

                    return (
                      <>
                        {/* Area gradient under spline */}
                        <path d={areaD} fill="url(#eloGrad)" />
                        {/* Spline curve */}
                        <path d={pathD} fill="none" stroke="#e2b65f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                        {/* Data dots with click and hover */}
                        {points.map((pt, i) => {
                          const isSelected = selectedGameIdx === i;
                          return (
                            <g
                              key={pt.game.gameId}
                              className="cursor-pointer group"
                              onClick={() => setSelectedGameIdx(i)}
                            >
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r={isSelected ? 6 : 4}
                                fill={isSelected ? "#06b6d4" : "#e2b65f"}
                                stroke="#080c0e"
                                strokeWidth="2"
                                className="transition-all duration-150"
                              />
                              {isSelected && (
                                <circle
                                  cx={pt.x}
                                  cy={pt.y}
                                  r={9}
                                  fill="none"
                                  stroke="#06b6d4"
                                  strokeWidth="1.5"
                                  className="animate-ping"
                                />
                              )}
                              {/* X-axis labels */}
                              <text
                                x={pt.x}
                                y="240"
                                fill={isSelected ? "#06b6d4" : "var(--text-muted)"}
                                fontSize="10"
                                textAnchor="middle"
                                fontWeight={isSelected ? "bold" : "normal"}
                              >
                                G{pt.game.gameIndex}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>
          </Card>
        )}

        {/* Side-by-side row: Accuracy Trajectory & ACPL Progression */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Graph 2: Accuracy (CAPS2) Trajectory */}
          {(activeChartTab === "all" || activeChartTab === "accuracy") && (
            <Card surface="shell" pad="md" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                    <span>2. Accuracy (CAPS2) Trajectory</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Per-game accuracy (74.2% → 92.1%) with 5-game rolling average
                  </p>
                </div>
                <Pill tone="accent" size="sm">Avg: 83.8%</Pill>
              </div>

              <div className="w-full">
                <svg viewBox="0 0 540 200" className="w-full h-auto select-none font-mono" role="img" aria-label="CAPS2 Accuracy trajectory">
                  <defs>
                    <linearGradient id="capsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Y range: 70% to 100%, height 140 (y=160 to y=20), scale = 140 / 30 = 4.66 px per % */}
                  {[70, 80, 90, 100].map((acc) => {
                    const y = 160 - (acc - 70) * 4.66;
                    return (
                      <g key={acc}>
                        <line x1="38" y1={y} x2="520" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x="32" y={y + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">
                          {acc}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Master 85% Benchmark Line */}
                  <line x1="38" y1={160 - 15 * 4.66} x2="520" y2={160 - 15 * 4.66} stroke="rgba(201,153,63,0.3)" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="515" y={160 - 15 * 4.66 - 4} fill="var(--gold-bright)" fontSize="8.5" textAnchor="end">
                    85% Master Standard
                  </text>

                  {/* Accuracy Line & Points */}
                  {(() => {
                    const step = activeGames.length > 1 ? 470 / (activeGames.length - 1) : 235;
                    const pts = activeGames.map((g, i) => ({
                      x: 45 + i * step,
                      y: 160 - (g.caps2 - 70) * 4.66,
                      game: g,
                    }));

                    // Rolling 5-game average points
                    const rollingPts = activeGames.map((g, i) => {
                      const start = Math.max(0, i - 4);
                      const slice = activeGames.slice(start, i + 1);
                      const avg = slice.reduce((acc, cur) => acc + cur.caps2, 0) / slice.length;
                      return {
                        x: 45 + i * step,
                        y: 160 - (avg - 70) * 4.66,
                        avg,
                      };
                    });

                    const pathD = pts.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`, "");
                    const rollingD = rollingPts.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`, "");
                    const areaD = `${pathD} L ${pts[pts.length - 1].x} 160 L ${pts[0].x} 160 Z`;

                    return (
                      <>
                        <path d={areaD} fill="url(#capsGrad)" />
                        <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth="2" />
                        {/* Rolling average trendline */}
                        <path d={rollingD} fill="none" stroke="#e2b65f" strokeWidth="1.75" strokeDasharray="4 3" />

                        {pts.map((pt, i) => (
                          <circle
                            key={pt.game.gameId}
                            cx={pt.x}
                            cy={pt.y}
                            r={selectedGameIdx === i ? 5 : 3.5}
                            fill={pt.game.result === "win" ? "#22c55e" : pt.game.result === "loss" ? "#ef4444" : "#f59e0b"}
                            stroke="#080c0e"
                            strokeWidth="1.5"
                            className="cursor-pointer"
                            onClick={() => setSelectedGameIdx(i)}
                          />
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--line-soft)] text-xs font-mono text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#06b6d4]" />
                  Per-Game CAPS2
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-[#e2b65f]" />
                  5-Game Rolling Trend (78.2% → 88.4%)
                </span>
              </div>
            </Card>
          )}

          {/* Graph 3: Centipawn Loss (ACPL) Trajectory */}
          {(activeChartTab === "all" || activeChartTab === "acpl") && (
            <Card surface="shell" pad="md" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                    <span>3. Centipawn Loss (ACPL) Curve</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Downward progression curve indicating sharper play (46.2 → 22.8 cp)
                  </p>
                </div>
                <Pill tone="positive" size="sm">Sharper Play</Pill>
              </div>

              <div className="w-full">
                <svg viewBox="0 0 540 200" className="w-full h-auto select-none font-mono" role="img" aria-label="Centipawn loss curve">
                  <defs>
                    <linearGradient id="acplGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Y range: 50 cp down to 15 cp, height 140 (y=20 to y=160), scale = 140 / 35 = 4 px per cp */}
                  {[50, 40, 30, 20].map((cp) => {
                    const y = 20 + (50 - cp) * 4;
                    return (
                      <g key={cp}>
                        <line x1="38" y1={y} x2="520" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x="32" y={y + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">
                          {cp}
                        </text>
                      </g>
                    );
                  })}

                  {/* Master 30 cp threshold line */}
                  <line x1="38" y1={20 + 20 * 4} x2="520" y2={20 + 20 * 4} stroke="rgba(34,197,94,0.4)" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="515" y={20 + 20 * 4 - 4} fill="#22c55e" fontSize="8.5" textAnchor="end">
                    &lt;30 cp Master Precision Threshold
                  </text>

                  {/* ACPL Path */}
                  {(() => {
                    const step = activeGames.length > 1 ? 470 / (activeGames.length - 1) : 235;
                    const pts = activeGames.map((g, i) => ({
                      x: 45 + i * step,
                      y: 20 + (50 - g.acpl) * 4,
                      game: g,
                    }));

                    const pathD = pts.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`, "");
                    const areaD = `${pathD} L ${pts[pts.length - 1].x} 160 L ${pts[0].x} 160 Z`;

                    return (
                      <>
                        <path d={areaD} fill="url(#acplGrad)" />
                        <path d={pathD} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
                        {pts.map((pt, i) => (
                          <circle
                            key={pt.game.gameId}
                            cx={pt.x}
                            cy={pt.y}
                            r={selectedGameIdx === i ? 5 : 3.5}
                            fill="#22c55e"
                            stroke="#080c0e"
                            strokeWidth="1.5"
                            className="cursor-pointer"
                            onClick={() => setSelectedGameIdx(i)}
                          />
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--line-soft)] text-xs font-mono text-[var(--text-muted)]">
                <span>Baseline Sprint Start: 46.2 cp</span>
                <span className="text-[var(--green)] font-semibold">Latest Match: 22.8 cp (-50.6% precision swing)</span>
              </div>
            </Card>
          )}
        </div>

        {/* Side-by-side row: Phase-by-Phase Accuracy Splines & Time Management Panic Curve */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Graph 4: Phase-by-Phase Accuracy Splines */}
          {(activeChartTab === "all" || activeChartTab === "phases") && (
            <Card surface="shell" pad="md" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                    <span>4. Phase-by-Phase Accuracy Splines</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Opening (88%), Middlegame (72%), Endgame (64%) trends over sprint
                  </p>
                </div>
              </div>

              <div className="w-full">
                <svg viewBox="0 0 540 210" className="w-full h-auto select-none font-mono" role="img" aria-label="Game phase accuracy splines">
                  {/* Y range: 45% to 95%, height 140 (y=160 to y=20), scale = 140 / 50 = 2.8 px per % */}
                  {[50, 60, 70, 80, 90].map((val) => {
                    const y = 160 - (val - 45) * 2.8;
                    return (
                      <g key={val}>
                        <line x1="38" y1={y} x2="520" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x="32" y={y + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">
                          {val}%
                        </text>
                      </g>
                    );
                  })}

                  {(() => {
                    const step = activeGames.length > 1 ? 470 / (activeGames.length - 1) : 235;
                    const openingPts = activeGames.map((g, i) => ({
                      x: 45 + i * step,
                      y: 160 - (g.phaseOpening - 45) * 2.8,
                    }));
                    const middlePts = activeGames.map((g, i) => ({
                      x: 45 + i * step,
                      y: 160 - (g.phaseMiddlegame - 45) * 2.8,
                    }));
                    const endPts = activeGames.map((g, i) => ({
                      x: 45 + i * step,
                      y: 160 - (g.phaseEndgame - 45) * 2.8,
                    }));

                    const openingPath = openingPts.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "");
                    const middlePath = middlePts.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "");
                    const endPath = endPts.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "");

                    return (
                      <>
                        <path d={openingPath} fill="none" stroke="#06b6d4" strokeWidth="2.2" />
                        <path d={middlePath} fill="none" stroke="#e2b65f" strokeWidth="2.2" />
                        <path d={endPath} fill="none" stroke="#22c55e" strokeWidth="2.2" />

                        {/* Selected Game vertical marker line */}
                        <line
                          x1={45 + selectedGameIdx * step}
                          y1="20"
                          x2={45 + selectedGameIdx * step}
                          y2="160"
                          stroke="rgba(255,255,255,0.2)"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* Legend with Current Scores */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--line-soft)] text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#06b6d4]" />
                  <span>Opening: <strong className="text-[#06b6d4]">88.0%</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#e2b65f]" />
                  <span>Middlegame: <strong className="text-[#e2b65f]">72.0%</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#22c55e]" />
                  <span>Endgame: <strong className="text-[#22c55e]">64.0%</strong></span>
                </div>
              </div>
            </Card>
          )}

          {/* Graph 5: Time Management Panic Curve */}
          {(activeChartTab === "all" || activeChartTab === "clock") && (
            <Card surface="shell" pad="md" className="space-y-3 bg-[var(--ink-2)] border border-[var(--line-soft)]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-[var(--text)] flex items-center gap-2">
                    <span>5. Time Trouble Panic Curve</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Blunder frequency vs remaining clock time with severe &lt;30s spike
                  </p>
                </div>
                <Pill tone="alert" size="sm">Panic &lt;30s</Pill>
              </div>

              <div className="w-full">
                <svg viewBox="0 0 540 210" className="w-full h-auto select-none font-mono" role="img" aria-label="Time trouble panic curve graph">
                  <defs>
                    <linearGradient id="panicZoneGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity="0.04" />
                    </linearGradient>
                  </defs>

                  {/* Y range: 0% to 45% blunder rate, height 130 (y=160 to y=30) */}
                  {[0, 10, 20, 30, 40].map((rate) => {
                    const y = 160 - (rate / 45) * 130;
                    return (
                      <g key={rate}>
                        <line x1="38" y1={y} x2="520" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x="32" y={y + 3} fill="var(--text-muted)" fontSize="9" textAnchor="end">
                          {rate}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Panic Zone Background (>30s) */}
                  <rect x="420" y="25" width="100" height="135" fill="url(#panicZoneGrad)" rx="4" />
                  <line x1="420" y1="25" x2="420" y2="160" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="515" y="20" fill="#ef4444" fontSize="9" textAnchor="end" fontWeight="bold">
                    CRITICAL PANIC ZONE (&lt;30s)
                  </text>

                  {/* Panic Curve Line: 5 buckets */}
                  {/* X coordinates: 70, 160, 260, 360, 470 */}
                  {(() => {
                    const xCoords = [70, 160, 260, 360, 470];
                    const pts = CLOCK_PANIC_BUCKETS.map((b, i) => ({
                      x: xCoords[i],
                      y: 160 - (b.rate / 45) * 130,
                      bucket: b,
                    }));

                    const pathD = pts.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x} ${p.y}`, "");

                    return (
                      <>
                        <path d={pathD} fill="none" stroke="#ef4444" strokeWidth="2.5" />
                        {pts.map((p) => (
                          <g key={p.bucket.bucket}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={p.bucket.bucket === "< 30s" ? 6 : 4}
                              fill={p.bucket.color}
                              stroke="#080c0e"
                              strokeWidth="2"
                            />
                            <text
                              x={p.x}
                              y={p.y - 8}
                              fill={p.bucket.color}
                              fontSize="9.5"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              {p.bucket.rate}%
                            </text>
                            <text
                              x={p.x}
                              y="180"
                              fill="var(--text-muted)"
                              fontSize="9"
                              textAnchor="middle"
                            >
                              {p.bucket.bucket}
                            </text>
                          </g>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>

              <div className="p-2.5 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-xs text-[var(--text)] leading-relaxed">
                <span className="font-bold text-[#ef4444] font-mono mr-1">Choke Diagnostic:</span>
                Blunder probability increases <strong>9.8x</strong> (from 3.8% to 38.2%) once remaining clock falls below 30 seconds due to fast intuitive pre-moves lacking king flight-check verification.
              </div>
            </Card>
          )}
        </div>
      </section>

      {/* ================================================================
          SECTION 4: TRANSPARENT GHOST RADAR OVERLAY
          ================================================================ */}
      <section aria-labelledby="ghost-radar-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-2 border-b border-[var(--line-soft)]">
          <div>
            <h2 id="ghost-radar-heading" className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              Transparent Ghost Radar Overlay
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)]">
              Baseline Onboarding Ghost (dashed) vs Current Form (cyan) across 6 mental dimensions
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-t border-dashed border-[var(--text-muted)]" />
              Ghost Baseline (Sep 15)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#06b6d4]" />
              Current Form (Oct 15)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left SVG Radar Canvas (5 cols) */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-full max-w-[340px] aspect-square flex items-center justify-center p-2">
              <svg viewBox="0 0 340 340" className="w-full h-auto select-none" role="img" aria-label="Transparent Ghost Radar mental profile overlay">
                <defs>
                  <linearGradient id="currentFormGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity="0.15" />
                  </linearGradient>
                </defs>

                {/* Radar calculation constants: center 170, 170; radius 110 */}
                {(() => {
                  const center = 170;
                  const radius = 105;
                  const count = 6;
                  const rings = [0.25, 0.5, 0.75, 1.0];

                  // Polar coordinate helper
                  const polar = (index: number, r: number) => {
                    const angle = (-90 + (360 / count) * index) * (Math.PI / 180);
                    return {
                      x: center + Math.cos(angle) * r,
                      y: center + Math.sin(angle) * r,
                    };
                  };

                  const makePolygon = (r: number) => {
                    return Array.from({ length: count }, (_, i) => {
                      const pt = polar(i, r);
                      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                    }).join(" ");
                  };

                  // Ghost Baseline Points
                  const baselinePts = PSYCH_DIMENSIONS.map((d, i) => polar(i, radius * (d.baseline / 100)));
                  const baselinePoly = baselinePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

                  // Current Form Points
                  const currentPts = PSYCH_DIMENSIONS.map((d, i) => polar(i, radius * (d.current / 100)));
                  const currentPoly = currentPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

                  return (
                    <>
                      {/* Background concentric rings */}
                      {rings.map((ring) => (
                        <polygon
                          key={ring}
                          points={makePolygon(radius * ring)}
                          fill="none"
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth="1"
                        />
                      ))}

                      {/* 70% Master benchmark polygon */}
                      <polygon
                        points={makePolygon(radius * 0.7)}
                        fill="none"
                        stroke="rgba(201,153,63,0.45)"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />

                      {/* Radial spokes */}
                      {PSYCH_DIMENSIONS.map((dim, i) => {
                        const spokeEnd = polar(i, radius);
                        return (
                          <line
                            key={`spoke-${dim.id}`}
                            x1={center}
                            y1={center}
                            x2={spokeEnd.x}
                            y2={spokeEnd.y}
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="1"
                          />
                        );
                      })}

                      {/* 1. Ghost Baseline (Dashed Outline) */}
                      <polygon
                        points={baselinePoly}
                        fill="rgba(137, 156, 164, 0.08)"
                        stroke="rgba(137, 156, 164, 0.65)"
                        strokeWidth="1.75"
                        strokeDasharray="4 4"
                      />
                      {baselinePts.map((p, i) => (
                        <circle
                          key={`base-dot-${i}`}
                          cx={p.x}
                          cy={p.y}
                          r={3}
                          fill="var(--text-muted)"
                          opacity="0.7"
                        />
                      ))}

                      {/* 2. Current Form (Vibrant Cyan Glow Fill) */}
                      <polygon
                        points={currentPoly}
                        fill="url(#currentFormGrad)"
                        stroke="#06b6d4"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                      {currentPts.map((p, i) => {
                        const isSelected = selectedRadarDimension === PSYCH_DIMENSIONS[i].id;
                        return (
                          <g
                            key={`curr-dot-${i}`}
                            className="cursor-pointer"
                            onClick={() => setSelectedRadarDimension(PSYCH_DIMENSIONS[i].id)}
                          >
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={isSelected ? 6 : 4.5}
                              fill="#06b6d4"
                              stroke="#080c0e"
                              strokeWidth="2"
                            />
                            {isSelected && (
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r={9}
                                fill="none"
                                stroke="#06b6d4"
                                strokeWidth="1.5"
                                className="animate-ping"
                              />
                            )}
                          </g>
                        );
                      })}

                      {/* Spoke Outer Labels */}
                      {PSYCH_DIMENSIONS.map((dim, i) => {
                        const labelPt = polar(i, radius + 22);
                        const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
                        const cos = Math.cos(angle);
                        const anchor = cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
                        const isSelected = selectedRadarDimension === dim.id;

                        return (
                          <text
                            key={`label-${dim.id}`}
                            x={labelPt.x}
                            y={labelPt.y}
                            fill={isSelected ? "#06b6d4" : "var(--text-muted)"}
                            fontSize="10"
                            fontWeight={isSelected ? "bold" : "600"}
                            textAnchor={anchor}
                            dominantBaseline="middle"
                            className="font-mono cursor-pointer transition-colors"
                            onClick={() => setSelectedRadarDimension(dim.id)}
                          >
                            {dim.shortLabel} ({dim.current})
                          </text>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>

          {/* Right Dimension Comparison Matrix (7 cols) */}
          <div className="lg:col-span-7 space-y-2.5">
            <div className="space-y-2">
              {PSYCH_DIMENSIONS.map((dim) => {
                const isSelected = selectedRadarDimension === dim.id;
                return (
                  <div
                    key={dim.id}
                    onClick={() => setSelectedRadarDimension(dim.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[var(--ink-3)] border-[#06b6d4] shadow-md shadow-[#06b6d4]/10"
                        : "bg-[var(--ink-2)] border-[var(--line-soft)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-serif font-semibold text-sm text-[var(--text)]">
                          {dim.label}
                        </span>
                        <Pill
                          tone={dim.status === "Mastered" ? "positive" : "accent"}
                          size="sm"
                        >
                          {dim.status}
                        </Pill>
                      </div>

                      <div className="flex items-center gap-3 font-mono text-xs">
                        <span className="text-[var(--text-muted)]">
                          Baseline: <strong className="text-[var(--text-muted)] line-through">{dim.baseline}</strong>
                        </span>
                        <span className="text-[var(--gold-bright)]">
                          Current: <strong className="text-[var(--gold-bright)]">{dim.current}</strong>
                        </span>
                        <span className="text-[var(--green)] font-bold">
                          +{dim.delta} pts
                        </span>
                      </div>
                    </div>

                    {/* Evidence & Recommendation */}
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--line-soft)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <p className="text-[var(--text-muted)] leading-relaxed">
                        <span className="font-mono font-semibold text-[var(--text)] mr-1">Evidence:</span>
                        {dim.evidence}
                      </p>
                      <span className="text-[0.7rem] font-mono text-[var(--gold-bright)] shrink-0 bg-[var(--ink-2)] px-2 py-0.5 rounded border border-[var(--line-soft)]">
                        {dim.recommendation}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          SECTION 5: BLUNDER ROOT CAUSE DISTRIBUTION
          ================================================================ */}
      <section aria-labelledby="blunder-root-cause-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-2 border-b border-[var(--line-soft)]">
          <div>
            <h2 id="blunder-root-cause-heading" className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              Blunder Root Cause Distribution
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)]">
              Horizontal proportional distribution of tactical vulnerabilities across 42 examined error incidents
            </p>
          </div>
          <Pill tone="alert" size="sm">
            42 Total Errors Audited
          </Pill>
        </div>

        {/* Proportional Horizontal Stacked Bar */}
        <div className="space-y-2">
          <div className="h-6 w-full rounded-xl overflow-hidden flex bg-[var(--ink-2)] border border-[var(--line-soft)] p-0.5">
            {ROOT_CAUSE_BLUNDERS.map((b) => (
              <div
                key={b.theme}
                style={{ width: `${b.percentage}%`, backgroundColor: b.color }}
                className="h-full first:rounded-l-lg last:rounded-r-lg relative group transition-opacity hover:opacity-90"
                title={`${b.theme}: ${b.percentage}% (${b.count} incidents)`}
              />
            ))}
          </div>

          {/* Bar Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            {ROOT_CAUSE_BLUNDERS.map((b) => (
              <div key={b.theme} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
                <span className="truncate text-[var(--text-muted)]">{b.theme}:</span>
                <strong className="text-[var(--text)]">{b.percentage}%</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Breakdown Detail Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {ROOT_CAUSE_BLUNDERS.map((item) => (
            <Card key={item.theme} surface="shell" pad="sm" className="space-y-2.5 bg-[var(--ink-2)] border border-[var(--line-soft)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <h3 className="font-serif font-bold text-sm text-[var(--text)]">
                    {item.theme}
                  </h3>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-[var(--gold-bright)] font-bold">{item.percentage}% of Blunders</span>
                  <span className="text-[var(--text-muted)]">({item.count} items)</span>
                </div>
              </div>

              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                <span className="font-mono font-semibold text-[var(--text)] mr-1">Mechanism:</span>
                {item.mechanism}
              </p>

              <div className="pt-2 border-t border-[var(--line-soft)] flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--green)] font-mono text-[0.7rem] flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  {item.prescription}
                </span>
                <Link
                  href={`/study/${item.studySlug}`}
                  className="font-mono text-xs text-[var(--gold-bright)] hover:underline flex items-center gap-0.5 shrink-0"
                >
                  Drill <ChevronRight size={13} />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ================================================================
          SECTION 6: 3-PILLAR MASTERY TRACKER
          ================================================================ */}
      <section aria-labelledby="mastery-tracker-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-2 border-b border-[var(--line-soft)]">
          <div>
            <h2 id="mastery-tracker-heading" className="font-serif text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight">
              3-Pillar Mastery Evolution
            </h2>
            <p className="text-xs font-mono text-[var(--text-muted)]">
              Structured developmental roadmap from verified strengths to critical tactical leaks
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-[var(--green)]">● Mastered</span>
            <span className="text-[var(--amber)]">● In Progress</span>
            <span className="text-[var(--red)]">● Critical Leaks</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pillar 1: What Has Improved (Mastered) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b-2 border-[var(--green)]">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[var(--green)]" />
                <h3 className="font-serif font-bold text-base text-[var(--text)]">
                  What Has Improved
                </h3>
              </div>
              <Pill tone="positive" size="sm">Mastered</Pill>
            </div>

            <div className="space-y-3">
              {MASTERY_PILLARS.mastered.map((item) => (
                <Card
                  key={item.id}
                  surface="shell"
                  pad="sm"
                  className="space-y-2.5 bg-[var(--ink-2)] border border-[var(--line-soft)] border-l-4 border-l-[var(--green)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-serif font-bold text-sm text-[var(--text)]">
                      {item.title}
                    </h4>
                    <span className="font-mono text-xs font-bold text-[var(--green)] shrink-0 bg-[rgba(34,197,94,0.1)] px-2 py-0.5 rounded border border-[rgba(34,197,94,0.3)]">
                      {item.metric}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="p-2 rounded bg-[var(--ink-3)]/60 text-[0.72rem] text-[var(--text-muted)] font-mono leading-relaxed">
                    {item.lessonRule}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs font-mono">
                    <span className="text-[var(--green)] text-[0.7rem]">{item.lift}</span>
                    <Link
                      href={item.drillUrl}
                      className="text-[var(--gold-bright)] hover:underline inline-flex items-center gap-1"
                    >
                      {item.recommendedDrill} <ChevronRight size={12} />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Pillar 2: What Is Improving (In Progress) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b-2 border-[var(--gold-bright)]">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-[var(--gold-bright)]" />
                <h3 className="font-serif font-bold text-base text-[var(--text)]">
                  What Is Improving
                </h3>
              </div>
              <Pill tone="caution" size="sm">In Progress</Pill>
            </div>

            <div className="space-y-3">
              {MASTERY_PILLARS.improving.map((item) => (
                <Card
                  key={item.id}
                  surface="shell"
                  pad="sm"
                  className="space-y-2.5 bg-[var(--ink-2)] border border-[var(--line-soft)] border-l-4 border-l-[var(--gold-bright)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-serif font-bold text-sm text-[var(--text)]">
                      {item.title}
                    </h4>
                    <span className="font-mono text-xs font-bold text-[var(--gold-bright)] shrink-0 bg-[rgba(201,153,63,0.1)] px-2 py-0.5 rounded border border-[rgba(201,153,63,0.3)]">
                      {item.metric}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="p-2 rounded bg-[var(--ink-3)]/60 text-[0.72rem] text-[var(--text-muted)] font-mono leading-relaxed">
                    {item.lessonRule}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs font-mono">
                    <span className="text-[var(--gold-bright)] text-[0.7rem]">{item.lift}</span>
                    <Link
                      href={item.drillUrl}
                      className="text-[var(--gold-bright)] hover:underline inline-flex items-center gap-1"
                    >
                      {item.recommendedDrill} <ChevronRight size={12} />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Pillar 3: What Still Needs Work (Critical Leaks) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b-2 border-[var(--red)]">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[var(--red)]" />
                <h3 className="font-serif font-bold text-base text-[var(--text)]">
                  What Still Needs Work
                </h3>
              </div>
              <Pill tone="alert" size="sm">Critical Leaks</Pill>
            </div>

            <div className="space-y-3">
              {MASTERY_PILLARS.criticalLeaks.map((item) => (
                <Card
                  key={item.id}
                  surface="shell"
                  pad="sm"
                  className="space-y-2.5 bg-[var(--ink-2)] border border-[var(--line-soft)] border-l-4 border-l-[var(--red)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-serif font-bold text-sm text-[var(--text)]">
                      {item.title}
                    </h4>
                    <span className="font-mono text-xs font-bold text-[var(--red)] shrink-0 bg-[rgba(201,106,90,0.12)] px-2 py-0.5 rounded border border-[rgba(201,106,90,0.3)]">
                      {item.metric}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    {item.summary}
                  </p>

                  <div className="p-2 rounded bg-[var(--ink-3)]/60 text-[0.72rem] text-[var(--text-muted)] font-mono leading-relaxed">
                    {item.lessonRule}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs font-mono">
                    <span className="text-[var(--red)] text-[0.7rem]">{item.lift}</span>
                    <Link
                      href={item.drillUrl}
                      className="text-[var(--gold-bright)] hover:underline inline-flex items-center gap-1"
                    >
                      {item.recommendedDrill} <ChevronRight size={12} />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer Navigation CTA */}
      <footer className="pt-6 border-t border-[var(--line-soft)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[var(--text-muted)]">
        <div>
          <span>{displayName} · {user?.email} · Dossier ID: </span>
          <span className="text-[var(--text)] font-semibold">{user?.id?.slice(0, 12)}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/coach" className="hover:text-[var(--text)] transition-colors">
            Coach Dashboard
          </Link>
          <Link href="/history" className="hover:text-[var(--text)] transition-colors">
            Game Archive
          </Link>
          <Link href="/" className="hover:text-[var(--text)] transition-colors">
            Live Analyzer
          </Link>
        </div>
      </footer>
    </main>
  );
}
