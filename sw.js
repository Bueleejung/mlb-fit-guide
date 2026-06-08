/* Fit Guide — Video Cache Service Worker */
const CACHE = 'fit-videos-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 영상 URL별 ArrayBuffer 메모리 캐시 (SW 생존 중 유지) */
const mem = {};

/* MP4 요청만 처리 (?meta=1 메타데이터 전용 요청은 통과) */
self.addEventListener('fetch', e => {
  if (!e.request.url.includes('.mp4')) return;
  if (new URL(e.request.url).searchParams.has('meta')) return;
  e.respondWith(serveVideo(e.request));
});

/* 메인 페이지 → SW: precache 메시지 수신 */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'precache') precache(e.data.url);
});

async function serveVideo(req) {
  const url   = req.url;
  const range = req.headers.get('range');
  const cache = await caches.open(CACHE);

  /* ① 메모리 캐시 */
  if (mem[url]) return range ? makeRange(mem[url], range) : fullRes(mem[url]);

  /* ② Cache Storage */
  const stored = await cache.match(url);
  if (stored) {
    mem[url] = await stored.arrayBuffer();
    return range ? makeRange(mem[url], range) : fullRes(mem[url]);
  }

  /* ③ 캐시 없음 → 네트워크 통과 + 백그라운드 캐시 시작 */
  precache(url, cache);
  return fetch(req);
}

async function precache(url, cache) {
  if (mem[url] || mem[url + ':busy']) return;
  mem[url + ':busy'] = true;
  try {
    if (!cache) cache = await caches.open(CACHE);
    const stored = await cache.match(url);
    if (stored) { mem[url] = await stored.arrayBuffer(); return; }
    const r = await fetch(new Request(url, { credentials: 'same-origin' }));
    if (!r.ok) return;
    const buf = await r.arrayBuffer();
    mem[url] = buf;
    await cache.put(url, new Response(buf.slice(0), {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(buf.byteLength),
        'Accept-Ranges': 'bytes',
      }
    }));
  } finally {
    delete mem[url + ':busy'];
  }
}

function fullRes(buf) {
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(buf.byteLength),
      'Accept-Ranges': 'bytes',
    }
  });
}

function makeRange(buf, header) {
  const total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  const s = (m && m[1]) ? +m[1] : 0;
  const e = (m && m[2]) ? Math.min(+m[2], total - 1) : total - 1;
  return new Response(buf.slice(s, e + 1), {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${s}-${e}/${total}`,
      'Content-Length': String(e - s + 1),
    }
  });
}
