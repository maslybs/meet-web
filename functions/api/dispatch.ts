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

function normalizeRoom(room?: string | null): string {
  return room?.trim() ?? '';
}

function parseDispatchMetadata(raw?: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractGeminiToken(metadata?: Record<string, unknown> | null): string {
  const raw = metadata?.['gemini_api_key'];
  if (typeof raw === 'string') {
    return raw.trim();
  }
  return '';
}

function getTokenlessRooms(env: LiveKitAgentEnv) {
  const defaultRoom = normalizeRoom(env.VITE_DEFAULT_ROOM ?? env.VOICE_AGENT_DEFAULT_ROOM ?? null);
  const demoRoom = normalizeRoom(env.VITE_DEMO_ROOM ?? env.VOICE_AGENT_DEMO_ROOM ?? null);
  return { defaultRoom, demoRoom };
}

function isTokenOptionalRoom(env: LiveKitAgentEnv, room?: string | null) {
  const normalizedRoom = normalizeRoom(room);
  if (!normalizedRoom) {
    return false;
  }

  const { defaultRoom, demoRoom } = getTokenlessRooms(env);

  if (defaultRoom && normalizedRoom === defaultRoom) {
    return true;
  }
  if (demoRoom && normalizedRoom === demoRoom) {
    return true;
  }
  // Allow explicit "demo-room" fallback like the frontend
  if (normalizedRoom === 'demo-room') {
    return true;
  }

  return false;
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

type UnknownRecord = Record<string, unknown>;

const JOB_STATUS_BY_NUMBER: Record<number, string> = {
  0: 'JS_PENDING',
  1: 'JS_RUNNING',
  2: 'JS_SUCCESS',
  3: 'JS_FAILED',
};

function normalizeStatus(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().toUpperCase() || null;
  }
  if (typeof value === 'number') {
    return JOB_STATUS_BY_NUMBER[value] ?? null;
  }
  return null;
}

function pickTimestamp(state: UnknownRecord | null | undefined): number {
  if (!state) {
    return 0;
  }
  const candidates = [
    state.updatedAt,
    state.updated_at,
    state.endedAt,
    state.ended_at,
    state.startedAt,
    state.started_at,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const numeric = Number(candidate);
      if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
        return numeric;
      }
      const iso = Date.parse(candidate);
      if (!Number.isNaN(iso)) {
        return iso;
      }
    }
  }

  return 0;
}

function getJobState(job: unknown): UnknownRecord | null {
  if (!job || typeof job !== 'object') {
    return null;
  }
  const state = (job as UnknownRecord).state;
  if (!state || typeof state !== 'object') {
    return null;
  }
  return state as UnknownRecord;
}

function getJobs(dispatch: AgentDispatch): UnknownRecord[] {
  const jobs = dispatch.state?.jobs;
  if (!Array.isArray(jobs)) {
    return [];
  }
  return jobs.filter((job): job is UnknownRecord => Boolean(job) && typeof job === 'object');
}

function isActiveDispatch(dispatch: AgentDispatch): boolean {
  const deleted = Boolean(dispatch.state?.deletedAt);
  if (deleted) {
    return false;
  }
  const jobs = getJobs(dispatch);
  if (jobs.length === 0) {
    return false;
  }
  return jobs.some((job) => {
    const status = normalizeStatus(getJobState(job)?.status);
    return status === 'JS_RUNNING' || status === 'JS_PENDING';
  });
}

interface DispatchErrorInfo {
  code: string;
  message: string;
  detail?: string | null;
}

const DEFAULT_ERROR_CODE = 'dispatch_failed';

function deriveErrorCode(detail?: string | null): string {
  if (!detail) {
    return DEFAULT_ERROR_CODE;
  }
  const normalized = detail.toLowerCase();
  if (normalized.includes('api key not valid')) {
    return 'invalid_api_key';
  }
  if (normalized.includes('not entitled') || normalized.includes('permission')) {
    return 'permission_denied';
  }
  return DEFAULT_ERROR_CODE;
}

function buildUserMessage(code: string, detail?: string | null): string {
  switch (code) {
    case 'invalid_api_key':
      return 'Неправильний LLM токен. Перевірте налаштування і спробуйте ще раз.';
    case 'permission_denied':
      return 'Немає дозволу на використання цього LLM. Зверніться до адміністратора.';
    default: {
      const fallback = 'Не вдалося запустити ШІ помічника. Спробуйте ще раз пізніше.';
      if (detail) {
        return `${fallback} (${detail})`;
      }
      return fallback;
    }
  }
}

function extractDispatchError(dispatches: AgentDispatch[]): DispatchErrorInfo | null {
  const jobs = dispatches.flatMap((dispatch) => getJobs(dispatch));
  if (jobs.length === 0) {
    return null;
  }

  const sorted = [...jobs].sort((a, b) => pickTimestamp(getJobState(b)) - pickTimestamp(getJobState(a)));
  const failed = sorted.find((job) => normalizeStatus(getJobState(job)?.status) === 'JS_FAILED');
  if (!failed) {
    return null;
  }

  const failedTimestamp = pickTimestamp(getJobState(failed));
  const newerActiveJobExists = sorted.some((job) => {
    if (job === failed) {
      return false;
    }
    const state = getJobState(job);
    const status = normalizeStatus(state?.status);
    if (status !== 'JS_RUNNING' && status !== 'JS_PENDING') {
      return false;
    }
    return pickTimestamp(state) >= failedTimestamp;
  });
  if (newerActiveJobExists) {
    return null;
  }

  const state = getJobState(failed);
  const detailRaw = state?.error;
  const detail = typeof detailRaw === 'string' && detailRaw.trim() ? detailRaw.trim() : null;
  const code = deriveErrorCode(detail);
  return {
    code,
    message: buildUserMessage(code, detail),
    detail,
  };
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
  const { room, metadata: rawMetadata } = await readPayload(request);
  if (!room) {
    return new Response('Missing required room parameter', { status: 400 });
  }

  const parsedMetadata = parseDispatchMetadata(rawMetadata);
  const geminiApiKey = extractGeminiToken(parsedMetadata);
  const tokenOptionalRoom = isTokenOptionalRoom(env, room);

  try {
    if (method === 'GET') {
      const context = await buildDispatchContext(env, room);
      const allDispatches = await listDispatches(context, room);
      const ours = allDispatches.filter((dispatch) => dispatch.agentName === agentName);
      const active = ours.find(isActiveDispatch) ?? null;
      const dispatchError = extractDispatchError(ours);
      const participants = await listParticipants(context, room);
      const agentPresent = participants.some((participant) => {
        const identity = (participant.identity ?? '').trim();
        return identity === agentName || identity.startsWith('agent-');
      });

      return Response.json({
        status: 'ok',
        active: Boolean(active),
        agentPresent,
        dispatch: active,
        total: ours.length,
        error: dispatchError?.message ?? null,
        errorCode: dispatchError?.code ?? null,
        errorDetail: dispatchError?.detail ?? null,
      });
    }

    if (method === 'POST') {
      if (!tokenOptionalRoom && !geminiApiKey) {
        return new Response('LLM токен обов’язковий для цієї кімнати.', { status: 400 });
      }

      const context = await buildDispatchContext(env, room);
      const allDispatches = await listDispatches(context, room);

      const participants = await listParticipants(context, room);
      const agentPresent = participants.some((participant) => {
        const identity = (participant.identity ?? '').trim();
        return identity === agentName || identity.startsWith('agent-');
      });

      // Remove other agents' dispatches to avoid conflicts.
      await Promise.all(
        allDispatches
          .filter((dispatch) => dispatch.agentName && dispatch.agentName !== agentName && dispatch.id)
          .map((dispatch) => deleteAgentDispatch(context, room, dispatch.id as string)),
      );

      const existing = await listAgentDispatches(context, room, agentName);
      const activeExisting = existing.find(isActiveDispatch);
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
        existing
          .filter((dispatch) => dispatch.id)
          .map((dispatch) => deleteAgentDispatch(context, room, dispatch.id as string)),
      );

      const dispatch = await createAgentDispatch(context, room, agentName, rawMetadata);
      return Response.json({ status: 'ok', dispatch, active: true, agentPresent: false });
    }

    const result = await removeAgentDispatch(env, room, agentName);
    return Response.json({ status: 'ok', removed: result.removed });
  } catch (error) {
    console.error('dispatch handler failed', error);
    const message = error instanceof Error ? error.message : 'Failed to manage dispatch';
    return new Response(message, { status: 502 });
  }
};
