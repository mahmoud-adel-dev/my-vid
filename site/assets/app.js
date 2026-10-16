/* Course Portal frontend - static HTML, no framework or build step. */
(() => {
  'use strict';
  const cfg = window.COURSE_CONFIG || {};
  const apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
  const configured = /^https:\/\//.test(apiBase) && !/REPLACE|YOUR-WORKER/i.test(apiBase);
  const page = document.body.dataset.page;
  const role = page === 'admin' ? 'admin' : 'student';
  let videos = [];
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const formatSize = n => !Number.isFinite(n) ? '—' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
  const formatDate = d => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
  const sessionKey = `course-portal-${role}`;

  document.querySelectorAll('[data-course-title]').forEach(e => e.textContent = cfg.title || 'أكاديمية المعرفة');
  document.querySelectorAll('[data-course-subtitle]').forEach(e => e.textContent = cfg.subtitle || 'تعلم وشاهد محاضراتك في أي وقت');

  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      return s && s.token && s.expiresAt > Date.now() + 10_000 ? s : null;
    } catch { return null; }
  }
  function clearSession() { sessionStorage.removeItem(sessionKey); }
  function setNotice(message, kind = '') {
    const e = $('status');
    if (!e) return;
    e.textContent = message;
    e.className = `notice ${kind}`.trim();
    if (!message) e.classList.add('hidden');
  }
  function showLogin(show) {
    $('loginPanel')?.classList.toggle('hidden', !show);
    $(page === 'admin' ? 'dashboardPanel' : page === 'watch' ? 'playerPanel' : 'libraryPanel')?.classList.toggle('hidden', show);
    $('logoutBtn')?.classList.toggle('hidden', show);
  }
  async function api(path, { method = 'GET', body, raw = false, ...options } = {}) {
    if (!configured) throw new Error('لم يتم ربط الموقع بعد. افتح config.js وضع رابط Cloudflare Worker.');
    const session = getSession();
    const headers = new Headers(options.headers || {});
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    if (body && !raw) headers.set('Content-Type', 'application/json');
    let resp;
    try {
      resp = await fetch(apiBase + path, { ...options, method, headers, body: body && !raw ? JSON.stringify(body) : body });
    } catch {
      throw new Error('تعذّر الاتصال بالخادم. تأكد من رابط Worker وضبط ALLOWED_ORIGIN.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (resp.status === 401 && path !== '/api/login') { clearSession(); showLogin(true); }
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
  }
  function mediaUrl(key, download = false) {
    return `${apiBase}/api/media/${encodeURIComponent(key)}?token=${encodeURIComponent(getSession()?.token || '')}${download ? '&download=1' : ''}`;
  }
  function watchUrl(key) { return `watch.html?id=${encodeURIComponent(key)}`; }
  function attachPasswordToggle() {
    document.querySelectorAll('[data-toggle-password]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.togglePassword);
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? 'إظهار' : 'إخفاء';
      });
    });
  }
  function attachAuth() {
    attachPasswordToggle();
    $('logoutBtn')?.addEventListener('click', () => { clearSession(); if ($('player')) { $('player').pause(); $('player').removeAttribute('src'); $('player').load(); } showLogin(true); });
    $('loginForm')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const msg = $('loginFeedback');
      const btn = $('loginForm').querySelector('button[type="submit"]');
      msg.textContent = '';
      btn.disabled = true;
      try {
        const result = await api('/api/login', { method: 'POST', body: { role, password: $('password').value } });
        sessionStorage.setItem(sessionKey, JSON.stringify(result));
        $('password').value = '';
        showLogin(false);
        await loadVideos();
      } catch (e) { msg.textContent = e.message; }
      finally { btn.disabled = false; }
    });
    if (getSession()) { showLogin(false); loadVideos(); }
    else { showLogin(true); if (!configured) $('loginFeedback').textContent = 'يتطلب تفعيل الموقع إعداد رابط الـ API في ملف config.js أولًا.'; }
  }
  async function loadVideos() {
    setNotice('جارٍ تحميل المحاضرات...');
    try {
      const data = await api('/api/videos');
      videos = data.videos || [];
      setNotice('');
      if (page === 'student') renderStudent();
      if (page === 'watch') renderWatch();
      if (page === 'admin') renderAdmin();
    } catch (e) { setNotice(e.message, 'error'); }
  }
  function renderStudent() {
    const q = ($('searchInput')?.value || '').toLocaleLowerCase();
    const matches = videos.filter(v => v.name.toLocaleLowerCase().includes(q));
    $('videoCount').textContent = videos.length.toLocaleString('ar-EG');
    const grid = $('videoGrid');
    grid.replaceChildren();
    $('emptyState').classList.toggle('hidden', matches.length > 0);
    if (matches.length === 0 && q) $('emptyState').querySelector('p').textContent = 'لا توجد محاضرات تطابق البحث.';
    else $('emptyState').querySelector('p').textContent = 'ستظهر هنا المحاضرات بمجرد أن يرفعها المسؤول.';
    matches.forEach(v => {
      const card = el('article', 'video-card');
      const cover = el('div', 'video-cover');
      cover.append(el('div', 'cover-icon', '▶'), el('span', 'cover-tag', 'فيديو تعليمي'));
      const body = el('div', 'video-card-body');
      body.append(el('h3', '', v.name));
      const sub = el('div', 'video-sub');
      sub.append(el('span', '', `◷ ${formatDate(v.uploaded)}`), el('span', '', `⇩ ${formatSize(v.size)}`));
      const actions = el('div', 'card-actions');
      const play = el('a', 'play-link', '▶ مشاهدة'); play.href = watchUrl(v.key);
      const download = el('a', 'download-link', '⇩ تحميل'); download.href = mediaUrl(v.key, true); download.setAttribute('download', v.name);
      actions.append(play, download); body.append(sub, actions); card.append(cover, body); grid.append(card);
    });
  }
  function renderWatch() {
    const key = new URLSearchParams(location.search).get('id');
    const video = videos.find(v => v.key === key);
    if (!video) { $('playerPanel').classList.add('hidden'); setNotice('الفيديو غير موجود أو تم حذفه. ارجع لقائمة المحاضرات.', 'error'); return; }
    document.title = `${video.name} | ${cfg.title || 'المحاضرة'}`;
    $('watchTitle').textContent = video.name;
    $('watchMeta').textContent = `${formatSize(video.size)} • أضيفت ${formatDate(video.uploaded)}`;
    $('player').src = mediaUrl(video.key);
    $('player').load();
    $('downloadBtn').href = mediaUrl(video.key, true);
    $('downloadBtn').setAttribute('download', video.name);
  }
  function renderAdmin() {
    $('metricCount').textContent = videos.length.toLocaleString('ar-EG');
    $('metricSize').textContent = formatSize(videos.reduce((sum, v) => sum + v.size, 0));
    const list = $('videoTable'); list.replaceChildren();
    $('emptyState').classList.toggle('hidden', videos.length > 0);
    videos.forEach(v => {
      const row = el('div', 'admin-row');
      row.append(el('div', 'admin-file-icon', '▶'));
      const info = el('div', 'admin-file-info');
      info.append(el('strong', '', v.name), el('small', '', `${formatSize(v.size)} · ${formatDate(v.uploaded)}`));
      const controls = el('div', 'admin-controls');
      const show = el('a', 'tiny-btn', 'مشاهدة'); show.href = mediaUrl(v.key); show.target = '_blank'; show.rel = 'noreferrer';
      const dl = el('a', 'tiny-btn', 'تحميل'); dl.href = mediaUrl(v.key, true); dl.setAttribute('download', v.name);
      const del = el('button', 'tiny-btn danger', 'حذف'); del.type = 'button'; del.addEventListener('click', () => deleteVideo(v, del));
      controls.append(show, dl, del); row.append(info, controls); list.append(row);
    });
  }
  async function deleteVideo(v, btn) {
    if (!confirm(`هل تريد حذف المحاضرة نهائيًا؟\n${v.name}`)) return;
    btn.disabled = true;
    try {
      await api(`/api/videos/${encodeURIComponent(v.key)}`, { method: 'DELETE' });
      await loadVideos(); setNotice('تم حذف المحاضرة بنجاح.', 'success');
    } catch (e) { setNotice(e.message, 'error'); btn.disabled = false; }
  }
  function attachUploads() {
    const MAX = 2 * 1024 * 1024 * 1024;
    const CHUNK = 10 * 1024 * 1024;
    const extensions = /\.(mp4|webm|mov|m4v|ogg)$/i;
    const drop = $('dropZone');
    const picker = $('fileInput');
    let selected = [];
    let isUploading = false;
    let cancelRequested = false;
    let controller = null;
    const choose = () => { if (!isUploading) picker.click(); };
    $('selectFiles').addEventListener('click', ev => { ev.stopPropagation(); choose(); });
    drop.addEventListener('click', choose);
    drop.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === drop) { e.preventDefault(); choose(); } });
    for (const event of ['dragover', 'dragenter']) drop.addEventListener(event, ev => { ev.preventDefault(); drop.classList.add('dragover'); });
    for (const event of ['drop', 'dragleave']) drop.addEventListener(event, ev => { ev.preventDefault(); drop.classList.remove('dragover'); });
    drop.addEventListener('drop', ev => { if (!isUploading) addFiles(ev.dataTransfer.files); });
    picker.addEventListener('change', ev => { addFiles(ev.target.files); picker.value = ''; });
    $('clearFiles').addEventListener('click', () => { if (!isUploading) { selected = []; renderFiles(); } });
    let currentXhr = null;
    $('cancelUploadBtn').addEventListener('click', () => {
      cancelRequested = true;
      currentXhr?.abort();
      $('uploadStatus').textContent = 'جارٍ إيقاف الرفع...';
    });

    function addFiles(files) {
      let invalid = 0;
      for (const file of files) {
        if (!extensions.test(file.name) || file.size < 1 || file.size > MAX) { invalid++; continue; }
        if (!selected.some(s => s.file.name === file.name && s.file.size === file.size && s.file.lastModified === file.lastModified))
          selected.push({ file, progress: 0, status: 'جاهز' });
      }
      if (invalid) setNotice(`تم تجاهل ${invalid} ملف: الصيغة غير مدعومة أو الحجم أكبر من 2 جيجا.`, 'error');
      renderFiles();
    }

    function renderFiles() {
      $('uploadQueue').classList.toggle('hidden', selected.length === 0);
      $('selectedCount').textContent = `(${selected.length})`;
      const list = $('fileList'); list.replaceChildren();
      selected.forEach(item => {
        const row = el('div', 'upload-file');
        row.append(el('div', 'file-icon', '▣'));
        const detail = el('div', 'file-detail');
        detail.append(el('strong', '', item.file.name), el('small', '', formatSize(item.file.size)));
        const bar = el('div', 'file-progress'); const inside = el('i'); inside.style.width = `${item.progress}%`; bar.append(inside); detail.append(bar);
        row.append(detail, el('div', 'file-done', `${item.progress}% · ${item.status}`));
        list.append(row);
      });
      $('uploadBtn').disabled = isUploading;
      $('clearFiles').disabled = isUploading;
      $('cancelUploadBtn').classList.toggle('hidden', !isUploading);
    }

    async function uploadToCloudinary(item, signData) {
      const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB chunks
      const file = item.file;
      const total = file.size;

      if (total <= CHUNK_SIZE) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          currentXhr = xhr;
          const fd = new FormData();
          fd.append('api_key', signData.apiKey);
          fd.append('timestamp', signData.timestamp);
          fd.append('folder', signData.folder);
          fd.append('public_id', signData.publicId);
          fd.append('display_name', signData.displayName);
          fd.append('signature', signData.signature);
          fd.append('file', file);

          xhr.upload.onprogress = ev => {
            if (ev.lengthComputable) {
              item.progress = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
              item.status = `جارٍ الرفع (${item.progress}%)`;
              renderFiles();
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error?.message || `فشل الرفع: خطأ ${xhr.status}`));
              } catch {
                reject(new Error(`فشل الرفع: خطأ ${xhr.status}`));
              }
            }
          };
          xhr.onerror = () => reject(new Error('انقطع الاتصال بخدمة Cloudinary.'));
          xhr.onabort = () => reject(new Error('تم إلغاء الرفع'));

          xhr.open('POST', signData.uploadUrl);
          xhr.send(fd);
        });
      }

      const totalChunks = Math.ceil(total / CHUNK_SIZE);
      const uniqueId = `cld_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      let lastData = null;

      for (let i = 0; i < totalChunks; i++) {
        if (cancelRequested) throw new Error('تم إلغاء الرفع');
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, total);
        const blob = file.slice(start, end);

        lastData = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          currentXhr = xhr;
          const fd = new FormData();
          fd.append('api_key', signData.apiKey);
          fd.append('timestamp', signData.timestamp);
          fd.append('folder', signData.folder);
          fd.append('public_id', signData.publicId);
          fd.append('display_name', signData.displayName);
          fd.append('signature', signData.signature);
          fd.append('file', blob, file.name);

          xhr.upload.onprogress = ev => {
            if (ev.lengthComputable) {
              const currentLoaded = start + ev.loaded;
              item.progress = Math.min(99, Math.round((currentLoaded / total) * 100));
              item.status = `جارٍ الرفع (${item.progress}%)`;
              renderFiles();
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error?.message || `فشل الرفع: خطأ ${xhr.status}`));
              } catch {
                reject(new Error(`فشل الرفع: خطأ ${xhr.status}`));
              }
            }
          };
          xhr.onerror = () => reject(new Error('انقطع الاتصال بخدمة Cloudinary.'));
          xhr.onabort = () => reject(new Error('تم إلغاء الرفع'));

          xhr.open('POST', signData.uploadUrl);
          xhr.setRequestHeader('X-Unique-Upload-Id', uniqueId);
          xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`);
          xhr.send(fd);
        });
      }
      return lastData;
    }

    async function uploadOne(item) {
      try {
        item.status = 'تجهيز الرفع'; renderFiles();
        const signData = await api('/api/upload/sign', {
          method: 'POST',
          body: { name: item.file.name, type: item.file.type, size: item.file.size }
        });
        item.status = 'جارٍ الرفع'; renderFiles();
        await uploadToCloudinary(item, signData);
        item.progress = 100;
        item.status = 'تم الرفع ✓';
        renderFiles();
      } catch (err) {
        item.status = cancelRequested ? 'ملغي' : 'فشل الرفع';
        renderFiles();
        throw err;
      }
    }

    $('uploadBtn').addEventListener('click', async () => {
      if (!selected.length || isUploading) return;
      isUploading = true; cancelRequested = false;
      $('uploadStatus').textContent = 'جارٍ رفع الملفات...'; renderFiles(); setNotice('');
      let done = 0;
      try {
        for (const item of selected) {
          await uploadOne(item); done++;
          $('uploadStatus').textContent = `${done} من ${selected.length} اكتمل`;
          await loadVideos();
        }
        setNotice(`تم رفع ${done} ملف بنجاح. تظهر الملفات الآن للطلاب.`, 'success');
      } catch (e) {
        setNotice(`${done ? `تم رفع ${done} ملف. ` : ''}${e.message}`, 'error');
      } finally {
        isUploading = false; currentXhr = null;
        if (done) selected = selected.filter(item => item.status !== 'تم الرفع ✓');
        renderFiles();
        $('uploadStatus').textContent = '';
      }
    });
  }

  attachAuth();
  $('refreshBtn')?.addEventListener('click', loadVideos);
  $('searchInput')?.addEventListener('input', () => renderStudent());
  if (page === 'admin') attachUploads();
})();
