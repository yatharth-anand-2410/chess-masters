import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import AccuracyChart from "./AccuracyChart";
import PsychologyPanel from "./PsychologyPanel";
import ResourceLinks from "./ResourceLinks";
import SectionInsightBoards from "./SectionInsightBoards";
import type { InsightsData } from "./insights";

type CoachingReportProps = {
  content: string;
  insights?: InsightsData | null;
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

export default function CoachingReport({ content, insights }: CoachingReportProps) {
  const normalized = normalizeCharts(content);
  const sections = splitSections(normalized);

  if (sections.length === 0) {
    return <section className="report">{renderMarkdown(normalized)}</section>;
  }

  return (
    <section className="report">
      {sections.map((section) => {
        const heading = section.heading.toLowerCase();
        return (
          <div key={section.heading} className="report-section">
            {renderMarkdown(`## ${section.heading}\n\n${section.body}`)}
            {heading.includes("strength") && (
              <SectionInsightBoards moments={insights?.strength_moments} />
            )}
            {heading.includes("weakness") && (
              <SectionInsightBoards moments={insights?.weakness_moments} />
            )}
            {heading.includes("psychology") && (
              <PsychologyPanel profile={insights?.psychology} />
            )}
            {heading.includes("resources") && (
              <ResourceLinks resources={insights?.resources} />
            )}
          </div>
        );
      })}
    </section>
  );
}