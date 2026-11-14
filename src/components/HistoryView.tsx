import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { TransferHistoryEntry } from '../types/instrop';
import { formatBytes, formatDateTime, formatSpeed } from '../utils/device';

interface HistoryViewProps {
  history: TransferHistoryEntry[];
  onClearHistory: () => void;
}

export function HistoryView({ history, onClearHistory }: HistoryViewProps) {
  const [query, setQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'completed' | 'canceled' | 'declined' | 'failed'
  >('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((entry) => {
      if (directionFilter !== 'all' && entry.direction !== directionFilter) return false;
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (!q) return true;
      const peerMatch =
        entry.peerName.toLowerCase().includes(q) || entry.peerOs.toLowerCase().includes(q);
      const folderMatch = entry.folderName?.toLowerCase().includes(q);
      const fileMatch = entry.files.some(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.relativePath.toLowerCase().includes(q) ||
          f.sha256.toLowerCase().includes(q)
      );
      return peerMatch || folderMatch || fileMatch;
    });
  }, [history, query, directionFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Transfer History
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Audit trail of sent and received files, timestamps, device names, and SHA-256 digests.
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear History
          </button>
        )}
      </section>

      {/* Search & Filters */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files, devices, or SHA-256..."
            aria-label="Search transfer history"
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-sm text-zinc-950 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
            {(['all', 'sent', 'received'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDirectionFilter(dir)}
                className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                  directionFilter === dir
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as 'all' | 'completed' | 'canceled' | 'declined' | 'failed'
              )
            }
            aria-label="Filter by transfer status"
            className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="canceled">Canceled</option>
            <option value="declined">Declined</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </section>

      {/* History List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-10 text-center">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {history.length === 0 ? 'No transfer history yet' : 'No matching transfers'}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {history.length === 0
              ? 'Completed, canceled, and declined file transfers are recorded locally on this device.'
              : 'Try adjusting your search query or filters.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] overflow-hidden">
          <div className="hidden md:grid md:grid-cols-[1fr_180px_110px_140px_130px] gap-4 px-5 py-3 border-b border-zinc-200/80 dark:border-zinc-800/80 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>File / Folder</span>
            <span>Device</span>
            <span className="text-right">Size</span>
            <span>Date &amp; Time</span>
            <span className="text-right">Status</span>
          </div>

          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {filtered.map((entry) => {
              const title =
                entry.isFolder && entry.folderName
                  ? `${entry.folderName}/ (${entry.files.length} files)`
                  : entry.files.length > 1
                    ? `${entry.files[0]?.name} (+${entry.files.length - 1})`
                    : entry.files[0]?.name || 'Transfer';

              const shortSha = entry.files[0]?.sha256?.slice(0, 10);

              return (
                <div
                  key={entry.id}
                  className="px-5 py-3.5 grid grid-cols-1 md:grid-cols-[1fr_180px_110px_140px_130px] gap-2 md:gap-4 items-center hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shrink-0">
                      {entry.direction === 'sent' ? (
                        <ArrowUpRight className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                        {title}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {entry.direction === 'sent' ? 'Sent' : 'Received'}
                        {entry.averageSpeedBps > 0 ? ` · ${formatSpeed(entry.averageSpeedBps)}` : ''}
                        {shortSha ? ` · SHA-256 ${shortSha}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                    {entry.peerName}{' '}
                    <span className="text-zinc-400 dark:text-zinc-500">({entry.peerOs})</span>
                  </div>

                  <div className="text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100 md:text-right">
                    {formatBytes(entry.totalSize)}
                  </div>

                  <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    {formatDateTime(entry.completedAt)}
                  </div>

                  <div className="md:text-right">
                    {entry.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 capitalize">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {entry.status}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
