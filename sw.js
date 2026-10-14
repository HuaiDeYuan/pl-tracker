/* 盈亏记账 —— Service Worker
 *
 * 策略：stale-while-revalidate（缓存优先，后台静默更新）
 *   记账工具"打开快"比"永远最新"重要。改版后第二次打开即生效。
 *
 * 注意：本文件必须与 index.html 同级，这样 SW 的默认作用域才是整个站点目录。
 */

var CACHE = 'pl-tracker-v2';
var DATA_CACHE = 'pl-tracker-data-v1';

/* 需要预缓存的 App 外壳文件。
 * 用相对路径 './xxx'，这样部署在 GitHub Pages 子路径（/pl-tracker/）下也正确。 */
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // 逐个 add，单个失败不影响整体安装
        return Promise.all(SHELL.map(function (u) {
          return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return (k === CACHE || k === DATA_CACHE) ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SAVE_STATE') {
    var payload = e.data.payload;
    var content = typeof payload === 'string' ? payload : JSON.stringify(payload);
    var p = caches.open(DATA_CACHE).then(function (cache) {
      return cache.put('./__pl_tracker_state__.json', new Response(content, {
        headers: { 'Content-Type': 'application/json' }
      }));
    });
    if (e.waitUntil) {
      e.waitUntil(p);
    }
  }
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // 只处理同源 GET。跨域、非 GET 一律放行给网络。
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      var isNav = req.mode === 'navigate';

      var matchPromise = isNav
        ? cache.match('./index.html', { ignoreSearch: true }).then(function (hit) {
            return hit || cache.match('./', { ignoreSearch: true });
          })
        : cache.match(req);

      return matchPromise.then(function (hit) {
        var network = fetch(req).then(function (res) {
          // 只缓存正常响应，避免把错误页写进缓存
          if (res && res.status === 200 && res.type === 'basic') {
            try {
              if (isNav) {
                cache.put('./index.html', res.clone());
                cache.put('./', res.clone());
              } else {
                cache.put(req, res.clone());
              }
            } catch (x) {}
          }
          return res;
        }).catch(function () {
          // 网络失败：有缓存用缓存；没有则给导航请求兜底到首页
          if (hit) return hit;
          if (isNav) {
            return cache.match('./index.html', { ignoreSearch: true }).then(function (fallback) {
              return fallback || cache.match('./', { ignoreSearch: true });
            });
          }
          return Response.error();
        });

        // 有缓存就立即返回，网络更新在后台进行
        return hit || network;
      });
    })
  );
});
