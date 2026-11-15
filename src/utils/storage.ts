import type {
  InstropSettings,
  TransferHistoryEntry,
  TrustedDeviceRecord,
} from '../types/instrop';
import { isMobileViewportOrAgent } from './mobileBridge';

const DEVICE_ID_KEY = 'instrop.device.id.v1';
const SETTINGS_KEY = 'instrop.settings.v1';
const TRUSTED_KEY = 'instrop.trusted.v1';
const HISTORY_KEY = 'instrop.history.v1';
const SERVER_ORIGIN_KEY = 'instrop.server.origin.v1';

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing && existing.length >= 8) return existing;
  const fresh = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

export function loadSettings(defaultDeviceName: string): InstropSettings {
  const defaultFolderLabel = isMobileViewportOrAgent()
    ? 'Documents/Instrop'
    : 'Browser Downloads';

  const fallback: InstropSettings = {
    deviceName: defaultDeviceName,
    receivingPermission: 'ask',
    autoAcceptTrusted: true,
    saveMode: 'auto',
    downloadFolderLabel: defaultFolderLabel,
    theme: 'system',
    notificationsEnabled: false,
    chunkSizeKb: 128,
    mdnsEnabled: true,
    windowsAutoStartConfigured: false,
  };

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<InstropSettings>;
    return {
      ...fallback,
      ...parsed,
      deviceName: parsed.deviceName?.trim() || defaultDeviceName,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: InstropSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTrustedDevices(): TrustedDeviceRecord[] {
  try {
    const raw = localStorage.getItem(TRUSTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrustedDeviceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTrustedDevices(devices: TrustedDeviceRecord[]): void {
  localStorage.setItem(TRUSTED_KEY, JSON.stringify(devices));
}

export function loadTransferHistory(): TransferHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TransferHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTransferHistory(entries: TransferHistoryEntry[]): void {
  // Keep latest 200 entries so localStorage stays lean
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 200)));
}

export function loadServerOrigin(): string {
  return (localStorage.getItem(SERVER_ORIGIN_KEY) || '').trim();
}

export function saveServerOrigin(origin: string): void {
  const cleaned = origin.trim();
  if (!cleaned) {
    localStorage.removeItem(SERVER_ORIGIN_KEY);
  } else {
    localStorage.setItem(SERVER_ORIGIN_KEY, cleaned);
  }
}
