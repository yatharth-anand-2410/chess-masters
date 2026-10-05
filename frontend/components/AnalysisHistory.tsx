import type { HistoryEntry } from "../lib/api";
import { externalGameUrl } from "../lib/api";

type AnalysisHistoryProps = {
  entries: HistoryEntry[];
  onOpen?: (id: string) => void;
  onOpenBatch?: (id: string) => void;
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

export default function AnalysisHistory({
  entries,
  onOpen,
  onOpenBatch,
}: AnalysisHistoryProps) {
  if (!entries || entries.length === 0) {
    return (
      <p className="history-empty">
        No analyses yet. Analyze a game and it will appear here.
      </p>
    );
  }
  return (
    <div className="history-list">
      {entries.map((entry) => {
        const platformLabel =
          entry.platform === "lichess" ? "Lichess" : "Chess.com";

        if (entry.kind === "batch") {
          const count = entry.game_count ?? 0;
          return (
            <div key={`batch-${entry.id}`} className="history-item">
              <button
                type="button"
                className="history-item-open"
                onClick={() => onOpenBatch?.(entry.id)}
              >
                <div className="history-item-main">
                  <span className="history-platform">{platformLabel}</span>
                  <span className="history-batch-badge">Multi-game</span>
                  <span className="history-meta">
                    Overall report · {count} {count === 1 ? "game" : "games"}
                  </span>
                </div>
                <div className="history-item-side">
                  <span className="history-date">
                    {formatDate(entry.created_at)}
                  </span>
                  <span className={`history-status status-${entry.status}`}>
                    {statusLabel(entry.status)}
                  </span>
                </div>
              </button>
            </div>
          );
        }

        return (
          <div key={entry.id} className="history-item">
            <button
              type="button"
              className="history-item-open"
              onClick={() => onOpen?.(entry.id)}
            >
              <div className="history-item-main">
                <span className="history-platform">{platformLabel}</span>
                <span className="history-meta">
                  {entry.opening_name ?? entry.game_id}
                </span>
              </div>
              <div className="history-item-side">
                <span className="history-date">
                  {formatDate(entry.created_at)}
                </span>
                <span className={`history-status status-${entry.status}`}>
                  {statusLabel(entry.status)}
                </span>
              </div>
            </button>
            <a
              href={externalGameUrl(entry)}
              target="_blank"
              rel="noreferrer"
              className="history-game-link"
              aria-label={`Open game on ${platformLabel}`}
            >
              Open game ↗
            </a>
          </div>
        );
      })}
    </div>
  );
}
