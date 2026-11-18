import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  Camera,
  Check,
  Copy,
  Edit3,
  FileUp,
  Lock,
  QrCode,
  Radio,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  MdnsLanPeer,
  PeerDevice,
  TrustedDeviceRecord,
} from '../types/instrop';
import type { ConnectionState } from '../hooks/useInstropEngine';
import { formatDateTime, type SelectedTransferFile } from '../utils/device';
import { isMobileLocalhostShell } from '../utils/mobileBridge';
import { DeviceIcon } from './InstropLogo';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>;
}

interface DevicesViewProps {
  selfDevice: PeerDevice | null;
  pairingCode: string;
  connectionState: ConnectionState;
  connectionError: string | null;
  lanUrls: string[];
  serverOrigin: string;
  onConnectToServer: (origin: string, pairCode?: string) => void;
  scanningLan: boolean;
  discoveredServerUrls: string[];
  onScanForPc: () => void;
  nearbyPeers: PeerDevice[];
  mdnsPeers: MdnsLanPeer[];
  trustedDevices: TrustedDeviceRecord[];
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

type HubTab = 'qr-code' | 'scan-qr' | 'pc-connect';

async function decodeQrFromCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<string | null> {
  const winExt = window as Window & {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  };
  if (typeof winExt.BarcodeDetector === 'function') {
    try {
      const detector = new winExt.BarcodeDetector({ formats: ['qr_code'] });
      const hits = await detector.detect(canvas);
      const val = hits?.[0]?.rawValue?.trim();
      if (val) return val;
    } catch {
      // Fall back to jsQR cleanly
    }
  }

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return decoded?.data?.trim() || null;
}

export function DevicesView({
  selfDevice,
  pairingCode,
  connectionState,
  connectionError,
  lanUrls,
  serverOrigin,
  onConnectToServer,
  scanningLan,
  discoveredServerUrls,
  onScanForPc,
  nearbyPeers,
  mdnsPeers,
  trustedDevices,
  onPairByCode,
  onPairById,
  onTrustPeer,
  onRenameTrusted,
  onRevokeTrusted,
  onSendFiles,
  onNavigateTransfers,
}: DevicesViewProps) {
  const isMobileShell = isMobileLocalhostShell();
  const isConnected = connectionState === 'connected';

  const [hubTab, setHubTab] = useState<HubTab>(() =>
    !isConnected && isMobileShell ? 'scan-qr' : 'qr-code'
  );
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [selectedLanUrl, setSelectedLanUrl] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [quickCode, setQuickCode] = useState('');
  const [hostInput, setHostInput] = useState(serverOrigin);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [targetPeerForSend, setTargetPeerForSend] = useState<PeerDevice | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement | null>(null);
  const scanningFrameRef = useRef<boolean>(false);

  useEffect(() => {
    setHostInput(serverOrigin);
  }, [serverOrigin]);

  const activeCode = selfDevice?.pairingCode || pairingCode;
  const preferredOrigin =
    (selectedLanUrl && lanUrls.includes(selectedLanUrl) ? selectedLanUrl : '') ||
    lanUrls[0] ||
    serverOrigin ||
    window.location.origin;
  const pairUrl = activeCode ? `${preferredOrigin}/?pair=${activeCode}` : preferredOrigin;

  useEffect(() => {
    if (!activeCode) return;
    let active = true;
    QRCode.toDataURL(pairUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [activeCode, pairUrl]);

  const handleDecodedQrString = React.useCallback(
    (rawInput: string): boolean => {
      const raw = rawInput.trim();
      if (!raw) return false;

      try {
        const parsed = new URL(raw);
        const pairParam = parsed.searchParams.get('pair');
        const currentEffective = serverOrigin || window.location.origin;
        if (parsed.origin && (!isConnected || parsed.origin !== currentEffective)) {
          setScanStatus(`Connecting to ${parsed.origin.replace(/^https?:\/\//, '')}...`);
          onConnectToServer(parsed.origin, pairParam || undefined);
          setHubTab('pc-connect');
          return true;
        }
        if (pairParam && /^\d{6}$/.test(pairParam)) {
          onPairByCode(pairParam);
          setHubTab('qr-code');
          return true;
        }
      } catch {
        // Not a full URL; fall through
      }

      const hostMatch = raw.match(/^(?:https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)$/);
      if (hostMatch?.[1]) {
        setScanStatus(`Connecting to ${hostMatch[1]}...`);
        onConnectToServer(`http://${hostMatch[1]}`);
        setHubTab('pc-connect');
        return true;
      }

      const match = raw.match(/pair=(\d{6})/) || raw.match(/\b(\d{6})\b/);
      if (match?.[1]) {
        onPairByCode(match[1]);
        setHubTab('qr-code');
        return true;
      }
      return false;
    },
    [isConnected, onConnectToServer, onPairByCode, serverOrigin]
  );

  // Camera QR Scanner lifecycle when Scan QR tab is active
  useEffect(() => {
    if (hubTab !== 'scan-qr') {
      setCameraReady(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setScanError(null);
    setScanStatus(null);
    setCameraReady(false);

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError(
          'Live camera preview is unavailable here. Tap "Scan QR Photo" below or switch to PC Connection.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        const tick = async () => {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (
            !scanningFrameRef.current &&
            video &&
            canvas &&
            video.readyState >= video.HAVE_CURRENT_DATA &&
            video.videoWidth > 0
          ) {
            scanningFrameRef.current = true;
            try {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const decoded = await decodeQrFromCanvas(canvas, ctx);
                if (!cancelled && decoded && handleDecodedQrString(decoded)) {
                  scanningFrameRef.current = false;
                  return;
                }
              }
            } finally {
              scanningFrameRef.current = false;
            }
          }
          if (!cancelled) {
            rafRef.current = requestAnimationFrame(() => void tick());
          }
        };

        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) {
          setScanError(
            'Camera permission was denied. Allow Camera in Android Settings → Apps → Instrop, or tap "Scan QR Photo" below.'
          );
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      setCameraReady(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [hubTab, handleDecodedQrString]);

  const handleQrImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const decoded = await decodeQrFromCanvas(canvas, ctx);
      if (!decoded || !handleDecodedQrString(decoded)) {
        setScanError(
          'Could not read a valid Instrop QR code from that photo. Hold steady closer to the screen or enter the PC IP manually.'
        );
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setScanError('Unable to load the selected image.');
    };
    img.src = url;
  };

  const handleQuickPair = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = quickCode.replace(/\D/g, '');
    if (cleaned.length === 6) {
      const ok = onPairByCode(cleaned);
      if (ok !== false) setQuickCode('');
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
      <section className="pb-5 border-b border-zinc-200/80 dark:border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Devices &amp; Pairing
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Connect to your local Wi-Fi server and pair devices in one place.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 text-xs font-medium self-start sm:self-auto">
          {isConnected ? (
            <>
              <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-700 dark:text-emerald-400">
                {serverOrigin
                  ? `Connected to ${serverOrigin.replace(/^https?:\/\//, '')}`
                  : 'Connected on local network'}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-700 dark:text-amber-400">
                {connectionState === 'connecting' || connectionState === 'reconnecting'
                  ? 'Connecting...'
                  : 'Not connected'}
              </span>
            </>
          )}
        </div>
      </section>

      {/* Unified Connect & Pair Hub */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] overflow-hidden">
        <div className="p-2 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setHubTab('qr-code')}
              className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                hubTab === 'qr-code'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              QR &amp; Code
            </button>
            <button
              type="button"
              onClick={() => setHubTab('scan-qr')}
              className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                hubTab === 'scan-qr'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Scan QR
            </button>
            <button
              type="button"
              onClick={() => setHubTab('pc-connect')}
              className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                hubTab === 'pc-connect'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {isMobileShell ? 'PC Connection' : 'Wi-Fi Server'}
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {hubTab === 'qr-code' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Show My QR & 6-Digit Code */}
              <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-4">
                {!isConnected && isMobileShell && (
                  <div className="w-full rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 px-3.5 py-2.5 text-left">
                    <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                      Connect this phone to your Windows PC first via{' '}
                      <button
                        type="button"
                        onClick={() => setHubTab('scan-qr')}
                        className="font-semibold underline underline-offset-2"
                      >
                        Scan QR
                      </button>{' '}
                      or{' '}
                      <button
                        type="button"
                        onClick={() => setHubTab('pc-connect')}
                        className="font-semibold underline underline-offset-2"
                      >
                        PC Connection
                      </button>
                      .
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="p-2.5 bg-white rounded-2xl border border-zinc-200 dark:border-zinc-700 shrink-0">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Instrop pairing QR code"
                        className="w-40 h-40 block"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-40 h-40 flex items-center justify-center text-zinc-400">
                        <QrCode className="w-9 h-9" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 min-w-0">
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        This device&apos;s 6-digit code
                      </p>
                      <div className="mt-1 flex items-center justify-center sm:justify-start gap-2.5">
                        <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-zinc-950 dark:text-zinc-50 tabular-nums">
                          {activeCode || '------'}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!activeCode) return;
                            await navigator.clipboard.writeText(activeCode);
                            setCopiedCode(true);
                            window.setTimeout(() => setCopiedCode(false), 1800);
                          }}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 inline-flex items-center gap-1"
                        >
                          {copiedCode ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedCode ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-center sm:justify-start gap-2 text-xs">
                      <span className="font-mono text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">
                        {pairUrl}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(pairUrl);
                          setCopiedUrl(true);
                          window.setTimeout(() => setCopiedUrl(false), 1800);
                        }}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        {copiedUrl ? 'Link Copied' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                </div>

                {lanUrls.length > 1 && (
                  <div className="w-full text-left pt-1">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">
                      Multiple network adapters detected — select your Wi-Fi IP for the QR code:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {lanUrls.map((url) => {
                        const active = url === preferredOrigin;
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setSelectedLanUrl(url)}
                            className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] transition-colors ${
                              active
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                            }`}
                          >
                            {url.replace(/^https?:\/\//, '')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Enter 6-Digit Code from Other Device */}
              <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50 p-4 sm:p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    Enter 6-Digit Pairing Code
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                    Once both devices are connected on the same local server/Wi-Fi, enter the 6-digit code shown on the other device.
                  </p>
                </div>

                <form onSubmit={handleQuickPair} className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={quickCode}
                    onChange={(e) => setQuickCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    aria-label="Enter 6-digit pairing code"
                    className="h-11 flex-1 px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#111114] font-mono text-lg text-center tracking-[0.25em] text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={quickCode.length !== 6}
                    className="min-h-[44px] px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    Pair
                  </button>
                </form>

                {selfDevice && (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    Fingerprint: {selfDevice.fingerprint}
                  </p>
                )}
              </div>
            </div>
          )}

          {hubTab === 'scan-qr' && (
            <div className="max-w-md mx-auto space-y-3">
              {scanStatus && (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 px-3.5 py-2.5 text-xs text-indigo-800 dark:text-indigo-200">
                  {scanStatus}
                </div>
              )}

              {scanError ? (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5 text-center space-y-3">
                  <Camera className="w-7 h-7 mx-auto text-zinc-400" />
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {scanError}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => qrFileInputRef.current?.click()}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                    >
                      Scan QR Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setHubTab('pc-connect')}
                      className="min-h-[40px] px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Enter PC IP
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-950 border border-zinc-800">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onPlaying={() => setCameraReady(true)}
                    className={`w-full h-full object-cover transition-opacity duration-200 ${
                      cameraReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400">
                      <Camera className="w-7 h-7" />
                      <span className="text-xs">Starting camera...</span>
                    </div>
                  )}
                  {cameraReady && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-48 h-48 rounded-2xl border-2 border-indigo-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
                    </div>
                  )}
                </div>
              )}

              {!scanError && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Point at the QR code on your PC screen, or snap a photo:
                  </p>
                  <button
                    type="button"
                    onClick={() => qrFileInputRef.current?.click()}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
                  >
                    Scan QR Photo
                  </button>
                </div>
              )}

              <input
                ref={qrFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleQrImagePick}
              />
            </div>
          )}

          {hubTab === 'pc-connect' && (
            <div className="space-y-4">
              {isMobileShell ? (
                <>
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      Connect Android to Windows PC
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      {connectionError ||
                        (isConnected
                          ? `Connected to ${serverOrigin.replace(/^https?:\/\//, '')}. Switch to QR & Code to pair.`
                          : 'Make sure Instrop is open on your Windows PC on the same Wi-Fi, then tap Find PC on Wi-Fi or enter its IP.')}
                    </p>
                  </div>

                  {discoveredServerUrls.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        PC Found:
                      </span>
                      {discoveredServerUrls.map((url) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => onConnectToServer(url)}
                          className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-medium transition-colors"
                        >
                          Connect {url.replace(/^https?:\/\//, '')}
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
                      className="h-10 flex-1 min-w-[180px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 font-mono text-xs text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      Connect
                    </button>
                    <button
                      type="button"
                      disabled={scanningLan}
                      onClick={onScanForPc}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
                    >
                      <Search className={`w-3.5 h-3.5 ${scanningLan ? 'animate-pulse text-indigo-500' : ''}`} />
                      {scanningLan ? 'Scanning Wi-Fi...' : 'Find PC on Wi-Fi'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      Local Wi-Fi Server Addresses
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                      Your PC hosts the Instrop server automatically. Enter one of these addresses on your Android phone (or scan the QR in the first tab).
                    </p>
                  </div>
                  {lanUrls.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {lanUrls.map((url) => (
                        <code
                          key={url}
                          className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-mono text-zinc-900 dark:text-zinc-100"
                        >
                          {url.replace(/^https?:\/\//, '')}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      No active Wi-Fi or LAN adapter found yet. Connect this PC to Wi-Fi or enable Mobile Hotspot.
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Tip: If Android times out connecting, allow port 3000 in Windows Defender Firewall (both Private &amp; Public networks).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

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
          <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-7 text-center space-y-2.5">
            <Radio className="w-6 h-6 mx-auto text-zinc-400" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No other Instrop devices connected yet
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
              Once your PC and phone connect to the same Wi-Fi server above, they appear here automatically ready for transfers.
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
