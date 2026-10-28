/* 睡前打卡 — 最小化 Service Worker
   作用：让安卓 Chrome 判定站点「可安装」，并提供离线打开能力。
   策略：
   - 导航请求（HTML）：网络优先，3 秒未响应回落缓存，保证更新及时又不至于白屏
   - 静态资源（图标）：缓存优先
   - 音频（mp3）：不预缓存，走浏览器原生缓存，避免拖慢安装
*/
var CACHE = 'sleep-checkin-v4';
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
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 音频不接管，交给浏览器原生缓存
  if (/\.mp3$/i.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var timer = setTimeout(function () {
          caches.match('./index.html').then(function (r) { if (r) resolve(r); });
        }, 3000);
        fetch(req).then(function (res) {
          clearTimeout(timer);
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          resolve(res);
        }).catch(function () {
          clearTimeout(timer);
          caches.match('./index.html').then(function (r) {
            resolve(r || caches.match('./') || Response.error());
          });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});
