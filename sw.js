// Service Worker：预缓存全部资源，装进主屏幕后可完全离线玩。
// 改动了任何静态文件后，把 VERSION 换一个值（如 v1.0.1）即可让客户端更新。
var VERSION = 'tilt-charades-v1.2.1';
var ASSETS = [
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
  './mp3/pass.mp3',
  './img/日常生活.png',
  './img/动物世界.png',
  './img/成语天地.png',
  './img/网络热词.png',
  './img/演技比拼.png',
  './img/随机提卡.png',
  './img/吃货天堂.png',
  './img/亲子乐园.png',
  './img/K歌之王.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
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
      return fetch(e.request);
    })
  );
});
