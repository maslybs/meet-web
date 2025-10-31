import type { LiveKitEnv } from './env';

const encoder = new TextEncoder();

export const base64url = (source: string | ArrayBuffer | Uint8Array) => {
  let bytes: Uint8Array;
  if (typeof source === 'string') {
    bytes = encoder.encode(source);
  } else if (source instanceof Uint8Array) {
    bytes = source;
  } else {
    bytes = new Uint8Array(source);
  }
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function signHmac(secret: string, input: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return base64url(signature);
}

export function toHttpUrl(url: string) {
  if (url.startsWith('wss://')) return `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) return `http://${url.slice(5)}`;
  return url;
}

export async function createRoomAdminJwt(env: LiveKitEnv, room: string, ttlSeconds = 60 * 5) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: env.LIVEKIT_API_KEY,
      aud: 'livekit',
      iat: now,
      exp: now + ttlSeconds,
      video: {
        room,
        roomAdmin: true,
      },
    }),
  );
  const toSign = `${header}.${payload}`;
  const signature = await signHmac(env.LIVEKIT_API_SECRET, toSign);
  return `${toSign}.${signature}`;
}

export interface ParticipantAccess {
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

export async function createParticipantToken(
  env: LiveKitEnv,
  room: string,
  identity: string,
  ttlSeconds = 60 * 15,
  access: ParticipantAccess = { canPublish: true, canSubscribe: true, canPublishData: true },
) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: identity,
      aud: 'livekit',
      iat: now,
      exp: now + ttlSeconds,
      video: {
        room,
        roomJoin: true,
        ...access,
      },
    }),
  );
  const toSign = `${header}.${payload}`;
  const signature = await signHmac(env.LIVEKIT_API_SECRET, toSign);
  return `${toSign}.${signature}`;
}
