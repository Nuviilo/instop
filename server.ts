import express from 'express';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { PeerDevice, MdnsLanPeer, DeviceOS, DeviceType } from './src/types/instrop.ts';

const serverDir =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_IS_PROD = process.env.NODE_ENV === 'production';

interface ConnectedClient {
  ws: WebSocket;
  device: PeerDevice;
  networkGroup: string;
  trustedIds: Set<string>;
}

const clients = new Map<string, ConnectedClient>();
const pairedLinks = new Map<string, Set<string>>();
const mdnsDiscoveredPeers = new Map<string, MdnsLanPeer>();

function normalizeIp(rawIp: string | undefined): string {
  if (!rawIp) return 'unknown';
  let ip = rawIp.split(',')[0]?.trim() || 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip;
}

function isPrivateLanIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function computeNetworkGroup(ip: string): string {
  if (isPrivateLanIp(ip)) return 'local-lan';
  return `net-${ip}`;
}

function getLocalLanUrls(port: number): string[] {
  const interfaces = os.networkInterfaces();
  const urls: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

function addPairLink(idA: string, idB: string) {
  if (!pairedLinks.has(idA)) pairedLinks.set(idA, new Set());
  if (!pairedLinks.has(idB)) pairedLinks.set(idB, new Set());
  pairedLinks.get(idA)!.add(idB);
  pairedLinks.get(idB)!.add(idA);
}

function arePaired(idA: string, idB: string): boolean {
  return Boolean(pairedLinks.get(idA)?.has(idB));
}

function getVisiblePeersFor(targetClient: ConnectedClient): PeerDevice[] {
  const visible: PeerDevice[] = [];
  for (const [id, other] of clients.entries()) {
    if (id === targetClient.device.id) continue;
    if (other.ws.readyState !== WebSocket.OPEN) continue;

    const sameNetwork = other.networkGroup === targetClient.networkGroup;
    const paired = arePaired(targetClient.device.id, id);
    const trustedMutual =
      targetClient.trustedIds.has(id) || other.trustedIds.has(targetClient.device.id);

    if (sameNetwork || paired || trustedMutual) {
      visible.push({
        ...other.device,
        discoverySource: paired || trustedMutual ? 'paired' : 'lan',
        online: true,
      });
    }
  }
  return visible;
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastPeersToVisibleClients() {
  for (const client of clients.values()) {
    sendJson(client.ws, {
      type: 'peers:update',
      peers: getVisiblePeersFor(client),
      mdnsPeers: Array.from(mdnsDiscoveredPeers.values()),
    });
  }
}

function generateUniquePairingCode(): string {
  const existingCodes = new Set(Array.from(clients.values()).map((c) => c.device.pairingCode));
  for (let i = 0; i < 30; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!existingCodes.has(code)) return code;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function initMdnsService(port: number) {
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour();
    const hostName = os.hostname() || 'Instrop-Node';

    bonjour.publish({
      name: `Instrop (${hostName})`,
      type: 'instrop',
      port,
      txt: {
        protocol: 'instrop-v1',
        host: hostName,
      },
    });

    const browser = bonjour.find({ type: 'instrop' });
    browser.on('up', (service: { name: string; host: string; port: number; addresses?: string[]; txt?: Record<string, string> }) => {
      if (service.host === `${hostName}.local` || service.name === `Instrop (${hostName})`) {
        return;
      }
      mdnsDiscoveredPeers.set(service.name, {
        name: service.name,
        host: service.host,
        port: service.port,
        addresses: service.addresses || [],
        txt: service.txt,
      });
      broadcastPeersToVisibleClients();
    });

    browser.on('down', (service: { name: string }) => {
      if (mdnsDiscoveredPeers.delete(service.name)) {
        broadcastPeersToVisibleClients();
      }
    });
  } catch {
    // Multicast UDP may be unavailable inside restricted cloud containers; WebSocket LAN grouping remains active.
  }
}

export interface StartServerOptions {
  port?: number;
  isProd?: boolean;
  distDir?: string;
}

export async function startInstropServer(options: StartServerOptions = {}): Promise<{
  port: number;
  close: () => void;
}> {
  const port = options.port ?? DEFAULT_PORT;
  const isProd = options.isProd ?? DEFAULT_IS_PROD;
  const distPath = options.distDir || path.resolve(serverDir, 'dist');

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      connectedDevices: clients.size,
      mdnsPeers: mdnsDiscoveredPeers.size,
      timestamp: Date.now(),
    });
  });

  app.get('/api/network-info', (_req, res) => {
    res.json({
      lanUrls: getLocalLanUrls(port),
      hostname: os.hostname(),
      mdnsPeers: Array.from(mdnsDiscoveredPeers.values()),
    });
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress;
    const ip = normalizeIp(rawIp);
    const networkGroup = computeNetworkGroup(ip);
    let currentDeviceId: string | null = null;

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf.length < 4) return;
        const metaLen = buf.readUInt32BE(0);
        if (metaLen <= 0 || buf.length < 4 + metaLen) return;

        try {
          const metaStr = buf.subarray(4, 4 + metaLen).toString('utf8');
          const meta = JSON.parse(metaStr) as { type?: string; targetId?: string; senderId?: string };
          if (!meta.targetId || !currentDeviceId || meta.senderId !== currentDeviceId) return;

          const target = clients.get(meta.targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(buf, { binary: true });
          } else {
            sendJson(ws, {
              type: 'transfer:peer-offline',
              targetId: meta.targetId,
            });
          }
        } catch {
          // Malformed binary header ignored
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg.type as string | undefined;
      if (!type) return;

      if (type === 'device:register') {
        const deviceId = String(msg.id || '').trim();
        if (!deviceId) return;

        const existing = clients.get(deviceId);
        if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close(4001, 'Replaced by newer session');
        }

        const pairingCode =
          typeof msg.preferredPairingCode === 'string' && /^\d{6}$/.test(msg.preferredPairingCode)
            ? msg.preferredPairingCode
            : generateUniquePairingCode();

        const trustedArray = Array.isArray(msg.trustedIds)
          ? msg.trustedIds.filter((x): x is string => typeof x === 'string')
          : [];

        const device: PeerDevice = {
          id: deviceId,
          name: String(msg.name || 'Unnamed Device').slice(0, 48),
          os: (msg.os as DeviceOS) || 'Unknown',
          deviceType: (msg.deviceType as DeviceType) || 'desktop',
          pairingCode,
          publicKeyJwk: (msg.publicKeyJwk as JsonWebKey) || {},
          fingerprint: String(msg.fingerprint || ''),
          discoverySource: 'lan',
          ipHint: isPrivateLanIp(ip) ? ip : undefined,
          connectedAt: Date.now(),
          online: true,
        };

        currentDeviceId = deviceId;
        const clientRecord: ConnectedClient = {
          ws,
          device,
          networkGroup,
          trustedIds: new Set(trustedArray),
        };
        clients.set(deviceId, clientRecord);

        sendJson(ws, {
          type: 'device:registered',
          device,
          lanUrls: getLocalLanUrls(port),
          mdnsPeers: Array.from(mdnsDiscoveredPeers.values()),
        });

        broadcastPeersToVisibleClients();
        return;
      }

      if (!currentDeviceId) return;
      const sender = clients.get(currentDeviceId);
      if (!sender) return;

      if (type === 'device:update') {
        if (typeof msg.name === 'string' && msg.name.trim()) {
          sender.device.name = msg.name.trim().slice(0, 48);
        }
        if (Array.isArray(msg.trustedIds)) {
          sender.trustedIds = new Set(msg.trustedIds.filter((x): x is string => typeof x === 'string'));
        }
        broadcastPeersToVisibleClients();
        return;
      }

      if (type === 'pair:by-code') {
        const code = String(msg.code || '').trim();
        let matched: ConnectedClient | undefined;
        for (const candidate of clients.values()) {
          if (candidate.device.id !== currentDeviceId && candidate.device.pairingCode === code) {
            matched = candidate;
            break;
          }
        }
        if (!matched) {
          sendJson(ws, {
            type: 'pair:error',
            message: 'No active Instrop device found with that 6-digit code.',
          });
          return;
        }

        addPairLink(currentDeviceId, matched.device.id);
        sendJson(ws, {
          type: 'pair:established',
          peer: { ...matched.device, discoverySource: 'paired', online: true },
          initiatedByMe: true,
        });
        sendJson(matched.ws, {
          type: 'pair:established',
          peer: { ...sender.device, discoverySource: 'paired', online: true },
          initiatedByMe: false,
        });
        broadcastPeersToVisibleClients();
        return;
      }

      if (type === 'pair:by-id') {
        const targetId = String(msg.targetId || '').trim();
        const matched = clients.get(targetId);
        if (!matched || targetId === currentDeviceId) {
          sendJson(ws, {
            type: 'pair:error',
            message: 'Target device is not currently online.',
          });
          return;
        }
        addPairLink(currentDeviceId, matched.device.id);
        sendJson(ws, {
          type: 'pair:established',
          peer: { ...matched.device, discoverySource: 'paired', online: true },
          initiatedByMe: true,
        });
        sendJson(matched.ws, {
          type: 'pair:established',
          peer: { ...sender.device, discoverySource: 'paired', online: true },
          initiatedByMe: false,
        });
        broadcastPeersToVisibleClients();
        return;
      }

      const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
      if (targetId) {
        const target = clients.get(targetId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, {
            ...msg,
            senderId: currentDeviceId,
            senderDevice: sender.device,
          });
        } else if (type.startsWith('transfer:')) {
          sendJson(ws, {
            type: 'transfer:peer-offline',
            transferId: msg.transferId,
            targetId,
          });
        }
      }
    });

    ws.on('close', () => {
      if (currentDeviceId) {
        const existing = clients.get(currentDeviceId);
        if (existing && existing.ws === ws) {
          clients.delete(currentDeviceId);
          broadcastPeersToVisibleClients();
        }
      }
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve(actualPort);
    });
  });

  console.log(`Instrop server running at http://0.0.0.0:${boundPort}`);
  void initMdnsService(boundPort);

  return {
    port: boundPort,
    close: () => {
      wss.close();
      server.close();
    },
  };
}

if (!process.versions?.electron) {
  void startInstropServer();
}
