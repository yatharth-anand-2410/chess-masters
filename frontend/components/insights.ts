export type BoardArrow = {
  orig: string;
  dest?: string;
  color?: string;
};

export type Blindspot = {
  type: string;
  theme: string;
  expected_recapture: string;
  actual_move: string;
  is_check: boolean;
  confidence: string;
  explanation: string;
};

export type OpeningMove = {
  san?: string;
  games: number;
  win_rate: number;
  draw_rate: number;
  loss_rate: number;
  popularity: number;
};

export type OpeningInsight = {
  name?: string | null;
  eco?: string | null;
  top_moves: OpeningMove[];
  total_master_games: number;
};

export type TablebaseInsight = {
  category: string;
  dtm?: number | null;
  dtz?: number | null;
  pieces: number;
  best_move?: {
    uci?: string;
    san?: string;
    category?: string;
    dtm?: number | null;
    dtz?: number | null;
  } | null;
  outcome_changed?: {
    from: string;
    to: string;
  } | null;
};

export type InsightMoment = {
  move_number: number;
  san: string;
  color: string;
  phase: string;
  quality: string;
  centipawn_loss: number;
  fen_before: string;
  played_move?: string;
  player_color?: "white" | "black";
  best_move_san?: string | null;
  motif?: string | null;
  motif_details?: string | null;
  highlight_squares?: string[];
  arrows?: BoardArrow[];
  blindspot?: Blindspot | null;
  opening?: OpeningInsight | null;
  tablebase?: TablebaseInsight | null;
  game_label?: string | null;
  analysis_id?: string | null;
};

export type PhaseAccuracies = {
  opening?: number | null;
  middlegame?: number | null;
  endgame?: number | null;
};

export type QualityStatistics = {
  blunder?: number;
  mistake?: number;
  inaccuracy?: number;
};

export type Resource = {
  title: string;
  url: string;
  theme: string;
  source_move?: string | null;
};

export type InsightsData = {
  strength_moments: InsightMoment[];
  weakness_moments: InsightMoment[];
  resources: Resource[];
  player_color?: string;
  player_name?: string;
  opening_name?: string | null;
  eco?: string | null;
  result?: string | null;
  phase_accuracies?: PhaseAccuracies;
  statistics?: QualityStatistics;
};