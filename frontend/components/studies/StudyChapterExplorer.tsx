"use client";

import { useMemo, useState } from "react";
import CriticalPositionBoard from "../CriticalPositionBoard";
import { Pill } from "../ui/Pill";
import DrillBoard, { type DrillStatus } from "../DrillBoard";
import {
  buildMainLine,
  chapterMoveCount,
  formatMoveLine,
  isPositionChapter,
  plyToMoment,
  type StudyChapter,
  type StudyImport,
} from "./studyTypes";

export type StudyChapterExplorerProps = {
  study: StudyImport;
  /** Optional motif label carried by the curated study, used for the drill chip. */
  motif?: string | null;
};

/**
 * The chapter explorer for an imported Lichess study.
 *
 * A study holds three kinds of chapter and the explorer shows each one as what
 * it is, because claiming a solution that does not exist is worse than showing
 * none:
 *
 * * **puzzle** — the chapter stores moves, so the main line is a real drill;
 * * **lesson** — the chapter stores a position *and* a written comment. The
 *   position is a diagram and the comment is the author's teaching;
 * * **position** — the chapter stores a position and nothing else. It is shown
 *   as a diagram with a link to solve or discuss it on Lichess.
 *
 * Nothing is fabricated: a note is the author's own PGN comment, and a chapter
 * with no stored line never pretends to have one.
 */
export default function StudyChapterExplorer({
  study,
  motif,
}: StudyChapterExplorerProps) {
  const chapters = useMemo(
    () => (study.chapters ?? []).filter((chapter) => chapter && chapter.title !== undefined),
    [study.chapters]
  );
  /** The first annotated ply of the opening chapter, used as the initial drill. */
  const openingPly = useMemo(() => {
    if (chapters.length === 0) {
      return 0;
    }
    const plies = buildMainLine(chapters[0]);
    const annotated = plies.findIndex(
      (ply) => typeof ply.note === "string" && ply.note.length > 0
    );
    return annotated > 0 ? annotated : 0;
  }, [chapters]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [plyIndex, setPlyIndex] = useState(openingPly);
  const [drillStatus, setDrillStatus] = useState<DrillStatus>("idle");
  const [drillRound, setDrillRound] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");

  const chapter: StudyChapter | undefined = chapters[
    Math.min(chapterIndex, chapters.length - 1)
  ];
  const activeChapterIndex = chapter ? Math.min(chapterIndex, chapters.length - 1) : 0;
  const plies = useMemo(() => buildMainLine(chapter), [chapter]);
  const activePly = plies[Math.min(plyIndex, Math.max(plies.length - 1, 0))];
  const moment = useMemo(
    () => (activePly ? plyToMoment(activePly, motif) : null),
    [activePly, motif]
  );
  const positionOnly = isPositionChapter(chapter);

  if (chapters.length === 0) {
    return (
      <p className="studies-inline-note">
        This study has no chapters to show. Open it on Lichess to read it there.
      </p>
    );
  }

  const selectChapter = (index: number) => {
    setChapterIndex(index);
    // Open on the first annotated move: that is the ply the study author wrote
    // a lesson about, and the honest default drill for the chapter.
    const chapterPlies = buildMainLine(chapters[index]);
    const annotated = chapterPlies.findIndex(
      (ply) => typeof ply.note === "string" && ply.note.length > 0
    );
    setPlyIndex(annotated > 0 ? annotated : 0);
    setDrillStatus("idle");
    setDrillRound((round) => round + 1);
    setLiveMessage("");
  };

  const selectPly = (index: number) => {
    setPlyIndex(index);
    setDrillStatus("idle");
    setDrillRound((round) => round + 1);
    setLiveMessage("");
  };

  const reveal = () => {
    setDrillStatus("revealed");
    setLiveMessage("Solution shown on the board.");
  };

  const chapterLink = chapter?.chapter_url || study.source_url;
  const orientation: "white" | "black" = chapter?.orientation === "black" ? "black" : "white";

  return (
    <div className="studies-detail-grid">
      <aside className="studies-chapter-rail" aria-label="Study chapters">
        <div className="studies-rail-head">
          <h2 className="studies-rail-title">Study Chapters</h2>
          <span className="studies-rail-count">
            {activeChapterIndex + 1} / {chapters.length}
          </span>
        </div>
        <div className="studies-rail-list">
          {chapters.map((entry, index) => {
            const isActive = index === activeChapterIndex;
            const isDiagram = isPositionChapter(entry);
            return (
              <button
                key={entry.id ?? index}
                type="button"
                className={`studies-rail-item${isActive ? " is-active" : ""}`}
                onClick={() => selectChapter(index)}
                aria-current={isActive}
              >
                <span className="studies-rail-meta">
                  Chapter {index + 1}
                  {isActive && <span className="studies-rail-live">● Active</span>}
                </span>
                <span className="studies-rail-name">{entry.title}</span>
                <span className="studies-rail-moves">
                  {isDiagram
                    ? entry.initial_comment
                      ? "Lesson · no moves"
                      : "Position · no moves"
                    : `${chapterMoveCount(entry)} ${
                        chapterMoveCount(entry) === 1 ? "move" : "moves"
                      }`}
                </span>
              </button>
            );
          })}
        </div>
        {typeof study.position_only_chapters === "number" &&
          study.position_only_chapters > 0 && (
            <p className="studies-rail-foot">
              {study.position_only_chapters} of {chapters.length} chapters are
              positions rather than move lines — those are shown as diagrams.
            </p>
          )}
        {typeof study.total_annotations === "number" && (
          <p className="studies-rail-foot">
            {study.total_annotations} annotations parsed from the study PGN
            {study.annotator ? ` · by ${study.annotator} on Lichess` : ""}.
          </p>
        )}
      </aside>

      <section className="studies-detail-main">
        <div className="studies-dual">
          <div className="studies-board-panel">
            {positionOnly ? (
              <CriticalPositionBoard
                fen={chapter?.initial_fen ?? ""}
                orientation={orientation}
                highlightSquares={(chapter?.initial_circles ?? []).map(
                  (circle) => circle.square
                )}
                arrows={(chapter?.initial_arrows ?? []).map((arrow) => ({
                  orig: arrow.from_square,
                  dest: arrow.to_square,
                  color: arrow.color,
                }))}
              />
            ) : moment ? (
              <DrillBoard
                key={`${chapter?.id ?? chapterIndex}-${plyIndex}-${drillRound}`}
                moment={moment}
                status={drillStatus}
                liveMessage={liveMessage}
                onAttempt={(correct) => {
                  if (correct) {
                    setLiveMessage("Correct — that is the study's move.");
                  } else {
                    setLiveMessage("Not the move the study plays here.");
                  }
                }}
              />
            ) : (
              <p className="studies-inline-note">
                This chapter&apos;s moves could not be rebuilt on a board — the
                move line below is the study&apos;s own PGN.
              </p>
            )}
            <p className="studies-board-caption">
              {positionOnly
                ? `Chapter ${activeChapterIndex + 1} · position only`
                : activePly
                  ? `Chapter ${activeChapterIndex + 1} · ply ${plyIndex + 1} of ${plies.length} · ${activePly.color} to move`
                  : "No replayable position"}
            </p>
          </div>

          <div className="studies-notes-panel">
            <Pill tone="shell" size="sm">
              {positionOnly
                ? chapter?.initial_comment
                  ? "Study position · with the author's note"
                  : "Study position"
                : "Interactive drill chapter"}
            </Pill>
            <h2 className="studies-notes-title">
              Chapter {activeChapterIndex + 1}: {chapter?.title ?? "Untitled"}
            </h2>

            {positionOnly ? (
              <>
                {chapter?.initial_comment ? (
                  <p className="studies-notes-body">{chapter.initial_comment}</p>
                ) : null}
                <p className="studies-notes-body studies-notes-fallback">
                  This chapter stores a position with no moves — there is no
                  solution saved to check against, so it is meant to be solved
                  cold or talked through with a coach.
                  {chapter?.initial_comment ? "" : " The author wrote no note on it either."}
                </p>
                <div className="studies-notes-actions">
                  <a
                    className="studies-btn-quiet"
                    href={chapterLink}
                    target="_blank"
                    rel="noopener"
                  >
                    Open this position on Lichess ↗
                  </a>
                </div>
              </>
            ) : activePly ? (
              <>
                {activePly.note ? (
                  <p className="studies-notes-body">{activePly.note}</p>
                ) : (
                  <p className="studies-notes-body studies-notes-fallback">
                    This move has no study note — the main line it belongs to
                    is shown instead.
                  </p>
                )}
                <p className="studies-notes-prompt">
                  {activePly.color === "white" ? "White" : "Black"} to move:
                  find the study&apos;s move at move {activePly.moveNumber}.
                </p>
                <div className="studies-notes-actions">
                  <button
                    type="button"
                    className="studies-btn-quiet"
                    onClick={reveal}
                  >
                    Try solution on board ➔
                  </button>
                  <a
                    className="studies-card-link"
                    href={chapterLink}
                    target="_blank"
                    rel="noopener"
                  >
                    Open this chapter on Lichess ↗
                  </a>
                </div>
              </>
            ) : (
              <p className="studies-notes-body">
                The main line of this chapter could not be replayed from its
                starting position.
              </p>
            )}
          </div>
        </div>

        {!positionOnly && (
          <div className="studies-move-line">
            <div className="studies-move-line-head">
              <span className="studies-move-line-label">Main line</span>
              {activePly?.glyphs && activePly.glyphs.length > 0 && (
                <span className="studies-move-line-glyph">
                  {activePly.glyphs.join(" ")}
                </span>
              )}
            </div>
            {plies.length > 0 ? (
              <>
                <ol className="studies-move-list">
                  {plies.map((ply, index) => (
                    <li key={`${ply.san}-${index}`}>
                      <button
                        type="button"
                        className={`studies-move${index === plyIndex ? " is-active" : ""}`}
                        onClick={() => selectPly(index)}
                        title={ply.note ?? undefined}
                      >
                        {ply.color === "white" ? `${ply.moveNumber}.` : ""}
                        {ply.san}
                        {ply.note ? <span className="studies-move-dot" /> : null}
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="studies-move-text">{formatMoveLine(plies)}</p>
              </>
            ) : (
              <p className="studies-shared-note studies-shared-note-muted">
                No moves were parsed for this chapter.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
