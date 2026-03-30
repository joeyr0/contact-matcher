import { useCallback, useMemo, useRef, useState } from 'react';
import { isGenericDomain } from '../lib/normalize';
import type { EnrichedRow, FuzzyBatchResult, MatchResult } from '../lib/types';

const BATCH_SIZE = 20;

interface FuzzyMatcherProps {
  results: EnrichedRow[];
  onFuzzyUpdates: (domainToMatch: Map<string, MatchResult>) => void;
}

type FuzzyState = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

export default function FuzzyMatcher({ results, onFuzzyUpdates }: FuzzyMatcherProps) {
  const [state, setState] = useState<FuzzyState>('idle');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [fuzzyMatchCount, setFuzzyMatchCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Unique unmatched non-generic domains — memoized so it doesn't recompute on every render
  const unmatchedDomains = useMemo(() => [
    ...new Set(
      results
        .filter((r) => r.match.matchMethod === 'no_match' && r.domain && !isGenericDomain(r.domain))
        .map((r) => r.domain),
    ),
  ], [results]);

  // Map of domain → company name for unmatched rows (used for Tier 1.7 company name matching)
  const companyNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of results) {
      if (r.match.matchMethod === 'no_match' && r.domain && r.companyName) {
        map[r.domain] = r.companyName;
      }
    }
    return map;
  }, [results]);

  const totalBatches = Math.ceil(unmatchedDomains.length / BATCH_SIZE);

  const runFuzzyMatch = useCallback(async () => {
    if (unmatchedDomains.length === 0) return;

    cancelledRef.current = false;
    setState('running');
    setBatchProgress({ current: 0, total: totalBatches });
    setFuzzyMatchCount(0);
    setErrorMsg(null);

    const allUpdates = new Map<string, MatchResult>();
    let allBatchesFailed = true;

    for (let i = 0; i < totalBatches; i++) {
      if (cancelledRef.current) {
        setState('cancelled');
        if (allUpdates.size > 0) onFuzzyUpdates(allUpdates);
        return;
      }

      const batch = unmatchedDomains.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);

      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 25000);
        let res: Response;
        try {
          res = await fetch('/api/fuzzy-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains: batch, companyNames }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(fetchTimeout);
        }

        if (!res.ok) {
          console.warn(`[fuzzy] Batch ${i + 1} HTTP error: ${res.status}`);
        } else {
          const data = (await res.json()) as FuzzyBatchResult;
          allBatchesFailed = false;

          for (const [domain, match] of Object.entries(data.matches)) {
            allUpdates.set(domain, match);
          }

          // Stream partial updates to the results table after each batch
          if (Object.keys(data.matches).length > 0) {
            onFuzzyUpdates(new Map(Object.entries(data.matches)));
            setFuzzyMatchCount((n) => n + Object.keys(data.matches).length);
          }
        }
      } catch (err) {
        console.warn(`[fuzzy] Batch ${i + 1} failed:`, err);
      }

      setBatchProgress({ current: i + 1, total: totalBatches });
    }

    if (allBatchesFailed && totalBatches > 0) {
      setErrorMsg('All fuzzy matching batches failed. Check that OPENAI_API_KEY is set in your .env file.');
      setState('error');
    } else {
      setState('complete');
    }
  }, [unmatchedDomains, totalBatches, onFuzzyUpdates]);

  const handleCancel = () => {
    cancelledRef.current = true;
  };

  if (unmatchedDomains.length === 0) return null;

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
      {state === 'idle' && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-purple-900">
              {unmatchedDomains.length.toLocaleString()} unmatched domains eligible for fuzzy matching
            </p>
            <p className="mt-0.5 text-xs text-purple-600">
              {totalBatches} batch{totalBatches !== 1 ? 'es' : ''} of {BATCH_SIZE} · powered by OpenAI
            </p>
          </div>
          <button
            onClick={() => void runFuzzyMatch()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 active:bg-purple-800"
          >
            Run Fuzzy Match
          </button>
        </div>
      )}

      {state === 'running' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-purple-900">
              Fuzzy matching… batch {batchProgress.current}/{batchProgress.total}
            </span>
            <button
              onClick={handleCancel}
              className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700 hover:bg-purple-100"
            >
              Cancel
            </button>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-200">
            <div
              className="h-full rounded-full bg-purple-500 transition-all duration-300"
              style={{
                width:
                  batchProgress.total > 0
                    ? `${(batchProgress.current / batchProgress.total) * 100}%`
                    : '0%',
              }}
            />
          </div>
          {fuzzyMatchCount > 0 && (
            <p className="text-xs text-purple-600">{fuzzyMatchCount} matches found so far</p>
          )}
        </div>
      )}

      {state === 'complete' && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-purple-900">
            Fuzzy matching complete — {fuzzyMatchCount} additional matches found
          </p>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-purple-600 underline hover:text-purple-800"
          >
            Run again
          </button>
        </div>
      )}

      {state === 'cancelled' && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-purple-700">
            Cancelled after batch {batchProgress.current}/{batchProgress.total} —{' '}
            {fuzzyMatchCount} matches applied
          </p>
          <button
            onClick={() => setState('idle')}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
          >
            Resume
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-red-700">{errorMsg}</p>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-purple-600 underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
