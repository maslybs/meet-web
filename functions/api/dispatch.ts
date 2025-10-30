interface Env {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  LIVEKIT_URL: string;
  LIVEKIT_AGENT_NAME?: string;
}

interface DispatchContext {
  baseUrl: string;
  headers: Record<string, string>;
}

type AgentDispatchState = {
  jobs?: Array<Record<string, unknown>>;
  createdAt?: string | number | null;
  deletedAt?: string | number | null;
};

type AgentDispatch = { agentName?: string; id?: string; state?: AgentDispatchState };

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
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return base64url(signature);
}

function toHttpUrl(url: string) {
  if (url.startsWith('wss://')) return `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) return `http://${url.slice(5)}`;
  return url;
}

async function createRoomAdminJwt(env: Env, room: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: env.LIVEKIT_API_KEY,
      aud: 'livekit',
      iat: now,
      exp: now + 60 * 5,
      video: {
        room,
        roomAdmin: true,
      },
    }),
  );
  const toSign = `${header}.${payload}`;
  const signature = await sign(env.LIVEKIT_API_SECRET, toSign);
  return `${toSign}.${signature}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected response: ${text}`);
  }
}

async function buildDispatchContext(env: Env, room: string): Promise<DispatchContext> {
  const baseUrl = toHttpUrl(env.LIVEKIT_URL);
  const token = await createRoomAdminJwt(env, room);
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  return { baseUrl, headers };
}

async function listAgentDispatches(
  context: DispatchContext,
  room: string,
  agentName: string,
): Promise<AgentDispatch[]> {
  const listRes = await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/ListDispatch`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({ room }),
  });

  if (!listRes.ok && listRes.status !== 404) {
    const errBody = await listRes.text();
    throw new Error(errBody || `ListDispatch failed with status ${listRes.status}`);
  }

  if (!listRes.ok) {
    return [];
  }

  const data = await parseJson<{ agentDispatches?: AgentDispatch[] }>(listRes);
  return (data.agentDispatches ?? []).filter((dispatch) => dispatch.agentName === agentName);
}

async function createAgentDispatch(
  context: DispatchContext,
  room: string,
  agentName: string,
  metadata?: string,
) {
  const payload: Record<string, unknown> = {
    agentName,
    room,
  };

  if (metadata && metadata.trim()) {
    payload.metadata = metadata;
  }

  const createRes = await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/CreateDispatch`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    throw new Error(errBody || `CreateDispatch failed with status ${createRes.status}`);
  }

  return parseJson(createRes);
}

async function removeDispatch(env: Env, room: string, agentName: string) {
  const context = await buildDispatchContext(env, room);

  const listRes = await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/ListDispatch`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({ room }),
  });

  if (!listRes.ok && listRes.status !== 404) {
    const errBody = await listRes.text();
    throw new Error(errBody || `ListDispatch failed with status ${listRes.status}`);
  }

  if (!listRes.ok) {
    return { removed: 0 };
  }

  const data = await parseJson<{ agentDispatches?: AgentDispatch[] }>(listRes);
  const matches = (data.agentDispatches ?? []).filter(
    (dispatch) => dispatch.agentName === agentName && dispatch.id,
  );

  await Promise.all(
    matches.map((dispatch) =>
      fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/DeleteDispatch`, {
        method: 'POST',
        headers: context.headers,
        body: JSON.stringify({ room, dispatchId: dispatch.id }),
      }).then(async (res) => {
        if (!res.ok && res.status !== 404) {
          const errBody = await res.text();
          throw new Error(errBody || `DeleteDispatch failed with status ${res.status}`);
        }
      }),
    ),
  );

  return { removed: matches.length };
}

async function readPayload(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    const rawMetadata = url.searchParams.get('metadata');
    return {
      room,
      metadata:
        rawMetadata && rawMetadata.trim() && rawMetadata.trim() !== '{}' && rawMetadata.trim() !== 'null'
          ? rawMetadata.trim()
          : undefined,
    };
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    const payload = (await request.json()) as { room?: string; metadata?: string | null };
    const rawMetadata = typeof payload.metadata === 'string' ? payload.metadata : undefined;
    const metadata = rawMetadata && rawMetadata.trim() && rawMetadata.trim() !== '{}' && rawMetadata.trim() !== 'null'
      ? rawMetadata.trim()
      : undefined;
    return { room: payload.room, metadata };
  } catch {
    return {};
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const method = request.method.toUpperCase();
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
    return new Response('LiveKit environment not configured', { status: 500 });
  }

  const agentName = (env.LIVEKIT_AGENT_NAME ?? 'hanna-agent').trim();
  if (!agentName) {
    return new Response('Missing LIVEKIT_AGENT_NAME', { status: 500 });
  }

  if (method !== 'POST' && method !== 'DELETE') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { room, metadata } = await readPayload(request);
  if (!room) {
    return new Response('Missing required room parameter', { status: 400 });
  }

  try {
    if (method === 'POST') {
      const context = await buildDispatchContext(env, room);
      const existingList = await listAgentDispatches(context, room, agentName);

      for (const existing of existingList) {
        const jobCount = existing.state?.jobs?.length ?? 0;
        const deleted = Boolean(existing.state?.deletedAt);
        if (jobCount > 0 && !deleted) {
          return Response.json({ status: 'ok', dispatch: existing, reused: true });
        }

        if (existing.id) {
          await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/DeleteDispatch`, {
            method: 'POST',
            headers: context.headers,
            body: JSON.stringify({ room, dispatchId: existing.id }),
          }).catch((err) => {
            console.warn('Failed to delete stale dispatch', err);
          });
        }
      }

      const dispatch = await createAgentDispatch(context, room, agentName, metadata ?? undefined);
      return Response.json({ status: 'ok', dispatch });
    }

    const result = await removeDispatch(env, room, agentName);
    return Response.json({ status: 'ok', removed: result.removed });
  } catch (error) {
    console.error('dispatch handler failed', error);
    const message = error instanceof Error ? error.message : 'Failed to manage dispatch';
    return new Response(message, { status: 502 });
  }
};
