import { useCallback, useState } from 'react';
import ReferenceDataManager from './components/ReferenceDataManager';
import ContactUpload from './components/ContactUpload';
import MatchProgress from './components/MatchProgress';
import ResultsTable from './components/ResultsTable';
import FuzzyMatcher from './components/FuzzyMatcher';
import type { EnrichedRow, MatchResult } from './lib/types';

type Tab = 'reference' | 'match';
type MatchState = 'idle' | 'matching' | 'complete';

export default function App() {
  const [tab, setTab] = useState<Tab>('reference');
  const [matchState, setMatchState] = useState<MatchState>('idle');
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [results, setResults] = useState<EnrichedRow[]>([]);
  const [resultHeaders, setResultHeaders] = useState<string[]>([]);
  const [matchError, setMatchError] = useState<string | null>(null);

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
    setResultHeaders(headers);
    setResults(rows);
    setMatchState('complete');
    setTab('match');
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
                { id: 'reference', label: 'Reference Data' },
                { id: 'match', label: 'Match Contacts' },
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
