import { useMemo, useState } from 'react';
import type { EnrichedRow, IcpScoreStreamEvent } from '../lib/types';
import { buildScoreableCompanies, classifyAccountRoute } from '../lib/icp';

interface IcpScorerProps {
  headers: string[];
  results: EnrichedRow[];
  onComplete: (results: EnrichedRow[]) => void;
  onError: (error: string) => void;
}

type ScoringState = 'idle' | 'running' | 'complete' | 'error';

export default function IcpScorer({ headers, results, onComplete, onError }: IcpScorerProps) {
  const [state, setState] = useState<ScoringState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState({ stage: 'companies' as 'companies' | 'contacts', processed: 0, total: 0 });

  const preparedResults = useMemo(
    () =>
      results.map((row) => ({
        ...row,
        match: {
          ...row.match,
          accountStatus: classifyAccountRoute(row).status,
        },
      })),
    [results],
  );

  const eligibleCompanies = useMemo(() => buildScoreableCompanies(preparedResults), [preparedResults]);
  const excludedCount = results.length - preparedResults.filter((row) => row.match.accountStatus === 'eligible').length;

  const runScore = async () => {
    setState('running');
    setErrorMsg(null);

    let response: Response;
    try {
      response = await fetch('/api/icp-score/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers, results }),
      });
    } catch (error) {
      const message = `Network error: ${String(error)}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
      return;
    }

    if (!response.ok || !response.body) {
      const message = `Scoring failed: HTTP ${response.status}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6)) as IcpScoreStreamEvent;
          if (event.type === 'progress') {
            setProgress({ stage: event.stage, processed: event.processed, total: event.total });
          } else if (event.type === 'complete') {
            setState('complete');
            onComplete(event.results);
          } else if (event.type === 'error') {
            setErrorMsg(event.error);
            setState('error');
            onError(event.error);
          }
        }
      }
    } catch (error) {
      const message = `Scoring stream failed: ${String(error)}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
    }
  };

  if (results.length === 0) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      {state === 'idle' && (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-emerald-900">
              Run ICP Score on {eligibleCompanies.length.toLocaleString()} eligible account
              {eligibleCompanies.length === 1 ? '' : 's'}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              Excludes {excludedCount.toLocaleString()} opted-out, customer, customer-review, or competitor row
              {excludedCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={() => void runScore()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Run ICP Score
          </button>
        </div>
      )}

      {state === 'running' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-emerald-900">
              Scoring {progress.stage}…
            </span>
            <span className="text-emerald-700">
              {progress.total > 0 ? `${progress.processed}/${progress.total}` : 'Starting'}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{
                width: progress.total > 0 ? `${(progress.processed / progress.total) * 100}%` : '15%',
              }}
            />
          </div>
        </div>
      )}

      {state === 'complete' && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-emerald-900">ICP scoring complete.</p>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-emerald-700 underline hover:text-emerald-900"
          >
            Run again
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-red-700">{errorMsg}</p>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-emerald-700 underline hover:text-emerald-900"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
