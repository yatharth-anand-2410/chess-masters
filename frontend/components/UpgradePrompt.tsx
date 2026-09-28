import Link from "next/link";

type UpgradePromptProps = {
  feature?: "analysis" | "qna";
};

const COPY: Record<NonNullable<UpgradePromptProps["feature"]>, { title: string; description: string }> = {
  analysis: {
    title: "You've used your free analyses",
    description: "Upgrade to keep analyzing games with detailed AI coaching reports.",
  },
  qna: {
    title: "Ask your coach follow-up questions",
    description: "Q&A with your chess coach is available on a paid plan.",
  },
};

export default function UpgradePrompt({ feature = "analysis" }: UpgradePromptProps) {
  const copy = COPY[feature];
  return (
    <div className="upgrade-prompt">
      <h3>{copy.title}</h3>
      <p>{copy.description}</p>
      <p className="upgrade-note">Payments are being added shortly.</p>
      <Link className="btn" href="/upgrade">
        Learn about upgrading
      </Link>
    </div>
  );
}