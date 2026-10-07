import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import AccuracyChart from "./AccuracyChart";
import LockedPsychologyPreview from "./LockedPsychologyPreview";
import PsychologyPanel from "./PsychologyPanel";
import ResourceLinks from "./ResourceLinks";
import SectionInsightBoards from "./SectionInsightBoards";
import {
  isPsychologyProfile,
  type InsightsData,
  type PsychologyProfile,
} from "./insights";

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

type Section = { heading: string; body: string };

function splitSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", body: "" };
  for (const line of content.split("\n")) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (current.heading) {
        sections.push(current);
      }
      current = { heading: match[1].trim(), body: "" };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.heading) {
    sections.push(current);
  }
  return sections;
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

  if (sections.length === 0) {
    return (
      <section className={sectionClassName}>
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
      {sections.map((section, index) => {
        const heading = section.heading.toLowerCase();
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
            {heading.includes("resources") && (
              <ResourceLinks resources={insights?.resources} />
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