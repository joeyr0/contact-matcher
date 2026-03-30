import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ReferenceStatus, UploadResponse } from '../lib/types';

const STALE_DAYS = 45;

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Updated today';
  if (diffDays === 1) return 'Updated yesterday';
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  const diffMs = Date.now() - new Date(iso).getTime();
  return diffMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

interface UploadZoneProps {
  label: string;
  description: string;
  type: 'sheet15' | 'optout' | 'arr';
  status: ReferenceStatus['sheet15'] | ReferenceStatus['optout'] | ReferenceStatus['arr'];
  onUploadComplete: () => void;
}

function UploadZone({ label, description, type, status, onUploadComplete }: UploadZoneProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const uniqueCount =
    'uniqueDomains' in status ? status.uniqueDomains : status.uniqueCustomers;
  const uniqueLabel = 'uniqueDomains' in status ? 'domains' : 'customers';

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (accepted.length === 0) return;
      const file = accepted[0];
      setUploading(true);
      setError(null);
      setSuccessMsg(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/reference/upload?type=${type}`, {
          method: 'POST',
          body: formData,
        });

        let data: UploadResponse;
        try {
          data = (await res.json()) as UploadResponse;
        } catch {
          setError(`HTTP ${res.status} — server returned a non-JSON response. Check that Vercel Blob storage is configured.`);
          return;
        }

        if (!res.ok || !data.success) {
          setError(data.error ?? `Upload failed (HTTP ${res.status})`);
        } else {
          setSuccessMsg(
            `${data.rowCount.toLocaleString()} rows loaded (${data.uniqueCount.toLocaleString()} unique ${data.uniqueLabel})` +
              (data.skippedRows > 0 ? ` — ${data.skippedRows} rows skipped` : ''),
          );
          onUploadComplete();
        }
      } catch (err) {
        setError(`Network error: ${String(err)}`);
      } finally {
        setUploading(false);
      }
    },
    [type, onUploadComplete],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'], 'application/vnd.ms-excel': ['.csv'], 'application/csv': ['.csv'] },
    multiple: false,
    disabled: uploading,
  });

  const stale = isStale(status.lastUpdated);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{label}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        </div>
        <span
          className={`ml-4 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status.loaded
              ? stale
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {status.loaded ? (stale ? 'Stale' : 'Loaded') : 'Not loaded'}
        </span>
      </div>

      {status.loaded && (
        <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <span className="font-medium">{status.rowCount.toLocaleString()}</span> rows &nbsp;·&nbsp;
          <span className="font-medium">{uniqueCount.toLocaleString()}</span> unique {uniqueLabel}
          &nbsp;·&nbsp;
          <span className={stale ? 'text-yellow-700' : ''}>{formatDate(status.lastUpdated)}</span>
        </div>
      )}

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
          isDragActive
            ? 'border-blue-400 bg-blue-50'
            : uploading
              ? 'border-gray-200 bg-gray-50 opacity-60'
              : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm text-gray-500">Uploading and processing…</p>
          </div>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-blue-600">Drop to upload</p>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-400">CSV files only</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}
      {successMsg && (
        <div className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          <span className="font-medium">Success:</span> {successMsg}
        </div>
      )}
    </div>
  );
}

export default function ReferenceDataManager() {
  const [status, setStatus] = useState<ReferenceStatus>({
    sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    arr: { loaded: false, rowCount: 0, uniqueCustomers: 0, lastUpdated: null },
  });
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/reference/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ReferenceStatus;
      setStatus(data);
      setStatusError(null);
    } catch (err) {
      setStatusError(`Could not load status: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const readyToMatch = status.sheet15.loaded && status.optout.loaded;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Reference Data</h2>
        <p className="mt-1 text-sm text-gray-500">
          Upload your Salesforce CSV exports to enable matching. Uploading Committed ARR enables
          active-customer flagging (and the default view hides active customers).
        </p>
      </div>

      {statusError && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {statusError}
        </div>
      )}

      {readyToMatch && (
        <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Both datasets loaded — ready to run contact matching.
        </div>
      )}
      {readyToMatch && !status.arr.loaded && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Committed ARR not loaded — active-customer blacklist is disabled.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <UploadZone
          label="Salesforce Accounts (Website → Account)"
          description="salesforce_all_accounts.csv — includes Stripe ID"
          type="sheet15"
          status={status.sheet15}
          onUploadComplete={fetchStatus}
        />
        <UploadZone
          label="Sales Opt-Out List"
          description="Opt-out_-_Sales_Opt_out_All.csv — ~3,550 rows"
          type="optout"
          status={status.optout}
          onUploadComplete={fetchStatus}
        />
        <UploadZone
          label="Committed ARR (Active Customers)"
          description="Turnkey Topline Metrics.xlsx - Committed ARR.csv — keyed by Stripe Customer ID"
          type="arr"
          status={status.arr}
          onUploadComplete={fetchStatus}
        />
      </div>
    </div>
  );
}
