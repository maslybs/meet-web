import type { LiveKitEnv } from './env';
import { createRoomAdminJwt, toHttpUrl } from './jwt';

export interface DispatchContext {
  baseUrl: string;
  headers: Record<string, string>;
}

export type AgentDispatchState = {
  jobs?: Array<Record<string, unknown>>;
  createdAt?: string | number | null;
  deletedAt?: string | number | null;
};

export interface AgentDispatch {
  agentName?: string;
  id?: string;
  state?: AgentDispatchState;
}

export interface RoomParticipant {
  identity?: string;
  state?: Record<string, unknown> | null;
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

export async function buildDispatchContext(env: LiveKitEnv, room: string): Promise<DispatchContext> {
  const baseUrl = toHttpUrl(env.LIVEKIT_URL);
  const token = await createRoomAdminJwt(env, room);
  const headers = {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  return { baseUrl, headers };
}

export async function listDispatches(context: DispatchContext, room: string): Promise<AgentDispatch[]> {
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
  return data.agentDispatches ?? [];
}

export async function listAgentDispatches(context: DispatchContext, room: string, agentName: string) {
  const all = await listDispatches(context, room);
  return all.filter((dispatch) => dispatch.agentName === agentName);
}

export async function createAgentDispatch(
  context: DispatchContext,
  room: string,
  agentName: string,
  metadata?: string,
) {
  const response = await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/CreateDispatch`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({
      room,
      agentName,
      metadata,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(errBody || `CreateDispatch failed with status ${response.status}`);
  }

  const data = await parseJson<{ agentDispatch?: AgentDispatch }>(response);
  return data.agentDispatch ?? null;
}

export async function deleteAgentDispatch(context: DispatchContext, room: string, id: string) {
  const res = await fetch(`${context.baseUrl}/twirp/livekit.AgentDispatchService/DeleteDispatch`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({ room, dispatchId: id }),
  });

  if (!res.ok && res.status !== 404) {
    const errBody = await res.text();
    throw new Error(errBody || `DeleteDispatch failed with status ${res.status}`);
  }
}

export async function removeAgentDispatch(env: LiveKitEnv, room: string, agentName: string) {
  const context = await buildDispatchContext(env, room);
  const all = await listDispatches(context, room);
  const matches = all.filter((dispatch) => dispatch.agentName === agentName && dispatch.id);

  await Promise.all(
    matches.map((dispatch) => deleteAgentDispatch(context, room, dispatch.id as string)),
  );

  return { removed: matches.length };
}

export async function listParticipants(context: DispatchContext, room: string): Promise<RoomParticipant[]> {
  const res = await fetch(`${context.baseUrl}/twirp/livekit.RoomService/ListParticipants`, {
    method: 'POST',
    headers: context.headers,
    body: JSON.stringify({ room }),
  });

  if (!res.ok && res.status !== 404) {
    const errBody = await res.text();
    throw new Error(errBody || `ListParticipants failed with status ${res.status}`);
  }

  if (!res.ok) {
    return [];
  }

  const data = await parseJson<{ participants?: RoomParticipant[] }>(res);
  return data.participants ?? [];
}
