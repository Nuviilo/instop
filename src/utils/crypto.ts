// End-to-End Encryption (ECDH P-256 + AES-256-GCM) and Incremental Streaming SHA-256

export interface DeviceKeyIdentity {
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}

export async function generateDeviceKeyIdentity(): Promise<DeviceKeyIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  const fingerprint = `${hex.slice(0, 4)} · ${hex.slice(4, 8)} · ${hex.slice(8, 12)} · ${hex.slice(12, 16)}`;

  return { keyPair, publicKeyJwk, fingerprint };
}

export async function deriveSharedAesKey(
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptChunk(
  aesKey: CryptoKey,
  plaintext: ArrayBuffer | Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
  const copy = new Uint8Array(plainBytes.byteLength);
  copy.set(plainBytes);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    copy
  );
  return {
    iv,
    ciphertext: new Uint8Array(encrypted),
  };
}

export async function decryptChunk(
  aesKey: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const ivCopy = new Uint8Array(iv.byteLength);
  ivCopy.set(iv);
  const cipherCopy = new Uint8Array(ciphertext.byteLength);
  cipherCopy.set(ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivCopy },
    aesKey,
    cipherCopy
  );
  return new Uint8Array(decrypted);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// Binary Wire Frame: [4-byte BE metaLen][UTF-8 JSON meta][raw ciphertext bytes]
export function packBinaryChunkFrame(
  meta: Record<string, unknown>,
  ciphertext: Uint8Array
): Uint8Array<ArrayBuffer> {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const ab = new ArrayBuffer(4 + metaBytes.length + ciphertext.length);
  const out = new Uint8Array(ab);
  const view = new DataView(ab);
  view.setUint32(0, metaBytes.length, false);
  out.set(metaBytes, 4);
  out.set(ciphertext, 4 + metaBytes.length);
  return out;
}

export function unpackBinaryChunkFrame(
  buffer: ArrayBuffer
): { meta: Record<string, unknown>; ciphertext: Uint8Array } | null {
  if (buffer.byteLength < 4) return null;
  const view = new DataView(buffer);
  const metaLen = view.getUint32(0, false);
  if (metaLen <= 0 || buffer.byteLength < 4 + metaLen) return null;
  try {
    const metaBytes = new Uint8Array(buffer, 4, metaLen);
    const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as Record<string, unknown>;
    const ciphertext = new Uint8Array(buffer, 4 + metaLen);
    return { meta, ciphertext };
  } catch {
    return null;
  }
}

// Streaming Incremental SHA-256 (RFC 6234) — O(1) memory footprint for multi-GB files
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class StreamingSha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private totalBytes = 0;
  private w = new Uint32Array(64);

  update(chunk: Uint8Array): void {
    let offset = 0;
    this.totalBytes += chunk.length;

    if (this.blockLen > 0) {
      const needed = 64 - this.blockLen;
      if (chunk.length < needed) {
        this.block.set(chunk, this.blockLen);
        this.blockLen += chunk.length;
        return;
      }
      this.block.set(chunk.subarray(0, needed), this.blockLen);
      this.compress(this.block, 0);
      this.blockLen = 0;
      offset = needed;
    }

    while (offset + 64 <= chunk.length) {
      this.compress(chunk, offset);
      offset += 64;
    }

    if (offset < chunk.length) {
      const rem = chunk.length - offset;
      this.block.set(chunk.subarray(offset), 0);
      this.blockLen = rem;
    }
  }

  digestHex(): string {
    const bitLen = this.totalBytes * 8;
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const finalBuf = new Uint8Array(this.blockLen + padLen + 8);
    finalBuf.set(this.block.subarray(0, this.blockLen), 0);
    finalBuf[this.blockLen] = 0x80;

    const highBits = Math.floor(bitLen / 0x100000000);
    const lowBits = bitLen >>> 0;
    const view = new DataView(finalBuf.buffer);
    view.setUint32(finalBuf.length - 8, highBits, false);
    view.setUint32(finalBuf.length - 4, lowBits, false);

    for (let off = 0; off < finalBuf.length; off += 64) {
      this.compress(finalBuf, off);
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += this.h[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];

    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}
