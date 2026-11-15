import type { SaveMode } from '../types/instrop';

interface CapacitorFilesystemPlugin {
  requestPermissions?: () => Promise<{ publicStorage?: string }>;
  checkPermissions?: () => Promise<{ publicStorage?: string }>;
  mkdir: (options: {
    path: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<void>;
  writeFile: (options: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
  }) => Promise<{ uri?: string }>;
  appendFile: (options: {
    path: string;
    data: string;
    directory: string;
  }) => Promise<void>;
}

interface CapacitorLocalNotificationsPlugin {
  checkPermissions?: () => Promise<{ display: string }>;
  requestPermissions?: () => Promise<{ display: string }>;
  createChannel?: (options: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
  }) => Promise<void>;
  schedule: (options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      channelId?: string;
    }>;
  }) => Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    Filesystem?: CapacitorFilesystemPlugin;
    LocalNotifications?: CapacitorLocalNotificationsPlugin;
  };
}

interface WindowWithPickers extends Window {
  Capacitor?: CapacitorGlobal;
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
}

const DIR_HANDLE_DB = 'instrop-fs-handles';
const DIR_HANDLE_STORE = 'handles';
const DIR_HANDLE_KEY = 'download-directory';

let cachedDirectoryHandle: FileSystemDirectoryHandle | null = null;

function getWindowExt(): WindowWithPickers {
  return window as WindowWithPickers;
}

export function isNativeCapacitorApp(): boolean {
  const cap = getWindowExt().Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform());
  }
  const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
  return platform === 'android' || platform === 'ios';
}

export function isMobileViewportOrAgent(): boolean {
  if (isNativeCapacitorApp()) return true;
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function hasCapacitorFilesystem(): boolean {
  return Boolean(getWindowExt().Capacitor?.Plugins?.Filesystem);
}

export function hasCapacitorLocalNotifications(): boolean {
  return Boolean(getWindowExt().Capacitor?.Plugins?.LocalNotifications);
}

export function supportsDesktopDirectoryPicker(): boolean {
  if (isNativeCapacitorApp() || isMobileViewportOrAgent()) return false;
  return typeof getWindowExt().showDirectoryPicker === 'function';
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DIR_HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DIR_HANDLE_STORE)) {
        req.result.createObjectStore(DIR_HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DIR_HANDLE_STORE, 'readwrite');
      tx.objectStore(DIR_HANDLE_STORE).put(handle, DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB persistence is best-effort; in-memory handle remains active
  }
}

export async function restoreDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedDirectoryHandle) return cachedDirectoryHandle;
  if (!supportsDesktopDirectoryPicker() || typeof indexedDB === 'undefined') return null;
  try {
    const db = await openHandleDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(DIR_HANDLE_STORE, 'readonly');
      const req = tx.objectStore(DIR_HANDLE_STORE).get(DIR_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (handle) cachedDirectoryHandle = handle;
    return handle;
  } catch {
    return null;
  }
}

export async function clearStoredDirectoryHandle(): Promise<void> {
  cachedDirectoryHandle = null;
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DIR_HANDLE_STORE, 'readwrite');
      tx.objectStore(DIR_HANDLE_STORE).delete(DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function pickDesktopDirectory(): Promise<
  | { status: 'picked'; name: string }
  | { status: 'canceled' }
  | { status: 'unsupported'; reason: string }
> {
  const picker = getWindowExt().showDirectoryPicker;
  if (typeof picker !== 'function' || isNativeCapacitorApp()) {
    return { status: 'unsupported', reason: 'Directory picker is unavailable on this device.' };
  }
  try {
    const handle = await picker({ mode: 'readwrite' });
    cachedDirectoryHandle = handle;
    await persistDirectoryHandle(handle);
    return { status: 'picked', name: handle.name };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'AbortError') {
      return { status: 'canceled' };
    }
    return {
      status: 'unsupported',
      reason: err instanceof Error ? err.message : 'Folder picker is unsupported in this browser.',
    };
  }
}

function uint8ToBase64Chunk(bytes: Uint8Array): string {
  let binary = '';
  const sliceSize = 0x8000;
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, i + sliceSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || `instrop-file-${Date.now()}`;
}

function parseMobileFolderTarget(downloadFolderLabel: string): {
  directory: 'DOCUMENTS' | 'EXTERNAL_STORAGE';
  subfolder: string;
  displayBase: string;
} {
  const trimmed = downloadFolderLabel.trim();
  if (trimmed.toLowerCase().startsWith('download/')) {
    const sub = trimmed.slice('download/'.length).replace(/^\/+|\/+$/g, '') || 'Instrop';
    return {
      directory: 'EXTERNAL_STORAGE',
      subfolder: `Download/${sub}`,
      displayBase: `Downloads/${sub}`,
    };
  }
  if (trimmed.toLowerCase().startsWith('downloads/')) {
    const sub = trimmed.slice('downloads/'.length).replace(/^\/+|\/+$/g, '') || 'Instrop';
    return {
      directory: 'EXTERNAL_STORAGE',
      subfolder: `Download/${sub}`,
      displayBase: `Downloads/${sub}`,
    };
  }
  if (trimmed.toLowerCase().startsWith('documents/')) {
    const sub = trimmed.slice('documents/'.length).replace(/^\/+|\/+$/g, '') || 'Instrop';
    return {
      directory: 'DOCUMENTS',
      subfolder: sub,
      displayBase: `Documents/${sub}`,
    };
  }
  return {
    directory: 'DOCUMENTS',
    subfolder: 'Instrop',
    displayBase: 'Documents/Instrop',
  };
}

async function writeBlobWithCapacitorFilesystem(
  fs: CapacitorFilesystemPlugin,
  blob: Blob,
  filename: string,
  downloadFolderLabel: string
): Promise<{ ok: boolean; savedTo?: string; error?: string }> {
  try {
    if (typeof fs.requestPermissions === 'function') {
      await fs.requestPermissions().catch(() => undefined);
    }

    const safeName = sanitizeFileName(filename);
    const parsed = parseMobileFolderTarget(downloadFolderLabel);

    const writeToTarget = async (directory: string, subfolder: string) => {
      await fs.mkdir({ path: subfolder, directory, recursive: true }).catch(() => undefined);
      const targetPath = `${subfolder}/${safeName}`;
      const chunkBytes = 512 * 1024; // 512 KB chunks prevent Android WebView OOM
      let offset = 0;
      let chunkIndex = 0;

      if (blob.size === 0) {
        await fs.writeFile({ path: targetPath, data: '', directory, recursive: true });
        return;
      }

      while (offset < blob.size) {
        const slice = blob.slice(offset, Math.min(blob.size, offset + chunkBytes));
        const buf = new Uint8Array(await slice.arrayBuffer());
        const b64 = uint8ToBase64Chunk(buf);
        if (chunkIndex === 0) {
          await fs.writeFile({ path: targetPath, data: b64, directory, recursive: true });
        } else {
          await fs.appendFile({ path: targetPath, data: b64, directory });
        }
        offset += buf.byteLength;
        chunkIndex += 1;
      }
    };

    try {
      await writeToTarget(parsed.directory, parsed.subfolder);
      return { ok: true, savedTo: `${parsed.displayBase}/${safeName}` };
    } catch {
      // Android 11+ Scoped Storage may deny ExternalStorage/Download; Documents always works cleanly
      const fallbackSub = parsed.subfolder.replace(/^Download\//i, '') || 'Instrop';
      await writeToTarget('DOCUMENTS', fallbackSub);
      return { ok: true, savedTo: `Documents/${fallbackSub}/${safeName}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to write file to Android storage.',
    };
  }
}

async function writeBlobToDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  blob: Blob,
  filename: string
): Promise<boolean> {
  try {
    const extHandle = dirHandle as FileSystemDirectoryHandle & {
      queryPermission?: (desc: { mode: 'readwrite' }) => Promise<string>;
      requestPermission?: (desc: { mode: 'readwrite' }) => Promise<string>;
    };
    if (typeof extHandle.queryPermission === 'function') {
      let state = await extHandle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted' && typeof extHandle.requestPermission === 'function') {
        state = await extHandle.requestPermission({ mode: 'readwrite' });
      }
      if (state !== 'granted') return false;
    }

    const safeName = sanitizeFileName(filename);
    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export interface SaveFileResult {
  ok: boolean;
  savedTo?: string;
  needsNativePlugin?: boolean;
  canceled?: boolean;
  error?: string;
}

export async function saveReceivedFileToDevice(options: {
  url: string;
  filename: string;
  blob?: Blob;
  saveMode: SaveMode;
  downloadFolderLabel: string;
  isUserGesture: boolean;
}): Promise<SaveFileResult> {
  const { url, filename, saveMode, downloadFolderLabel, isUserGesture } = options;
  let blob = options.blob;

  if (!blob) {
    try {
      const resp = await fetch(url);
      blob = await resp.blob();
    } catch {
      blob = undefined;
    }
  }

  // 1. Desktop chosen folder via showDirectoryPicker
  if (blob && !isNativeCapacitorApp()) {
    const dirHandle = await restoreDirectoryHandle();
    if (dirHandle) {
      const wrote = await writeBlobToDirectoryHandle(dirHandle, blob, filename);
      if (wrote) {
        return { ok: true, savedTo: `${dirHandle.name}/${sanitizeFileName(filename)}` };
      }
    }
  }

  // 2. Capacitor native Android / iOS Filesystem plugin
  const capFs = getWindowExt().Capacitor?.Plugins?.Filesystem;
  if (capFs && blob) {
    const res = await writeBlobWithCapacitorFilesystem(capFs, blob, filename, downloadFolderLabel);
    if (res.ok) return res;
  }

  // 3. Desktop "Ask location" using showSaveFilePicker on explicit user click
  const saveFilePicker = getWindowExt().showSaveFilePicker;
  if (
    isUserGesture &&
    saveMode === 'ask-location' &&
    blob &&
    !isNativeCapacitorApp() &&
    typeof saveFilePicker === 'function'
  ) {
    try {
      const fileHandle = await saveFilePicker({ suggestedName: sanitizeFileName(filename) });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { ok: true, savedTo: fileHandle.name || filename };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false, canceled: true };
      }
      // Fall through to Web Share / anchor download
    }
  }

  // 4. Mobile Web Share sheet (works on mobile browsers and newer Android WebViews on click)
  if (isUserGesture && isMobileViewportOrAgent() && blob && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], sanitizeFileName(filename), {
        type: blob.type || 'application/octet-stream',
      });
      const navExt = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (!navExt.canShare || navExt.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return { ok: true, savedTo: 'Device Share / Files' };
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false, canceled: true };
      }
      // Fall through if WebView rejects navigator.share
    }
  }

  // 5. Native Capacitor WebView without @capacitor/filesystem cannot save blob: URLs via <a download>
  if (isNativeCapacitorApp() && !capFs) {
    return {
      ok: false,
      needsNativePlugin: true,
      error:
        'Install @capacitor/filesystem in your Android project (npx cap sync android) to save directly to Documents/Downloads.',
    };
  }

  // 6. Standard browser anchor download (Windows / Desktop Chrome / Edge / Mobile Chrome / Electron)
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFileName(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    document.body.removeChild(a);
  }, 300);

  return { ok: true, savedTo: downloadFolderLabel || 'Browser Downloads' };
}

export type NotificationEnableResult =
  | { enabled: true; mode: 'native' | 'web' | 'in-app'; message: string }
  | { enabled: false; message: string };

export async function enableNotificationsForPlatform(): Promise<NotificationEnableResult> {
  // 1. Capacitor LocalNotifications plugin (Android/iOS)
  const localNotif = getWindowExt().Capacitor?.Plugins?.LocalNotifications;
  if (localNotif) {
    try {
      if (typeof localNotif.requestPermissions === 'function') {
        const perm = await localNotif.requestPermissions();
        if (perm.display !== 'granted') {
          return {
            enabled: false,
            message: 'Allow Notifications in Android Settings → Apps → Instrop to enable alerts.',
          };
        }
      }
      if (typeof localNotif.createChannel === 'function') {
        await localNotif
          .createChannel({
            id: 'instrop-transfers',
            name: 'File Transfers',
            description: 'Incoming transfer requests and completion alerts',
            importance: 4,
          })
          .catch(() => undefined);
      }
      return {
        enabled: true,
        mode: 'native',
        message: 'Android notifications enabled.',
      };
    } catch {
      return {
        enabled: true,
        mode: 'in-app',
        message: 'In-app transfer alerts and sound enabled.',
      };
    }
  }

  // 2. Web Notification API (Desktop Electron / Chrome / Edge / Mobile Chrome)
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      return { enabled: true, mode: 'web', message: 'Transfer notifications enabled.' };
    }
    if (Notification.permission === 'denied') {
      return {
        enabled: true,
        mode: 'in-app',
        message: 'System notifications are blocked; using in-app banners & chime instead.',
      };
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        return { enabled: true, mode: 'web', message: 'Transfer notifications enabled.' };
      }
      return {
        enabled: true,
        mode: 'in-app',
        message: 'Using in-app transfer banners and chime.',
      };
    } catch {
      return {
        enabled: true,
        mode: 'in-app',
        message: 'In-app transfer alerts enabled.',
      };
    }
  }

  // 3. Stock Android WebView without @capacitor/local-notifications
  return {
    enabled: true,
    mode: 'in-app',
    message: 'In-app alerts & chime enabled (add @capacitor/local-notifications for lock-screen alerts).',
  };
}

let audioCtx: AudioContext | null = null;

export function playNotificationChime(): void {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    audioCtx = audioCtx || new AudioCtor();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const playTone = (freq: number, start: number, duration: number) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    playTone(660, now, 0.14);
    playTone(880, now + 0.11, 0.22);
  } catch {
    // Ignore audio context restrictions
  }
}

export async function dispatchPlatformNotification(title: string, body: string): Promise<void> {
  playNotificationChime();

  const localNotif = getWindowExt().Capacitor?.Plugins?.LocalNotifications;
  if (localNotif) {
    try {
      await localNotif.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483000),
            title,
            body,
            channelId: 'instrop-transfers',
          },
        ],
      });
      return;
    } catch {
      // Fall through
    }
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore if blocked by WebView context
    }
  }
}
