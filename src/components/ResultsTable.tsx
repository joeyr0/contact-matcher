import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import Papa from 'papaparse';
import type { EnrichedRow } from '../lib/types';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type FlatRow = Record<string, string>;

const ENRICHED_HEADERS = [
  'sf_account_name',
  'sf_account_id',
  'sf_account_owner',
  'sf_opt_out',
  'sf_opt_out_specific_contacts',
  'sf_opt_out_notes',
  'match_method',
  'match_confidence',
] as const;

const CONFIDENCE_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, '': 0 };
const METHOD_ORDER: Record<string, number> = { exact: 4, name_match: 3, fuzzy: 2, no_match: 1, '': 0 };

const METHOD_BADGE: Record<string, string> = {
  exact: 'bg-green-100 text-green-800',
  name_match: 'bg-blue-100 text-blue-800',
  fuzzy: 'bg-yellow-100 text-yellow-800',
  no_match: 'bg-gray-100 text-gray-500',
};

type MatchMethodFilter = 'exact' | 'name_match' | 'fuzzy' | 'no_match';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFlatRows(headers: string[], results: EnrichedRow[]): FlatRow[] {
  return results.map(({ originalRow, match }) => {
    const row: FlatRow = {};
    headers.forEach((h, i) => {
      row[h] = originalRow[i] ?? '';
    });
    row['sf_account_name'] = match.sfAccountName;
    row['sf_account_id'] = match.sfAccountId;
    row['sf_account_owner'] = match.sfAccountOwner;
    row['sf_opt_out'] = match.sfOptOut;
    row['sf_opt_out_specific_contacts'] = match.sfOptOutSpecificContacts;
    row['sf_opt_out_notes'] = match.sfOptOutNotes;
    row['match_method'] = match.matchMethod;
    row['match_confidence'] = match.matchConfidence;
    return row;
  });
}

function exportCSV(allHeaders: string[], rows: FlatRow[], filename: string) {
  const data = rows.map((row) => allHeaders.map((h) => row[h] ?? ''));
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility
  const csv = BOM + Papa.unparse({ fields: allHeaders, data });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResultsTableProps {
  headers: string[];
  results: EnrichedRow[];
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ResultsTable({ headers, results, onReset }: ResultsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filterInput, setFilterInput] = useState('');
  const [globalFilter, setGlobalFilter] = useState('');

  // Debounce: only run TanStack's expensive filter after 150ms of no typing
  useEffect(() => {
    const t = setTimeout(() => startTransition(() => setGlobalFilter(filterInput)), 150);
    return () => clearTimeout(t);
  }, [filterInput]);
  const [methodFilter, setMethodFilter] = useState<MatchMethodFilter[]>([]);
  const [optOutFilter, setOptOutFilter] = useState<'all' | 'opted_out' | 'specific_only'>('all');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    sf_account_id: false,
    sf_opt_out_specific_contacts: false,
    sf_opt_out_notes: false,
  });
  const [showColPicker, setShowColPicker] = useState(false);

  const allHeaders = [...headers, ...ENRICHED_HEADERS];
  const flatRows = useMemo(() => toFlatRows(headers, results), [headers, results]);

  // All filtering happens here — outside TanStack entirely so it can't block the render pipeline
  const filteredRows = useMemo(() => {
    let rows = flatRows;

    if (optOutFilter === 'opted_out')
      rows = rows.filter((r) => r['sf_opt_out'] === 'TRUE');
    else if (optOutFilter === 'specific_only')
      rows = rows.filter((r) => r['sf_opt_out_specific_contacts'] === 'TRUE');

    if (methodFilter.length > 0)
      rows = rows.filter((r) => methodFilter.includes(r['match_method'] as MatchMethodFilter));

    if (globalFilter) {
      const lf = globalFilter.toLowerCase();
      rows = rows.filter((r) =>
        Object.values(r).some((v) => v && String(v).toLowerCase().includes(lf)),
      );
    }

    return rows;
  }, [flatRows, optOutFilter, methodFilter, globalFilter]);

  // Column definitions
  const columns = useMemo((): ColumnDef<FlatRow>[] => {
    const originalCols: ColumnDef<FlatRow>[] = headers.map((h) => ({
      id: h,
      header: h,
      accessorFn: (row) => row[h] ?? '',
      cell: (info) => (
        <span className="max-w-48 truncate block">{info.getValue<string>()}</span>
      ),
    }));

    const enrichedCols: ColumnDef<FlatRow>[] = [
      {
        id: 'sf_account_name',
        header: 'sf_account_name',
        accessorFn: (row) => row['sf_account_name'] ?? '',
        cell: (info) => (
          <span className="font-medium text-gray-800">{info.getValue<string>()}</span>
        ),
      },
      {
        id: 'sf_account_id',
        header: 'sf_account_id',
        accessorFn: (row) => row['sf_account_id'] ?? '',
      },
      {
        id: 'sf_account_owner',
        header: 'sf_account_owner',
        accessorFn: (row) => row['sf_account_owner'] ?? '',
      },
      {
        id: 'sf_opt_out',
        header: 'sf_opt_out',
        accessorFn: (row) => row['sf_opt_out'] ?? '',
        cell: (info) => {
          const val = info.getValue<string>();
          if (val === 'TRUE')
            return (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                Opted out
              </span>
            );
          if (val === 'FALSE') return <span className="text-xs text-gray-400">FALSE</span>;
          return null;
        },
      },
      {
        id: 'sf_opt_out_specific_contacts',
        header: 'sf_opt_out_specific_contacts',
        accessorFn: (row) => row['sf_opt_out_specific_contacts'] ?? '',
      },
      {
        id: 'sf_opt_out_notes',
        header: 'sf_opt_out_notes',
        accessorFn: (row) => row['sf_opt_out_notes'] ?? '',
      },
      {
        id: 'match_method',
        header: 'match_method',
        accessorFn: (row) => row['match_method'] ?? '',
        sortingFn: (a, b) =>
          (METHOD_ORDER[a.getValue<string>('match_method')] ?? 0) -
          (METHOD_ORDER[b.getValue<string>('match_method')] ?? 0),
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${METHOD_BADGE[val] ?? ''}`}
            >
              {val}
            </span>
          );
        },
      },
      {
        id: 'match_confidence',
        header: 'match_confidence',
        accessorFn: (row) => row['match_confidence'] ?? '',
        sortingFn: (a, b) =>
          (CONFIDENCE_ORDER[a.getValue<string>('match_confidence')] ?? 0) -
          (CONFIDENCE_ORDER[b.getValue<string>('match_confidence')] ?? 0),
      },
    ];

    return [...originalCols, ...enrichedCols];
  }, [headers]);

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => startTransition(() => setSorting(updater)),
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();
  const totalFiltered = filteredRows.length;
  const totalAll = flatRows.length;

  // Stats (computed from all flat rows, not filtered)
  const stats = useMemo(() => ({
    exact: flatRows.filter((r) => r['match_method'] === 'exact').length,
    nameMatch: flatRows.filter((r) => r['match_method'] === 'name_match').length,
    fuzzy: flatRows.filter((r) => r['match_method'] === 'fuzzy').length,
    noMatch: flatRows.filter((r) => r['match_method'] === 'no_match').length,
    optedOut: flatRows.filter((r) => r['sf_opt_out'] === 'TRUE').length,
    specificOnly: flatRows.filter(
      (r) => r['sf_opt_out_specific_contacts'] === 'TRUE' && r['sf_opt_out'] !== 'TRUE',
    ).length,
  }), [flatRows]);

  // Virtualization
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalVirtualSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const today = new Date().toISOString().slice(0, 10);

  const toggleMethod = (m: MatchMethodFilter) =>
    startTransition(() =>
      setMethodFilter((prev) =>
        prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
      ),
    );

  const clearFilters = () => {
    setFilterInput('');
    startTransition(() => {
      setMethodFilter([]);
      setOptOutFilter('all');
      setGlobalFilter('');
    });
  };

  const hasFilters = methodFilter.length > 0 || optOutFilter !== 'all' || filterInput !== '';

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        {/* Text search */}
        <input
          type="text"
          placeholder="Search all columns…"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        />

        {/* Match method filter */}
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-gray-500">Method:</span>
          {(['exact', 'name_match', 'fuzzy', 'no_match'] as MatchMethodFilter[]).map((m) => (
            <button
              key={m}
              onClick={() => toggleMethod(m)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${
                METHOD_BADGE[m]
              } ${methodFilter.length > 0 && !methodFilter.includes(m) ? 'opacity-40' : ''}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Opt-out filter */}
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-gray-500">Opt-out:</span>
          <select
            value={optOutFilter}
            onChange={(e) => startTransition(() => setOptOutFilter(e.target.value as typeof optOutFilter))}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none"
          >
            <option value="all">All</option>
            <option value="opted_out">Opted out</option>
            <option value="specific_only">Specific contacts</option>
          </select>
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-blue-600 underline">
            Clear filters
          </button>
        )}

        {/* Column visibility picker */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowColPicker((v) => !v)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Columns
          </button>
          {showColPicker && (
            <div className="absolute right-0 top-9 z-20 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Toggle columns
              </p>
              {table.getAllLeafColumns().map((col) => (
                <label key={col.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                  />
                  {col.id}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary stats bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
        <span>
          Showing{' '}
          <span className="font-semibold text-gray-900">{totalFiltered.toLocaleString()}</span> of{' '}
          <span className="font-semibold text-gray-900">{totalAll.toLocaleString()}</span>
        </span>
        <span className="text-green-700">
          <span className="font-semibold">{stats.exact.toLocaleString()}</span> exact
        </span>
        {stats.nameMatch > 0 && (
          <span className="text-blue-700">
            <span className="font-semibold">{stats.nameMatch.toLocaleString()}</span> name match
          </span>
        )}
        {stats.fuzzy > 0 && (
          <span className="text-yellow-700">
            <span className="font-semibold">{stats.fuzzy.toLocaleString()}</span> fuzzy
          </span>
        )}
        <span className="text-gray-400">
          <span className="font-semibold">{stats.noMatch.toLocaleString()}</span> no match
        </span>
        {stats.optedOut > 0 && (
          <span className="text-red-700">
            <span className="font-semibold">{stats.optedOut.toLocaleString()}</span> opted out
          </span>
        )}
        {stats.specificOnly > 0 && (
          <span className="text-amber-700">
            <span className="font-semibold">{stats.specificOnly.toLocaleString()}</span> specific
            contacts
          </span>
        )}

        {/* Export buttons */}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => exportCSV(allHeaders, flatRows, `matched-contacts-${today}.csv`)}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            Export all ({totalAll.toLocaleString()})
          </button>
          {hasFilters && totalFiltered !== totalAll && (
            <button
              onClick={() =>
                exportCSV(
                  allHeaders,
                  rows.map((r) => r.original),
                  `matched-contacts-filtered-${today}.csv`,
                )
              }
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Export filtered ({totalFiltered.toLocaleString()})
            </button>
          )}
          <button
            onClick={onReset}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            New match
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        ref={tableContainerRef}
        className="overflow-auto rounded-lg border border-gray-200 bg-white"
        style={{ maxHeight: 'calc(100vh - 320px)', minHeight: 200 }}
        onClick={() => setShowColPicker(false)}
      >
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 ${
                      header.column.getCanSort() ? 'cursor-pointer select-none hover:text-gray-700' : ''
                    }`}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' && ' ↑'}
                    {header.column.getIsSorted() === 'desc' && ' ↓'}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualRows.map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              const isOptedOut = row.original['sf_opt_out'] === 'TRUE';
              const isSpecificOnly =
                row.original['sf_opt_out_specific_contacts'] === 'TRUE' &&
                row.original['sf_opt_out'] !== 'TRUE';
              return (
                <tr
                  key={row.id}
                  className={
                    isOptedOut
                      ? 'bg-red-50 hover:bg-red-100'
                      : isSpecificOnly
                        ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-gray-50'
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-3 py-2 text-gray-700"
                      title={
                        cell.column.id === 'sf_opt_out_notes' ||
                        isSpecificOnly
                          ? (row.original['sf_opt_out_notes'] || undefined)
                          : undefined
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Specific contacts opt-out legend */}
      {(stats.optedOut > 0 || stats.specificOnly > 0) && (
        <div className="flex gap-4 text-xs text-gray-500">
          {stats.optedOut > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-100" /> Full opt-out
            </span>
          )}
          {stats.specificOnly > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-100" /> Specific contacts
              opted out — hover row for names
            </span>
          )}
        </div>
      )}
    </div>
  );
}
