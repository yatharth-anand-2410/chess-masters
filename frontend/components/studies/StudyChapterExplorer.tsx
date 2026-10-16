"use client";

import { useMemo, useState } from "react";
import { Pill } from "../ui/Pill";
import DrillBoard, { type DrillStatus } from "../DrillBoard";
import {
  buildMainLine,
  chapterMoveCount,
  formatMoveLine,
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
 * The interactive drill is the study's own main line: pick any ply and the
 * board asks for the move the study plays there. Nothing is fabricated — the
 * "note" panel shows the author's PGN comment when the study has one and falls
 * back to the move line when it does not.
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

  if (chapters.length === 0) {
    return (
      <p className="studies-inline-note">
        This study has no public chapters to show. Open it on Lichess to read it
        there.
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
                  {chapterMoveCount(entry)} {chapterMoveCount(entry) === 1 ? "move" : "moves"}
                </span>
              </button>
            );
          })}
        </div>
        {typeof study.total_annotations === "number" && (
          <p className="studies-rail-foot">
            {study.total_annotations} annotations parsed from the public study
            PGN.
          </p>
        )}
      </aside>

      <section className="studies-detail-main">
        <div className="studies-dual">
          <div className="studies-board-panel">
            {moment ? (
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
              {activePly
                ? `Chapter ${activeChapterIndex + 1} · ply ${plyIndex + 1} of ${plies.length} · ${activePly.color} to move`
                : "No replayable position"}
            </p>
          </div>

          <div className="studies-notes-panel">
            <Pill tone="shell" size="sm">
              Interactive drill chapter
            </Pill>
            <h2 className="studies-notes-title">
              Chapter {activeChapterIndex + 1}: {chapter?.title ?? "Untitled"}
            </h2>

            {activePly ? (
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
                    href={study.source_url}
                    target="_blank"
                    rel="noopener"
                  >
                    Open in Lichess Study ↗
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
      </section>
    </div>
  );
}
