import { useCallback, useEffect, useState, startTransition } from 'react';
import ReferenceDataManager from './components/ReferenceDataManager';
import ContactUpload from './components/ContactUpload';
import MatchProgress from './components/MatchProgress';
import ResultsTable from './components/ResultsTable';
import FuzzyMatcher from './components/FuzzyMatcher';
import type { EnrichedRow, MatchResult, ReferenceStatus } from './lib/types';

type Tab = 'reference' | 'match';
type MatchState = 'idle' | 'matching' | 'complete';

export default function App() {
  const [tab, setTab] = useState<Tab>('match');
  const [refStatus, setRefStatus] = useState<ReferenceStatus | null>(null);
  const [matchState, setMatchState] = useState<MatchState>('idle');
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [results, setResults] = useState<EnrichedRow[]>([]);
  const [resultHeaders, setResultHeaders] = useState<string[]>([]);
  const [matchError, setMatchError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/reference/status')
      .then((r) => r.json())
      .then((d) => setRefStatus(d as ReferenceStatus))
      .catch(() => null);
  }, [tab]);

  const handleMatchStart = () => {
    setMatchState('matching');
    setProgress({ processed: 0, total: 0 });
    setMatchError(null);
    setResults([]);
  };

  const handleProgress = (processed: number, total: number) => {
    setProgress({ processed, total });
  };

  const handleComplete = (headers: string[], rows: EnrichedRow[]) => {
    // Show "complete" state immediately; defer the heavy results render
    setMatchState('complete');
    startTransition(() => {
      setResultHeaders(headers);
      setResults(rows);
    });
  };

  const handleError = (error: string) => {
    setMatchError(error);
    setMatchState('idle');
  };

  const handleReset = () => {
    setMatchState('idle');
    setResults([]);
    setResultHeaders([]);
    setMatchError(null);
    setProgress({ processed: 0, total: 0 });
  };

  const handleFuzzyUpdates = useCallback((domainToMatch: Map<string, MatchResult>) => {
    setResults((prev) =>
      prev.map((row) => {
        const fuzzyMatch = domainToMatch.get(row.domain);
        return fuzzyMatch ? { ...row, match: fuzzyMatch } : row;
      }),
    );
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between py-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Contact–Account Matcher</h1>
              <p className="text-xs text-gray-500">Turnkey revenue team · Salesforce enrichment</p>
            </div>
          </div>
          <nav className="-mb-px flex gap-4">
            {(
              [
                { id: 'match', label: 'Match' },
                { id: 'reference', label: 'Salesforce Data' },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  tab === id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {tab === 'reference' && <ReferenceDataManager />}

        {tab === 'match' && (
          <div className="space-y-6">
            {refStatus && (!refStatus.sheet15.loaded || !refStatus.optout.loaded) && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <span className="font-medium">Setup required:</span>{' '}
                Upload your Salesforce data before matching.{' '}
                <button
                  onClick={() => setTab('reference')}
                  className="underline font-medium hover:text-amber-900"
                >
                  Go to Salesforce Data →
                </button>
              </div>
            )}

            {matchState === 'idle' && (
              <>
                {matchError && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    <span className="font-medium">Error:</span> {matchError}
                  </div>
                )}
                <ContactUpload
                  onMatchStart={handleMatchStart}
                  onProgress={handleProgress}
                  onComplete={handleComplete}
                  onError={handleError}
                />
              </>
            )}

            {matchState === 'matching' && (
              <MatchProgress processed={progress.processed} total={progress.total} />
            )}

            {matchState === 'complete' && (
              <>
                <FuzzyMatcher results={results} onFuzzyUpdates={handleFuzzyUpdates} />
                <ResultsTable headers={resultHeaders} results={results} onReset={handleReset} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
