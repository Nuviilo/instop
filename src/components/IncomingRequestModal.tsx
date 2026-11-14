import React, { useState } from 'react';
import { Folder, Lock, ShieldCheck, X } from 'lucide-react';
import type { PendingIncomingRequest } from '../types/instrop';
import { formatBytes } from '../utils/device';
import { DeviceIcon, FileTypeIcon } from './InstropLogo';

interface IncomingRequestModalProps {
  request: PendingIncomingRequest | null;
  onAccept: (req: PendingIncomingRequest, trust: boolean) => void;
  onDecline: (req: PendingIncomingRequest) => void;
}

export function IncomingRequestModal({
  request,
  onAccept,
  onDecline,
}: IncomingRequestModalProps) {
  const [trustDevice, setTrustDevice] = useState(true);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-transfer-title"
    >
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="sm:hidden w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-3" />

        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2
              id="incoming-transfer-title"
              className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              Incoming Transfer
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onDecline(request)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors"
            aria-label="Decline transfer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 shrink-0">
              <DeviceIcon
                deviceType={request.fromPeer.deviceType}
                os={request.fromPeer.os}
                className="w-5 h-5"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                {request.fromPeer.name}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {request.fromPeer.os} · {request.files.length}{' '}
                {request.files.length === 1 ? 'item' : 'items'} ·{' '}
                <span className="font-mono tabular-nums">{formatBytes(request.totalSize)}</span>
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50 divide-y divide-zinc-200/70 dark:divide-zinc-800/70 max-h-44 overflow-y-auto">
            {request.isFolder && request.folderName && (
              <div className="px-3.5 py-2.5 flex items-center gap-2.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="truncate">{request.folderName}/</span>
              </div>
            )}
            {request.files.slice(0, 6).map((file) => (
              <div
                key={file.fileId}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileTypeIcon
                    name={file.name}
                    mimeType={file.mimeType}
                    className="w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0"
                  />
                  <span className="truncate text-zinc-800 dark:text-zinc-200">
                    {file.relativePath || file.name}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
            {request.files.length > 6 && (
              <div className="px-3.5 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                + {request.files.length - 6} more files
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              AES-256-GCM encrypted
            </span>
            <span className="font-mono truncate max-w-[180px]">
              {request.fromPeer.fingerprint}
            </span>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Remember and trust {request.fromPeer.name}</span>
          </label>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => onDecline(request)}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => onAccept(request, trustDevice)}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
            >
              Accept &amp; Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
