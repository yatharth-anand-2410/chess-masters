import CoachGate from "../../components/CoachGate";

export default function CoachLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <CoachGate>{children}</CoachGate>;
}
