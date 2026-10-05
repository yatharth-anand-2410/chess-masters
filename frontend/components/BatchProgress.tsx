export type BatchGameState = "pending" | "active" | "done" | "failed";

export type BatchGameProgress = {
  gameUrl: string;
  state: BatchGameState;
  message?: string;
  analysisId?: string;
  openingName?: string | null;
  result?: string | null;
};

type BatchProgressProps = {
  games: BatchGameProgress[];
};

function stateLabel(state: BatchGameState): string {
  switch (state) {
    case "pending":
      return "Waiting";
    case "active":
      return "Analyzing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

export default function BatchProgress({ games }: BatchProgressProps) {
  if (games.length === 0) {
    return null;
  }
  const done = games.filter((game) => game.state === "done").length;
  const failed = games.filter((game) => game.state === "failed").length;

  return (
    <div className="batch-progress">
      <div className="batch-progress-head">
        <span className="batch-progress-count">
          {done + failed} of {games.length} games processed
        </span>
        {failed > 0 && (
          <span className="batch-progress-failed">{failed} failed</span>
        )}
      </div>
      <ul className="batch-progress-list">
        {games.map((game, index) => (
          <li
            key={`${game.gameUrl}-${index}`}
            className={`batch-progress-item state-${game.state}`}
          >
            <span className="batch-progress-index" aria-hidden="true">
              {index + 1}
            </span>
            <div className="batch-progress-body">
              <span className="batch-progress-url">
                {game.openingName ?? game.gameUrl}
              </span>
              <span className="batch-progress-message">
                {game.state === "done" && game.result
                  ? `Result ${game.result}`
                  : game.message ?? stateLabel(game.state)}
              </span>
            </div>
            <span className="batch-progress-state">
              {game.state === "active" && (
                <span className="spinner" aria-hidden="true" />
              )}
              {stateLabel(game.state)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
