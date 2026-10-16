import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const env = {
  CLOUDINARY_CLOUD_NAME: 'eovzipnj',
  CLOUDINARY_API_KEY: '899147943361934',
  CLOUDINARY_API_SECRET: 'mf2nLY_KKHsP4wxzbpJwlw6fC_8',
  CLOUDINARY_URL: 'cloudinary://899147943361934:mf2nLY_KKHsP4wxzbpJwlw6fC_8@eovzipnj',
  ADMIN_PASSWORD: 'owner-super-strong-pass',
  STUDENT_PASSWORD: 'students-super-strong-pass',
  TOKEN_SECRET: 'THIS_IS_DEMO_SECRET_AT_LEAST_32_CHARS_1234',
  ALLOWED_ORIGIN: 'https://my-course.vercel.app'
};

const origin = 'https://my-course.vercel.app';

async function request(path, opts = {}) {
  return worker.fetch(new Request('https://course-portal-api.test' + path, {
    ...opts,
    headers: { Origin: origin, ...(opts.headers || {}) }
  }), env);
}

const login = async (role, pass) => {
  const r = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, password: pass })
  });
  return { res: r, data: await r.json() };
};

console.log('Testing Course Portal Worker with Cloudinary...');

// 1. Health check
let r = await request('/api/health');
assert.equal(r.status, 200);
let healthData = await r.json();
assert.equal(healthData.storage, 'Cloudinary');
assert.equal(healthData.cloudName, 'eovzipnj');

// 2. Authentication
let blocked = await login('student', 'wrongpassword11');
assert.equal(blocked.res.status, 401);

const student = await login('student', env.STUDENT_PASSWORD);
const admin = await login('admin', env.ADMIN_PASSWORD);
assert.equal(student.res.status, 200);
assert.equal(admin.res.status, 200);

const auth = { Authorization: `Bearer ${admin.data.token}`, 'Content-Type': 'application/json' };
const studentAuth = { Authorization: `Bearer ${student.data.token}` };

// 3. RBAC: Student cannot request upload signature
r = await request('/api/upload/sign', {
  method: 'POST',
  headers: { ...studentAuth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Lecture 1.mp4', size: 1024, type: 'video/mp4' })
});
assert.equal(r.status, 403);

// 4. Admin can request upload signature
r = await request('/api/upload/sign', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: 'المحاضرة الأولى.mp4', size: 50 * 1024 * 1024, type: 'video/mp4' })
});
assert.equal(r.status, 200);
const signData = await r.json();
assert.equal(signData.cloudName, 'eovzipnj');
assert.equal(signData.apiKey, '899147943361934');
assert.equal(typeof signData.signature, 'string');
assert.match(signData.publicId, /^courses\//);
assert.equal(signData.displayName, 'المحاضرة الأولى.mp4');

// 5. List videos from Cloudinary
r = await request('/api/videos', { headers: studentAuth });
assert.equal(r.status, 200);
let listing = await r.json();
assert(Array.isArray(listing.videos));
console.log(`Found ${listing.videos.length} videos on Cloudinary.`);

// 6. Media playback requires valid token
r = await request('/api/media/samples/cld-sample-video');
assert.equal(r.status, 401);

// 7. Media playback with valid student token redirects (302) to Cloudinary CDN URL
r = await request(`/api/media/samples/cld-sample-video?token=${encodeURIComponent(student.data.token)}`);
assert.equal(r.status, 302);
assert.equal(r.headers.get('Location'), 'https://res.cloudinary.com/eovzipnj/video/upload/samples/cld-sample-video');

// 8. Media download with valid student token redirects with fl_attachment
r = await request(`/api/media/samples/cld-sample-video?token=${encodeURIComponent(student.data.token)}&download=1`);
assert.equal(r.status, 302);
assert.equal(r.headers.get('Location'), 'https://res.cloudinary.com/eovzipnj/video/upload/fl_attachment/samples/cld-sample-video');

console.log('ALL TESTS PASSED: health, auth, RBAC, sign, Cloudinary list, protected media redirect, download!');
