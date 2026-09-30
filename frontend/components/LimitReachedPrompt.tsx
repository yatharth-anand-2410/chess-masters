import Link from "next/link";

type LimitReachedPromptProps = {
  periodEnd?: string | null;
};

function formatResetDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function LimitReachedPrompt({ periodEnd }: LimitReachedPromptProps) {
  const resetDate = formatResetDate(periodEnd);
  return (
    <div className="upgrade-prompt">
      <h3>You&apos;ve reached your analysis limit</h3>
      <p>
        Your paid plan includes 100 game analyses per billing period.
        {resetDate
          ? ` Your quota resets on ${resetDate}.`
          : " It resets at the start of your next billing period."}
      </p>
      <Link className="btn btn-ghost" href="/subscription">
        View subscription
      </Link>
    </div>
  );
}
