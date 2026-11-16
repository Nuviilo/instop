import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { startInstropServer } from '../server.ts';

let mainWindow: BrowserWindow | null = null;
let serverHandle: { port: number; close: () => void } | null = null;

function resolveAppPath(...segments: string[]): string {
  return path.resolve(__dirname, '..', ...segments);
}

function resolveAppIcon() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  const candidates = [
    resolveAppPath('build', 'icon.ico'),
    resolveAppPath('build', 'icon.png'),
    resolveAppPath('dist', 'instrop-icon.png'),
    resolveAppPath('public', 'instrop-icon.png'),
    path.join(resourcesPath, 'build', 'icon.ico'),
    path.join(resourcesPath, 'app.asar', 'build', 'icon.ico'),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        return img;
      }
      return candidate;
    }
  }
  return undefined;
}

async function bootServer(): Promise<{ port: number; close: () => void }> {
  const distDir = resolveAppPath('dist');
  try {
    return await startInstropServer({
      port: 3000,
      isProd: true,
      distDir,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE') {
      return await startInstropServer({
        port: 0,
        isProd: true,
        distDir,
      });
    }
    throw err;
  }
}

function createMainWindow(port: number) {
  const icon = resolveAppIcon();

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 380,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Instrop',
    backgroundColor: '#09090B',
    show: false,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (icon && typeof win.setIcon === 'function' && typeof icon !== 'string') {
    win.setIcon(icon);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  void win.loadURL(`http://127.0.0.1:${port}`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.instrop.app');

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media' || permission === 'notifications') {
        callback(true);
        return;
      }
      callback(false);
    });

    serverHandle = await bootServer();
    createMainWindow(serverHandle.port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
        createMainWindow(serverHandle.port);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    serverHandle?.close();
    serverHandle = null;
  });
}
