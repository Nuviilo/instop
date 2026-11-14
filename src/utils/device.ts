import type { DeviceOS, DeviceType } from '../types/instrop';

export interface SelectedTransferFile {
  file: File;
  relativePath: string;
}

export async function detectLocalDeviceProfile(): Promise<{
  os: DeviceOS;
  deviceType: DeviceType;
  defaultName: string;
}> {
  const ua = navigator.userAgent || '';
  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      mobile?: boolean;
      getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string; model?: string }>;
    };
  };

  let os: DeviceOS = 'Unknown';
  let deviceType: DeviceType = 'desktop';
  let modelHint = '';

  if (/Android/i.test(ua)) {
    os = 'Android';
    deviceType = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'iOS';
    deviceType = /iPad/i.test(ua) ? 'tablet' : 'mobile';
  } else if (/Windows NT/i.test(ua) || nav.userAgentData?.platform === 'Windows') {
    os = 'Windows 10';
    deviceType = 'desktop';
    if (nav.userAgentData?.getHighEntropyValues) {
      try {
        const high = await nav.userAgentData.getHighEntropyValues(['platformVersion']);
        const major = parseInt((high.platformVersion || '0').split('.')[0] || '0', 10);
        if (major >= 13) {
          os = 'Windows 11';
        }
      } catch {
        // Keep Windows 10 fallback
      }
    }
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
    deviceType = 'desktop';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    deviceType = 'desktop';
  }

  if (nav.userAgentData?.getHighEntropyValues && os === 'Android') {
    try {
      const high = await nav.userAgentData.getHighEntropyValues(['model']);
      if (high.model) modelHint = high.model.trim();
    } catch {
      // Ignore
    }
  }

  const defaultName = modelHint
    ? modelHint
    : os === 'Windows 11' || os === 'Windows 10'
      ? 'Windows PC'
      : os === 'Android'
        ? deviceType === 'tablet'
          ? 'Android Tablet'
          : 'Android Phone'
        : os === 'macOS'
          ? 'Mac'
          : os === 'iOS'
            ? deviceType === 'tablet'
              ? 'iPad'
              : 'iPhone'
            : 'Workstation';

  return { os, deviceType, defaultName };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 KB/s';
  if (bps < 1024 * 1024) {
    return `${Math.max(1, Math.round(bps / 1024))} KB/s`;
  }
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s left`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m left`;
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export type FileCategory = 'image' | 'video' | 'audio' | 'archive' | 'apk' | 'document' | 'other';

export function inferFileCategory(name: string, mimeType: string): FileCategory {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'heic'].includes(ext)) {
    return 'image';
  }
  if (mimeType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext)) {
    return 'video';
  }
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return 'audio';
  }
  if (ext === 'apk') {
    return 'apk';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return 'archive';
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx', 'pptx', 'json'].includes(ext)) {
    return 'document';
  }
  return 'other';
}

// Recursive FileSystemEntry traversal for Windows/macOS Drag-and-Drop folders
async function readEntryRecursively(
  entry: FileSystemEntry,
  parentPath: string
): Promise<SelectedTransferFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    return new Promise((resolve) => {
      fileEntry.file(
        (file) => {
          const rel = parentPath ? `${parentPath}/${file.name}` : file.name;
          resolve([{ file, relativePath: rel }]);
        },
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const allEntries: FileSystemEntry[] = [];

    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([])
        );
      });

    while (true) {
      const batch = await readBatch();
      if (batch.length === 0) break;
      allEntries.push(...batch);
    }

    const nextParent = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const nested = await Promise.all(
      allEntries.map((child) => readEntryRecursively(child, nextParent))
    );
    return nested.flat();
  }

  return [];
}

export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<{ files: SelectedTransferFile[]; isFolder: boolean; folderName?: string }> {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length > 0) {
    const hasDir = entries.some((e) => e.isDirectory);
    const folderName = hasDir && entries.length === 1 ? entries[0].name : undefined;
    const nested = await Promise.all(entries.map((entry) => readEntryRecursively(entry, '')));
    const flat = nested.flat();
    return { files: flat, isFolder: hasDir, folderName };
  }

  const rawFiles = Array.from(dataTransfer.files || []);
  return {
    files: rawFiles.map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    })),
    isFolder: rawFiles.some((f) => Boolean(f.webkitRelativePath)),
  };
}
