import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Edit3,
  FileUp,
  FolderUp,
  QrCode,
  Radio,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  ActiveTransferBatch,
  DeviceOS,
  DeviceType,
  NavTab,
  PeerDevice,
  TransferHistoryEntry,
  TrustedDeviceRecord,
} from '../types/instrop';
import type { ConnectionState } from '../hooks/useInstropEngine';
import {
  extractFilesFromDataTransfer,
  formatBytes,
  formatDateTime,
  type SelectedTransferFile,
} from '../utils/device';
import { DeviceIcon } from './InstropLogo';

interface HomeViewProps {
  deviceName: string;
  deviceOs: DeviceOS;
  deviceType: DeviceType;
  pairingCode?: string;
  connectionState: ConnectionState;
  connectionError?: string | null;
  lanUrls: string[];
  serverOrigin: string;
  onConnectToServer: (origin: string) => void;
  scanningLan?: boolean;
  discoveredServerUrls?: string[];
  onScanForPc?: () => void;
  nearbyPeers: PeerDevice[];
  trustedDevices: TrustedDeviceRecord[];
  selectedPeerId: string | null;
  onSelectPeer: (id: string) => void;
  onRenameSelf: (name: string) => void;
  onOpenPairing: () => void;
  onSendFiles: (
    peer: PeerDevice,
    files: SelectedTransferFile[],
    isFolder: boolean,
    folderName?: string
  ) => void;
  activeTransfers: ActiveTransferBatch[];
  history: TransferHistoryEntry[];
  onNavigate: (tab: NavTab) => void;
}

export function HomeView({
  deviceName,
  deviceOs,
  deviceType,
  pairingCode,
  connectionState,
  connectionError,
  lanUrls,
  serverOrigin,
  onConnectToServer,
  scanningLan,
  discoveredServerUrls = [],
  onScanForPc,
  nearbyPeers,
  trustedDevices,
  selectedPeerId,
  onSelectPeer,
  onRenameSelf,
  onOpenPairing,
  onSendFiles,
  activeTransfers,
  history,
  onNavigate,
}: HomeViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(deviceName);
  const [hostInput, setHostInput] = useState(serverOrigin);

  React.useEffect(() => {
    setHostInput(serverOrigin);
  }, [serverOrigin]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPeer =
    nearbyPeers.find((p) => p.id === selectedPeerId) ||
    (nearbyPeers.length === 1 ? nearbyPeers[0] : null);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (draftName.trim()) {
      onRenameSelf(draftName.trim());
    }
    setEditingName(false);
  };

  const dispatchFiles = (
    files: SelectedTransferFile[],
    isFolder: boolean,
    folderName?: string
  ) => {
    if (files.length === 0) return;
    if (!selectedPeer) {
      onOpenPairing();
      return;
    }
    onSendFiles(selectedPeer, files, isFolder, folderName);
    onNavigate('transfers');
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length > 0) {
      dispatchFiles(
        list.map((file) => ({ file, relativePath: file.name })),
        false
      );
    }
    e.target.value = '';
  };

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length > 0) {
      const firstRel = list[0].webkitRelativePath || '';
      const rootFolder = firstRel.includes('/') ? firstRel.split('/')[0] : 'Folder';
      dispatchFiles(
        list.map((file) => ({
          file,
          relativePath: file.webkitRelativePath || file.name,
        })),
        true,
        rootFolder
      );
    }
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const extracted = await extractFilesFromDataTransfer(e.dataTransfer);
    if (extracted.files.length > 0) {
      dispatchFiles(extracted.files, extracted.isFolder, extracted.folderName);
    }
  };

  const recentItems = [
    ...activeTransfers.slice(0, 3).map((t) => ({
      id: t.transferId,
      title: t.isFolder && t.folderName ? t.folderName : t.files[0]?.name || 'Transfer',
      count: t.files.length,
      size: t.totalSize,
      peerName: t.peerName,
      direction: t.direction === 'send' ? ('sent' as const) : ('received' as const),
      status: t.status,
      time: t.startedAt,
    })),
    ...history
      .filter((h) => !activeTransfers.some((a) => a.transferId === h.id))
      .slice(0, 4)
      .map((h) => ({
        id: h.id,
        title: h.isFolder && h.folderName ? h.folderName : h.files[0]?.name || 'Transfer',
        count: h.files.length,
        size: h.totalSize,
        peerName: h.peerName,
        direction: h.direction,
        status: h.status,
        time: h.completedAt,
      })),
  ].slice(0, 4);

  return (
    <div className="space-y-8">
      {/* Identity & Network Status Strip */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-800 dark:text-zinc-200 shrink-0">
            <DeviceIcon deviceType={deviceType} os={deviceOs} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            {editingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-2">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  autoFocus
                  maxLength={40}
                  className="h-8 px-2.5 rounded-lg border border-indigo-500 bg-white dark:bg-zinc-900 text-sm font-semibold text-zinc-950 dark:text-zinc-50 focus:outline-none"
                />
                <button
                  type="submit"
                  className="min-h-[32px] px-2.5 rounded-lg bg-indigo-600 text-white text-xs font-medium flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 truncate">
                  {deviceName}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(deviceName);
                    setEditingName(true);
                  }}
                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors"
                  aria-label="Rename this device"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{deviceOs}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                {connectionState === 'connected' ? (
                  <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span
                  className={
                    connectionState === 'connected'
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-amber-700 dark:text-amber-400 font-medium'
                  }
                >
                  {connectionState === 'connected'
                    ? 'Ready on local network'
                    : connectionState === 'reconnecting'
                      ? 'Reconnecting to local network...'
                      : connectionState === 'offline'
                        ? 'Not connected to PC server'
                        : 'Connecting to local network...'}
                </span>
              </span>
              {pairingCode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">Code {pairingCode}</span>
                </>
              )}
              {lanUrls[0] && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{lanUrls[0].replace(/^https?:\/\//, '')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenPairing}
          className="min-h-[42px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] hover:bg-zinc-50 dark:hover:bg-zinc-900 text-sm font-medium text-zinc-800 dark:text-zinc-200 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <QrCode className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          Pair with QR or Code
        </button>
      </section>

      {connectionState !== 'connected' && (
        <section className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-4 sm:p-5 flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
              Connect to your Windows PC on Wi-Fi
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
              {connectionError ||
                'Enter the PC IP shown on Instrop Windows (e.g. 192.168.1.15:3000), tap Find PC on Wi-Fi, or tap Scan QR.'}
            </p>
          </div>
          {discoveredServerUrls.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Found on Wi-Fi:
              </span>
              {discoveredServerUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => onConnectToServer(url)}
                  className="min-h-[34px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-medium transition-colors"
                >
                  {url.replace(/^https?:\/\//, '')}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (hostInput.trim()) onConnectToServer(hostInput.trim());
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="192.168.1.15:3000"
              aria-label="Windows PC IP address"
              className="h-10 flex-1 min-w-[160px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              Connect
            </button>
            {onScanForPc && (
              <button
                type="button"
                disabled={scanningLan}
                onClick={onScanForPc}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
              >
                <Search className={`w-3.5 h-3.5 ${scanningLan ? 'animate-pulse text-indigo-500' : ''}`} />
                {scanningLan ? 'Scanning Wi-Fi...' : 'Find PC on Wi-Fi'}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenPairing}
              className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <QrCode className="w-3.5 h-3.5" />
              Scan QR
            </button>
          </form>
        </section>
      )}

      {/* Nearby Devices Selector */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nearby Devices
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('devices')}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors inline-flex items-center gap-1"
          >
            Manage devices
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {nearbyPeers.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  No other Instrop devices discovered yet
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 max-w-xl leading-relaxed">
                  Open Instrop on your Windows PC or Android phone on the same Wi-Fi network, or pair instantly using a QR code or 6-digit pairing code.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onOpenPairing}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Show QR Code
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nearbyPeers.map((peer) => {
              const isSelected = selectedPeer?.id === peer.id;
              const trustedRecord = trustedDevices.find((t) => t.id === peer.id);
              const displayName = trustedRecord?.name || peer.name;

              return (
                <button
                  key={peer.id}
                  type="button"
                  onClick={() => onSelectPeer(peer.id)}
                  className={`min-h-[68px] p-4 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/25 ring-1 ring-indigo-500/30'
                      : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <DeviceIcon
                        deviceType={peer.deviceType}
                        os={peer.os}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                        {displayName}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {peer.os} · {trustedRecord ? 'Trusted' : 'Local network'}
                      </p>
                    </div>
                  </div>
                  {trustedRecord && (
                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Primary Focal Anchor: Drag & Drop Transfer Surface */}
      <section>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDragging) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={(e) => void handleDrop(e)}
          className={`relative rounded-2xl border transition-colors px-6 py-12 sm:py-16 flex flex-col items-center justify-center text-center ${
            isDragging
              ? 'border-indigo-500 border-dashed bg-indigo-50/60 dark:bg-indigo-950/25'
              : 'border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#111114]'
          }`}
        >
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-center text-zinc-800 dark:text-zinc-200 mb-4">
            <FileUp className="w-5 h-5" />
          </div>

          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 text-balance max-w-md">
            {selectedPeer
              ? `Drop files or folders to send to ${
                  trustedDevices.find((t) => t.id === selectedPeer.id)?.name || selectedPeer.name
                }`
              : 'Drop files or folders to transfer'}
          </h2>

          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md leading-relaxed">
            {selectedPeer
              ? 'Files stream directly over your local network with AES-256-GCM encryption and SHA-256 verification.'
              : 'Select a nearby device above or pair a new device, then drop any files, videos, APKs, or folders here.'}
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!selectedPeer) {
                  onOpenPairing();
                  return;
                }
                fileInputRef.current?.click();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <FileUp className="w-4 h-4" />
              Send Files
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedPeer) {
                  onOpenPairing();
                  return;
                }
                folderInputRef.current?.click();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <FolderUp className="w-4 h-4" />
              Send Folder
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is standard in Chromium/WebKit desktop & Android browsers
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={handleFolderInput}
          />
        </div>
      </section>

      {/* Recent Transfers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recent Transfers
          </h2>
          {recentItems.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors inline-flex items-center gap-1"
            >
              View full history
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {recentItems.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] px-5 py-6 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No transfers in this session yet. Your sent and received files will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {recentItems.map((item) => (
              <div
                key={item.id}
                className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-600 dark:text-zinc-300 shrink-0">
                    <ArrowUpRight
                      className={`w-4 h-4 ${
                        item.direction === 'received' ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                      {item.title}
                      {item.count > 1 ? ` (+${item.count - 1} more)` : ''}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {item.direction === 'sent' ? 'To' : 'From'} {item.peerName} ·{' '}
                      {formatDateTime(item.time)}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatBytes(item.size)}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
                    {item.status.replace('-', ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
