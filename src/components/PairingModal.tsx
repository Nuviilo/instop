import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Camera, Check, Copy, QrCode, X } from 'lucide-react';
import type { PeerDevice } from '../types/instrop';

interface PairingModalProps {
  open: boolean;
  onClose: () => void;
  selfDevice: PeerDevice | null;
  lanUrls: string[];
  serverOrigin: string;
  isConnected: boolean;
  onConnectToServer: (origin: string, pairCode?: string) => void;
  onPairByCode: (code: string) => boolean | void;
}

export function PairingModal({
  open,
  onClose,
  selfDevice,
  lanUrls,
  serverOrigin,
  isConnected,
  onConnectToServer,
  onPairByCode,
}: PairingModalProps) {
  const [tab, setTab] = useState<'my-code' | 'enter-code' | 'scan-qr'>('my-code');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [manualCode, setManualCode] = useState<string>('');
  const [manualHost, setManualHost] = useState<string>(serverOrigin);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const preferredOrigin = lanUrls[0] || window.location.origin;
  const pairUrl = selfDevice
    ? `${preferredOrigin}/?pair=${selfDevice.pairingCode}`
    : preferredOrigin;

  useEffect(() => {
    if (!open || !selfDevice) return;
    let active = true;
    QRCode.toDataURL(pairUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#09090B',
        light: '#FFFFFF',
      },
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
  }, [open, selfDevice, pairUrl]);

  // Camera QR Scanner lifecycle
  useEffect(() => {
    if (!open || tab !== 'scan-qr') {
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

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError('Camera access is not available in this browser context. Use the 6-digit pairing code instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const tick = () => {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const decoded = jsQR(imgData.data, imgData.width, imgData.height);
              if (decoded?.data) {
                const raw = decoded.data.trim();
                try {
                  const parsed = new URL(raw);
                  const pairParam = parsed.searchParams.get('pair');
                  const currentEffective = serverOrigin || window.location.origin;
                  if (parsed.origin && parsed.origin !== currentEffective) {
                    onConnectToServer(parsed.origin, pairParam || undefined);
                    onClose();
                    return;
                  }
                  if (pairParam && /^\d{6}$/.test(pairParam)) {
                    onPairByCode(pairParam);
                    onClose();
                    return;
                  }
                } catch {
                  // Not a full URL; fall through to raw 6-digit code extraction
                }
                const match = raw.match(/pair=(\d{6})/) || raw.match(/\b(\d{6})\b/);
                if (match?.[1]) {
                  onPairByCode(match[1]);
                  onClose();
                  return;
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setScanError('Camera permission denied or no camera detected. Enter the 6-digit pairing code manually.');
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open, tab, serverOrigin, onClose, onConnectToServer, onPairByCode]);

  if (!open) return null;

  const handleCopyCode = async () => {
    if (!selfDevice?.pairingCode) return;
    await navigator.clipboard.writeText(selfDevice.pairingCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(pairUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.replace(/\D/g, '');
    const host = manualHost.trim();
    if (host && host !== serverOrigin) {
      onConnectToServer(host, cleaned.length === 6 ? cleaned : undefined);
      setManualCode('');
      onClose();
      return;
    }
    if (cleaned.length === 6) {
      onPairByCode(cleaned);
      setManualCode('');
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pair-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111114] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <h2 id="pair-modal-title" className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Pair Device
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors"
            aria-label="Close pairing dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/80">
            <button
              type="button"
              onClick={() => setTab('my-code')}
              className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                tab === 'my-code'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Show QR
            </button>
            <button
              type="button"
              onClick={() => setTab('enter-code')}
              className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                tab === 'enter-code'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Enter Code
            </button>
            <button
              type="button"
              onClick={() => setTab('scan-qr')}
              className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                tab === 'scan-qr'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Scan QR
            </button>
          </div>
        </div>

        <div className="p-6">
          {tab === 'my-code' && (
            <div className="flex flex-col items-center text-center">
              <div className="p-3 bg-white rounded-2xl border border-zinc-200 dark:border-zinc-700">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Instrop device pairing QR code"
                    className="w-48 h-48 block"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-zinc-400">
                    <QrCode className="w-10 h-10" />
                  </div>
                )}
              </div>

              <div className="mt-5 w-full">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  Scan with Android camera or enter this 6-digit pairing code
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="font-mono text-2xl font-semibold tracking-[0.22em] text-zinc-950 dark:text-zinc-50 tabular-nums">
                    {selfDevice?.pairingCode || '------'}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="min-h-[40px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="mt-4 w-full pt-4 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-2 text-left">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Direct pairing link</p>
                  <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate">{pairUrl}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedUrl ? 'Link Copied' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}

          {tab === 'enter-code' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              {!isConnected && (
                <div>
                  <label
                    htmlFor="manual-host-input"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                  >
                    Windows PC Server Address (for Wi-Fi / Hotspot)
                  </label>
                  <input
                    id="manual-host-input"
                    type="text"
                    value={manualHost}
                    onChange={(e) => setManualHost(e.target.value)}
                    placeholder="e.g. 192.168.1.15:3000"
                    className="w-full h-10 px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 font-mono text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="manual-pair-input"
                  className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5"
                >
                  6-digit device code
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                  Open Instrop on the other device and enter the 6-digit code shown in its Pair dialog.
                </p>
                <input
                  id="manual-pair-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full h-12 px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 font-mono text-xl text-center tracking-[0.25em] text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={manualCode.length !== 6 && !manualHost.trim()}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-45 disabled:pointer-events-none text-white text-sm font-medium transition-colors"
              >
                {!isConnected && manualHost.trim() ? 'Connect & Pair' : 'Pair Device'}
              </button>
            </form>
          )}

          {tab === 'scan-qr' && (
            <div className="space-y-3">
              {scanError ? (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5 text-center space-y-3">
                  <Camera className="w-7 h-7 mx-auto text-zinc-400" />
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{scanError}</p>
                  <button
                    type="button"
                    onClick={() => setTab('enter-code')}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    Enter Code Manually
                  </button>
                </div>
              ) : (
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-950 border border-zinc-800">
                  <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="w-48 h-48 rounded-2xl border-2 border-indigo-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
                  </div>
                </div>
              )}
              <p className="text-xs text-center text-zinc-500 dark:text-zinc-400">
                Point your camera at the Instrop QR code on your other device.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
