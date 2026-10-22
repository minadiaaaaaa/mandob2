// Public API gateway for a Cloudflare Workers VPC Service backed by the local
// Express server. The VPC binding is created on the Cloudflare account.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) headers.set('x-forwarded-for', clientIp);
    headers.set('x-forwarded-proto', 'https');

    const target = new URL(url.pathname + url.search, 'http://127.0.0.1:4000');
    try {
      return await env.MANDOOB_API.fetch(new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      }));
    } catch {
      return new Response('API unavailable', { status: 503 });
    }
  },
};
