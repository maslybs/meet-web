import type { LiveKitAgentEnv } from '../../src/server/livekit/env';
import {
  buildDispatchContext,
  createAgentDispatch,
  deleteAgentDispatch,
  listAgentDispatches,
  listDispatches,
  listParticipants,
  removeAgentDispatch,
} from '../../src/server/livekit/dispatch';
import type { AgentDispatch } from '../../src/server/livekit/dispatch';

interface RequestPayload {
  room?: string;
  metadata?: string;
}

async function readPayload(request: Request): Promise<RequestPayload> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'DELETE') {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') ?? undefined;
    const rawMetadata = url.searchParams.get('metadata') ?? undefined;
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
    const metadata =
      rawMetadata && rawMetadata.trim() && rawMetadata.trim() !== '{}' && rawMetadata.trim() !== 'null'
        ? rawMetadata.trim()
        : undefined;
    return { room: payload.room, metadata };
  } catch {
    return {};
  }
}

function hasTimestamp(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'number') {
    return value > 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || normalized === '0') {
      return false;
    }
    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) {
      return numeric > 0;
    }
  }

  return Boolean(value);
}

function isActiveDispatch(dispatch: AgentDispatch): boolean {
  const deleted = hasTimestamp(dispatch.state?.deletedAt);
  return Boolean(dispatch.id && !deleted);
}

function normalizeAgentName(name?: string | null): string {
  return (name ?? '').trim().toLowerCase();
}

function getConfiguredAgentName(env: LiveKitAgentEnv): string | undefined {
  const candidate = env.LIVEKIT_AGENT_NAME ?? env.VOICE_AGENT_NAME;
  return candidate && candidate.trim() ? candidate.trim() : undefined;
}

function assertEnvConfigured(env: LiveKitAgentEnv): asserts env is Required<LiveKitAgentEnv> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
    throw new Error('LiveKit environment not configured');
  }
  if (!getConfiguredAgentName(env)) {
    throw new Error('Missing LIVEKIT_AGENT_NAME');
  }
}

export const onRequest: PagesFunction<LiveKitAgentEnv> = async ({ request, env }) => {
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    assertEnvConfigured(env);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Environment not configured', { status: 500 });
  }

  const agentName = getConfiguredAgentName(env)!;
  const { room, metadata } = await readPayload(request);
  if (!room) {
    return new Response('Missing required room parameter', { status: 400 });
  }

  try {
    if (method === 'GET') {
      const context = await buildDispatchContext(env, room);
      const allDispatches = await listDispatches(context, room);
      const normalizedAgentName = normalizeAgentName(agentName);
      console.log('dispatch:get:list', {
        room,
        agentName,
        total: allDispatches.length,
        dispatches: allDispatches,
      });
      const ours = allDispatches.filter((dispatch) => normalizeAgentName(dispatch.agentName) === normalizedAgentName);
      const active = ours.find(isActiveDispatch) ?? null;
      const participants = await listParticipants(context, room);
      const agentPresent = participants.some((participant) => {
        const identity = (participant.identity ?? '').trim();
        const normalizedIdentity = normalizeAgentName(identity);
        return normalizedIdentity === normalizedAgentName || normalizedIdentity.startsWith('agent-');
      });

      return Response.json({
        status: 'ok',
        active: Boolean(active ?? ours.find(isActiveDispatch)),
        agentPresent,
        dispatch: active,
        total: ours.length,
      });
    }

    if (method === 'POST') {
      const context = await buildDispatchContext(env, room);
      const allDispatches = await listDispatches(context, room);
      const normalizedAgentName = normalizeAgentName(agentName);
      console.log('dispatch:post:list-before', {
        room,
        agentName,
        total: allDispatches.length,
        dispatches: allDispatches,
      });

      const participants = await listParticipants(context, room);
      const agentPresent = participants.some((participant) => {
        const identity = (participant.identity ?? '').trim();
        const normalizedIdentity = normalizeAgentName(identity);
        return normalizedIdentity === normalizedAgentName || normalizedIdentity.startsWith('agent-');
      });

      // Remove other agents' dispatches to avoid conflicts.
      await Promise.all(
        allDispatches
          .filter(
            (dispatch) =>
              dispatch.agentName &&
              normalizeAgentName(dispatch.agentName) !== normalizedAgentName &&
              dispatch.id,
          )
          .map((dispatch) => deleteAgentDispatch(context, room, dispatch.id as string)),
      );

      const existing = await listAgentDispatches(context, room, agentName);
      const activeExisting = existing.find(isActiveDispatch);
      console.log('dispatch:post:existing', {
        room,
        agentName,
        total: existing.length,
        activeExisting,
        existing,
      });
      if (activeExisting) {
        return Response.json({
          status: 'ok',
          dispatch: activeExisting,
          active: true,
          reused: true,
          agentPresent,
        });
      }

      if (agentPresent) {
        return Response.json({
          status: 'ok',
          dispatch: null,
          active: true,
          reused: true,
          agentPresent: true,
        });
      }

      // Clean up any stale dispatches for this agent before creating a new one.
      await Promise.all(
        existing.filter((dispatch) => dispatch.id).map((dispatch) => deleteAgentDispatch(context, room, dispatch.id as string)),
      );

      let dispatch = await createAgentDispatch(context, room, agentName, metadata);

      if (!dispatch) {
        const refreshed = await listAgentDispatches(context, room, agentName);
        console.log('dispatch:post:refreshed', {
          room,
          agentName,
          total: refreshed.length,
          refreshed,
        });
        dispatch = refreshed.find((candidate) => candidate.id && !candidate.state?.deletedAt) ?? refreshed[0] ?? null;
      }

      const active = dispatch ? isActiveDispatch(dispatch) : false;
      console.log('dispatch:post:result', {
        room,
        agentName,
        dispatch,
        active,
        agentPresent,
      });

      return Response.json({ status: 'ok', dispatch, active, agentPresent: false });
    }

    const result = await removeAgentDispatch(env, room, agentName);
    return Response.json({ status: 'ok', removed: result.removed });
  } catch (error) {
    console.error('dispatch handler failed', error);
    const message = error instanceof Error ? error.message : 'Failed to manage dispatch';
    return new Response(message, { status: 502 });
  }
};
