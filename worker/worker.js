/**
 * Health Tracker Sync Worker
 * Cloudflare Worker + R2 存储
 * 替代 GitHub API 同步方案
 */

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /health — 健康检查
      if (path === '/health' && request.method === 'GET') {
        return json({ status: 'ok', timestamp: Date.now() });
      }

      // GET /data/:userId — 读取用户数据（无需认证）
      const dataMatch = path.match(/^\/data\/([a-zA-Z0-9_-]+)$/);
      if (dataMatch) {
        const userId = dataMatch[1];

        if (request.method === 'GET') {
          const obj = await env.DATA_BUCKET.get(`data/${userId}.json`);
          if (!obj) {
            return json({ exists: false, data: null });
          }
          const data = await obj.json();
          return json({ exists: true, data });
        }

        // PUT /data/:userId — 写入用户数据（需 PIN 认证）
        if (request.method === 'PUT') {
          const pin = request.headers.get('X-Pin') || '';
          if (pin !== env.AUTH_PIN) {
            return json({ error: 'PIN 验证失败' }, 401);
          }

          const body = await request.json();
          await env.DATA_BUCKET.put(
            `data/${userId}.json`,
            JSON.stringify(body, null, 2),
            { httpMetadata: { contentType: 'application/json' } }
          );
          return json({ ok: true, timestamp: Date.now() });
        }
      }

      return json({ error: 'Not Found' }, 404);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: e.message || 'Internal Server Error' }, 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
