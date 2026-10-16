"""4-Quadrant Draw Classification and Evaluation Swing Analysis.

Categorizes chess draws into four distinct tactical and psychological quadrants:
1. MISSED_WIN: Decisive winning advantage squandered into a draw (choke).
2. HEROIC_FORTRESS: Decisive losing position salvaged through resilient defense / fortress / swindle.
3. PREMATURE_FEAR_DRAW: Premature peaceful abdication or repetition due to risk aversion / rating anxiety.
4. BALANCED_DRAW: Symmetrical balance, theoretical endgame, or genuine dynamic equilibrium.

Provides granular evaluation swing analysis, turning point detection, and psychological takeaways.
"""

from __future__ import annotations

import io
import math
import re
from typing import Any, Dict, List, Optional, Tuple

import chess
import chess.pgn
from pydantic import BaseModel, Field

# Constants for evaluation thresholds (in pawns)
DECISIVE_ADVANTAGE_PAWNS = 2.0
MATERIAL_CHOKE_PAWNS = 1.8
BALANCED_THRESHOLD_PAWNS = 1.2
MAX_PREMATURE_MOVE_COUNT = 25
MIN_FORTRESS_DEFENSE_MOVES = 6

QUADRANT_MISSED_WIN = "MISSED_WIN"
QUADRANT_HEROIC_FORTRESS = "HEROIC_FORTRESS"
QUADRANT_PREMATURE_FEAR_DRAW = "PREMATURE_FEAR_DRAW"
QUADRANT_BALANCED_DRAW = "BALANCED_DRAW"

QUADRANT_LABELS = {
    QUADRANT_MISSED_WIN: "Missed Win (Choke)",
    QUADRANT_HEROIC_FORTRESS: "Heroic Fortress (Tenacious Hold)",
    QUADRANT_PREMATURE_FEAR_DRAW: "Premature Fear Draw (Peaceful Abdication)",
    QUADRANT_BALANCED_DRAW: "Balanced Fight / Theoretical Draw",
}


# --- Pydantic Models ---


class TurningPoint(BaseModel):
    move_number: int = Field(..., description="Move number where swing occurred")
    ply: int = Field(..., description="Half-move index (1-based)")
    player_color: str = Field(..., description="Color of the player who made the move ('white' or 'black')")
    san: Optional[str] = Field(None, description="Standard Algebraic Notation for the move")
    eval_before_pawns: float = Field(..., description="Evaluation before move in pawns")
    eval_after_pawns: float = Field(..., description="Evaluation after move in pawns")
    swing_pawns: float = Field(..., description="Evaluation change from player perspective")
    note: str = Field(..., description="Tactical or psychological description of the turning point")


class EvalSwingAnalysis(BaseModel):
    peak_eval_player: float = Field(..., description="Highest advantage achieved by the focal player (pawns)")
    peak_eval_opponent: float = Field(..., description="Highest advantage achieved by opponent (pawns)")
    net_swing: float = Field(..., description="Final eval minus starting eval (pawns)")
    largest_single_drop: float = Field(..., description="Largest negative single-move swing for player (pawns)")
    largest_drop_move: Optional[int] = Field(None, description="Move number of largest single drop")
    largest_single_gain: float = Field(..., description="Largest positive single-move swing for player (pawns)")
    largest_gain_move: Optional[int] = Field(None, description="Move number of largest single gain")
    lead_changes: int = Field(..., description="Number of times evaluation switched significant advantage")
    volatility_score: float = Field(..., description="Standard deviation of move-to-move evaluation changes")
    turning_points: List[TurningPoint] = Field(default_factory=list, description="Key turning points")


class FocusAreaCard(BaseModel):
    rule_type: str = Field(..., description="'do' or 'dont'")
    text: str = Field(..., description="Actionable psychological rule")
    detail: str = Field(..., description="Concrete explanation grounded in game moves")


class DrawClassifyRequest(BaseModel):
    pgn: Optional[str] = Field(None, description="Raw PGN string of the game")
    player_color: Optional[str] = Field("white", description="Perspective color: 'white' or 'black'")
    eval_curve_pawns: Optional[List[float]] = Field(None, description="Evaluation series in pawns")
    moves: Optional[List[Dict[str, Any]]] = Field(None, description="Move list with evaluations and SAN")
    result: Optional[str] = Field("1/2-1/2", description="Game result tag (defaults to draw)")
    termination: Optional[str] = Field(None, description="Game termination reason (e.g. 'Draw by repetition')")


class DrawClassificationResult(BaseModel):
    quadrant: str = Field(..., description="One of: MISSED_WIN, HEROIC_FORTRESS, PREMATURE_FEAR_DRAW, BALANCED_DRAW")
    quadrant_label: str = Field(..., description="Human-readable title of quadrant")
    verdict_title: str = Field(..., description="Concise diagnostic verdict")
    summary: str = Field(..., description="Detailed analytical review of the draw")
    choke_detected: bool = Field(..., description="True if a decisive win was squandered")
    fortress_detected: bool = Field(..., description="True if a lost position was saved")
    confidence: float = Field(..., description="Classification confidence (0.0 - 1.0)")
    total_moves: int = Field(..., description="Total moves played in the game")
    eval_swings: EvalSwingAnalysis = Field(..., description="Comprehensive evaluation swing telemetry")
    focus_areas: List[FocusAreaCard] = Field(default_factory=list, description="Binary behavioral rules")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional context and metrics")


# --- Helper Functions ---


def _normalize_color(color: Optional[str]) -> str:
    cleaned = (color or "white").strip().lower()
    return "black" if cleaned in ("black", "b") else "white"


def _extract_eval_curve_from_pgn(pgn_text: str, player_color: str) -> Tuple[List[float], List[Dict[str, Any]], Optional[str], Optional[str]]:
    """Parse PGN text to extract evaluations, moves, result, and termination."""
    eval_curve: List[float] = [0.0]
    moves: List[Dict[str, Any]] = []
    result: Optional[str] = None
    termination: Optional[str] = None

    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        if game is not None:
            result = game.headers.get("Result", "1/2-1/2")
            termination = game.headers.get("Termination")

            node = game
            move_num = 1
            is_white = True
            eval_regex = re.compile(r"\[%eval\s+([+-]?\d+(?:\.\d+)?|#[+-]?\d+)\]")

            while node.variations:
                next_node = node.variation(0)
                san = next_node.san()
                comment = next_node.comment or ""
                eval_val: Optional[float] = None

                match = eval_regex.search(comment)
                if match:
                    raw_val = match.group(1)
                    if raw_val.startswith("#"):
                        # Mate score: convert to large cp equivalent
                        mate_val = int(raw_val.replace("#", ""))
                        eval_val = 100.0 if mate_val > 0 else -100.0
                    else:
                        eval_val = float(raw_val)

                if eval_val is not None:
                    # Lichess/standard PGN eval is always from White's perspective
                    player_eval = eval_val if player_color == "white" else -eval_val
                    eval_curve.append(player_eval)
                else:
                    # If no eval comment, reuse previous or fallback
                    eval_curve.append(eval_curve[-1])

                moves.append({
                    "move_number": move_num,
                    "san": san,
                    "color": "white" if is_white else "black",
                    "comment": comment,
                    "eval_after_pawns": eval_curve[-1],
                })

                if not is_white:
                    move_num += 1
                is_white = not is_white
                node = next_node
    except Exception:
        pass

    return eval_curve, moves, result, termination


def analyze_eval_swings(
    eval_curve: List[float],
    moves: Optional[List[Dict[str, Any]]] = None,
    player_color: str = "white",
) -> EvalSwingAnalysis:
    """Compute swing metrics, volatility, lead changes, and major turning points."""
    if not eval_curve:
        eval_curve = [0.0]

    peak_player = max(eval_curve)
    trough_player = min(eval_curve)
    peak_opponent = -trough_player
    net_swing = round(eval_curve[-1] - eval_curve[0], 2)

    largest_drop = 0.0
    largest_drop_move: Optional[int] = None
    largest_gain = 0.0
    largest_gain_move: Optional[int] = None
    lead_changes = 0
    turning_points: List[TurningPoint] = []

    # Lead state: +1 if player has > 1.0 pawn edge, -1 if opponent has > 1.0, 0 otherwise
    current_lead = 0
    deltas: List[float] = []

    for i in range(1, len(eval_curve)):
        prev_eval = eval_curve[i - 1]
        curr_eval = eval_curve[i]
        delta = curr_eval - prev_eval
        deltas.append(delta)

        move_num = (i + 1) // 2
        active_color = "white" if (i % 2 != 0) else "black"

        # Check largest drop / gain
        if delta < largest_drop:
            largest_drop = delta
            largest_drop_move = move_num
        if delta > largest_gain:
            largest_gain = delta
            largest_gain_move = move_num

        # Lead change tracking
        new_lead = 1 if curr_eval >= 1.0 else (-1 if curr_eval <= -1.0 else 0)
        if new_lead != 0 and current_lead != 0 and new_lead != current_lead:
            lead_changes += 1
        if new_lead != 0:
            current_lead = new_lead

        # Turning point threshold (swing >= 1.5 pawns)
        if abs(delta) >= 1.5:
            san = None
            if moves and (i - 1) < len(moves):
                san = moves[i - 1].get("san")

            if delta < 0:
                note = f"Critical slip at move {move_num}: advantage dropped by {abs(round(delta, 2))} pawns."
            else:
                note = f"Sharp defensive swing at move {move_num}: recovered {round(delta, 2)} pawns."

            turning_points.append(
                TurningPoint(
                    move_number=move_num,
                    ply=i,
                    player_color=active_color,
                    san=san,
                    eval_before_pawns=round(prev_eval, 2),
                    eval_after_pawns=round(curr_eval, 2),
                    swing_pawns=round(delta, 2),
                    note=note,
                )
            )

    # Volatility (standard deviation of deltas)
    volatility = 0.0
    if len(deltas) > 1:
        mean_delta = sum(deltas) / len(deltas)
        variance = sum((d - mean_delta) ** 2 for d in deltas) / len(deltas)
        volatility = round(math.sqrt(variance), 2)

    return EvalSwingAnalysis(
        peak_eval_player=round(peak_player, 2),
        peak_eval_opponent=round(peak_opponent, 2),
        net_swing=net_swing,
        largest_single_drop=round(largest_drop, 2),
        largest_drop_move=largest_drop_move,
        largest_single_gain=round(largest_gain, 2),
        largest_gain_move=largest_gain_move,
        lead_changes=lead_changes,
        volatility_score=volatility,
        turning_points=turning_points[:6],
    )


def classify_draw(request: DrawClassifyRequest) -> DrawClassificationResult:
    """Classify a game into one of 4 draw quadrants with eval swing diagnostics."""
    color = _normalize_color(request.player_color)
    eval_curve: List[float] = []
    moves: List[Dict[str, Any]] = request.moves or []
    termination = request.termination or ""
    result = request.result or "1/2-1/2"

    # Extract from PGN if provided and curve missing
    if request.pgn:
        pgn_curve, pgn_moves, pgn_result, pgn_term = _extract_eval_curve_from_pgn(request.pgn, color)
        if pgn_curve and len(pgn_curve) > 1:
            eval_curve = pgn_curve
        if not moves and pgn_moves:
            moves = pgn_moves
        if pgn_result:
            result = pgn_result
        if pgn_term and not termination:
            termination = pgn_term

    if not eval_curve:
        if request.eval_curve_pawns:
            eval_curve = [round(float(v), 2) for v in request.eval_curve_pawns]
        elif moves:
            eval_curve = [0.0]
            for m in moves:
                val = m.get("eval_after_pawns") or m.get("eval_after_cp", 0) / 100.0
                eval_curve.append(float(val))
        else:
            # Fallback curve if no eval data provided
            eval_curve = [0.0, 0.0]

    swings = analyze_eval_swings(eval_curve, moves, color)
    total_moves = max(len(moves), (len(eval_curve) - 1) // 2, 1)

    # Quadrant Classification Decision Logic
    quadrant = QUADRANT_BALANCED_DRAW
    choke_detected = False
    fortress_detected = False
    confidence = 0.85
    focus_areas: List[FocusAreaCard] = []

    # 1. Missed Win Choke: Player reached decisive winning advantage (>= 2.0 pawns) but finished in draw
    if swings.peak_eval_player >= DECISIVE_ADVANTAGE_PAWNS:
        quadrant = QUADRANT_MISSED_WIN
        choke_detected = True
        confidence = min(0.98, 0.70 + (swings.peak_eval_player / 10.0))
        verdict_title = "Critical Advantage Squandered &middot; Missed Win"
        summary = (
            f"You established a commanding +{swings.peak_eval_player} pawn advantage. "
            f"A major conversion leak occurred (largest drop of {abs(swings.largest_single_drop)} pawns "
            f"around Move {swings.largest_drop_move or 'midgame'}), allowing the opponent to stabilize and salvage a draw."
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="dont",
                text="Don't rush to simplify when holding a decisive material or spatial advantage.",
                detail=f"In this game, your peak of +{swings.peak_eval_player} evaporated into equality. Verify king safety and opponent counterplay before trading active pieces.",
            )
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="do",
                text="Maintain tension and calculate opponent's defensive candidate moves.",
                detail="When completely winning, assume the opponent has only one trick left and actively neutralize it before pushing pawns.",
            )
        )

    # 2. Heroic Fortress: Opponent had decisive advantage (>= 2.0 pawns), but player held
    elif swings.peak_eval_opponent >= DECISIVE_ADVANTAGE_PAWNS:
        quadrant = QUADRANT_HEROIC_FORTRESS
        fortress_detected = True
        confidence = min(0.98, 0.70 + (swings.peak_eval_opponent / 10.0))
        verdict_title = "Heroic Defense &middot; Fortress Successfully Held"
        summary = (
            f"You survived a deep -{swings.peak_eval_opponent} pawn deficit through disciplined defense. "
            f"Your resilience held off the opponent's winning attempts over the final moves, turning a near-certain loss into half a point."
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="do",
                text="Lock pawn structures and construct stubborn blockades when down material.",
                detail=f"Surviving a -{swings.peak_eval_opponent} pawn deficit proves high defensive resourcefulness. Keep creating practical problems for the attacker.",
            )
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="dont",
                text="Don't resign early in dynamic or unbalanced positions.",
                detail="Opponents under time pressure frequently fail to convert technical endgames. Tenacity yields rating points.",
            )
        )

    # 3. Premature Fear Draw: Early draw (<= 25 moves) without reaching decisive eval or technical draw
    elif total_moves <= MAX_PREMATURE_MOVE_COUNT and not any(k in termination.lower() for k in ("stalemate", "insufficient", "50-move")):
        quadrant = QUADRANT_PREMATURE_FEAR_DRAW
        confidence = 0.88
        verdict_title = "Premature Fear Draw &middot; Peaceful Abdication"
        summary = (
            f"The game was concluded at Move {total_moves} with an evaluation of {eval_curve[-1]:+.1f}. "
            "Neither side breached decisive advantage thresholds, yet substantial piece play and fighting chances remained on the board. "
            "This suggests risk aversion or premature draw acceptance."
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="dont",
                text="Don't offer or accept peaceful draws in dynamic middlegames.",
                detail="Agreeing to draws before move 30 stunts your tactical progression and deprives you of endgame conversion experience.",
            )
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="do",
                text="Play on in equal positions to test the opponent's stamina.",
                detail="Grandmaster practice demonstrates that over 40% of equal endgames are eventually won by the player willing to press.",
            )
        )

    # 4. Balanced Theoretical Draw
    else:
        quadrant = QUADRANT_BALANCED_DRAW
        confidence = 0.92
        verdict_title = "Balanced Dynamic Equilibrium &middot; High Precision"
        summary = (
            f"A tightly contested {total_moves}-move battle where neither player allowed an evaluation breach beyond "
            f"+{swings.peak_eval_player} / -{swings.peak_eval_opponent} pawns. Concluded in legitimate theoretical equality or natural stalemate."
        )
        focus_areas.append(
            FocusAreaCard(
                rule_type="do",
                text="Preserve tactical vigilance even in symmetrical structures.",
                detail="Accurate theoretical draws are commendable; analyze small move-order nuances to find incremental winning tries.",
            )
        )

    return DrawClassificationResult(
        quadrant=quadrant,
        quadrant_label=QUADRANT_LABELS[quadrant],
        verdict_title=verdict_title,
        summary=summary,
        choke_detected=choke_detected,
        fortress_detected=fortress_detected,
        confidence=round(confidence, 2),
        total_moves=total_moves,
        eval_swings=swings,
        focus_areas=focus_areas,
        metadata={
            "player_color": color,
            "result": result,
            "termination": termination,
            "raw_eval_points": len(eval_curve),
        },
    )
