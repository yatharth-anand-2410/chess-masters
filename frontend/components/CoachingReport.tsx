import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import AccuracyChart from "./AccuracyChart";
import DrillSection from "./DrillSection";
import FocusAreasBoard from "./FocusAreasBoard";
import HeroRule from "./HeroRule";
import LockedPsychologyPreview from "./LockedPsychologyPreview";
import PsychologyPanel from "./PsychologyPanel";
import SectionInsightBoards from "./SectionInsightBoards";
import ChokeCard from "./review/ChokeCard";
import PhaseMatrix from "./review/PhaseMatrix";
import {
  isPsychologyProfile,
  type InsightsData,
  type PsychologyProfile,
} from "./insights";
import {
  headingMatches,
  heroWhy,
  isDrillable,
  parseFocusPairs,
  resolveNextGameRule,
  resolveVerdict,
  splitSections,
  type ResolvedVerdict,
  type Section,
} from "./reportParsing";

type CoachingReportProps = {
  content: string;
  insights?: InsightsData | null;
  pending?: boolean;
  psychologyLocked?: boolean;
  gamesAnalyzed?: number;
  /** Analysis id, forwarded to the drills so moves can be engine-validated. */
  analysisId?: string | null;
  /** Paper-canvas header (platform pill, title, meta, canvas actions). */
  header?: ReactNode;
  /** Stored overall accuracy, rendered as the phase matrix's "Game Overall" pill. */
  gameAccuracy?: number | null;
};

const EVALCHART_PATTERN =
  /<EvalChart\b[\s\S]*?data\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')[\s\S]*?(?:\/>|<\/EvalChart\s*>|$)/gi;

const ACCURACYCHART_PATTERN =
  /<AccuracyChart\b[\s\S]*?data\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')[\s\S]*?(?:\/>|<\/AccuracyChart\s*>|$)/gi;

function cleanChartValue(rawValue: string): string {
  return rawValue
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function normalizeCharts(content: string): string {
  let out = content;
  out = out.replace(
    EVALCHART_PATTERN,
    (_block, rawValue: string) =>
      `<EvalChart data="${cleanChartValue(rawValue)}"></EvalChart>`
  );
  out = out.replace(
    ACCURACYCHART_PATTERN,
    (_block, rawValue: string) =>
      `<AccuracyChart data="${cleanChartValue(rawValue)}"></AccuracyChart>`
  );
  return out;
}

function hideIncompleteChartTag(content: string): string {
  const lastOpen = content.lastIndexOf("<");
  if (lastOpen === -1) {
    return content;
  }
  const tail = content.slice(lastOpen);
  if (/^<(EvalChart|AccuracyChart)\b/i.test(tail) && !tail.includes(">")) {
    return content.slice(0, lastOpen);
  }
  return content;
}

/** The real phase data renders the matrix, so drop the embedded chart tags. */
function stripEmbeddedCharts(content: string): string {
  return content
    .replace(ACCURACYCHART_PATTERN, "")
    .replace(EVALCHART_PATTERN, "");
}

const components = {
  evalchart: ({ node: _node, ...props }: { node?: unknown; data?: string }) => (
    <AccuracyChart {...props} />
  ),
  accuracychart: ({ node: _node, ...props }: { node?: unknown; data?: string }) => (
    <AccuracyChart {...props} />
  ),
} as unknown as Components;

function renderMarkdown(markdown: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}

const MemoizedMarkdown = memo(function MemoizedMarkdown({
  markdown,
}: {
  markdown: string;
}) {
  return renderMarkdown(markdown);
});

function SectionBoardsSkeleton() {
  return (
    <div className="section-boards-skeleton" aria-hidden="true">
      <div className="insight-skeleton-card" />
      <div className="insight-skeleton-card" />
    </div>
  );
}

function DrillSectionSkeleton() {
  return (
    <div className="drill-grid" aria-hidden="true">
      <div className="drill-skeleton" />
      <div className="drill-skeleton" />
      <div className="drill-skeleton" />
    </div>
  );
}

function PsychologySlot({
  profile,
  locked,
  gamesAnalyzed,
}: {
  profile: PsychologyProfile | null;
  locked: boolean;
  gamesAnalyzed: number;
}) {
  if (profile) {
    return <PsychologyPanel profile={profile} />;
  }
  if (locked) {
    return <LockedPsychologyPreview gamesAnalyzed={gamesAnalyzed} />;
  }
  return null;
}

/** The personalized one-liner, rendered above the Next Game Rule wedge. */
function VerdictNote({ verdict }: { verdict: ResolvedVerdict }) {
  return (
    <div className="review-verdict" role="note">
      <span className="review-verdict-kicker">Verdict</span>
      <p className="review-verdict-line">{verdict.line}</p>
      {verdict.detail && <p className="review-verdict-detail">{verdict.detail}</p>}
    </div>
  );
}

function isVerdictSection(section: Section): boolean {
  return headingMatches(section, "verdict");
}

function isRuleSection(section: Section): boolean {
  return headingMatches(section, "next game rule", "next-game rule");
}

function isFocusSection(section: Section): boolean {
  return headingMatches(section, "focus areas", "focus");
}

function isResourcesSection(section: Section): boolean {
  return headingMatches(section, "resources");
}

function isStrengthSection(section: Section): boolean {
  return headingMatches(section, "strength");
}

function isWeaknessSection(section: Section): boolean {
  return headingMatches(section, "weakness");
}

function isPsychologySection(section: Section): boolean {
  return headingMatches(section, "psycholog");
}

const MOMENT_LIMIT_WEAKNESS = 3;
const MOMENT_LIMIT_STRENGTH = 2;

/**
 * The paper editorial canvas.
 *
 * Order mirrors the showcase: psychology verdict, personalized verdict + the
 * Next Game Rule wedge, the phase matrix, the choke verification card, focus
 * areas, key moments, the replay drill arena and curated resources. Strength
 * and Weakness stay reachable inside the closing notes disclosure — the moment
 * cards above already carry their evidence — and the raw Markdown of any
 * section a micro-component failed to parse is never hidden.
 */
export default function CoachingReport({
  content,
  insights,
  pending = false,
  psychologyLocked = false,
  gamesAnalyzed = 0,
  analysisId,
  header,
  gameAccuracy,
}: CoachingReportProps) {
  const rawPsychology = insights?.psychology ?? null;
  const psychologyProfile = isPsychologyProfile(rawPsychology)
    ? rawPsychology
    : null;
  const showLockedPsychology = psychologyLocked && !psychologyProfile;
  const sectionClassName = pending ? "report review-canvas report-pending" : "report review-canvas";

  const renderPsychologyHeader = () => {
    if (!psychologyProfile && !showLockedPsychology) {
      return null;
    }
    return (
      <div className="review-psych-slot" data-slot="psychology-header">
        <PsychologySlot
          profile={psychologyProfile}
          locked={showLockedPsychology}
          gamesAnalyzed={gamesAnalyzed}
        />
      </div>
    );
  };

  if (!content.trim()) {
    if (!pending) {
      return null;
    }
    return (
      <section className={sectionClassName} data-surface="paper" aria-label="Generating coaching report">
        {header && <div className="review-canvas-header">{header}</div>}
        {renderPsychologyHeader()}
        <HeroRule rule={null} pending />
        <div className="report-skeleton" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, index) => (
            <span key={index} className="report-skeleton-line" />
          ))}
        </div>
      </section>
    );
  }

  const normalized = normalizeCharts(hideIncompleteChartTag(content));
  const phaseData = insights?.phase_accuracies ?? null;
  const hasPhaseData = [phaseData?.opening, phaseData?.middlegame, phaseData?.endgame].some(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
  const source = hasPhaseData ? stripEmbeddedCharts(normalized) : normalized;
  const sections = splitSections(source);

  const verdict = resolveVerdict(sections, insights);
  const nextRule = resolveNextGameRule(sections, insights);
  const weaknessMoments = insights?.weakness_moments ?? [];
  const strengthMoments = insights?.strength_moments ?? [];
  // The hero evidence comes from the most costly weakness that actually
  // carries clock or engine evidence — otherwise the "why" is omitted.
  const rankedWeakness = [...weaknessMoments].sort(
    (a, b) => (b.centipawn_loss ?? 0) - (a.centipawn_loss ?? 0)
  );
  const hasHeroEvidence = (moment: (typeof rankedWeakness)[number]) =>
    Boolean(
      moment.best_move_san ||
        moment.better_move_idea ||
        typeof moment.player_clock_remaining === "number" ||
        typeof moment.clock_remaining === "number"
    );
  const topWeakness =
    rankedWeakness.find((moment) => moment.fen_before && hasHeroEvidence(moment)) ??
    rankedWeakness[0] ??
    null;
  const why = heroWhy(topWeakness);
  const hasDrills = weaknessMoments.some(isDrillable);

  const focusSection = sections.find(isFocusSection);
  const resourcesSection = sections.find(isResourcesSection);
  const strengthSections = sections.filter(isStrengthSection);
  const weaknessSections = sections.filter(isWeaknessSection);
  const focusPairs = focusSection ? parseFocusPairs(focusSection.body) : [];
  const narrativeSections = sections.filter((section) => {
    if (
      (isVerdictSection(section) && verdict !== null) ||
      (isRuleSection(section) && nextRule?.source === "rule-section") ||
      isFocusSection(section) ||
      isResourcesSection(section) ||
      isStrengthSection(section) ||
      isWeaknessSection(section)
    ) {
      // Custom-rendered sections are re-created as micro-components below.
      return false;
    }
    if (psychologyProfile && isPsychologySection(section)) {
      return false;
    }
    return true;
  });

  const headerSlot = header ? <div className="review-canvas-header">{header}</div> : null;

  if (sections.length === 0) {
    return (
      <section className={sectionClassName} data-surface="paper">
        {headerSlot}
        {renderPsychologyHeader()}
        <div className="review-hero-stack">
          {verdict ? <VerdictNote verdict={verdict} /> : null}
          <HeroRule
            rule={nextRule}
            pending={pending}
            drillAnchor={hasDrills ? "drills" : null}
            why={why}
          />
        </div>
        {hasPhaseData && phaseData && (
          <PhaseMatrix
            opening={phaseData.opening ?? null}
            middlegame={phaseData.middlegame ?? null}
            endgame={phaseData.endgame ?? null}
            overall={gameAccuracy ?? null}
          />
        )}
        <ChokeCard insights={insights} />
        <div className="report-section review-narrative">
          <MemoizedMarkdown markdown={normalized} />
        </div>
      </section>
    );
  }

  const verdictSlot = verdict ? <VerdictNote verdict={verdict} /> : null;

  const hasMoments = weaknessMoments.length > 0 || strengthMoments.length > 0;

  return (
    <section className={sectionClassName} data-surface="paper">
      {headerSlot}

      {/* 1. Cognitive psychology card leads the canvas. */}
      {renderPsychologyHeader()}

      {/* 2. Personalized verdict + the Next Game Rule hero wedge. */}
      <div className="review-hero-stack">
        {verdictSlot}
        <HeroRule
          rule={nextRule}
          pending={pending}
          drillAnchor={hasDrills ? "drills" : null}
          why={why}
        />
      </div>

      {/* 3. Phase-by-phase accuracy matrix (real stored data). */}
      {hasPhaseData && phaseData && (
        <PhaseMatrix
          opening={phaseData.opening ?? null}
          middlegame={phaseData.middlegame ?? null}
          endgame={phaseData.endgame ?? null}
          overall={gameAccuracy ?? null}
        />
      )}

      {/* 4. Choke verification — only when a moment carries the evidence. */}
      <ChokeCard insights={insights} />

      {/* 5. Remaining narrative the coach wrote (Game Overview and friends). */}
      {narrativeSections.map((section, index) => (
        <div key={`${index}-${section.heading}`} className="report-section review-narrative">
          <MemoizedMarkdown markdown={`## ${section.heading}\n\n${section.body}`} />
        </div>
      ))}

      {/* 6. Focus Areas as binary Do / Don't cards. */}
      {focusPairs.length > 0 && (
        <div className="report-section review-focus-section">
          <div className="review-section-head">
            <h3>Focus Areas · Actionable Habits</h3>
            <p>Binary behavioural rules to run in your future games</p>
          </div>
          <FocusAreasBoard
            pairs={focusPairs}
            fallback={focusSection ? <MemoizedMarkdown markdown={focusSection.body} /> : undefined}
          />
        </div>
      )}

      {/* 7. Key game moments as mini-board cards. */}
      {hasMoments ? (
        <div className="report-section review-moments-section" id="key-moments">
          <div className="review-section-head">
            <h3>Key Game Moments</h3>
            <p>The positions the engine flagged in this game</p>
          </div>
          <SectionInsightBoards moments={weaknessMoments} limit={MOMENT_LIMIT_WEAKNESS} />
          <SectionInsightBoards moments={strengthMoments} limit={MOMENT_LIMIT_STRENGTH} />
        </div>
      ) : pending && insights ? (
        <div className="report-section">
          <SectionBoardsSkeleton />
        </div>
      ) : null}

      {/* 8 + 9. Replay drill arena and curated practice resources. */}
      {insights ? (
        <DrillSection
          moments={weaknessMoments}
          insights={insights}
          psychology={psychologyProfile}
          analysisId={analysisId}
          fallback={
            resourcesSection ? <MemoizedMarkdown markdown={resourcesSection.body} /> : undefined
          }
        />
      ) : pending ? (
        <DrillSectionSkeleton />
      ) : resourcesSection ? (
        <div className="report-section review-resources">
          <div className="review-section-head">
            <h2>{resourcesSection.heading}</h2>
          </div>
          <MemoizedMarkdown markdown={resourcesSection.body} />
        </div>
      ) : null}

      {/* The coach's raw strength / weakness notes stay one click away. */}
      {(weaknessSections.length > 0 || strengthSections.length > 0) && (
        <details className="review-details review-coach-notes">
          <summary>The coach&apos;s full strength &amp; weakness notes</summary>
          <div className="review-details-body">
            {[...weaknessSections, ...strengthSections].map((section, index) => (
              <MemoizedMarkdown
                key={`${index}-${section.heading}`}
                markdown={`## ${section.heading}\n\n${section.body}`}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
