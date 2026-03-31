import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyStatusEntry, PromptConfig } from '../lib/types';

interface PromptPayload {
  prompts: PromptConfig;
  defaults: PromptConfig;
}

interface ApiKeyPayload {
  keys: ApiKeyStatusEntry[];
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Default prompt';
  return `Saved ${new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

interface PromptEditorProps {
  label: string;
  description: string;
  promptKey: keyof PromptConfig;
  prompts: PromptConfig;
  defaults: PromptConfig;
  onRefresh: () => Promise<void>;
}

function PromptEditor({ label, description, promptKey, prompts, defaults, onRefresh }: PromptEditorProps) {
  const [value, setValue] = useState(prompts[promptKey].value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(prompts[promptKey].value);
  }, [promptKey, prompts]);

  const hasChanges = value !== prompts[promptKey].value;
  const matchesDefault = value === defaults[promptKey].value;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: promptKey, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await onRefresh();
      setMessage('Saved');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: promptKey, action: 'reset' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await onRefresh();
      setMessage('Reset to default');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{label}</h3>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
          <p className="mt-1 text-xs text-gray-400">{formatDate(prompts[promptKey].lastUpdated)}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            matchesDefault ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {matchesDefault ? 'Default' : 'Custom'}
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-[420px] w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-xs leading-5 text-gray-800 focus:border-blue-400 focus:outline-none"
        spellCheck={false}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving || !hasChanges}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={() => setValue(prompts[promptKey].value)}
          disabled={saving || !hasChanges}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Revert
        </button>
        <button
          onClick={() => void reset()}
          disabled={saving}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to default
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}

function formatKeySource(source: ApiKeyStatusEntry['source']): string {
  if (source === 'saved') return 'Using saved override';
  if (source === 'environment') return 'Using default environment key';
  return 'No key configured';
}

function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyStatusEntry[]>([]);
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [mode, setMode] = useState<'default' | 'override'>('default');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/api-keys');
      const data = (await res.json()) as ApiKeyPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setKeys(data.keys);
      const current = data.keys.find((entry) => entry.provider === provider);
      setMode(current?.source === 'saved' ? 'override' : 'default');
      setError(null);
    } catch (err) {
      setError(`Could not load API keys: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const current = keys.find((entry) => entry.provider === provider);
    setMode(current?.source === 'saved' ? 'override' : 'default');
    setValue('');
    setMessage(null);
    setError(null);
  }, [keys, provider]);

  const current = keys.find((entry) => entry.provider === provider);

  const save = async () => {
    if (mode === 'default') {
      setSaving(true);
      setMessage(null);
      setError(null);
      try {
        const res = await fetch('/api/api-keys', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, mode: 'default' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setKeys((data as ApiKeyPayload).keys);
        setValue('');
        setMessage('Switched back to default key');
      } catch (err) {
        setError(String(err));
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, mode: 'override', value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setKeys((data as ApiKeyPayload).keys);
      setValue('');
      setMessage('Saved key override');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">API Keys</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          Use the default server key or save your own override for OpenAI or Claude.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px,1fr]">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-none"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Claude / Anthropic</option>
          </select>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading key status…</p>
          ) : current ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{current.label}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    current.source === 'saved'
                      ? 'bg-blue-100 text-blue-700'
                      : current.source === 'environment'
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {formatKeySource(current.source)}
                </span>
                {current.active && (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    Active provider
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">Current key: {current.maskedValue}</p>
              {current.lastUpdated && (
                <p className="mt-1 text-xs text-gray-400">
                  Saved {new Date(current.lastUpdated).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            checked={mode === 'default'}
            onChange={() => setMode('default')}
          />
          Use default key
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            checked={mode === 'override'}
            onChange={() => setMode('override')}
          />
          Enter my own key
        </label>
      </div>

      {mode === 'override' && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">API key</label>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={provider === 'openai' ? 'sk-proj-...' : 'sk-ant-...'}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-xs text-gray-800 focus:border-blue-400 focus:outline-none"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving || (mode === 'override' && !value.trim())}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </div>
  );
}

export default function PromptManager() {
  const [payload, setPayload] = useState<PromptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      const data = (await res.json()) as PromptPayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPayload(data);
      setError(null);
    } catch (err) {
      setError(`Could not load prompts: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void fetchPrompts();
  }, [fetchPrompts]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Prompts</h2>
        <p className="mt-1 text-sm text-gray-500">
          Edit the active ICP scoring and outbound prompts without changing code. Prompt edits apply on the next request.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {error}
        </div>
      )}

      {payload && (
        <div className="grid gap-6">
          <ApiKeyManager />
          <PromptEditor
            label="ICP Scoring Prompt"
            description="Company scoring system prompt used by the ICP scorer."
            promptKey="icpScoring"
            prompts={payload.prompts}
            defaults={payload.defaults}
            onRefresh={fetchPrompts}
          />
          <PromptEditor
            label="Contact Scoring Prompt"
            description="Role and persona scoring system prompt used after company scoring."
            promptKey="contactScoring"
            prompts={payload.prompts}
            defaults={payload.defaults}
            onRefresh={fetchPrompts}
          />
          <PromptEditor
            label="Outbound Prompt"
            description="Outbound drafting system prompt used for email and LinkedIn generation."
            promptKey="outbound"
            prompts={payload.prompts}
            defaults={payload.defaults}
            onRefresh={fetchPrompts}
          />
        </div>
      )}
    </div>
  );
}
