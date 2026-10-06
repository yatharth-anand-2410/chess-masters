import AuthButton from "./AuthButton";

type GuestQnaPromptProps = {
  moveLabel?: string | null;
};

export default function GuestQnaPrompt({ moveLabel }: GuestQnaPromptProps) {
  return (
    <section className="upgrade-prompt guest-qna-prompt">
      <h3>Ask your coach follow-up questions</h3>
      <p>
        Want to ask the AI coach why {moveLabel ?? "that move"} was a blunder? Sign
        in to unlock chat.
      </p>
      <AuthButton user={null} onAuthChange={() => undefined} />
    </section>
  );
}
