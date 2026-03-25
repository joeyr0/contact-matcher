import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { EnrichedRow, MatchStreamEvent } from '../lib/types';

interface ContactUploadProps {
  onMatchStart: () => void;
  onProgress: (processed: number, total: number) => void;
  onComplete: (headers: string[], results: EnrichedRow[]) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}

export default function ContactUpload({
  onMatchStart,
  onProgress,
  onComplete,
  onError,
  disabled,
}: ContactUploadProps) {
  const [uploading, setUploading] = useState(false);

  const runMatch = useCallback(
    async (file: File) => {
      setUploading(true);
      onMatchStart();

      const formData = new FormData();
      formData.append('file', file);

      let response: Response;
      try {
        response = await fetch('/api/match/stream', { method: 'POST', body: formData });
      } catch (err) {
        setUploading(false);
        onError(`Network error: ${String(err)}`);
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Unknown error' }));
        setUploading(false);
        onError((body as { error?: string }).error ?? `HTTP ${response.status}`);
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
    [onMatchStart, onProgress, onComplete, onError],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) void runMatch(accepted[0]);
    },
    [runMatch],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'] },
    multiple: false,
    disabled: uploading || disabled,
  });

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Contact CSV</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Upload a CSV with an email column. Email column is auto-detected.
        </p>
      </div>

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
            <p className="text-sm text-gray-500">Processing contacts…</p>
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
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
              />
            </svg>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-400">CSV with email column</p>
          </div>
        )}
      </div>
    </div>
  );
}
