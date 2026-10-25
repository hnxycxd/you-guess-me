// Service Worker：核心资源预缓存，图片尽力预缓存 + 运行时补缓存，装进主屏幕后可完全离线玩。
// 改动了任何静态文件后，把 VERSION 换一个值（如 v1.0.1）即可让客户端更新。
var VERSION = 'tilt-charades-v1.2.6'; // 与 js/app.js 的 APP_VERSION 保持一致
var CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/words.js',
  './js/audio.js',
  './js/tilt.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './mp3/wo.mp3',
  './mp3/pass.mp3'
];
var IMG_ASSETS = [
  './img/日常生活.webp',
  './img/动物世界.webp',
  './img/成语天地.webp',
  './img/网络热词.webp',
  './img/演技比拼.webp',
  './img/随机提卡.webp',
  './img/吃货天堂.webp',
  './img/亲子乐园.webp',
  './img/K歌之王.webp'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      // 核心资源必须全部装成功；图片逐张装，弱网下个别失败不拖垮整个安装，
      // 漏掉的图片由 fetch 里的运行时缓存补上。
      return c.addAll(CORE_ASSETS).then(function () {
        return Promise.all(IMG_ASSETS.map(function (u) {
          return c.add(u).catch(function () {});
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      return fetch(e.request).then(function (resp) {
        // 成功的网络响应顺手写入缓存，弱网首装时漏掉的图片之后就能离线用了
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      });
    })
  );
});
