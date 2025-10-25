interface Env {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  LIVEKIT_URL: string;
}

const encoder = new TextEncoder();

const base64url = (source: string | ArrayBuffer) => {
  let bytes: Uint8Array;
  if (typeof source === 'string') {
    bytes = encoder.encode(source);
  } else {
    bytes = new Uint8Array(source);
  }
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function sign(secret: string, input: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return base64url(signature);
}

async function createToken(env: Env, room: string, identity: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: identity,
      aud: 'livekit',
      iat: now,
      exp: now + 60 * 15,
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    }),
  );
  const toSign = `${header}.${payload}`;
  const signature = await sign(env.LIVEKIT_API_SECRET, toSign);
  return `${toSign}.${signature}`;
}

function randomSuffix(length = 4) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    const name = url.searchParams.get('name') ?? 'user';

    if (!room) {
      return new Response('Missing room parameter', { status: 400 });
    }
    if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
      return new Response('LiveKit environment not configured', { status: 500 });
    }

    const identity = `${name}-${randomSuffix()}`;
    const token = await createToken(env, room, identity);

    return Response.json({
      token,
      serverUrl: env.LIVEKIT_URL,
      identity,
    });
  } catch (err) {
    console.error('Token generation failed', err);
    return new Response('Failed to generate token', { status: 500 });
  }
};
