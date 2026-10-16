import React from "react";
import { Users } from "lucide-react";
import type { StudentSummary } from "../../lib/api";

type Props = {
  students: StudentSummary[];
  selectedId: string;
  busy?: boolean;
  onSelect: (studentId: string) => void;
};

/**
 * Coach ribbon: keeps the existing student selector so a coach can switch the
 * report being viewed. Selecting the empty option shows the coach's own data.
 */
export default function CoachStudentRibbon({ students, selectedId, busy, onSelect }: Props) {
  return (
    <div className="progress-ribbon">
      <div className="progress-ribbon-left">
        <div className="progress-ribbon-icon" aria-hidden="true">
          <Users size={18} />
        </div>
        <div>
          <div className="progress-ribbon-title-row">
            <span className="progress-ribbon-eyebrow">Coach Mode Active</span>
            <span className="progress-ribbon-pro">Coach</span>
          </div>
          <div className="progress-ribbon-picker">
            <label htmlFor="coach-student-picker">Select Student:</label>
            <select
              id="coach-student-picker"
              className="progress-ribbon-select"
              value={selectedId}
              disabled={busy}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value="">My own progress</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.display_name} ({student.analysis_count}{" "}
                  {student.analysis_count === 1 ? "game" : "games"})
                  {student.lichess_username
                    ? ` · @${student.lichess_username}`
                    : student.chesscom_username
                      ? ` · @${student.chesscom_username}`
                      : ""}
                </option>
              ))}
            </select>
            {students.length === 0 ? (
              <span className="progress-ribbon-empty">No student profiles yet</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="progress-ribbon-actions">
        <button
          type="button"
          className="progress-ribbon-manage"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("open-manage-students"));
            }
          }}
        >
          <Users size={13} aria-hidden="true" />
          <span>Manage Student Profiles</span>
        </button>
      </div>
    </div>
  );
}
