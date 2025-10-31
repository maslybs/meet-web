import type { LiveKitEnv } from '../../src/server/livekit/env';
import { createParticipantToken } from '../../src/server/livekit/jwt';

function randomSuffix(length = 4) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function assertEnvConfigured(env: LiveKitEnv): asserts env is Required<LiveKitEnv> {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
    throw new Error('LiveKit environment not configured');
  }
}

export const onRequest: PagesFunction<LiveKitEnv> = async ({ request, env }) => {
  try {
    assertEnvConfigured(env);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Failed to validate environment';
    return new Response(message, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const room = url.searchParams.get('room');
    const name = url.searchParams.get('name') ?? 'user';

    if (!room) {
      return new Response('Missing room parameter', { status: 400 });
    }

    const identity = `${name}-${randomSuffix()}`;
    const token = await createParticipantToken(env, room, identity);

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
