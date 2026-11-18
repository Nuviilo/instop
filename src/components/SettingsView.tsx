import React, { useState } from 'react';
import {
  Bell,
  Check,
  FolderDown,
  Laptop,
  Lock,
  Moon,
  Network,
  Shield,
  Sun,
  Trash2,
} from 'lucide-react';
import type {
  InstropSettings,
  PeerDevice,
  ReceivingPermission,
  SaveMode,
  ThemeMode,
  TrustedDeviceRecord,
} from '../types/instrop';
import {
  clearStoredDirectoryHandle,
  enableNotificationsForPlatform,
  hasCapacitorFilesystem,
  isNativeCapacitorApp,
  pickDesktopDirectory,
  playNotificationChime,
  supportsDesktopDirectoryPicker,
} from '../utils/mobileBridge';

interface SettingsViewProps {
  settings: InstropSettings;
  selfDevice: PeerDevice | null;
  trustedDevices: TrustedDeviceRecord[];
  lanUrls: string[];
  onUpdateSettings: (patch: Partial<InstropSettings>) => void;
  onRevokeTrusted: (id: string) => void;
  onNotify: (toast: {
    title: string;
    detail?: string;
    tone: 'info' | 'success' | 'warning' | 'error';
  }) => void;
}

export function SettingsView({
  settings,
  selfDevice,
  trustedDevices,
  lanUrls,
  onUpdateSettings,
  onRevokeTrusted,
  onNotify,
}: SettingsViewProps) {
  const [nameInput, setNameInput] = useState(settings.deviceName);
  const [nameSaved, setNameSaved] = useState(false);
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [customFolderInput, setCustomFolderInput] = useState(
    settings.downloadFolderLabel || 'Documents/Instrop'
  );

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    onUpdateSettings({ deviceName: nameInput.trim() });
    setNameSaved(true);
    window.setTimeout(() => setNameSaved(false), 1800);
  };

  const handleToggleNotifications = async () => {
    if (settings.notificationsEnabled) {
      onUpdateSettings({ notificationsEnabled: false });
      onNotify({
        title: 'Transfer notifications paused',
        tone: 'info',
      });
      return;
    }

    const result = await enableNotificationsForPlatform();
    onUpdateSettings({ notificationsEnabled: result.enabled });

    if (result.enabled) {
      playNotificationChime();
      onNotify({
        title: 'Transfer notifications enabled',
        detail: result.message,
        tone: 'success',
      });
    } else {
      onNotify({
        title: 'Notifications blocked',
        detail: result.message,
        tone: 'warning',
      });
    }
  };

  const handleChooseDownloadLabel = async () => {
    if (supportsDesktopDirectoryPicker()) {
      const picked = await pickDesktopDirectory();
      if (picked.status === 'picked') {
        onUpdateSettings({ downloadFolderLabel: picked.name });
        setFolderEditorOpen(false);
        onNotify({
          title: 'Download folder updated',
          detail: `Incoming files will save directly to "${picked.name}".`,
          tone: 'success',
        });
        return;
      }
      if (picked.status === 'canceled') {
        return;
      }
    }

    // Mobile / Android / Fallback: toggle inline destination folder selector
    setCustomFolderInput(settings.downloadFolderLabel || 'Documents/Instrop');
    setFolderEditorOpen((prev) => !prev);
  };

  const applyPresetFolder = async (label: string) => {
    await clearStoredDirectoryHandle();
    onUpdateSettings({ downloadFolderLabel: label });
    setCustomFolderInput(label);
    setFolderEditorOpen(false);
    onNotify({
      title: 'Destination folder updated',
      detail: `Files will save to ${label}.`,
      tone: 'success',
    });
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <section className="pb-6 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Settings
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Configure device identity, receiving permissions, encryption preferences, and appearance.
        </p>
      </section>

      {/* Device Identity */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Laptop className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Device Identity
          </h2>
        </div>

        <form onSubmit={handleSaveName} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={40}
            aria-label="Device name"
            className="flex-1 h-10 px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="min-h-[40px] px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            {nameSaved ? <Check className="w-3.5 h-3.5" /> : null}
            {nameSaved ? 'Updated' : 'Save Device Name'}
          </button>
        </form>

        {selfDevice && (
          <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              ECDH P-256 Fingerprint
            </span>
            <span className="font-mono text-zinc-800 dark:text-zinc-200">
              {selfDevice.fingerprint}
            </span>
          </div>
        )}
      </section>

      {/* Security & Receiving Permissions */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Security &amp; Receiving Permissions
          </h2>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Who can send files to this device
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { value: 'ask', label: 'Ask Every Time' },
                { value: 'trusted-only', label: 'Trusted Devices Only' },
                { value: 'off', label: 'Off (Private Mode)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onUpdateSettings({ receivingPermission: opt.value as ReceivingPermission })
                }
                className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-medium transition-colors ${
                  settings.receivingPermission === opt.value
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Auto-accept from trusted devices
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Skip manual confirmation prompts when a remembered trusted device sends files.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.autoAcceptTrusted}
            onChange={(e) => onUpdateSettings({ autoAcceptTrusted: e.target.checked })}
            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
        </label>
      </section>

      {/* Downloads & Storage */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <FolderDown className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Download Location &amp; Folder Handling
          </h2>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Destination folder
              </p>
              <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                {settings.downloadFolderLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleChooseDownloadLabel()}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              {folderEditorOpen ? 'Close Picker' : 'Change Folder'}
            </button>
          </div>

          {folderEditorOpen && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 p-3.5 space-y-3">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Choose mobile / browser save folder
              </p>
              <div className="flex flex-wrap gap-2">
                {(['Documents/Instrop', 'Downloads/Instrop', 'Browser Downloads'] as const).map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void applyPresetFolder(preset)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
                        settings.downloadFolderLabel === preset
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                          : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#111114] text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const cleaned = customFolderInput.trim();
                  if (!cleaned) return;
                  void applyPresetFolder(cleaned);
                }}
                className="flex flex-col sm:flex-row gap-2"
              >
                <input
                  type="text"
                  value={customFolderInput}
                  onChange={(e) => setCustomFolderInput(e.target.value)}
                  placeholder="Documents/Instrop"
                  aria-label="Custom folder path"
                  className="flex-1 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#111114] font-mono text-xs text-zinc-950 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium whitespace-nowrap"
                >
                  Apply Folder
                </button>
              </form>

              {isNativeCapacitorApp() && !hasCapacitorFilesystem() && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Tip: Install <code className="font-mono">@capacitor/filesystem</code> and run{' '}
                  <code className="font-mono">npx cap sync android</code> so Android saves straight into this folder.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Save behavior for incoming transfers
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { value: 'auto', label: 'Auto-Save Files' },
                { value: 'zip-folders', label: 'Auto-ZIP Folders' },
                { value: 'ask-location', label: 'Manual Save Button' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdateSettings({ saveMode: opt.value as SaveMode })}
                className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-medium transition-colors ${
                  settings.saveMode === opt.value
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Theme & Notifications */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Sun className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Appearance &amp; Notifications
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Laptop },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onUpdateSettings({ theme: value as ThemeMode })}
              className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 ${
                settings.theme === value
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.notificationsEnabled}
          onClick={() => void handleToggleNotifications()}
          className="w-full text-left flex items-center justify-between gap-4 pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70 min-h-[52px]"
        >
          <div className="flex items-start gap-2.5">
            <Bell className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Transfer notifications
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Notify when a device requests to send files or a transfer finishes.
              </p>
            </div>
          </div>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              settings.notificationsEnabled
                ? 'bg-indigo-600'
                : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                settings.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </span>
        </button>
      </section>

      {/* Network & Windows Startup */}
      <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <Network className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Network Preferences &amp; Local Startup
          </h2>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Streaming chunk size
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([64, 128, 256] as const).map((kb) => (
              <button
                key={kb}
                type="button"
                onClick={() => onUpdateSettings({ chunkSizeKb: kb })}
                className={`min-h-[40px] px-3 py-2 rounded-xl border font-mono text-xs font-medium transition-colors ${
                  settings.chunkSizeKb === kb
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                {kb} KB
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Local mDNS discovery (_instrop._tcp)
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Advertise and discover Instrop nodes on your Wi-Fi LAN without internet access.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.mdnsEnabled}
            onChange={(e) => onUpdateSettings({ mdnsEnabled: e.target.checked })}
            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
        </label>

        {lanUrls.length > 0 && (
          <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 space-y-1.5">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Local LAN addresses (open or enter on Android on same Wi-Fi)
            </p>
            <div className="flex flex-wrap gap-2">
              {lanUrls.map((url) => (
                <code
                  key={url}
                  className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-xs font-mono text-zinc-800 dark:text-zinc-200"
                >
                  {url}
                </code>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 cursor-pointer">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Launch Instrop automatically on Windows startup
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              On Windows 10/11, install this page as an Edge/Chrome app and enable &ldquo;Start app when you sign in&rdquo;, or add <code className="font-mono">npm run start</code> to <code className="font-mono">shell:startup</code>.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.windowsAutoStartConfigured}
            onChange={(e) =>
              onUpdateSettings({ windowsAutoStartConfigured: e.target.checked })
            }
            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
        </label>
      </section>

      {/* Trusted Devices Quick Revoke */}
      {trustedDevices.length > 0 && (
        <section className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#111114] p-5 sm:p-6 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Trusted Devices ({trustedDevices.length})
          </h2>
          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            {trustedDevices.map((dev) => (
              <div key={dev.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {dev.name}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {dev.os} · {dev.fingerprint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevokeTrusted(dev.id)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors inline-flex items-center gap-1.5 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
