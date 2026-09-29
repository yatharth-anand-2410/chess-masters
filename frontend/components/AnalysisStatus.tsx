type AnalysisStatusProps = {
  status?: string;
  isAnalyzing?: boolean;
};

export default function AnalysisStatus({ status, isAnalyzing }: AnalysisStatusProps) {
  if (!status) {
    return null;
  }
  return (
    <div className={isAnalyzing ? "status-badge" : "status-badge done"} role="status">
      {isAnalyzing ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <span className="status-mark" aria-hidden="true">
          ✓
        </span>
      )}
      {status}
    </div>
  );
}
