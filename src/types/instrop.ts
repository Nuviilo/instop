export type DeviceOS =
  | 'Windows 11'
  | 'Windows 10'
  | 'Android'
  | 'macOS'
  | 'Linux'
  | 'iOS'
  | 'Unknown';

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export type NavTab = 'home' | 'devices' | 'transfers' | 'history' | 'settings';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ReceivingPermission = 'ask' | 'trusted-only' | 'off';

export type SaveMode = 'auto' | 'ask-location' | 'zip-folders';

export interface PeerDevice {
  id: string;
  name: string;
  os: DeviceOS;
  deviceType: DeviceType;
  pairingCode: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  discoverySource: 'lan' | 'paired' | 'mdns';
  ipHint?: string;
  connectedAt: number;
  online: boolean;
}

export interface MdnsLanPeer {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  txt?: Record<string, string>;
}

export interface TrustedDeviceRecord {
  id: string;
  name: string;
  originalName: string;
  os: DeviceOS;
  deviceType: DeviceType;
  fingerprint: string;
  publicKeyJwk?: JsonWebKey;
  pairedAt: number;
  lastSeenAt: number;
}

export interface FileManifestItem {
  fileId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  sha256?: string;
}

export type TransferStatus =
  | 'awaiting-approval'
  | 'transferring'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'declined';

export interface ActiveFileProgress {
  fileId: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  bytesTransferred: number;
  chunksTransferred: number;
  totalChunks: number;
  sha256?: string;
  verified?: boolean;
  previewUrl?: string;
  downloadUrl?: string;
  savedToDisk?: boolean;
}

export interface ActiveTransferBatch {
  transferId: string;
  direction: 'send' | 'receive';
  peerId: string;
  peerName: string;
  peerOs: DeviceOS;
  isFolder: boolean;
  folderName?: string;
  transportMode: 'p2p-webrtc' | 'e2e-relay';
  encrypted: boolean;
  status: TransferStatus;
  files: ActiveFileProgress[];
  totalSize: number;
  bytesTransferred: number;
  speedBps: number;
  etaSeconds: number | null;
  startedAt: number;
  completedAt?: number;
  currentFileIndex: number;
  errorMessage?: string;
  zipDownloadUrl?: string;
}

export interface TransferHistoryEntry {
  id: string;
  direction: 'sent' | 'received';
  peerId: string;
  peerName: string;
  peerOs: DeviceOS;
  isFolder: boolean;
  folderName?: string;
  files: Array<{
    name: string;
    relativePath: string;
    size: number;
    mimeType: string;
    sha256: string;
    verified: boolean;
  }>;
  totalSize: number;
  status: 'completed' | 'failed' | 'canceled' | 'declined';
  startedAt: number;
  completedAt: number;
  averageSpeedBps: number;
  errorMessage?: string;
}

export interface InstropSettings {
  deviceName: string;
  receivingPermission: ReceivingPermission;
  autoAcceptTrusted: boolean;
  saveMode: SaveMode;
  downloadFolderLabel: string;
  theme: ThemeMode;
  notificationsEnabled: boolean;
  chunkSizeKb: 64 | 128 | 256;
  mdnsEnabled: boolean;
  windowsAutoStartConfigured: boolean;
}

export interface PendingIncomingRequest {
  transferId: string;
  fromPeer: PeerDevice;
  isFolder: boolean;
  folderName?: string;
  files: FileManifestItem[];
  totalSize: number;
  receivedAt: number;
}
