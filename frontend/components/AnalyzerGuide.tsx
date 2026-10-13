import { PRODUCT_FACTS } from "../lib/site";

/**
 * Homepage onboarding copy rendered directly under the hero and analyzer.
 *
 * Two question-led sections answer what people search for before they try the
 * tool. Answers are plain prose so search and AI engines can read them without
 * running JavaScript. Markup reuses the faq-panel / section-head patterns
 * already used on the homepage so the blocks sit natively in the layout.
 */
export default function AnalyzerGuide() {
  const { reportSections } = PRODUCT_FACTS;

  return (
    <>
      <section className="faq-panel" aria-labelledby="suggested-moves-title">
        <div className="section-head">
          <h2 id="suggested-moves-title">
            Can I see suggested moves and engine evaluations?
          </h2>
        </div>
        <p className="pedigree-body">
          Yes. At the key moments of the game, the report shows the stronger
          move the engine preferred, how far the evaluation swung after the move
          you actually played, and accuracy figures for each phase of the game.
        </p>
        <p className="pedigree-body">
          The difference is the delivery. Instead of leaving you with a wall of
          numbers and an evaluation bar, Chessmasters explains each turning
          point in plain English &mdash; what the better move was trying to
          achieve and which pattern to drill next &mdash; so you learn the idea,
          not just the score.
        </p>
      </section>

      <section className="faq-panel" aria-labelledby="analyze-first-game-title">
        <div className="section-head">
          <h2 id="analyze-first-game-title">How do I analyze my first game?</h2>
        </div>
        <ol className="faq-list">
          <li className="faq-item">
            <p>
              Choose <strong>Lichess</strong> or <strong>Chess.com</strong> in
              the analyzer above.
            </p>
          </li>
          <li className="faq-item">
            <p>
              Paste the link to a finished game. On Lichess, tell us whether you
              played White or Black; on Chess.com, enter the username the game
              was played under so we can find your side.
            </p>
          </li>
          <li className="faq-item">
            <p>
              Press <strong>Analyze game</strong>. Your game is fetched and run
              through Stockfish before the report is written.
            </p>
          </li>
          <li className="faq-item">
            <p>
              Watch the report stream in and read the five sections:{" "}
              {reportSections.join(", ")}.
            </p>
          </li>
        </ol>
        <p className="faq-more">
          The first analysis is free and needs no account. Signing in afterwards
          unlocks four more free games ({PRODUCT_FACTS.freeAnalyses} in total);
          Pro is &#8377;{PRODUCT_FACTS.proPriceInr} a month for{" "}
          {PRODUCT_FACTS.proAnalysesPerPeriod} analyses per billing period.
        </p>
      </section>
    </>
  );
}
