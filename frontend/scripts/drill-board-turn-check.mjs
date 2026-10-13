/**
 * Canary for the contract between chessground and the drill board.
 *
 * chessground does NOT derive the side to move from a FEN: `fen.read()` only
 * parses the piece placement, and the board's own turn colour stays on white
 * until someone sets `turnColor` or makes a move. When that colour disagreed
 * with `movable.color` — which is exactly what happens on every drill where
 * Black is to move, because the FEN carries no turn information — the player's
 * move failed the mobility check and chessground quietly recorded it as a
 * *premove*. Premoves never fire `movable.events.after`, so the board looked
 * and felt interactive while `DrillBoard` graded nothing at all.
 *
 * This script drives the same code path a click does (selectSquare twice, which
 * is what both a tap-tap and a drag end up calling) against the same config
 * `DrillBoard` builds, and fails loudly if the move stops reaching `after`.
 *
 * Run with `npm run check:drill-board` from the frontend directory.
 */

import { JSDOM } from "jsdom";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";

/** A Black-to-move middlegame, i.e. the shape half of all real drills have. */
const FEN = "r3k2r/ppp2ppp/8/8/3n4/8/PPP2PPP/R3K2R b KQkq - 0 27";
const WRONG_MOVE = ["e8", "c8"];
const ENGINE_MOVE = ["d4", "c2"];

const dom = new JSDOM('<!doctype html><html><body><div id="board"></div></body></html>', {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const toSide = (color) => (color === "b" ? "black" : "white");

function computeDests(game) {
  const dests = new Map();
  for (const move of game.moves({ verbose: true })) {
    const list = dests.get(move.from);
    if (list) {
      list.push(move.to);
    } else {
      dests.set(move.from, [move.to]);
    }
  }
  return dests;
}

/** The exact position-change payload `DrillBoard` sends on mount and on unlock. */
function configFor(game, extra = {}) {
  return {
    fen: game.fen(),
    turnColor: toSide(game.turn()),
    lastMove: undefined,
    movable: {
      free: false,
      color: toSide(game.turn()),
      dests: computeDests(game),
      showDests: true,
    },
    ...extra,
  };
}

const failures = [];
const check = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

const game = new Chess(FEN);
const attempts = [];
const element = document.getElementById("board");

const api = Chessground(element, {
  fen: game.fen(),
  turnColor: toSide(game.turn()),
  orientation: toSide(game.turn()),
  coordinates: true,
  highlight: { lastMove: true, check: true },
  drawable: { enabled: false, visible: true },
  premovable: { enabled: false, showDests: false },
  movable: {
    free: false,
    color: toSide(game.turn()),
    dests: computeDests(game),
    showDests: true,
    events: {
      after: (orig, dest) => {
        const played = game.move({ from: orig, to: dest, promotion: "q" });
        attempts.push(played ? `${played.from}${played.to}` : `${orig}${dest} (illegal)`);
      },
    },
  },
});

check(api.state.turnColor === "black", `board turnColor is ${api.state.turnColor}, expected black`);

async function clickMove([from, to]) {
  api.selectSquare(from);
  api.selectSquare(to);
  // chessground defers user callbacks, so let the queue drain.
  await new Promise((resolve) => setTimeout(resolve, 5));
}

await clickMove(WRONG_MOVE);
check(
  attempts.length === 1,
  `the wrong move never reached chessground's after event (attempts: ${JSON.stringify(attempts)}) — the move was probably taken as a premove, so nothing is graded`
);
check(
  api.state.premovable.current === undefined,
  `chessground stored the move as a premove (${JSON.stringify(api.state.premovable.current)}) instead of playing it`
);

// Replay the wrong move and hand the position back, exactly like the 420ms
// revert in DrillBoard: play a Black move and chessground flips its own turn
// colour to white, so the revert has to restate it or the *next* attempt is the
// one that silently vanishes.
game.undo();
api.set(configFor(game));

check(api.state.turnColor === "black", "the board did not restore Black to move after the revert");

await clickMove(ENGINE_MOVE);
check(
  attempts.length === 2,
  `the second attempt never reached chessground's after event (attempts: ${JSON.stringify(attempts)})`
);
check(
  attempts[1] === ENGINE_MOVE.join(""),
  `the engine move arrived as ${attempts[1]}, expected ${ENGINE_MOVE.join("")}`
);

api.destroy();

if (failures.length > 0) {
  console.error("drill board turn check FAILED");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("\nIf chessground ever starts reading the side to move from the FEN,");
  console.error("or if DrillBoard stops passing turnColor, fix DrillBoard.tsx first.");
  process.exit(1);
}

console.log(`drill board turn check PASSED (attempts: ${attempts.join(" ")}; premoves disabled)`);
