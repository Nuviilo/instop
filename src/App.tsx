import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Clock,
  Home,
  Laptop,
  Moon,
  QrCode,
  Settings as SettingsIcon,
  Sun,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { NavTab } from './types/instrop';
import { useInstropEngine } from './hooks/useInstropEngine';
import { InstropMark } from './components/InstropLogo';
import { HomeView } from './components/HomeView';
import { DevicesView } from './components/DevicesView';
import { TransfersView } from './components/TransfersView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { PairingModal } from './components/PairingModal';
import { IncomingRequestModal } from './components/IncomingRequestModal';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'devices', label: 'Devices', icon: Laptop },
  { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const engine = useInstropEngine();
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [resolvedDark, setResolvedDark] = useState(false);

  // Sync Tailwind v4 .dark class with light / dark / system preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const isDark =
        engine.settings.theme === 'dark' ||
        (engine.settings.theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', isDark);
      setResolvedDark(isDark);
    };

    applyTheme();
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [engine.settings.theme]);

  // Keep selectedPeerId valid as peers connect/disconnect
  useEffect(() => {
    if (selectedPeerId && engine.nearbyPeers.some((p) => p.id === selectedPeerId)) {
      return;
    }
    if (engine.nearbyPeers.length > 0) {
      setSelectedPeerId(engine.nearbyPeers[0].id);
    } else {
      setSelectedPeerId(null);
    }
  }, [engine.nearbyPeers, selectedPeerId]);

  const activeTransferCount = engine.transfers.filter((t) =>
    ['awaiting-approval', 'transferring', 'paused', 'verifying'].includes(t.status)
  ).length;

  const toggleThemeQuick = () => {
    engine.updateSettings({ theme: resolvedDark ? 'light' : 'dark' });
  };

  const currentNavTitle = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Home';
  const topIncomingRequest = engine.incomingRequests[0] || null;

  return (
    <div className="min-h-screen bg-[#FAFAFB] dark:bg-[#09090B] text-[#09090B] dark:text-[#FAFAFA] flex flex-col md:flex-row">
      {/* Desktop Left Sidebar (Windows / Large Screens) */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-[#0C0C0F] z-30">
        <div className="h-14 px-5 flex items-center gap-2.5 border-b border-zinc-200/80 dark:border-zinc-800/80">
          <InstropMark className="w-7 h-7 shrink-0" />
          <span className="font-display text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap">
            Instrop
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`w-full min-h-[42px] px-3 py-2 rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                  active
                    ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Icon
                    className={`w-4 h-4 ${
                      active ? 'text-indigo-600 dark:text-indigo-400' : ''
                    }`}
                  />
                  {label}
                </span>
                {id === 'transfers' && activeTransferCount > 0 && (
                  <span className="font-mono text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
                    {activeTransferCount}
                  </span>
                )}
                {id === 'devices' && engine.nearbyPeers.length > 0 && (
                  <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {engine.nearbyPeers.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-zinc-200/80 dark:border-zinc-800/80">
          <button
            type="button"
            onClick={toggleThemeQuick}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              {resolvedDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              {resolvedDark ? 'Dark Theme' : 'Light Theme'}
            </span>
            <span className="text-[11px] text-zinc-400">Switch</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-60 flex flex-col min-h-screen">
        {/* Desktop Top Bar */}
        <header className="hidden md:flex h-14 px-8 items-center justify-between gap-8 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-[#FAFAFB]/80 dark:bg-[#09090B]/80 backdrop-blur-md sticky top-0 z-20">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap shrink-0">
            Instrop / <span className="text-zinc-950 dark:text-zinc-50">{currentNavTitle}</span>
          </p>

          <button
            type="button"
            onClick={() => setPairingOpen(true)}
            className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <QrCode className="w-3.5 h-3.5" />
            Pair Device
          </button>
        </header>

        {/* Mobile Top App Bar (Android / Compact Viewports with Safe-Area Support) */}
        <header className="md:hidden pt-[env(safe-area-inset-top)] border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-[#0C0C0F]/95 backdrop-blur-md sticky top-0 z-20">
          <div className="h-14 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <InstropMark className="w-6 h-6 shrink-0" />
              <span className="font-display text-sm font-bold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap">
                Instrop
              </span>
            </div>

            <button
              type="button"
              onClick={() => setPairingOpen(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <QrCode className="w-3.5 h-3.5" />
              Pair
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'home' && (
                <HomeView
                  deviceName={engine.settings.deviceName}
                  deviceOs={engine.deviceOs}
                  deviceType={engine.deviceType}
                  pairingCode={engine.selfDevice?.pairingCode}
                  connectionState={engine.connectionState}
                  connectionError={engine.connectionError}
                  lanUrls={engine.lanUrls}
                  serverOrigin={engine.serverOrigin}
                  onConnectToServer={engine.connectToServer}
                  nearbyPeers={engine.nearbyPeers}
                  trustedDevices={engine.trustedDevices}
                  selectedPeerId={selectedPeerId}
                  onSelectPeer={setSelectedPeerId}
                  onRenameSelf={(name) => engine.updateSettings({ deviceName: name })}
                  onOpenPairing={() => setPairingOpen(true)}
                  onSendFiles={(peer, files, isFolder, folderName) =>
                    void engine.sendFiles(peer, files, isFolder, folderName)
                  }
                  activeTransfers={engine.transfers}
                  history={engine.history}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'devices' && (
                <DevicesView
                  selfDevice={engine.selfDevice}
                  nearbyPeers={engine.nearbyPeers}
                  mdnsPeers={engine.mdnsPeers}
                  trustedDevices={engine.trustedDevices}
                  onOpenPairing={() => setPairingOpen(true)}
                  onPairByCode={engine.pairByCode}
                  onPairById={engine.pairById}
                  onTrustPeer={(peer) => engine.trustPeer(peer)}
                  onRenameTrusted={engine.renameTrustedDevice}
                  onRevokeTrusted={engine.revokeTrustedDevice}
                  onSendFiles={(peer, files, isFolder, folderName) =>
                    void engine.sendFiles(peer, files, isFolder, folderName)
                  }
                  onNavigateTransfers={() => setActiveTab('transfers')}
                />
              )}

              {activeTab === 'transfers' && (
                <TransfersView
                  transfers={engine.transfers}
                  incomingRequests={engine.incomingRequests}
                  onAcceptRequest={(req, trust) =>
                    void engine.acceptIncomingRequest(req, trust)
                  }
                  onDeclineRequest={(req) => engine.declineIncomingRequest(req)}
                  onPause={engine.pauseTransfer}
                  onResume={engine.resumeTransfer}
                  onCancel={engine.cancelTransfer}
                  onDownloadFile={(url, filename) =>
                    void engine.triggerDownload(url, filename, true)
                  }
                  onDownloadFolderZip={(id) => void engine.downloadFolderAsZip(id)}
                  onClearCompleted={engine.clearCompletedTransfers}
                  onGoHome={() => setActiveTab('home')}
                />
              )}

              {activeTab === 'history' && (
                <HistoryView
                  history={engine.history}
                  onClearHistory={engine.clearHistory}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  settings={engine.settings}
                  selfDevice={engine.selfDevice}
                  trustedDevices={engine.trustedDevices}
                  lanUrls={engine.lanUrls}
                  serverOrigin={engine.serverOrigin}
                  onConnectToServer={engine.connectToServer}
                  onUpdateSettings={engine.updateSettings}
                  onRevokeTrusted={engine.revokeTrustedDevice}
                  onNotify={engine.pushToast}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (5 Consistent Tabs + Safe-Area Support) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#0C0C0F]/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80"
        aria-label="Mobile navigation"
      >
        <div className="h-16 grid grid-cols-5 items-center">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative ${
                  active
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-full px-1">{label}</span>
                {id === 'transfers' && activeTransferCount > 0 && (
                  <span className="absolute top-1.5 right-3 font-mono text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {activeTransferCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals & Live Toasts */}
      <PairingModal
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        selfDevice={engine.selfDevice}
        lanUrls={engine.lanUrls}
        serverOrigin={engine.serverOrigin}
        isConnected={engine.connectionState === 'connected'}
        onConnectToServer={engine.connectToServer}
        onPairByCode={engine.pairByCode}
      />

      <IncomingRequestModal
        request={topIncomingRequest}
        onAccept={(req, trust) => void engine.acceptIncomingRequest(req, trust)}
        onDecline={(req) => engine.declineIncomingRequest(req)}
      />

      {engine.toasts.length > 0 && (
        <div
          className="fixed bottom-20 md:bottom-5 right-4 z-50 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
          aria-live="polite"
        >
          {engine.toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111114] shadow-lg px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p
                  className={`text-xs font-semibold ${
                    toast.tone === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : toast.tone === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : toast.tone === 'success'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-950 dark:text-zinc-50'
                  }`}
                >
                  {toast.title}
                </p>
                {toast.detail && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                    {toast.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => engine.dismissToast(toast.id)}
                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
