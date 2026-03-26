import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { EnrichedRow, MatchStreamEvent } from '../lib/types';

type ColumnMode = 'auto' | 'email' | 'website';

interface ContactUploadProps {
  onMatchStart: () => void;
  onProgress: (processed: number, total: number) => void;
  onComplete: (headers: string[], results: EnrichedRow[]) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}

const MODE_OPTIONS: { value: ColumnMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto-detect', hint: 'Detect email or website column automatically' },
  { value: 'email', label: 'Emails', hint: 'e.g. john@company.com' },
  { value: 'website', label: 'Websites', hint: 'e.g. company.com or https://company.com' },
];

export default function ContactUpload({
  onMatchStart,
  onProgress,
  onComplete,
  onError,
  disabled,
}: ContactUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [columnMode, setColumnMode] = useState<ColumnMode>('auto');

  const runMatch = useCallback(
    async (file: File) => {
      setUploading(true);
      onMatchStart();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('columnMode', columnMode);

      let response: Response;
      try {
        response = await fetch('/api/match/stream', { method: 'POST', body: formData });
      } catch (err) {
        setUploading(false);
        onError(`Network error: ${String(err)}`);
        return;
      }

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const text = await response.text();
          const body = JSON.parse(text) as { error?: string };
          errorMsg = body.error ?? errorMsg;
        } catch {
          // non-JSON response (HTML error page, etc.)
        }
        setUploading(false);
        onError(errorMsg);
        return;
      }

      if (!response.body) {
        setUploading(false);
        onError('No response body from server');
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
            const event = JSON.parse(line.slice(6)) as MatchStreamEvent;

            if (event.type === 'progress') {
              onProgress(event.processed, event.total);
            } else if (event.type === 'complete') {
              onComplete(event.headers, event.results);
            } else if (event.type === 'error') {
              onError(event.error);
            }
          }
        }
      } catch (err) {
        onError(`Stream error: ${String(err)}`);
      } finally {
        setUploading(false);
      }
    },
    [columnMode, onMatchStart, onProgress, onComplete, onError],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) void runMatch(accepted[0]);
    },
    [runMatch],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv', '.txt'], 'application/vnd.ms-excel': ['.csv'], 'application/csv': ['.csv'] },
    multiple: false,
    disabled: uploading || disabled,
  });

  const activeMode = MODE_OPTIONS.find((m) => m.value === columnMode)!;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Contact list</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Upload a CSV. Choose whether your list has email addresses or company websites.
        </p>
      </div>

      {/* Column mode selector */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setColumnMode(opt.value)}
            disabled={uploading}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              columnMode === opt.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 -mt-2">{activeMode.hint}</p>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          disabled
            ? 'border-gray-200 bg-gray-50 opacity-50'
            : isDragActive
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
            <p className="text-sm text-gray-500">Processing…</p>
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
            <p className="text-xs text-gray-400">
              {columnMode === 'website' ? 'CSV or plain text list of URLs' : 'CSV file'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
