import { memo } from "react";
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
import {
  isPsychologyProfile,
  type InsightsData,
  type PsychologyProfile,
} from "./insights";
import {
  headingMatches,
  isDrillable,
  parseFocusPairs,
  resolveNextGameRule,
  splitSections,
} from "./reportParsing";

type CoachingReportProps = {
  content: string;
  insights?: InsightsData | null;
  pending?: boolean;
  psychologyLocked?: boolean;
  gamesAnalyzed?: number;
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

export default function CoachingReport({
  content,
  insights,
  pending = false,
  psychologyLocked = false,
  gamesAnalyzed = 0,
}: CoachingReportProps) {
  if (!content.trim()) {
    if (!pending) {
      return null;
    }
    return (
      <section
        className="report report-pending"
        aria-label="Generating coaching report"
      >
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
  const sections = splitSections(normalized);
  const sectionClassName = pending ? "report report-pending" : "report";
  const rawPsychology = insights?.psychology ?? null;
  const psychologyProfile = isPsychologyProfile(rawPsychology)
    ? rawPsychology
    : null;
  const showLockedPsychology = psychologyLocked && !psychologyProfile;
  const hasPsychologySection = sections.some((section) =>
    section.heading.toLowerCase().includes("psychology")
  );

  const nextRule = resolveNextGameRule(sections, insights);
  const hasDrills = (insights?.weakness_moments ?? []).some(isDrillable);
  // The hero card already presents the rule, so drop it from the body to avoid
  // showing the same sentence twice.
  const ruleSectionIndex =
    nextRule?.source === "rule-section"
      ? sections.findIndex((section) =>
          headingMatches(section, "next game rule", "next-game rule")
        )
      : -1;

  if (sections.length === 0) {
    return (
      <section className={sectionClassName}>
        <HeroRule rule={nextRule} pending={pending} drillAnchor={hasDrills ? "drills" : null} />
        <MemoizedMarkdown markdown={normalized} />
        {(psychologyProfile || showLockedPsychology) && (
          <div className="report-section">
            <PsychologySlot
              profile={psychologyProfile}
              locked={showLockedPsychology}
              gamesAnalyzed={gamesAnalyzed}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={sectionClassName}>
      <HeroRule rule={nextRule} pending={pending} drillAnchor={hasDrills ? "drills" : null} />

      {sections.map((section, index) => {
        if (index === ruleSectionIndex) {
          return null;
        }
        const heading = section.heading.toLowerCase();
        const isFocusAreas = heading.includes("focus areas") || heading.includes("focus");
        const isResources = heading.includes("resources");
        const focusPairs = isFocusAreas ? parseFocusPairs(section.body) : [];

        // Focus Areas and Resources are rebuilt as visual components. The
        // original Markdown stays reachable inside a disclosure so a failed
        // parse can never hide what the coach actually wrote.
        if (isFocusAreas && focusPairs.length > 0) {
          return (
            <div key={`${index}-${section.heading}`} className="report-section">
              <MemoizedMarkdown markdown={`## ${section.heading}`} />
              <FocusAreasBoard
                pairs={focusPairs}
                fallback={<MemoizedMarkdown markdown={section.body} />}
              />
            </div>
          );
        }

        if (isResources) {
          return (
            <div key={`${index}-${section.heading}`} className="report-section">
              <MemoizedMarkdown markdown={`## ${section.heading}`} />
              {insights ? (
                <DrillSection
                  moments={insights.weakness_moments ?? []}
                  insights={insights}
                  psychology={psychologyProfile}
                  fallback={<MemoizedMarkdown markdown={section.body} />}
                />
              ) : pending ? (
                <DrillSectionSkeleton />
              ) : (
                <MemoizedMarkdown markdown={section.body} />
              )}
            </div>
          );
        }

        return (
          <div key={`${index}-${section.heading}`} className="report-section">
            <MemoizedMarkdown
              markdown={`## ${section.heading}\n\n${section.body}`}
            />
            {heading.includes("strength") &&
              (insights ? (
                <SectionInsightBoards moments={insights.strength_moments} />
              ) : pending ? (
                <SectionBoardsSkeleton />
              ) : null)}
            {heading.includes("weakness") &&
              (insights ? (
                <SectionInsightBoards moments={insights.weakness_moments} />
              ) : pending ? (
                <SectionBoardsSkeleton />
              ) : null)}
            {heading.includes("psychology") && (
              <PsychologySlot
                profile={psychologyProfile}
                locked={showLockedPsychology}
                gamesAnalyzed={gamesAnalyzed}
              />
            )}
          </div>
        );
      })}

      {(psychologyProfile || showLockedPsychology) && !hasPsychologySection && (
        <div className="report-section">
          <PsychologySlot
            profile={psychologyProfile}
            locked={showLockedPsychology}
            gamesAnalyzed={gamesAnalyzed}
          />
        </div>
      )}
    </section>
  );
}
