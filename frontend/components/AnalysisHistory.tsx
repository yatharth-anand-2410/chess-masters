import type { AnalysisSummary } from "../lib/api";

type AnalysisHistoryProps = {
  analyses: AnalysisSummary[];
  onOpen?: (id: string) => void;
  compact?: boolean;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "processing":
      return "Processing";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export default function AnalysisHistory({ analyses, onOpen }: AnalysisHistoryProps) {
  if (!analyses || analyses.length === 0) {
    return (
      <p className="history-empty">
        No analyses yet. Analyze a game and it will appear here.
      </p>
    );
  }
  return (
    <div className="history-list">
      {analyses.map((analysis) => (
        <button
          key={analysis.id}
          type="button"
          className="history-item"
          onClick={() => onOpen?.(analysis.id)}
        >
          <div className="history-item-main">
            <span className="history-platform">
              {analysis.platform === "lichess" ? "Lichess" : "Chess.com"}
            </span>
            <span className="history-meta">
              {analysis.opening_name ?? analysis.game_id}
            </span>
          </div>
          <div className="history-item-side">
            <span className="history-date">{formatDate(analysis.created_at)}</span>
            <span className={`history-status status-${analysis.status}`}>
              {statusLabel(analysis.status)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}