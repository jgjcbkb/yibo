const defaultAllowedHosts = ['image.uglycat.cc'];

function responseHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store'
  };
}

function errorResponse(origin, status, message) {
  return new Response(message, {
    status,
    headers: { ...responseHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function validateTarget(raw, allowedHosts) {
  if (!raw || raw.length > 4096) throw Object.assign(new Error('Invalid URL'), { status: 400 });

  let target;
  try {
    target = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }

  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) {
    throw Object.assign(new Error('Only public HTTPS URLs are allowed'), { status: 400 });
  }
  if (!allowedHosts.has(target.hostname.toLowerCase())) {
    throw Object.assign(new Error('Media host is not allowed'), { status: 403 });
  }
  return target;
}

async function fetchMedia(target, init, allowedHosts, redirectsLeft = 3) {
  const upstream = await fetch(target, { ...init, redirect: 'manual' });
  const location = upstream.headers.get('location');
  if (![301, 302, 303, 307, 308].includes(upstream.status) || !location) return upstream;

  if (redirectsLeft <= 0) throw new Error('Too many upstream redirects');
  const redirected = validateTarget(new URL(location, target).toString(), allowedHosts);
  return fetchMedia(redirected, init, allowedHosts, redirectsLeft - 1);
}

export default async function handler(request) {
  const siteOrigin = new URL(request.url).origin;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== siteOrigin) {
    return errorResponse(siteOrigin, 403, 'Origin is not allowed');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(siteOrigin) });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(siteOrigin, 405, 'Method not allowed');
  }

  const range = request.headers.get('range');
  if (range && !/^bytes=\d*-\d*$/i.test(range)) {
    return errorResponse(siteOrigin, 400, 'Only a single byte range is allowed');
  }

  const configuredHosts = Netlify.env.get('ALLOWED_MEDIA_HOSTS');
  const allowedHosts = new Set((configuredHosts || defaultAllowedHosts.join(','))
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean));

  let target;
  try {
    target = validateTarget(new URL(request.url).searchParams.get('url'), allowedHosts);
  } catch (error) {
    return errorResponse(siteOrigin, error.status || 400, error.message);
  }

  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (compatible; YiboMediaProxy/1.0)',
    'Accept-Encoding': 'identity'
  });
  if (range) headers.set('Range', range);
  const ifRange = request.headers.get('if-range');
  if (ifRange) headers.set('If-Range', ifRange);

  try {
    const upstream = await fetchMedia(target, { method: request.method, headers }, allowedHosts);
    const forwardedHeaders = new Headers(responseHeaders(siteOrigin));
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) forwardedHeaders.set(name, value);
    }

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: forwardedHeaders
    });
  } catch (error) {
    return errorResponse(siteOrigin, 502, error.message || 'Upstream request failed');
  }
}

export const config = { path: '/proxy' };