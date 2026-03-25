interface MatchProgressProps {
  processed: number;
  total: number;
}

export default function MatchProgress({ processed, total }: MatchProgressProps) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-blue-800">Matching contacts…</span>
        <span className="text-blue-600">
          {processed.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
