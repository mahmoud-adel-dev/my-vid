/**
 * Course Portal API - Cloudflare Worker + Cloudinary Video Storage.
 * Secrets: ADMIN_PASSWORD, STUDENT_PASSWORD, TOKEN_SECRET, CLOUDINARY_API_SECRET
 * Vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_URL, ALLOWED_ORIGIN
 */
const encoder = new TextEncoder();
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const VALID_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogg']);

let cachedClockOffset = 0;
let lastSync = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function getCloudinaryConfig(env) {
  let cloudName = env.CLOUDINARY_CLOUD_NAME || env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  let apiKey = env.CLOUDINARY_API_KEY;
  let apiSecret = env.CLOUDINARY_API_SECRET;
  if (env.CLOUDINARY_URL) {
    try {
      const u = new URL(env.CLOUDINARY_URL);
      if (u.protocol === 'cloudinary:') {
        apiKey = apiKey || decodeURIComponent(u.username);
        apiSecret = apiSecret || decodeURIComponent(u.password);
        cloudName = cloudName || u.hostname;
      }
    } catch {}
  }
  return { cloudName, apiKey, apiSecret };
}

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', encoder.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getTimestamp() {
  const now = Date.now();
  if (now - lastSync > 1800_000) {
    try {
      const res = await fetch('https://api.cloudinary.com', { method: 'HEAD' });
      const dateHeader = res.headers.get('date');
      if (dateHeader) {
        cachedClockOffset = new Date(dateHeader).getTime() - now;
        lastSync = now;
      }
    } catch {}
  }
  return Math.floor((Date.now() + cachedClockOffset) / 1000);
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  if (!allowed.includes(origin) && !local) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Location',
    'Access-Control-Max-Age': '7200',
    'Vary': 'Origin'
  };
}

function originAllowed(origin, env) {
  if (!origin) return true; // Direct browser navigations / <video> tags
  return Boolean(corsHeaders(origin, env)['Access-Control-Allow-Origin']);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unbase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function makeToken(role, env) {
  const expire = Date.now() + (role === 'admin' ? 8 : 24) * 3600_000;
  const data = base64url(encoder.encode(JSON.stringify({ role, expire })));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.TOKEN_SECRET), encoder.encode(data)));
  return { token: `${data}.${base64url(mac)}`, expiresAt: expire, role };
}

async function verifyToken(token, env) {
  if (!token || !env.TOKEN_SECRET || token.length > 2048) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env.TOKEN_SECRET), unbase64url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
    return (['admin', 'student'].includes(payload.role) && Number.isFinite(payload.expire) && payload.expire > Date.now()) ? payload : null;
  } catch { return null; }
}

function bearer(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  return match?.[1];
}

function validKey(key) {
  return typeof key === 'string' &&
    key.length > 0 &&
    key.length < 500 &&
    !key.includes('..') &&
    /^[a-zA-Z0-9_\-\.\/]+$/.test(key);
}

function originalFilename(name) {
  return String(name || '').replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 180) || 'Video';
}

function parseKeyFromPath(path, prefix) {
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch { return ''; }
}

async function getBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function listVideos(env) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig(env);
  if (!cloudName || !apiKey || !apiSecret) {
    return json({ error: 'Cloudinary credentials missing in worker environment.' }, 503);
  }

  let cursor;
  const all = [];
  const basicAuth = btoa(`${apiKey}:${apiSecret}`);

  do {
    const url = new URL(`https://api.cloudinary.com/v1_1/${cloudName}/resources/video`);
    url.searchParams.set('max_results', '500');
    url.searchParams.set('context', 'true');
    if (cursor) url.searchParams.set('next_cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Cloudinary API error ${res.status}`);
    }

    const data = await res.json();
    if (Array.isArray(data.resources)) {
      for (const f of data.resources) {
        all.push({
          key: f.public_id,
          name: f.context?.custom?.name || f.display_name || f.public_id.split('/').pop(),
          size: f.bytes || 0,
          uploaded: f.created_at,
          type: f.format ? `video/${f.format}` : 'video/mp4',
          url: f.secure_url,
          duration: f.duration || null
        });
      }
    }
    cursor = data.next_cursor;
  } while (cursor && all.length < 2500);

  all.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return json({ videos: all });
}

function mediaResponse(env, key, download) {
  if (!validKey(key)) return json({ error: 'Invalid video' }, 400);
  const { cloudName } = getCloudinaryConfig(env);
  if (!cloudName) return json({ error: 'Cloudinary configuration missing' }, 503);

  const cleanKey = key.replace(/^\/+/, '');
  const prefix = download ? 'fl_attachment/' : '';
  const cldUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${prefix}${encodeURI(cleanKey)}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: cldUrl,
      'Cache-Control': 'private, no-store'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!originAllowed(origin, env)) return json({ error: 'Origin not allowed. Configure ALLOWED_ORIGIN.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env) });

    let response;
    try {
      const { cloudName, apiKey, apiSecret } = getCloudinaryConfig(env);
      if (!cloudName || !apiKey || !apiSecret || !env.ADMIN_PASSWORD || !env.STUDENT_PASSWORD || !env.TOKEN_SECRET) {
        response = json({ error: 'Worker setup incomplete: configure Cloudinary credentials and three secrets.' }, 503);
      } else if (request.method === 'GET' && url.pathname === '/api/health') {
        response = json({ ok: true, service: 'Course Portal API', storage: 'Cloudinary', cloudName });
      } else if (request.method === 'POST' && url.pathname === '/api/login') {
        const body = await getBody(request);
        const role = body?.role;
        if (role !== 'admin' && role !== 'student') {
          response = json({ error: 'Invalid role' }, 400);
        } else {
          const pass = String(body?.password || '');
          const desired = role === 'admin' ? env.ADMIN_PASSWORD : env.STUDENT_PASSWORD;
          response = pass.length >= 10 && pass === desired ? json(await makeToken(role, env)) : json({ error: 'كلمة المرور غير صحيحة' }, 401);
        }
      } else {
        const token = url.pathname.startsWith('/api/media/') ? url.searchParams.get('token') : bearer(request);
        const session = await verifyToken(token, env);
        if (!session) {
          response = json({ error: 'يجب تسجيل الدخول مرة أخرى' }, 401);
        } else if (request.method === 'GET' && url.pathname === '/api/videos') {
          response = await listVideos(env);
        } else if (request.method === 'GET' && url.pathname.startsWith('/api/media/')) {
          const key = parseKeyFromPath(url.pathname, '/api/media/');
          response = mediaResponse(env, key, url.searchParams.get('download') === '1');
        } else if (session.role !== 'admin') {
          response = json({ error: 'هذه العملية متاحة للإدارة فقط' }, 403);
        } else if (request.method === 'POST' && url.pathname === '/api/upload/sign') {
          const body = await getBody(request);
          const name = originalFilename(body?.name);
          const ext = name.split('.').pop().toLowerCase();
          const size = Number(body?.size);
          if (!VALID_EXTENSIONS.has(ext) || !Number.isSafeInteger(size) || size < 1 || size > MAX_SIZE) {
            response = json({ error: 'صيغة الملف غير مدعومة أو الحجم أكبر من 2 جيجا' }, 400);
          } else {
            const timestamp = await getTimestamp();
            const folder = 'courses';
            const publicId = `courses/${crypto.randomUUID()}`;
            const params = {
              display_name: name,
              folder,
              public_id: publicId,
              timestamp: String(timestamp)
            };
            const sortedKeys = Object.keys(params).sort();
            const signStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + apiSecret;
            const signature = await sha1Hex(signStr);

            response = json({
              cloudName,
              apiKey,
              timestamp,
              folder,
              publicId,
              displayName: name,
              signature,
              uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`
            });
          }
        } else if (request.method === 'DELETE' && url.pathname.startsWith('/api/videos/')) {
          const key = parseKeyFromPath(url.pathname, '/api/videos/');
          if (!validKey(key)) {
            response = json({ error: 'Invalid video key' }, 400);
          } else {
            const delUrl = new URL(`https://api.cloudinary.com/v1_1/${cloudName}/resources/video/upload`);
            delUrl.searchParams.append('public_ids[]', key);

            const delRes = await fetch(delUrl.toString(), {
              method: 'DELETE',
              headers: {
                Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`
              }
            });

            const delData = await delRes.json().catch(() => ({}));
            if (!delRes.ok) {
              response = json({ error: delData.error?.message || 'فشل حذف الفيديو من Cloudinary' }, delRes.status);
            } else {
              response = json({ ok: true, deleted: delData.deleted });
            }
          }
        } else {
          response = json({ error: 'Route not found' }, 404);
        }
      }
    } catch (err) {
      console.error('Course API error:', err);
      response = json({ error: 'تعذر إكمال العملية، حاول مرة أخرى' }, 500);
    }
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(origin, env)).forEach(([key, value]) => headers.set(key, value));
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  }
};
