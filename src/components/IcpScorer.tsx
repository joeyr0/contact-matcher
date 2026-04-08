import { useEffect, useMemo, useState } from 'react';
import type { AccountPitchCandidate, AccountPitchDraft, AccountPitchStreamEvent, CompactScoreRow, EnrichedRow, IcpJobResponse, IcpJobState, OutboundDraft, OutboundStreamEvent } from '../lib/types';
import { buildScoreableCompanies, classifyAccountRoute, extractContactFields } from '../lib/icp';
import { buildAccountPitchCandidates, buildOutboundCandidates, type OutboundScope } from '../lib/outbound';

interface IcpScorerProps {
  headers: string[];
  results: EnrichedRow[];
  onComplete: (results: EnrichedRow[]) => void;
  onError: (error: string) => void;
}

type ScoringState = 'idle' | 'running' | 'complete' | 'error';
type OutboundState = 'idle' | 'running' | 'complete' | 'error';
type RunMode = 'score_only' | 'score_sample' | 'score_and_outbound_direct' | 'score_and_outbound_queue';
const SCORE_HEADERS = ['Full Name', 'Title', 'Email'];
const SAMPLE_LIMIT = 5;
const ACTIVE_JOB_STORAGE_KEY = 'contact-matcher:active-icp-job';
const SCORING_MATCH_FIELDS = [
  'accountStatus',
  'accountPriority',
  'icpScore',
  'icpConfidence',
  'primaryUseCase',
  'tvcScore',
  'tvcRelevance',
  'tvcFitReason',
  'icpReasonSummary',
  'isCompetitor',
  'contactScore',
  'contactPriority',
  'roleFit',
  'contactReasonSummary',
  'leadPriority',
] as const;

export default function IcpScorer({ headers, results, onComplete, onError }: IcpScorerProps) {
  const [state, setState] = useState<ScoringState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState({ stage: 'companies' as 'companies' | 'contacts' | 'complete', processed: 0, total: 0 });
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [showOutboundMenu, setShowOutboundMenu] = useState(false);
  const [outboundState, setOutboundState] = useState<OutboundState>('idle');
  const [outboundError, setOutboundError] = useState<string | null>(null);
  const [outboundProgress, setOutboundProgress] = useState({ processed: 0, total: 0 });
  const [outboundScope, setOutboundScope] = useState<OutboundScope>('direct');
  const [drafts, setDrafts] = useState<OutboundDraft[]>([]);
  const [accountPitches, setAccountPitches] = useState<AccountPitchDraft[]>([]);
  const [lastRunWasSample, setLastRunWasSample] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [currentJobState, setCurrentJobState] = useState<IcpJobState | null>(null);
  const [lastRunMode, setLastRunMode] = useState<RunMode>('score_only');
  const [runTargetIndexes, setRunTargetIndexes] = useState<number[]>([]);

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
  const isCompanyOnly = useMemo(() => {
    // Check if any row has structured contact data
    return !results.some((row) => {
      const contact = extractContactFields(headers, row.originalRow);
      return contact.hasStructuredContact;
    });
  }, [headers, results]);
  const directOutboundCandidates = useMemo(() => buildOutboundCandidates(headers, results, 'direct'), [headers, results]);
  const directQueueOutboundCandidates = useMemo(
    () => buildOutboundCandidates(headers, results, 'direct_queue'),
    [headers, results],
  );
  const eligibleRowIndexes = useMemo(
    () =>
      preparedResults
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.match.accountStatus === 'eligible')
        .map(({ index }) => index),
    [preparedResults],
  );

  const mergeScoredMatch = (existing: EnrichedRow['match'], scored?: Partial<EnrichedRow['match']>) => {
    if (!scored) return existing;
    const next = { ...existing };
    for (const key of SCORING_MATCH_FIELDS) {
      if (key in scored) {
        next[key] = scored[key] as never;
      }
    }
    return next;
  };

  const runAccountPitches = async (pitchCandidates: AccountPitchCandidate[]) => {
    setOutboundState('running');
    setOutboundError(null);
    setShowOutboundMenu(false);
    setAccountPitches([]);

    let response: Response;
    try {
      response = await fetch('/api/account-pitch/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: pitchCandidates }),
      });
    } catch (error) {
      const message = `Account pitch network error: ${String(error)}`;
      setOutboundError(message);
      setOutboundState('error');
      onError(message);
      return;
    }

    if (!response.ok || !response.body) {
      const message = `Account pitch failed: HTTP ${response.status}`;
      setOutboundError(message);
      setOutboundState('error');
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
          const event = JSON.parse(line.slice(6)) as AccountPitchStreamEvent;
          if (event.type === 'progress') {
            setOutboundProgress({ processed: event.processed, total: event.total });
          } else if (event.type === 'complete') {
            setAccountPitches(event.pitches);
            setOutboundState('complete');
          } else if (event.type === 'error') {
            setOutboundError(event.error);
            setOutboundState('error');
            onError(event.error);
          }
        }
      }
    } catch (error) {
      const message = `Account pitch stream failed: ${String(error)}`;
      setOutboundError(message);
      setOutboundState('error');
      onError(message);
    }
  };

  const runOutbound = async (scope: OutboundScope, sourceResults = results) => {
    const candidates = buildOutboundCandidates(headers, sourceResults, scope);
    if (candidates.length === 0) {
      // Fallback: generate account-level pitches for high-ICP companies
      const pitchCandidates = buildAccountPitchCandidates(headers, sourceResults);
      if (pitchCandidates.length === 0) {
        setOutboundError('No scored leads or high-ICP accounts available for outbound.');
        setOutboundState('error');
        return;
      }
      await runAccountPitches(pitchCandidates);
      return;
    }

    setOutboundScope(scope);
    setOutboundState('running');
    setOutboundError(null);
    setShowOutboundMenu(false);

    let response: Response;
    try {
      response = await fetch('/api/outbound/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates }),
      });
    } catch (error) {
      const message = `Outbound network error: ${String(error)}`;
      setOutboundError(message);
      setOutboundState('error');
      onError(message);
      return;
    }

    if (!response.ok || !response.body) {
      const message = `Outbound failed: HTTP ${response.status}`;
      setOutboundError(message);
      setOutboundState('error');
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
          const event = JSON.parse(line.slice(6)) as OutboundStreamEvent;
          if (event.type === 'progress') {
            setOutboundProgress({ processed: event.processed, total: event.total });
          } else if (event.type === 'complete') {
            setDrafts(event.drafts);
            setOutboundState('complete');
          } else if (event.type === 'error') {
            setOutboundError(event.error);
            setOutboundState('error');
            onError(event.error);
          }
        }
      }
    } catch (error) {
      const message = `Outbound stream failed: ${String(error)}`;
      setOutboundError(message);
      setOutboundState('error');
      onError(message);
    }
  };

  const runScore = async (mode: RunMode = 'score_only') => {
    const isSampleRun = mode === 'score_sample';
    const targetIndexes = isSampleRun ? eligibleRowIndexes.slice(0, SAMPLE_LIMIT) : results.map((_, index) => index);
    if (targetIndexes.length === 0) {
      setErrorMsg(isSampleRun ? 'No eligible rows available for a test run.' : 'No rows available to score.');
      setState('error');
      return;
    }

    setState('running');
    setErrorMsg(null);
    setShowRunMenu(false);
    setOutboundState('idle');
    setOutboundError(null);
    setDrafts([]);
    setAccountPitches([]);
    setLastRunWasSample(isSampleRun);
    setLastRunMode(mode);
    setRunTargetIndexes(targetIndexes);

    let response: Response;
    try {
      const compactResults: CompactScoreRow[] = targetIndexes.map((rowIndex) => {
        const row = results[rowIndex]!;
        return {
          originalRow: (() => {
            const contact = extractContactFields(headers, row.originalRow);
            return [contact.name, contact.title, contact.email];
          })(),
          domain: row.domain,
          companyName: row.companyName,
          match: {
            sfAccountName: row.match.sfAccountName,
            sfMatchedDomain: row.match.sfMatchedDomain,
            sfOptOut: row.match.sfOptOut,
            sfOptOutSpecificContacts: row.match.sfOptOutSpecificContacts,
            isCustomer: row.match.isCustomer,
            accountStatus: row.match.accountStatus,
          },
        };
      });
      response = await fetch('/api/icp-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: SCORE_HEADERS, results: compactResults }),
      });
    } catch (error) {
      const message = `Network error: ${String(error)}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
      return;
    }

    if (!response.ok) {
      const message = `Scoring failed: HTTP ${response.status}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
      return;
    }

    try {
      const data = (await response.json()) as IcpJobResponse;
      setJobId(data.job.id);
      if (data.jobState) setCurrentJobState(data.jobState);
      window.localStorage.setItem(
        ACTIVE_JOB_STORAGE_KEY,
        JSON.stringify({
          id: data.job.id,
          mode,
          lastRunWasSample: isSampleRun,
          targetIndexes,
        }),
      );
    } catch (error) {
      const message = `Scoring start failed: ${String(error)}`;
      setErrorMsg(message);
      setState('error');
      onError(message);
    }
  };

  useEffect(() => {
    if (jobId || state === 'running') return;
    try {
      const raw = window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        id?: string;
        mode?: RunMode;
        lastRunWasSample?: boolean;
        targetIndexes?: number[];
      };
      if (!saved.id || !Array.isArray(saved.targetIndexes)) return;
      setJobId(saved.id);
      setLastRunMode(saved.mode ?? 'score_only');
      setLastRunWasSample(Boolean(saved.lastRunWasSample));
      setRunTargetIndexes(saved.targetIndexes);
      setState('running');
      setErrorMsg(null);
    } catch {
      // ignore corrupt saved job state
    }
  }, [jobId, state]);

  useEffect(() => {
    if (!jobId || state !== 'running') return;

    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const run = async () => {
      while (!cancelled) {
        let response: Response;
        try {
          response = await fetch(`/api/icp-jobs/${jobId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobState: currentJobState }),
          });
        } catch (error) {
          if (!cancelled && retryCount < MAX_RETRIES) {
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, 3000 * retryCount));
            continue;
          }
          const message = `Network error: ${String(error)}`;
          if (!cancelled) {
            setErrorMsg(message);
            setState('error');
            onError(message);
          }
          return;
        }

        if (!response.ok) {
          // Retry on transient server errors (504 gateway timeout, 502 bad gateway, 500)
          if ((response.status === 504 || response.status === 502 || response.status === 500) && retryCount < MAX_RETRIES) {
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, 3000 * retryCount));
            continue;
          }
          const message = `Scoring failed: HTTP ${response.status}`;
          if (!cancelled) {
            setErrorMsg(message);
            setState('error');
            onError(message);
          }
          return;
        }

        retryCount = 0;
        const data = (await response.json()) as IcpJobResponse;
        if (cancelled) return;
        if (data.jobState) setCurrentJobState(data.jobState);
        const job = data.job;
        setProgress(job.progress);

        if (job.status === 'error') {
          const message = job.error || 'Scoring job failed';
          setErrorMsg(message);
          setState('error');
          onError(message);
          setJobId(null);
          window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
          return;
        }

        if (job.status === 'complete' && job.results) {
          const targetIndexes = runTargetIndexes.length > 0 ? runTargetIndexes : lastRunWasSample ? eligibleRowIndexes.slice(0, SAMPLE_LIMIT) : results.map((_, index) => index);
          const scoredIndexByOriginalIndex = new Map(targetIndexes.map((originalIndex, scoredIndex) => [originalIndex, scoredIndex]));
          const mergedResults = results.map((row, index) => {
            const scoredPosition = scoredIndexByOriginalIndex.get(index) ?? -1;
            const scoredRow = scoredPosition >= 0 ? job.results?.[scoredPosition] : undefined;
            if (!scoredRow) return row;
            return {
              ...row,
              match: mergeScoredMatch(row.match, scoredRow.match),
            };
          });
          setState('complete');
          setJobId(null);
          setRunTargetIndexes([]);
          window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
          onComplete(mergedResults);
          if (lastRunMode === 'score_and_outbound_direct') {
            void runOutbound('direct', mergedResults);
          } else if (lastRunMode === 'score_and_outbound_queue') {
            void runOutbound('direct_queue', mergedResults);
          }
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentJobState, eligibleRowIndexes, jobId, lastRunMode, lastRunWasSample, onComplete, onError, results, runTargetIndexes, state]);

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
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => void runScore()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Run ICP
            </button>
            <button
              onClick={() => setShowRunMenu((prev) => !prev)}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              ▼
            </button>
            {showRunMenu && (
              <div className="absolute right-0 top-11 z-20 w-64 rounded-lg border border-emerald-200 bg-white p-2 shadow-lg">
                <button
                  onClick={() => void runScore('score_only')}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Run ICP only
                </button>
                <button
                  onClick={() => void runScore('score_sample')}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Test run first 5 eligible {isCompanyOnly ? 'accounts' : 'leads'}
                </button>
                <button
                  onClick={() => void runScore('score_and_outbound_direct')}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Run ICP + outbound for direct leads
                </button>
                <button
                  onClick={() => void runScore('score_and_outbound_queue')}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  Run ICP + outbound for direct + queue leads
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {state === 'running' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-emerald-900">
              {progress.stage === 'contacts' && !isCompanyOnly ? 'Model-reviewing contacts…' : 'Scoring companies…'}
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
          {progress.stage === 'contacts' && (
            <p className="text-xs text-emerald-700">
              This contact count reflects only roles that need an LLM review. Obvious buyer, connector, and excluded roles are scored deterministically and do not appear here.
            </p>
          )}
        </div>
      )}

      {state === 'complete' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-emerald-900">
              {lastRunWasSample ? `ICP test run complete for ${Math.min(SAMPLE_LIMIT, eligibleRowIndexes.length)} eligible leads.` : 'ICP scoring complete.'}
            </p>
            <div className="relative flex items-center gap-2">
              <button
                onClick={() => void runOutbound('direct')}
                className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                Create Outbound
              </button>
              <button
                onClick={() => setShowOutboundMenu((prev) => !prev)}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                ▼
              </button>
              <button
                onClick={() => setState('idle')}
                className="text-xs text-emerald-700 underline hover:text-emerald-900"
              >
                Re-run ICP
              </button>
              {showOutboundMenu && (
                <div className="absolute right-16 top-11 z-20 w-64 rounded-lg border border-emerald-200 bg-white p-2 shadow-lg">
                  <button
                    onClick={() => {
                      setShowOutboundMenu(false);
                      void runOutbound('direct');
                    }}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Create outbound for direct leads
                  </button>
                  <button
                    onClick={() => {
                      setShowOutboundMenu(false);
                      void runOutbound('direct_queue');
                    }}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Create outbound for direct + queue leads
                  </button>
                </div>
              )}
            </div>
          </div>

          {isCompanyOnly ? (
            <p className="text-xs text-emerald-700">
              Company-only mode — {eligibleCompanies.length.toLocaleString()} account{eligibleCompanies.length === 1 ? '' : 's'} scored (no contacts to classify).
              Use &quot;Create Outbound&quot; for account-level pitch angles.
            </p>
          ) : (
            <p className="text-xs text-emerald-700">
              Direct leads available: {directOutboundCandidates.length.toLocaleString()} · Direct + queue available:{' '}
              {directQueueOutboundCandidates.length.toLocaleString()}
            </p>
          )}
          {lastRunWasSample && (
            <p className="text-xs text-amber-700">
              Only the first {Math.min(SAMPLE_LIMIT, eligibleRowIndexes.length)} eligible leads were scored in this test run. Use Run ICP for the full list.
            </p>
          )}
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

      {(outboundState === 'running' || outboundState === 'error' || outboundState === 'complete') && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4">
          {outboundState === 'running' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-blue-900">
                  {directQueueOutboundCandidates.length === 0
                    ? 'Generating account pitch angles…'
                    : `Generating outbound for ${outboundScope === 'direct' ? 'direct' : 'direct + queue'} leads…`}
                </span>
                <span className="text-blue-700">
                  {outboundProgress.total > 0 ? `${outboundProgress.processed}/${outboundProgress.total}` : 'Starting'}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{
                    width: outboundProgress.total > 0 ? `${(outboundProgress.processed / outboundProgress.total) * 100}%` : '15%',
                  }}
                />
              </div>
            </div>
          )}

          {outboundState === 'error' && <p className="text-sm font-medium text-red-700">{outboundError}</p>}

          {outboundState === 'complete' && accountPitches.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    Account pitches ready for {accountPitches.length.toLocaleString()} account{accountPitches.length === 1 ? '' : 's'}.
                  </p>
                  <p className="text-xs text-blue-700">
                    No contact info available — generated account-level pitch angles instead.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const text = accountPitches
                      .map((p) => [`${p.company} (${p.useCase})`, p.pitch, `Internal: ${p.rationale}`].join('\n'))
                      .join('\n\n---\n\n');
                    void navigator.clipboard.writeText(text);
                  }}
                  className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
                >
                  Copy all
                </button>
              </div>

              <div className="space-y-3">
                {accountPitches.map((pitch) => (
                  <div key={pitch.key} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{pitch.company}</p>
                      <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                        {pitch.useCase}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{pitch.pitch}</p>
                    <p className="mt-2 text-xs text-gray-400">{pitch.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outboundState === 'complete' && drafts.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    Outbound drafts ready for {drafts.length.toLocaleString()} lead{drafts.length === 1 ? '' : 's'}.
                  </p>
                  <p className="text-xs text-blue-700">
                    Scope: {outboundScope === 'direct' ? 'Direct only' : 'Direct + queue'}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const text = drafts
                      .map((draft) => {
                        const candidate = [...directQueueOutboundCandidates, ...directOutboundCandidates].find((item) => item.key === draft.key);
                        return [
                          `${candidate?.company ?? 'Lead'} · ${candidate?.fullName ?? ''}`,
                          `Subject: ${draft.subject}`,
                          '',
                          'Email 1:',
                          draft.email1,
                          '',
                          'Email 2:',
                          draft.email2,
                          '',
                          'LinkedIn:',
                          draft.linkedinMessage,
                        ].join('\n');
                      })
                      .join('\n\n---\n\n');
                    void navigator.clipboard.writeText(text);
                  }}
                  className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50"
                >
                  Copy all
                </button>
              </div>

              <div className="space-y-3">
                {drafts.map((draft) => {
                  const candidate = [...directQueueOutboundCandidates, ...directOutboundCandidates].find((item) => item.key === draft.key);
                  return (
                    <div key={draft.key} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-2 flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {candidate?.company ?? 'Lead'} · {candidate?.fullName ?? 'Unknown contact'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {candidate?.title ?? ''} · {candidate?.leadPriority ?? ''} · {draft.rationale}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3 text-sm text-gray-700">
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Subject</p>
                          <p>{draft.subject}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Email 1</p>
                          <p className="whitespace-pre-wrap">{draft.email1}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Email 2</p>
                          <p className="whitespace-pre-wrap">{draft.email2}</p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">LinkedIn</p>
                          <p className="whitespace-pre-wrap">{draft.linkedinMessage}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
