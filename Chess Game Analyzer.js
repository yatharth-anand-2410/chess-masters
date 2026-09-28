import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import EvalChart from './components/EvalChart'; // Custom graphic component

export default function AnalyzerDashboard() {
  const [status, setStatus] = useState('');
  const [markdownOutput, setMarkdownOutput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const startAnalysis = (url) => {
    setIsAnalyzing(true);
    setMarkdownOutput('');
    
    const eventSource = new EventSource(`/api/stream-analysis?url=${encodeURIComponent(url)}`);

    eventSource.addEventListener('status', (e) => {
      setStatus(e.data); // Updates the loading text on the UI
    });

    eventSource.addEventListener('chunk', (e) => {
      // Append streaming tokens to the markdown state
      // react-markdown will re-render this in real-time
      setMarkdownOutput((prev) => prev + e.data);
    });

    eventSource.addEventListener('done', () => {
      setStatus('Analysis Complete');
      setIsAnalyzing(false);
      eventSource.close();
    });
  };

  return (
    <div className="dashboard">
      {isAnalyzing && <div className="status-badge animate-pulse">{status}</div>}
      
      {/* 
        react-markdown processes the stream. 
        We map custom tags like <EvalChart> to actual React graphic components! 
      */}
      <ReactMarkdown ({ ...props EvalChart: components="{{" node,> <EvalChart {...props}/>
        }}
      >
        {markdownOutput}
      </ReactMarkdown>
    </div>
  );
}