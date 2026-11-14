import React, { useRef, useState } from 'react';
import {
  Check,
  Edit3,
  FileUp,
  Lock,
  QrCode,
  Radio,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type {
  MdnsLanPeer,
  PeerDevice,
  TrustedDeviceRecord,
} from '../types/instrop';
import { formatDateTime, type SelectedTransferFile } from '../utils/device';
import { DeviceIcon } from './InstropLogo';

interface DevicesViewProps {
  selfDevice: PeerDevice | null;
  nearbyPeers: PeerDevice[];
  mdnsPeers: MdnsLanPeer[];
  trustedDevices: TrustedDeviceRecord[];
  onOpenPairing: () => void;
  onPairByCode: (code: string) => boolean | void;
  onPairById: (id: string) => void;
  onTrustPeer: (peer: PeerDevice) => void;
  onRenameTrusted: (id: string, name: string) => void;
  onRevokeTrusted: (id: string) => void;
  onSendFiles: (
    peer: PeerDevice,
    files: SelectedTransferFile[],
    isFolder: boolean,
    folderName?: string
  ) => void;
  onNavigateTransfers: () => void;
}

export function DevicesView({
  selfDevice,
  nearbyPeers,
  mdnsPeers,
  trustedDevices,
  onOpenPairing,
  onPairByCode,
  onPairById,
  onTrustPeer,
  onRenameTrusted,
  onRevokeTrusted,
  onSendFiles,
  onNavigateTransfers,
}: DevicesViewProps) {
  const [quickCode, setQuickCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [targetPeerForSend, setTargetPeerForSend] = useState<PeerDevice | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleQuickPair = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = quickCode.replace(/\D/g, '');
    if (cleaned.length === 6) {
      onPairByCode(cleaned);
      setQuickCode('');
    }
  };

  const handlePickFilesForPeer = (peer: PeerDevice) => {
    setTargetPeerForSend(peer);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length > 0 && targetPeerForSend) {
      onSendFiles(
        targetPeerForSend,
        list.map((file) => ({ file, relativePath: file.name })),
        false
      );
      onNavigateTransfers();
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-8">
      {/* Header & Quick Pairing Bar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Devices &amp; Discovery
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Automatically discovers Instrop peers on your local Wi-Fi or via direct QR and code pairing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <form onSubmit={handleQuickPair} className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={quickCode}
              onChange={(e) => setQuickCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              aria-label="Enter 6-digit pairing code"
              className="h-10 w-36 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] font-mono text-sm text-center tracking-widest text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={quickCode.length !== 6}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium disabled:opacity-40 transition-opacity whitespace-nowrap"
            >
              Pair
            </button>
          </form>

          <button
            type="button"
            onClick={onOpenPairing}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <QrCode className="w-4 h-4" />
            QR Pair
          </button>
        </div>
      </section>

      {/* This Device Identity Summary */}
      {selfDevice && (
        <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-800 dark:text-zinc-200 shrink-0">
              <DeviceIcon
                deviceType={selfDevice.deviceType}
                os={selfDevice.os}
                className="w-5 h-5"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                {selfDevice.name} (This Device)
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {selfDevice.os} · Key Fingerprint{' '}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {selfDevice.fingerprint}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="text-zinc-500 dark:text-zinc-400">Pairing Code:</span>
            <span className="font-mono text-base font-semibold tracking-widest text-zinc-950 dark:text-zinc-50 tabular-nums">
              {selfDevice.pairingCode}
            </span>
          </div>
        </section>
      )}

      {/* Discovered Online Devices */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Online Nearby &amp; Paired Devices
          </h2>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {nearbyPeers.length} online
          </span>
        </div>

        {nearbyPeers.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-8 text-center space-y-3">
            <Radio className="w-7 h-7 mx-auto text-zinc-400" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Listening for nearby Instrop devices
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
              Devices on the same Wi-Fi network appear here automatically. If your Windows PC and Android phone are on separate networks, use QR Pair or enter the 6-digit code.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {nearbyPeers.map((peer) => {
              const trusted = trustedDevices.find((t) => t.id === peer.id);
              const displayName = trusted?.name || peer.name;

              return (
                <div
                  key={peer.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0">
                      <DeviceIcon
                        deviceType={peer.deviceType}
                        os={peer.os}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                          {displayName}
                        </p>
                        {trusted && (
                          <ShieldCheck
                            className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                            aria-label="Trusted device"
                          />
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {peer.os} ·{' '}
                        {peer.discoverySource === 'paired' ? 'Paired' : 'Same local network'} ·{' '}
                        <span className="font-mono">{peer.fingerprint.slice(0, 11)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!trusted && (
                      <button
                        type="button"
                        onClick={() => {
                          onPairById(peer.id);
                          onTrustPeer(peer);
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Trust
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePickFilesForPeer(peer)}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      Send Files
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Trusted Devices Registry */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Remembered Trusted Devices
          </h2>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {trustedDevices.length} saved
          </span>
        </div>

        {trustedDevices.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] px-5 py-6 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No trusted devices saved yet. Pair a device or accept a transfer with &ldquo;Remember and trust&rdquo; enabled.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {trustedDevices.map((dev) => {
              const isOnline = nearbyPeers.some((p) => p.id === dev.id);
              const isEditing = editingId === dev.id;

              return (
                <div
                  key={dev.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-300 shrink-0">
                      <DeviceIcon
                        deviceType={dev.deviceType}
                        os={dev.os}
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="min-w-0">
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            onRenameTrusted(dev.id, draftName);
                            setEditingId(null);
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            autoFocus
                            className="h-8 px-2.5 rounded-lg border border-indigo-500 bg-white dark:bg-zinc-900 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="min-h-[32px] px-2.5 rounded-lg bg-indigo-600 text-white text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Save
                          </button>
                        </form>
                      ) : (
                        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50 truncate">
                          {dev.name}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {dev.os} · {isOnline ? 'Online now' : `Last seen ${formatDateTime(dev.lastSeenAt)}`} ·{' '}
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Verified
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setDraftName(dev.name);
                        setEditingId(dev.id);
                      }}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors"
                      aria-label={`Rename ${dev.name}`}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevokeTrusted(dev.id)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      aria-label={`Remove trust for ${dev.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* mDNS LAN Services (only when discovered by Node mDNS responder on local Wi-Fi) */}
      {mdnsPeers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            mDNS LAN Services (_instrop._tcp)
          </h2>
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {mdnsPeers.map((host) => (
              <div key={host.name} className="px-5 py-3.5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">{host.name}</p>
                  <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                    {host.addresses[0] || host.host}:{host.port}
                  </p>
                </div>
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  mDNS Active
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
