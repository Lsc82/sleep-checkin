/* 睡前打卡 — Service Worker
   目标：让安卓 Chrome 判定站点「可安装」，并支持离线打开。
   关键设计（踩坑记录）：
   1. 不使用 clients.claim()。新建页面若在 SW 刚激活时被接管，
      <audio> 的媒体请求会被挂住，表现为音乐一直停在"加载中"。
   2. 媒体请求（mp3 / Range / destination=audio）一律不拦截，交给浏览器原生网络栈。
   3. 导航请求：网络优先，3 秒超时回落缓存，兼顾更新及时与离线可用。
*/
var CACHE = 'sleep-checkin-v5';
var CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(CORE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
    // 刻意不调用 clients.claim()
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 媒体资源完全放行
  if (/\.(mp3|m4a|ogg|wav|mp4)$/i.test(url.pathname)) return;
  if (req.destination === 'audio' || req.destination === 'video') return;
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        function done(res) {
          if (settled) return;
          settled = true;
          resolve(res);
        }
        var timer = setTimeout(function () {
          caches.match('./index.html').then(function (r) { if (r) done(r); });
        }, 3000);
        fetch(req).then(function (res) {
          clearTimeout(timer);
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          }
          done(res);
        }).catch(function () {
          clearTimeout(timer);
          caches.match('./index.html').then(function (r) {
            done(r || caches.match('./') || Response.error());
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});
