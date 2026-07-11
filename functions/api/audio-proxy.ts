const ALLOWED_AUDIO_HOSTS = new Set([
  'ukr.radio',
  'www.ukr.radio',
  'ukr-radio.bgdn.dev',
]);

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range, content-type',
    ...extra,
  };
}

export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get('url')?.trim();
  if (!rawUrl) {
    return new Response('Missing url parameter', { status: 400, headers: corsHeaders() });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new Response('Invalid url parameter', { status: 400, headers: corsHeaders() });
  }

  if (target.protocol !== 'https:' || !ALLOWED_AUDIO_HOSTS.has(target.hostname)) {
    return new Response('Audio host is not allowed', { status: 403, headers: corsHeaders() });
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get('range');
  if (range) {
    upstreamHeaders.set('range', range);
  }
  upstreamHeaders.set('user-agent', 'meet-web-audio-proxy/1.0');

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: upstreamHeaders,
  });

  const headers = new Headers(corsHeaders());
  const passthrough = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
  ];
  for (const key of passthrough) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};
