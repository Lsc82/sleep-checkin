/* 睡前打卡 — Service Worker
   目标：让安卓 Chrome 判定站点「可安装」（独立窗口 App），并提供离线打开。

   ⚠️ 踩坑记录（这两条都直接导致「安装应用」入口不出现）：

   1) install 事件里绝不能 waitUntil 等待预缓存下载。
      早期版本在 install 里 caches.add 了 5 个文件，跨境/弱网时任一文件卡住，
      install 永远不结束 → SW 长期停在 installing → Chrome 认为「没有已激活的 SW」
      → 不判定为可安装 → 菜单里只剩「添加书签」，没有「安装应用」。
      现在：install 只做 skipWaiting()，秒级激活；预缓存放激活之后异步跑。

   2) 不要 clients.claim()。新页面若在 SW 刚激活的瞬间被接管，
      <audio> 的媒体请求会被挂住，表现为音乐一直停在「加载中」。

   另：媒体请求（mp3 / Range / destination=audio）一律不拦截，交给原生网络栈。
*/
var CACHE = 'sleep-checkin-v6';
var CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

/* ---------- 安装：立即激活，不做任何阻塞操作 ---------- */
self.addEventListener('install', function () {
  self.skipWaiting();
});

/* ---------- 激活：清理旧缓存，然后后台预缓存（不阻塞激活） ---------- */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
  precache();   // fire-and-forget：慢也不影响 SW 已激活的事实
});

function precache() {
  caches.open(CACHE).then(function (c) {
    CORE.forEach(function (u) {
      c.match(u).then(function (hit) {
        if (hit) return;
        // 单个文件加超时，避免一个慢请求拖住整批
        var ctrl = ('AbortController' in self) ? new AbortController() : null;
        var killer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (err) {} }, 20000) : null;
        fetch(new Request(u, { cache: 'reload', signal: ctrl ? ctrl.signal : undefined }))
          .then(function (res) {
            if (killer) clearTimeout(killer);
            if (res && res.ok) return c.put(u, res);
          })
          .catch(function () { if (killer) clearTimeout(killer); });
      });
    });
  }).catch(function () {});
}

/* ---------- 请求拦截 ---------- */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 媒体资源完全放行（音频需要 Range 与流式，交给浏览器）
  if (/\.(mp3|m4a|ogg|wav|mp4)$/i.test(url.pathname)) return;
  if (req.destination === 'audio' || req.destination === 'video') return;
  if (req.headers.has('range')) return;

  // 导航：网络优先，3 秒未响应则回落缓存（有缓存才回落，否则继续等网络）
  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        function done(res) {
          if (settled || !res) return;
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
            caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }).catch(function () {});
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

  // 静态资源：缓存优先，回源后写入
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});
