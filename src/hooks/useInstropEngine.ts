import { useCallback, useEffect, useRef, useState } from 'react';
import { zip } from 'fflate';
import type {
  ActiveFileProgress,
  ActiveTransferBatch,
  DeviceOS,
  DeviceType,
  FileManifestItem,
  InstropSettings,
  MdnsLanPeer,
  PeerDevice,
  PendingIncomingRequest,
  TransferHistoryEntry,
  TrustedDeviceRecord,
} from '../types/instrop';
import {
  base64ToUint8,
  decryptChunk,
  deriveSharedAesKey,
  encryptChunk,
  generateDeviceKeyIdentity,
  packBinaryChunkFrame,
  StreamingSha256,
  uint8ToBase64,
  unpackBinaryChunkFrame,
  type DeviceKeyIdentity,
} from '../utils/crypto';
import {
  detectLocalDeviceProfile,
  type SelectedTransferFile,
} from '../utils/device';
import {
  getOrCreateDeviceId,
  loadServerOrigin,
  loadSettings,
  loadTransferHistory,
  loadTrustedDevices,
  saveServerOrigin,
  saveSettings,
  saveTransferHistory,
  saveTrustedDevices,
} from '../utils/storage';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ToastNotice {
  id: string;
  title: string;
  detail?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface SenderFileState {
  file: File;
  manifest: FileManifestItem;
  sha256: StreamingSha256;
  nextChunkIndex: number;
  ackedChunkIndex: number;
  computedSha256?: string;
}

interface SenderJob {
  transferId: string;
  peer: PeerDevice;
  aesKey: CryptoKey;
  isFolder: boolean;
  folderName?: string;
  files: SenderFileState[];
  totalSize: number;
  bytesSent: number;
  startedAt: number;
  paused: boolean;
  canceled: boolean;
  resumeResolver: (() => void) | null;
  ackWaiter: (() => void) | null;
  dc: RTCDataChannel | null;
  pc: RTCPeerConnection | null;
  transportMode: 'p2p-webrtc' | 'e2e-relay';
}

interface ReceiverFileState {
  manifest: FileManifestItem;
  sha256: StreamingSha256;
  chunks: Uint8Array[];
  bytesReceived: number;
  chunksReceived: number;
  blob?: Blob;
  downloadUrl?: string;
  previewUrl?: string;
  verified?: boolean;
  expectedSha256?: string;
}

interface ReceiverJob {
  transferId: string;
  peer: PeerDevice;
  aesKey: CryptoKey;
  isFolder: boolean;
  folderName?: string;
  files: Map<string, ReceiverFileState>;
  fileOrder: string[];
  totalSize: number;
  bytesReceived: number;
  startedAt: number;
  paused: boolean;
  canceled: boolean;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  transportMode: 'p2p-webrtc' | 'e2e-relay';
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export function useInstropEngine() {
  const [deviceId] = useState<string>(() => getOrCreateDeviceId());
  const [deviceOs, setDeviceOs] = useState<DeviceOS>('Unknown');
  const [deviceType, setDeviceType] = useState<DeviceType>('desktop');
  const [settings, setSettingsState] = useState<InstropSettings>(() => loadSettings('Instrop Device'));
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceRecord[]>(() => loadTrustedDevices());
  const [history, setHistory] = useState<TransferHistoryEntry[]>(() => loadTransferHistory());

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [selfDevice, setSelfDevice] = useState<PeerDevice | null>(null);
  const [nearbyPeers, setNearbyPeers] = useState<PeerDevice[]>([]);
  const [mdnsPeers, setMdnsPeers] = useState<MdnsLanPeer[]>([]);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<PendingIncomingRequest[]>([]);
  const [transfers, setTransfers] = useState<ActiveTransferBatch[]>([]);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [serverOrigin, setServerOriginState] = useState<string>(() => loadServerOrigin());

  const wsRef = useRef<WebSocket | null>(null);
  const identityRef = useRef<DeviceKeyIdentity | null>(null);
  const settingsRef = useRef<InstropSettings>(settings);
  const trustedRef = useRef<TrustedDeviceRecord[]>(trustedDevices);
  const selfDeviceRef = useRef<PeerDevice | null>(null);
  const senderJobsRef = useRef<Map<string, SenderJob>>(new Map());
  const receiverJobsRef = useRef<Map<string, ReceiverJob>>(new Map());
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingPairFromUrlRef = useRef<string | null>(null);

  settingsRef.current = settings;
  trustedRef.current = trustedDevices;
  selfDeviceRef.current = selfDevice;

  const pushToast = useCallback((toast: Omit<ToastNotice, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fireBrowserNotification = useCallback((title: string, body: string) => {
    if (!settingsRef.current.notificationsEnabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body });
    } catch {
      // Ignore if blocked by browser context
    }
  }, []);

  const appendHistory = useCallback((entry: TransferHistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.id !== entry.id)].slice(0, 200);
      saveTransferHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveTransferHistory([]);
  }, []);

  const updateSettings = useCallback((patch: Partial<InstropSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      if (wsRef.current?.readyState === WebSocket.OPEN && patch.deviceName !== undefined) {
        wsRef.current.send(
          JSON.stringify({
            type: 'device:update',
            name: next.deviceName,
            trustedIds: trustedRef.current.map((t) => t.id),
          })
        );
      }
      return next;
    });
  }, []);

  const trustPeer = useCallback(
    (peer: PeerDevice, customName?: string) => {
      setTrustedDevices((prev) => {
        const existing = prev.find((d) => d.id === peer.id);
        const now = Date.now();
        const record: TrustedDeviceRecord = {
          id: peer.id,
          name: customName?.trim() || existing?.name || peer.name,
          originalName: peer.name,
          os: peer.os,
          deviceType: peer.deviceType,
          fingerprint: peer.fingerprint,
          publicKeyJwk: peer.publicKeyJwk,
          pairedAt: existing?.pairedAt || now,
          lastSeenAt: now,
        };
        const next = [record, ...prev.filter((d) => d.id !== peer.id)];
        saveTrustedDevices(next);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'device:update',
              trustedIds: next.map((d) => d.id),
            })
          );
        }
        return next;
      });
    },
    []
  );

  const renameTrustedDevice = useCallback((id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setTrustedDevices((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, name: trimmed } : d));
      saveTrustedDevices(next);
      return next;
    });
  }, []);

  const revokeTrustedDevice = useCallback((id: string) => {
    setTrustedDevices((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveTrustedDevices(next);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'device:update',
            trustedIds: next.map((d) => d.id),
          })
        );
      }
      return next;
    });
  }, []);

  const sendWsJson = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const triggerDownload = useCallback((url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      document.body.removeChild(a);
    }, 250);
  }, []);

  const downloadFolderAsZip = useCallback(
    async (transferId: string) => {
      const job = receiverJobsRef.current.get(transferId);
      if (!job) return;
      const zipInput: Record<string, Uint8Array> = {};
      for (const fId of job.fileOrder) {
        const f = job.files.get(fId);
        if (!f?.blob) continue;
        const bytes = new Uint8Array(await f.blob.arrayBuffer());
        zipInput[f.manifest.relativePath || f.manifest.name] = bytes;
      }

      zip(zipInput, { level: 0 }, (err, data) => {
        if (err || !data) {
          pushToast({
            title: 'ZIP export failed',
            detail: err?.message || 'Unable to package folder.',
            tone: 'error',
          });
          return;
        }
        const ab = new ArrayBuffer(data.byteLength);
        new Uint8Array(ab).set(data);
        const blob = new Blob([ab], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const zipName = `${job.folderName || 'Instrop-Files'}.zip`;
        setTransfers((prev) =>
          prev.map((t) => (t.transferId === transferId ? { ...t, zipDownloadUrl: url } : t))
        );
        triggerDownload(url, zipName);
      });
    },
    [pushToast, triggerDownload]
  );

  const handleIncomingBinaryChunk = useCallback(
    async (buffer: ArrayBuffer) => {
      const unpacked = unpackBinaryChunkFrame(buffer);
      if (!unpacked) return;
      const { meta, ciphertext } = unpacked;
      if (meta.type !== 'transfer:chunk') return;

      const transferId = String(meta.transferId || '');
      const fileId = String(meta.fileId || '');
      const ivB64 = String(meta.iv || '');
      const senderId = String(meta.senderId || '');

      const job = receiverJobsRef.current.get(transferId);
      if (!job || job.canceled) return;
      const fileState = job.files.get(fileId);
      if (!fileState) return;

      try {
        const iv = base64ToUint8(ivB64);
        const plain = await decryptChunk(job.aesKey, iv, ciphertext);

        fileState.sha256.update(plain);
        fileState.chunks.push(plain);
        fileState.bytesReceived += plain.byteLength;
        fileState.chunksReceived += 1;
        job.bytesReceived += plain.byteLength;

        const elapsedSec = Math.max(0.15, (Date.now() - job.startedAt) / 1000);
        const speedBps = job.bytesReceived / elapsedSec;
        const remainingBytes = Math.max(0, job.totalSize - job.bytesReceived);
        const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : null;

        // Send sliding-window ACK every 8 chunks or at file end
        if (
          fileState.chunksReceived % 8 === 0 ||
          fileState.chunksReceived >= fileState.manifest.totalChunks
        ) {
          sendWsJson({
            type: 'transfer:ack',
            targetId: senderId,
            transferId,
            fileId,
            ackedChunkIndex: Number(meta.chunkIndex ?? fileState.chunksReceived - 1),
          });
        }

        const fileIndex = job.fileOrder.indexOf(fileId);
        setTransfers((prev) =>
          prev.map((batch) => {
            if (batch.transferId !== transferId) return batch;
            return {
              ...batch,
              bytesTransferred: job.bytesReceived,
              speedBps,
              etaSeconds,
              currentFileIndex: fileIndex >= 0 ? fileIndex : batch.currentFileIndex,
              files: batch.files.map((f) =>
                f.fileId === fileId
                  ? {
                      ...f,
                      bytesTransferred: fileState.bytesReceived,
                      chunksTransferred: fileState.chunksReceived,
                    }
                  : f
              ),
            };
          })
        );
      } catch (err) {
        job.canceled = true;
        setTransfers((prev) =>
          prev.map((b) =>
            b.transferId === transferId
              ? {
                  ...b,
                  status: 'failed',
                  errorMessage: err instanceof Error ? err.message : 'Decryption failed',
                }
              : b
          )
        );
      }
    },
    [sendWsJson]
  );

  const runSenderLoop = useCallback(
    async (transferId: string) => {
      const job = senderJobsRef.current.get(transferId);
      if (!job) return;

      setTransfers((prev) =>
        prev.map((b) =>
          b.transferId === transferId
            ? { ...b, status: 'transferring', transportMode: job.transportMode }
            : b
        )
      );

      try {
        for (let fileIdx = 0; fileIdx < job.files.length; fileIdx++) {
          if (job.canceled) break;
          const fileEntry = job.files[fileIdx];
          const { file, manifest } = fileEntry;

          for (
            let chunkIdx = fileEntry.nextChunkIndex;
            chunkIdx < manifest.totalChunks;
            chunkIdx++
          ) {
            if (job.canceled) break;

            if (job.paused) {
              await new Promise<void>((resolve) => {
                job.resumeResolver = resolve;
              });
              if (job.canceled) break;
            }

            const start = chunkIdx * manifest.chunkSize;
            const end = Math.min(file.size, start + manifest.chunkSize);
            const sliceBuffer = await file.slice(start, end).arrayBuffer();
            const plainBytes = new Uint8Array(sliceBuffer);

            fileEntry.sha256.update(plainBytes);
            const { iv, ciphertext } = await encryptChunk(job.aesKey, plainBytes);

            const frame = packBinaryChunkFrame(
              {
                type: 'transfer:chunk',
                transferId,
                targetId: job.peer.id,
                senderId: selfDeviceRef.current?.id || deviceId,
                fileId: manifest.fileId,
                chunkIndex: chunkIdx,
                iv: uint8ToBase64(iv),
              },
              ciphertext
            );

            // Prefer open WebRTC P2P DataChannel, otherwise E2E encrypted WebSocket binary relay
            if (job.dc && job.dc.readyState === 'open') {
              while (job.dc.bufferedAmount > 2 * 1024 * 1024) {
                if (job.canceled) break;
                await new Promise((r) => setTimeout(r, 15));
              }
              job.dc.send(frame);
            } else if (wsRef.current?.readyState === WebSocket.OPEN) {
              while (wsRef.current.bufferedAmount > 4 * 1024 * 1024) {
                if (job.canceled) break;
                await new Promise((r) => setTimeout(r, 15));
              }
              wsRef.current.send(frame);
            } else {
              throw new Error('Connection lost during transfer.');
            }

            fileEntry.nextChunkIndex = chunkIdx + 1;
            job.bytesSent += plainBytes.byteLength;

            const elapsedSec = Math.max(0.15, (Date.now() - job.startedAt) / 1000);
            const speedBps = job.bytesSent / elapsedSec;
            const remaining = Math.max(0, job.totalSize - job.bytesSent);
            const etaSeconds = speedBps > 0 ? remaining / speedBps : null;

            setTransfers((prev) =>
              prev.map((batch) => {
                if (batch.transferId !== transferId) return batch;
                return {
                  ...batch,
                  currentFileIndex: fileIdx,
                  bytesTransferred: job.bytesSent,
                  speedBps,
                  etaSeconds,
                  transportMode:
                    job.dc && job.dc.readyState === 'open' ? 'p2p-webrtc' : 'e2e-relay',
                  files: batch.files.map((f) =>
                    f.fileId === manifest.fileId
                      ? {
                          ...f,
                          bytesTransferred: Math.min(file.size, end),
                          chunksTransferred: chunkIdx + 1,
                        }
                      : f
                  ),
                };
              })
            );

            // Sliding-window flow control every 16 chunks so receiver ACK paces large files
            if (chunkIdx - fileEntry.ackedChunkIndex >= 16) {
              await Promise.race([
                new Promise<void>((resolve) => {
                  job.ackWaiter = resolve;
                }),
                new Promise<void>((resolve) => setTimeout(resolve, 600)),
              ]);
              job.ackWaiter = null;
            }
          }

          if (job.canceled) break;

          const shaHex = fileEntry.sha256.digestHex();
          fileEntry.computedSha256 = shaHex;

          sendWsJson({
            type: 'transfer:file-complete',
            targetId: job.peer.id,
            transferId,
            fileId: manifest.fileId,
            sha256: shaHex,
          });

          setTransfers((prev) =>
            prev.map((batch) =>
              batch.transferId === transferId
                ? {
                    ...batch,
                    files: batch.files.map((f) =>
                      f.fileId === manifest.fileId
                        ? { ...f, sha256: shaHex, verified: true }
                        : f
                    ),
                  }
                : batch
            )
          );
        }

        if (job.canceled) return;

        const completedAt = Date.now();
        const avgSpeed = job.totalSize / Math.max(0.2, (completedAt - job.startedAt) / 1000);

        sendWsJson({
          type: 'transfer:batch-complete',
          targetId: job.peer.id,
          transferId,
        });

        setTransfers((prev) =>
          prev.map((b) =>
            b.transferId === transferId
              ? {
                  ...b,
                  status: 'completed',
                  bytesTransferred: job.totalSize,
                  etaSeconds: 0,
                  completedAt,
                }
              : b
          )
        );

        appendHistory({
          id: transferId,
          direction: 'sent',
          peerId: job.peer.id,
          peerName: job.peer.name,
          peerOs: job.peer.os,
          isFolder: job.isFolder,
          folderName: job.folderName,
          files: job.files.map((f) => ({
            name: f.manifest.name,
            relativePath: f.manifest.relativePath,
            size: f.manifest.size,
            mimeType: f.manifest.mimeType,
            sha256: f.computedSha256 || '',
            verified: true,
          })),
          totalSize: job.totalSize,
          status: 'completed',
          startedAt: job.startedAt,
          completedAt,
          averageSpeedBps: avgSpeed,
        });

        fireBrowserNotification(
          'Instrop — Transfer Complete',
          `Sent ${job.files.length} item${job.files.length > 1 ? 's' : ''} to ${job.peer.name}`
        );
        pushToast({
          title: 'Transfer complete',
          detail: `Sent ${job.files.length} item${job.files.length > 1 ? 's' : ''} to ${job.peer.name}`,
          tone: 'success',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transfer failed';
        setTransfers((prev) =>
          prev.map((b) =>
            b.transferId === transferId
              ? { ...b, status: 'failed', errorMessage: message }
              : b
          )
        );
        appendHistory({
          id: transferId,
          direction: 'sent',
          peerId: job.peer.id,
          peerName: job.peer.name,
          peerOs: job.peer.os,
          isFolder: job.isFolder,
          folderName: job.folderName,
          files: job.files.map((f) => ({
            name: f.manifest.name,
            relativePath: f.manifest.relativePath,
            size: f.manifest.size,
            mimeType: f.manifest.mimeType,
            sha256: f.computedSha256 || '',
            verified: false,
          })),
          totalSize: job.totalSize,
          status: 'failed',
          startedAt: job.startedAt,
          completedAt: Date.now(),
          averageSpeedBps: 0,
          errorMessage: message,
        });
      } finally {
        job.pc?.close();
      }
    },
    [appendHistory, deviceId, fireBrowserNotification, pushToast, sendWsJson]
  );

  const acceptIncomingRequest = useCallback(
    async (request: PendingIncomingRequest, alsoTrust: boolean) => {
      if (!identityRef.current) return;
      if (alsoTrust) {
        trustPeer(request.fromPeer);
      }

      setIncomingRequests((prev) => prev.filter((r) => r.transferId !== request.transferId));

      const aesKey = await deriveSharedAesKey(
        identityRef.current.keyPair.privateKey,
        request.fromPeer.publicKeyJwk
      );

      const filesMap = new Map<string, ReceiverFileState>();
      const fileOrder: string[] = [];
      const activeFiles: ActiveFileProgress[] = [];

      for (const item of request.files) {
        filesMap.set(item.fileId, {
          manifest: item,
          sha256: new StreamingSha256(),
          chunks: [],
          bytesReceived: 0,
          chunksReceived: 0,
        });
        fileOrder.push(item.fileId);
        activeFiles.push({
          fileId: item.fileId,
          name: item.name,
          relativePath: item.relativePath,
          size: item.size,
          mimeType: item.mimeType,
          bytesTransferred: 0,
          chunksTransferred: 0,
          totalChunks: item.totalChunks,
        });
      }

      const job: ReceiverJob = {
        transferId: request.transferId,
        peer: request.fromPeer,
        aesKey,
        isFolder: request.isFolder,
        folderName: request.folderName,
        files: filesMap,
        fileOrder,
        totalSize: request.totalSize,
        bytesReceived: 0,
        startedAt: Date.now(),
        paused: false,
        canceled: false,
        pc: null,
        dc: null,
        transportMode: 'e2e-relay',
      };

      receiverJobsRef.current.set(request.transferId, job);

      const batch: ActiveTransferBatch = {
        transferId: request.transferId,
        direction: 'receive',
        peerId: request.fromPeer.id,
        peerName: request.fromPeer.name,
        peerOs: request.fromPeer.os,
        isFolder: request.isFolder,
        folderName: request.folderName,
        transportMode: 'e2e-relay',
        encrypted: true,
        status: 'transferring',
        files: activeFiles,
        totalSize: request.totalSize,
        bytesTransferred: 0,
        speedBps: 0,
        etaSeconds: null,
        startedAt: job.startedAt,
        currentFileIndex: 0,
      };

      setTransfers((prev) => [batch, ...prev]);

      sendWsJson({
        type: 'transfer:response',
        targetId: request.fromPeer.id,
        transferId: request.transferId,
        accepted: true,
      });
    },
    [sendWsJson, trustPeer]
  );

  const declineIncomingRequest = useCallback(
    (request: PendingIncomingRequest, reason = 'Declined by recipient.') => {
      setIncomingRequests((prev) => prev.filter((r) => r.transferId !== request.transferId));
      sendWsJson({
        type: 'transfer:response',
        targetId: request.fromPeer.id,
        transferId: request.transferId,
        accepted: false,
        reason,
      });
      appendHistory({
        id: request.transferId,
        direction: 'received',
        peerId: request.fromPeer.id,
        peerName: request.fromPeer.name,
        peerOs: request.fromPeer.os,
        isFolder: request.isFolder,
        folderName: request.folderName,
        files: request.files.map((f) => ({
          name: f.name,
          relativePath: f.relativePath,
          size: f.size,
          mimeType: f.mimeType,
          sha256: '',
          verified: false,
        })),
        totalSize: request.totalSize,
        status: 'declined',
        startedAt: request.receivedAt,
        completedAt: Date.now(),
        averageSpeedBps: 0,
        errorMessage: reason,
      });
    },
    [appendHistory, sendWsJson]
  );

  const handleWsJsonMessage = useCallback(
    async (msg: Record<string, unknown>) => {
      const type = String(msg.type || '');

      if (type === 'device:registered') {
        const dev = msg.device as PeerDevice;
        setSelfDevice(dev);
        setLanUrls(Array.isArray(msg.lanUrls) ? (msg.lanUrls as string[]) : []);
        setMdnsPeers(Array.isArray(msg.mdnsPeers) ? (msg.mdnsPeers as MdnsLanPeer[]) : []);

        if (pendingPairFromUrlRef.current) {
          const code = pendingPairFromUrlRef.current;
          pendingPairFromUrlRef.current = null;
          if (code !== dev.pairingCode) {
            sendWsJson({ type: 'pair:by-code', code });
          }
        }
        return;
      }

      if (type === 'peers:update') {
        setNearbyPeers(Array.isArray(msg.peers) ? (msg.peers as PeerDevice[]) : []);
        if (Array.isArray(msg.mdnsPeers)) {
          setMdnsPeers(msg.mdnsPeers as MdnsLanPeer[]);
        }
        return;
      }

      if (type === 'pair:established') {
        const peer = msg.peer as PeerDevice;
        trustPeer(peer);
        pushToast({
          title: `Paired with ${peer.name}`,
          detail: `${peer.os} · End-to-end encryption verified`,
          tone: 'success',
        });
        return;
      }

      if (type === 'pair:error') {
        pushToast({
          title: 'Pairing failed',
          detail: String(msg.message || 'Could not pair with that code.'),
          tone: 'error',
        });
        return;
      }

      if (type === 'transfer:request') {
        const fromPeer = msg.senderDevice as PeerDevice;
        const transferId = String(msg.transferId || '');
        const files = (msg.files as FileManifestItem[]) || [];
        const totalSize = Number(msg.totalSize || 0);
        const isFolder = Boolean(msg.isFolder);
        const folderName = typeof msg.folderName === 'string' ? msg.folderName : undefined;

        const curSettings = settingsRef.current;
        const isTrusted = trustedRef.current.some((t) => t.id === fromPeer.id);

        if (curSettings.receivingPermission === 'off') {
          sendWsJson({
            type: 'transfer:response',
            targetId: fromPeer.id,
            transferId,
            accepted: false,
            reason: 'Recipient is in Private Mode (not accepting incoming files).',
          });
          return;
        }

        if (curSettings.receivingPermission === 'trusted-only' && !isTrusted) {
          sendWsJson({
            type: 'transfer:response',
            targetId: fromPeer.id,
            transferId,
            accepted: false,
            reason: 'Recipient only accepts transfers from trusted devices.',
          });
          return;
        }

        const reqObj: PendingIncomingRequest = {
          transferId,
          fromPeer,
          isFolder,
          folderName,
          files,
          totalSize,
          receivedAt: Date.now(),
        };

        if (isTrusted && curSettings.autoAcceptTrusted) {
          void acceptIncomingRequest(reqObj, false);
          fireBrowserNotification(
            'Instrop — Auto-receiving files',
            `${fromPeer.name} is sending ${files.length} item${files.length > 1 ? 's' : ''}`
          );
        } else {
          setIncomingRequests((prev) => [reqObj, ...prev]);
          fireBrowserNotification(
            'Instrop — Incoming Transfer Request',
            `${fromPeer.name} wants to send ${files.length} item${files.length > 1 ? 's' : ''}`
          );
        }
        return;
      }

      if (type === 'transfer:response') {
        const transferId = String(msg.transferId || '');
        const accepted = Boolean(msg.accepted);
        const job = senderJobsRef.current.get(transferId);
        if (!job) return;

        if (!accepted) {
          const reason = String(msg.reason || 'Transfer declined by recipient.');
          job.canceled = true;
          setTransfers((prev) =>
            prev.map((b) =>
              b.transferId === transferId
                ? { ...b, status: 'declined', errorMessage: reason, completedAt: Date.now() }
                : b
            )
          );
          appendHistory({
            id: transferId,
            direction: 'sent',
            peerId: job.peer.id,
            peerName: job.peer.name,
            peerOs: job.peer.os,
            isFolder: job.isFolder,
            folderName: job.folderName,
            files: job.files.map((f) => ({
              name: f.manifest.name,
              relativePath: f.manifest.relativePath,
              size: f.manifest.size,
              mimeType: f.manifest.mimeType,
              sha256: '',
              verified: false,
            })),
            totalSize: job.totalSize,
            status: 'declined',
            startedAt: job.startedAt,
            completedAt: Date.now(),
            averageSpeedBps: 0,
            errorMessage: reason,
          });
          pushToast({ title: 'Transfer declined', detail: reason, tone: 'warning' });
          return;
        }

        // Accepted! Start streaming chunks
        void runSenderLoop(transferId);
        return;
      }

      if (type === 'transfer:ack') {
        const transferId = String(msg.transferId || '');
        const fileId = String(msg.fileId || '');
        const acked = Number(msg.ackedChunkIndex ?? -1);
        const job = senderJobsRef.current.get(transferId);
        if (!job) return;
        const f = job.files.find((x) => x.manifest.fileId === fileId);
        if (f && acked > f.ackedChunkIndex) {
          f.ackedChunkIndex = acked;
        }
        if (job.ackWaiter) {
          job.ackWaiter();
          job.ackWaiter = null;
        }
        return;
      }

      if (type === 'transfer:pause') {
        const transferId = String(msg.transferId || '');
        const sJob = senderJobsRef.current.get(transferId);
        if (sJob) sJob.paused = true;
        const rJob = receiverJobsRef.current.get(transferId);
        if (rJob) rJob.paused = true;
        setTransfers((prev) =>
          prev.map((b) => (b.transferId === transferId ? { ...b, status: 'paused' } : b))
        );
        return;
      }

      if (type === 'transfer:resume') {
        const transferId = String(msg.transferId || '');
        const sJob = senderJobsRef.current.get(transferId);
        if (sJob) {
          sJob.paused = false;
          sJob.resumeResolver?.();
          sJob.resumeResolver = null;
        }
        const rJob = receiverJobsRef.current.get(transferId);
        if (rJob) rJob.paused = false;
        setTransfers((prev) =>
          prev.map((b) => (b.transferId === transferId ? { ...b, status: 'transferring' } : b))
        );
        return;
      }

      if (type === 'transfer:cancel') {
        const transferId = String(msg.transferId || '');
        const sJob = senderJobsRef.current.get(transferId);
        if (sJob) {
          sJob.canceled = true;
          sJob.resumeResolver?.();
          sJob.ackWaiter?.();
        }
        const rJob = receiverJobsRef.current.get(transferId);
        if (rJob) {
          rJob.canceled = true;
        }
        setTransfers((prev) =>
          prev.map((b) =>
            b.transferId === transferId
              ? { ...b, status: 'canceled', completedAt: Date.now() }
              : b
          )
        );
        return;
      }

      if (type === 'transfer:file-complete') {
        const transferId = String(msg.transferId || '');
        const fileId = String(msg.fileId || '');
        const expectedSha = String(msg.sha256 || '');
        const job = receiverJobsRef.current.get(transferId);
        if (!job) return;
        const fileState = job.files.get(fileId);
        if (!fileState) return;

        const actualSha = fileState.sha256.digestHex();
        const verified = actualSha === expectedSha;
        fileState.expectedSha256 = expectedSha;
        fileState.verified = verified;

        const parts = fileState.chunks.map((c) => {
          const copy = new Uint8Array(c.byteLength);
          copy.set(c);
          return copy.buffer;
        });
        const blob = new Blob(parts, {
          type: fileState.manifest.mimeType || 'application/octet-stream',
        });
        fileState.blob = blob;
        const url = URL.createObjectURL(blob);
        fileState.downloadUrl = url;
        if (fileState.manifest.mimeType.startsWith('image/')) {
          fileState.previewUrl = url;
        }
        // Release intermediate chunk references once Blob is materialized
        fileState.chunks = [];

        let savedToDisk = false;
        if (verified && settingsRef.current.saveMode === 'auto' && !job.isFolder) {
          triggerDownload(url, fileState.manifest.name);
          savedToDisk = true;
        }

        setTransfers((prev) =>
          prev.map((batch) =>
            batch.transferId === transferId
              ? {
                  ...batch,
                  files: batch.files.map((f) =>
                    f.fileId === fileId
                      ? {
                          ...f,
                          sha256: actualSha,
                          verified,
                          downloadUrl: url,
                          previewUrl: fileState.previewUrl,
                          savedToDisk,
                        }
                      : f
                  ),
                }
              : batch
          )
        );
        return;
      }

      if (type === 'transfer:batch-complete') {
        const transferId = String(msg.transferId || '');
        const job = receiverJobsRef.current.get(transferId);
        if (!job) return;

        const completedAt = Date.now();
        const avgSpeed = job.totalSize / Math.max(0.2, (completedAt - job.startedAt) / 1000);
        const allVerified = job.fileOrder.every((id) => job.files.get(id)?.verified);

        setTransfers((prev) =>
          prev.map((b) =>
            b.transferId === transferId
              ? {
                  ...b,
                  status: allVerified ? 'completed' : 'failed',
                  etaSeconds: 0,
                  completedAt,
                  errorMessage: allVerified ? undefined : 'Integrity verification mismatch (SHA-256).',
                }
              : b
          )
        );

        appendHistory({
          id: transferId,
          direction: 'received',
          peerId: job.peer.id,
          peerName: job.peer.name,
          peerOs: job.peer.os,
          isFolder: job.isFolder,
          folderName: job.folderName,
          files: job.fileOrder.map((id) => {
            const f = job.files.get(id)!;
            return {
              name: f.manifest.name,
              relativePath: f.manifest.relativePath,
              size: f.manifest.size,
              mimeType: f.manifest.mimeType,
              sha256: f.expectedSha256 || '',
              verified: Boolean(f.verified),
            };
          }),
          totalSize: job.totalSize,
          status: allVerified ? 'completed' : 'failed',
          startedAt: job.startedAt,
          completedAt,
          averageSpeedBps: avgSpeed,
        });

        if (allVerified && job.isFolder && settingsRef.current.saveMode === 'zip-folders') {
          void downloadFolderAsZip(transferId);
        }

        fireBrowserNotification(
          'Instrop — Files Received',
          `Received ${job.fileOrder.length} item${job.fileOrder.length > 1 ? 's' : ''} from ${job.peer.name}`
        );
        pushToast({
          title: allVerified ? 'Files received & verified' : 'Checksum mismatch',
          detail: `${job.fileOrder.length} item${job.fileOrder.length > 1 ? 's' : ''} from ${job.peer.name}`,
          tone: allVerified ? 'success' : 'error',
        });
        return;
      }

      if (type === 'transfer:peer-offline') {
        const transferId = String(msg.transferId || '');
        if (transferId) {
          const sJob = senderJobsRef.current.get(transferId);
          if (sJob) sJob.paused = true;
          setTransfers((prev) =>
            prev.map((b) =>
              b.transferId === transferId && b.status === 'transferring'
                ? { ...b, status: 'paused', errorMessage: 'Peer went offline — paused for recovery.' }
                : b
            )
          );
        }
        return;
      }

      // Optional WebRTC DataChannel signaling for direct LAN P2P upgrade
      if (type === 'webrtc:offer') {
        const transferId = String(msg.transferId || '');
        const senderId = String(msg.senderId || '');
        const job = receiverJobsRef.current.get(transferId);
        if (!job) return;
        try {
          const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
          job.pc = pc;
          pc.onicecandidate = (ev) => {
            if (ev.candidate) {
              sendWsJson({ type: 'webrtc:ice', targetId: senderId, transferId, candidate: ev.candidate });
            }
          };
          pc.ondatachannel = (ev) => {
            const dc = ev.channel;
            dc.binaryType = 'arraybuffer';
            job.dc = dc;
            dc.onopen = () => {
              job.transportMode = 'p2p-webrtc';
              setTransfers((prev) =>
                prev.map((b) =>
                  b.transferId === transferId ? { ...b, transportMode: 'p2p-webrtc' } : b
                )
              );
            };
            dc.onmessage = (mEv) => {
              if (mEv.data instanceof ArrayBuffer) {
                void handleIncomingBinaryChunk(mEv.data);
              }
            };
          };
          await pc.setRemoteDescription(msg.offer as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWsJson({ type: 'webrtc:answer', targetId: senderId, transferId, answer });
        } catch {
          // WebSocket E2E relay remains active seamlessly
        }
        return;
      }

      if (type === 'webrtc:answer') {
        const transferId = String(msg.transferId || '');
        const job = senderJobsRef.current.get(transferId);
        if (job?.pc && msg.answer) {
          try {
            await job.pc.setRemoteDescription(msg.answer as RTCSessionDescriptionInit);
          } catch {
            // Ignore
          }
        }
        return;
      }

      if (type === 'webrtc:ice') {
        const transferId = String(msg.transferId || '');
        const sJob = senderJobsRef.current.get(transferId);
        const rJob = receiverJobsRef.current.get(transferId);
        const pc = sJob?.pc || rJob?.pc;
        if (pc && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit);
          } catch {
            // Ignore
          }
        }
      }
    },
    [
      acceptIncomingRequest,
      appendHistory,
      downloadFolderAsZip,
      fireBrowserNotification,
      handleIncomingBinaryChunk,
      pushToast,
      runSenderLoop,
      sendWsJson,
      triggerDownload,
      trustPeer,
    ]
  );

  // Boot device identity + WebSocket connection (re-runs if serverOrigin changes)
  useEffect(() => {
    let unmounted = false;

    const urlParams = new URLSearchParams(window.location.search);
    const pairParam = urlParams.get('pair');
    if (pairParam && /^\d{6}$/.test(pairParam)) {
      pendingPairFromUrlRef.current = pairParam;
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
    }

    const resolveWsEndpoint = (): string => {
      const trimmed = serverOrigin.trim().replace(/\/+$/, '');
      if (!trimmed) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/ws`;
      }
      if (trimmed.startsWith('https://')) {
        return `wss://${trimmed.slice(8)}/ws`;
      }
      if (trimmed.startsWith('http://')) {
        return `ws://${trimmed.slice(7)}/ws`;
      }
      if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
        return `${trimmed}/ws`;
      }
      const hasPort = /:\d+$/.test(trimmed);
      return `ws://${hasPort ? trimmed : `${trimmed}:3000`}/ws`;
    };

    async function boot() {
      const profile = await detectLocalDeviceProfile();
      if (unmounted) return;
      setDeviceOs(profile.os);
      setDeviceType(profile.deviceType);

      const loaded = loadSettings(profile.defaultName);
      setSettingsState(loaded);

      const identity = identityRef.current || (await generateDeviceKeyIdentity());
      if (unmounted) return;
      identityRef.current = identity;

      const connect = () => {
        if (unmounted) return;
        setConnectionState(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');

        let ws: WebSocket;
        try {
          ws = new WebSocket(resolveWsEndpoint());
        } catch {
          setConnectionState('offline');
          return;
        }
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
          setConnectionState('connected');
          ws.send(
            JSON.stringify({
              type: 'device:register',
              id: deviceId,
              name: settingsRef.current.deviceName,
              os: profile.os,
              deviceType: profile.deviceType,
              publicKeyJwk: identity.publicKeyJwk,
              fingerprint: identity.fingerprint,
              trustedIds: trustedRef.current.map((t) => t.id),
            })
          );
        };

        ws.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            void handleIncomingBinaryChunk(ev.data);
            return;
          }
          try {
            const parsed = JSON.parse(String(ev.data)) as Record<string, unknown>;
            void handleWsJsonMessage(parsed);
          } catch {
            // Ignore malformed JSON
          }
        };

        ws.onclose = () => {
          if (unmounted) return;
          setConnectionState('offline');
          for (const job of senderJobsRef.current.values()) {
            if (!job.canceled) job.paused = true;
          }
          setTransfers((prev) =>
            prev.map((b) =>
              b.status === 'transferring'
                ? { ...b, status: 'paused', errorMessage: 'Network disconnected — reconnecting...' }
                : b
            )
          );

          const delay = Math.min(8000, 1000 * Math.pow(2, reconnectAttemptRef.current));
          reconnectAttemptRef.current += 1;
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        };
      };

      connect();
    }

    void boot();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [deviceId, serverOrigin, handleIncomingBinaryChunk, handleWsJsonMessage]);

  const sendFiles = useCallback(
    async (
      targetPeer: PeerDevice,
      selected: SelectedTransferFile[],
      isFolder: boolean,
      folderName?: string
    ) => {
      if (!identityRef.current || selected.length === 0) return null;
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        pushToast({
          title: 'Offline',
          detail: 'Reconnect to local network before sending.',
          tone: 'error',
        });
        return null;
      }

      const transferId = crypto.randomUUID ? crypto.randomUUID() : `tx-${Date.now()}`;
      const chunkSize = settingsRef.current.chunkSizeKb * 1024;
      const aesKey = await deriveSharedAesKey(
        identityRef.current.keyPair.privateKey,
        targetPeer.publicKeyJwk
      );

      let totalSize = 0;
      const senderFiles: SenderFileState[] = selected.map((item, index) => {
        const fileId = `${transferId}-f${index}`;
        totalSize += item.file.size;
        const totalChunks = item.file.size === 0 ? 0 : Math.ceil(item.file.size / chunkSize);
        const manifest: FileManifestItem = {
          fileId,
          name: item.file.name,
          relativePath: item.relativePath || item.file.name,
          size: item.file.size,
          mimeType: item.file.type || 'application/octet-stream',
          totalChunks,
          chunkSize,
        };
        return {
          file: item.file,
          manifest,
          sha256: new StreamingSha256(),
          nextChunkIndex: 0,
          ackedChunkIndex: -1,
        };
      });

      const job: SenderJob = {
        transferId,
        peer: targetPeer,
        aesKey,
        isFolder,
        folderName,
        files: senderFiles,
        totalSize,
        bytesSent: 0,
        startedAt: Date.now(),
        paused: false,
        canceled: false,
        resumeResolver: null,
        ackWaiter: null,
        dc: null,
        pc: null,
        transportMode: 'e2e-relay',
      };

      // Initiate optional WebRTC P2P DataChannel in parallel
      try {
        const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
        const dc = pc.createDataChannel('instrop-data', { ordered: true });
        dc.binaryType = 'arraybuffer';
        job.pc = pc;
        job.dc = dc;
        dc.onopen = () => {
          job.transportMode = 'p2p-webrtc';
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            sendWsJson({
              type: 'webrtc:ice',
              targetId: targetPeer.id,
              transferId,
              candidate: ev.candidate,
            });
          }
        };
        void pc.createOffer().then(async (offer) => {
          await pc.setLocalDescription(offer);
          sendWsJson({
            type: 'webrtc:offer',
            targetId: targetPeer.id,
            transferId,
            offer,
          });
        });
      } catch {
        // E2E WebSocket relay works seamlessly without WebRTC
      }

      senderJobsRef.current.set(transferId, job);

      const batch: ActiveTransferBatch = {
        transferId,
        direction: 'send',
        peerId: targetPeer.id,
        peerName: targetPeer.name,
        peerOs: targetPeer.os,
        isFolder,
        folderName,
        transportMode: 'e2e-relay',
        encrypted: true,
        status: 'awaiting-approval',
        files: senderFiles.map((f) => ({
          fileId: f.manifest.fileId,
          name: f.manifest.name,
          relativePath: f.manifest.relativePath,
          size: f.manifest.size,
          mimeType: f.manifest.mimeType,
          bytesTransferred: 0,
          chunksTransferred: 0,
          totalChunks: f.manifest.totalChunks,
        })),
        totalSize,
        bytesTransferred: 0,
        speedBps: 0,
        etaSeconds: null,
        startedAt: job.startedAt,
        currentFileIndex: 0,
      };

      setTransfers((prev) => [batch, ...prev]);

      sendWsJson({
        type: 'transfer:request',
        targetId: targetPeer.id,
        transferId,
        isFolder,
        folderName,
        files: senderFiles.map((f) => f.manifest),
        totalSize,
      });

      return transferId;
    },
    [pushToast, sendWsJson]
  );

  const pauseTransfer = useCallback(
    (transferId: string) => {
      const sJob = senderJobsRef.current.get(transferId);
      const rJob = receiverJobsRef.current.get(transferId);
      const targetId = sJob?.peer.id || rJob?.peer.id;
      if (sJob) sJob.paused = true;
      if (rJob) rJob.paused = true;

      setTransfers((prev) =>
        prev.map((b) => (b.transferId === transferId ? { ...b, status: 'paused' } : b))
      );
      if (targetId) {
        sendWsJson({ type: 'transfer:pause', targetId, transferId });
      }
    },
    [sendWsJson]
  );

  const resumeTransfer = useCallback(
    (transferId: string) => {
      const sJob = senderJobsRef.current.get(transferId);
      const rJob = receiverJobsRef.current.get(transferId);
      const targetId = sJob?.peer.id || rJob?.peer.id;
      if (sJob) {
        sJob.paused = false;
        sJob.resumeResolver?.();
        sJob.resumeResolver = null;
      }
      if (rJob) rJob.paused = false;

      setTransfers((prev) =>
        prev.map((b) =>
          b.transferId === transferId
            ? { ...b, status: 'transferring', errorMessage: undefined }
            : b
        )
      );
      if (targetId) {
        sendWsJson({ type: 'transfer:resume', targetId, transferId });
      }
    },
    [sendWsJson]
  );

  const cancelTransfer = useCallback(
    (transferId: string) => {
      const sJob = senderJobsRef.current.get(transferId);
      const rJob = receiverJobsRef.current.get(transferId);
      const targetId = sJob?.peer.id || rJob?.peer.id;

      if (sJob) {
        sJob.canceled = true;
        sJob.resumeResolver?.();
        sJob.ackWaiter?.();
      }
      if (rJob) {
        rJob.canceled = true;
      }

      if (targetId) {
        sendWsJson({ type: 'transfer:cancel', targetId, transferId });
      }

      setTransfers((prev) =>
        prev.map((b) => {
          if (b.transferId !== transferId) return b;
          const completedAt = Date.now();
          appendHistory({
            id: transferId,
            direction: b.direction === 'send' ? 'sent' : 'received',
            peerId: b.peerId,
            peerName: b.peerName,
            peerOs: b.peerOs,
            isFolder: b.isFolder,
            folderName: b.folderName,
            files: b.files.map((f) => ({
              name: f.name,
              relativePath: f.relativePath,
              size: f.size,
              mimeType: f.mimeType,
              sha256: f.sha256 || '',
              verified: false,
            })),
            totalSize: b.totalSize,
            status: 'canceled',
            startedAt: b.startedAt,
            completedAt,
            averageSpeedBps: 0,
          });
          return { ...b, status: 'canceled', completedAt };
        })
      );
    },
    [appendHistory, sendWsJson]
  );

  const pairByCode = useCallback(
    (code: string) => {
      const cleaned = code.replace(/\D/g, '').slice(0, 6);
      if (cleaned.length !== 6) {
        pushToast({
          title: 'Invalid code',
          detail: 'Enter a 6-digit pairing code.',
          tone: 'warning',
        });
        return false;
      }
      if (cleaned === selfDeviceRef.current?.pairingCode) {
        pushToast({
          title: 'Same device code',
          detail: 'Enter the 6-digit code shown on the other device.',
          tone: 'warning',
        });
        return false;
      }
      return sendWsJson({ type: 'pair:by-code', code: cleaned });
    },
    [pushToast, sendWsJson]
  );

  const pairById = useCallback(
    (targetId: string) => {
      return sendWsJson({ type: 'pair:by-id', targetId });
    },
    [sendWsJson]
  );

  const clearCompletedTransfers = useCallback(() => {
    setTransfers((prev) =>
      prev.filter((t) =>
        ['awaiting-approval', 'transferring', 'paused', 'verifying'].includes(t.status)
      )
    );
  }, []);

  const connectToServer = useCallback((origin: string, optionalPairCode?: string) => {
    const cleaned = origin.trim().replace(/\/+$/, '');
    if (optionalPairCode && /^\d{6}$/.test(optionalPairCode)) {
      pendingPairFromUrlRef.current = optionalPairCode;
    }
    reconnectAttemptRef.current = 0;
    saveServerOrigin(cleaned);
    setNearbyPeers([]);
    setSelfDevice(null);
    setServerOriginState(cleaned);
  }, []);

  return {
    deviceId,
    deviceOs,
    deviceType,
    selfDevice,
    connectionState,
    serverOrigin,
    connectToServer,
    nearbyPeers,
    mdnsPeers,
    lanUrls,
    trustedDevices,
    settings,
    history,
    transfers,
    incomingRequests,
    toasts,
    dismissToast,
    updateSettings,
    trustPeer,
    renameTrustedDevice,
    revokeTrustedDevice,
    pairByCode,
    pairById,
    sendFiles,
    acceptIncomingRequest,
    declineIncomingRequest,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    clearCompletedTransfers,
    clearHistory,
    downloadFolderAsZip,
    triggerDownload,
  };
}
