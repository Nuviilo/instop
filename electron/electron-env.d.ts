declare module 'electron' {
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    autoHideMenuBar?: boolean;
    title?: string;
    backgroundColor?: string;
    icon?: string;
    show?: boolean;
    webPreferences?: {
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    static getAllWindows(): BrowserWindow[];
    isMinimized(): boolean;
    restore(): void;
    focus(): void;
    show(): void;
    loadURL(url: string): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    webContents: {
      setWindowOpenHandler(
        handler: (details: { url: string }) => { action: 'allow' | 'deny' }
      ): void;
    };
  }

  export const app: {
    requestSingleInstanceLock(): boolean;
    setAppUserModelId(id: string): void;
    whenReady(): Promise<void>;
    quit(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  };

  export const session: {
    defaultSession: {
      setPermissionRequestHandler(
        handler:
          | ((
              webContents: unknown,
              permission: string,
              callback: (granted: boolean) => void
            ) => void)
          | null
      ): void;
    };
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
  };
}
