import React from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  Folder,
  Lock,
  Pause,
  Play,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { ActiveTransferBatch, PendingIncomingRequest } from '../types/instrop';
import { formatBytes, formatEta, formatSpeed } from '../utils/device';
import { FileTypeIcon } from './InstropLogo';

interface TransfersViewProps {
  transfers: ActiveTransferBatch[];
  incomingRequests: PendingIncomingRequest[];
  onAcceptRequest: (req: PendingIncomingRequest, trust: boolean) => void;
  onDeclineRequest: (req: PendingIncomingRequest) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDownloadFile: (url: string, filename: string) => void;
  onDownloadFolderZip: (transferId: string) => void;
  onClearCompleted: () => void;
  onGoHome: () => void;
}

export function TransfersView({
  transfers,
  incomingRequests,
  onAcceptRequest,
  onDeclineRequest,
  onPause,
  onResume,
  onCancel,
  onDownloadFile,
  onDownloadFolderZip,
  onClearCompleted,
  onGoHome,
}: TransfersViewProps) {
  const hasFinished = transfers.some((t) =>
    ['completed', 'failed', 'canceled', 'declined'].includes(t.status)
  );

  return (
    <div className="space-y-8">
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Transfers
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Live chunked streaming progress, real-time speed, and SHA-256 verification.
          </p>
        </div>

        {hasFinished && (
          <button
            type="button"
            onClick={onClearCompleted}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            Clear Finished
          </button>
        )}
      </section>

      {/* Pending Incoming Requests */}
      {incomingRequests.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Awaiting Your Approval
          </h2>
          <div className="space-y-3">
            {incomingRequests.map((req) => (
              <div
                key={req.transferId}
                className="rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    {req.fromPeer.name} wants to send {req.files.length}{' '}
                    {req.files.length === 1 ? 'file' : 'files'}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                    {req.fromPeer.os} ·{' '}
                    <span className="font-mono tabular-nums">{formatBytes(req.totalSize)}</span> ·{' '}
                    {req.isFolder && req.folderName ? `Folder: ${req.folderName}` : req.files[0]?.name}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onDeclineRequest(req)}
                    className="min-h-[40px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => onAcceptRequest(req, false)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active & Recent Session Transfers */}
      {transfers.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-10 text-center space-y-4">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            No active transfers right now
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            Select a nearby device on Home and drop files or folders to start a high-speed encrypted transfer.
          </p>
          <button
            type="button"
            onClick={onGoHome}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors"
          >
            Go to Send Files
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {transfers.map((batch) => {
            const pct =
              batch.totalSize > 0
                ? Math.min(100, (batch.bytesTransferred / batch.totalSize) * 100)
                : batch.status === 'completed'
                  ? 100
                  : 0;
            const isActive =
              batch.status === 'transferring' ||
              batch.status === 'paused' ||
              batch.status === 'awaiting-approval';

            return (
              <div
                key={batch.transferId}
                className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 space-y-4"
              >
                {/* Batch Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {batch.files[0]?.previewUrl ? (
                      <img
                        src={batch.files[0].previewUrl}
                        alt={batch.files[0].name}
                        className="w-11 h-11 rounded-xl object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0">
                        {batch.isFolder ? (
                          <Folder className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <FileTypeIcon
                            name={batch.files[0]?.name || 'file'}
                            mimeType={batch.files[0]?.mimeType || ''}
                            className="w-5 h-5"
                          />
                        )}
                      </div>
                    )}

                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                        {batch.isFolder && batch.folderName
                          ? `${batch.folderName}/ (${batch.files.length} files)`
                          : batch.files.length === 1
                            ? batch.files[0].name
                            : `${batch.files.length} files`}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>
                          {batch.direction === 'send' ? 'Sending to' : 'Receiving from'}{' '}
                          {batch.peerName} ({batch.peerOs})
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          {batch.transportMode === 'p2p-webrtc' ? 'Direct P2P' : 'E2E Encrypted'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    {batch.status === 'transferring' && (
                      <button
                        type="button"
                        onClick={() => onPause(batch.transferId)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pause
                      </button>
                    )}

                    {batch.status === 'paused' && (
                      <button
                        type="button"
                        onClick={() => onResume(batch.transferId)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Resume
                      </button>
                    )}

                    {isActive && (
                      <button
                        type="button"
                        onClick={() => onCancel(batch.transferId)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors inline-flex items-center gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    )}

                    {batch.direction === 'receive' &&
                      batch.status === 'completed' &&
                      batch.isFolder && (
                        <button
                          type="button"
                          onClick={() => onDownloadFolderZip(batch.transferId)}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Download Folder (.zip)
                        </button>
                      )}
                  </div>
                </div>

                {/* Smooth GPU-Composited Progress Bar & Real-Time Metrics */}
                <div className="space-y-2">
                  <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                    <div
                      className={`h-full w-full origin-left transition-transform duration-150 ease-out rounded-full ${
                        batch.status === 'failed' || batch.status === 'canceled' || batch.status === 'declined'
                          ? 'bg-red-500'
                          : batch.status === 'completed'
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : batch.status === 'paused'
                              ? 'bg-amber-500'
                              : 'bg-indigo-600 dark:bg-indigo-500'
                      }`}
                      style={{ transform: `scaleX(${Math.max(0.01, pct / 100)})` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-mono tabular-nums">
                      <span>
                        {formatBytes(batch.bytesTransferred)} / {formatBytes(batch.totalSize)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{pct.toFixed(0)}%</span>
                      {batch.status === 'transferring' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatSpeed(batch.speedBps)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatEta(batch.etaSeconds)}</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {batch.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          SHA-256 Verified
                        </span>
                      )}
                      {batch.status === 'awaiting-approval' && (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Waiting for {batch.peerName} to accept
                        </span>
                      )}
                      {batch.status === 'paused' && (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          {batch.errorMessage || 'Paused'}
                        </span>
                      )}
                      {(batch.status === 'failed' ||
                        batch.status === 'canceled' ||
                        batch.status === 'declined') && (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          {batch.errorMessage ||
                            (batch.status === 'canceled'
                              ? 'Canceled'
                              : batch.status === 'declined'
                                ? 'Declined'
                                : 'Failed')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Per-file list when multiple files or completed received downloads */}
                {(batch.files.length > 1 ||
                  (batch.direction === 'receive' && batch.files[0]?.downloadUrl)) && (
                  <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-56 overflow-y-auto">
                    {batch.files.map((file) => (
                      <div
                        key={file.fileId}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileTypeIcon
                            name={file.name}
                            mimeType={file.mimeType}
                            className="w-3.5 h-3.5 text-zinc-500 shrink-0"
                          />
                          <span className="truncate text-zinc-800 dark:text-zinc-200">
                            {file.relativePath || file.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                            {formatBytes(file.bytesTransferred)} / {formatBytes(file.size)}
                          </span>
                          {file.downloadUrl && (
                            <button
                              type="button"
                              onClick={() => onDownloadFile(file.downloadUrl!, file.name)}
                              className="min-h-[30px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              Save
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
