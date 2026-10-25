// 游戏主逻辑：状态机 home → countdown → play → result，含暂停/恢复、点按降级、结算与战绩。
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SETTINGS_KEY = 'tc.settings.v2'; // 升版本让老用户已存储的 tilt: true 失效，改用新默认
  var HIST_KEY = 'tc.history.v1';
  var APP_VERSION = 'v1.2.6'; // 与 sw.js 的 VERSION 保持一致（改动静态文件时同步更新）
  var EASTER_EGG = 'harper 💗 April';
  var DURATIONS = [60, 120, 180, 240, 300];
  var SENS_ANGLE = { high: 22, mid: 30, low: 38 };
  var DEFAULTS = { tilt: false, sens: 'mid', sound: true, swap: false, duration: 240 };

  var settings = loadSettings();
  var state = 'home';          // home | countdown | play | flash | paused | result
  var round = null;
  var pendingCat = null;
  var wakeLock = null;
  var tickTimer = null;
  var flashTimer = null;
  var lastSec = -1;

  // ---------- 存储 ----------
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; }
  }
  function pushHistory(rec) {
    var h = loadHistory();
    h.push(rec);
    if (h.length > 50) h = h.slice(-50);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) {}
  }

  // ---------- 工具 ----------
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function catWords(cat) {
    if (!cat.mix) return cat.words;
    var all = [];
    window.WORD_CATEGORIES.forEach(function (c) { if (!c.mix) all = all.concat(c.words); });
    return all;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }
  function fmtDate(t) {
    var d = new Date(t);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 对局用时：结束前实际进行的秒数（老记录没有 used 字段时用设置的时长兜底）
  function fmtUsed(r) {
    var s = typeof r.used === 'number' ? r.used : r.dur;
    var m = Math.floor(s / 60), sec = s % 60;
    if (sec === 0) return m + ' 分钟';
    return (m > 0 ? m + ' 分 ' : '') + sec + ' 秒';
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- 屏幕切换 ----------
  var SCREENS = ['screen-home', 'screen-countdown', 'screen-play', 'screen-result'];
  function showScreen(id) {
    SCREENS.forEach(function (s) { $(s).classList.toggle('active', s === id); });
  }
  function setGaming(v) {
    if (v) document.body.dataset.gaming = '1';
    else delete document.body.dataset.gaming;
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2800);
  }

  // ---------- 首页 ----------
  function buildGrid() {
    var grid = $('cat-grid');
    grid.innerHTML = '';
    window.WORD_CATEGORIES.forEach(function (cat) {
      var b = document.createElement('button');
      b.className = 'cat-card';
      b.style.background = cat.bg;
      b.setAttribute('aria-label', cat.name);
      // emoji + 文字先渲染垫底，弱网下图片加载慢时卡片不会一片空白
      var em = document.createElement('span');
      em.className = 'em';
      em.textContent = cat.emoji;
      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.style.color = cat.fg;
      nm.textContent = cat.name;
      b.appendChild(em);
      b.appendChild(nm);
      var img = document.createElement('img');
      img.className = 'cat-img';
      img.src = cat.img;
      img.alt = cat.name;
      img.draggable = false;
      img.decoding = 'async';
      // 图片加载失败先重试两次，仍失败则移除图片，保留 emoji + 文字（bg/emoji 仅作回退用）
      var retries = 0;
      img.addEventListener('error', function () {
        if (retries < 2) {
          retries++;
          setTimeout(function () { img.src = cat.img; }, retries * 1200);
        } else if (img.parentNode) {
          img.parentNode.removeChild(img);
        }
      });
      img.addEventListener('load', function () {
        em.remove();
        nm.remove();
      });
      b.appendChild(img);
      b.addEventListener('click', function () { openSetup(cat); });
      grid.appendChild(b);
    });
  }

  // ---------- 开局弹窗 ----------
  function openSetup(cat) {
    pendingCat = cat;
    $('setup-title').textContent = cat.name;
    $('setup-desc').textContent = cat.desc;
    var dots = $('dur-dots');
    dots.innerHTML = '';
    DURATIONS.forEach(function (d) {
      var b = document.createElement('button');
      b.className = 'dot' + (d === settings.duration ? ' on' : '');
      b.setAttribute('aria-label', d + '秒');
      b.addEventListener('click', function () {
        settings.duration = d;
        saveSettings();
        dots.querySelectorAll('.dot').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      });
      dots.appendChild(b);
    });
    $('btn-start').disabled = false;
    $('modal-setup').hidden = false;
  }

  async function onStart() {
    if (!pendingCat) return;
    $('btn-start').disabled = true;
    GameAudio.unlock();
    if (settings.tilt) {
      // iOS 要求 requestPermission 在点击手势内发起：这里是本次点击后的第一个 await
      var perm = await Tilt.prepare();
      if (perm === 'denied') toast('未授权传感器，本局用点按模式玩');
      else if (perm === 'unsupported') toast('此设备不支持倾斜检测，用点按模式玩');
    }
    $('modal-setup').hidden = true;
    var cat = pendingCat;
    await beginCountdown(cat, settings.duration);
    $('btn-start').disabled = false;
  }

  // ---------- 倒数（同时完成传感器校准） ----------
  async function beginCountdown(cat, dur) {
    round = {
      cat: cat, duration: dur,
      deck: shuffle(catWords(cat).slice()), idx: -1,
      correct: [], skipped: [],
      paused: false, ended: false, touchMode: !settings.tilt,
      flashPending: false, resumeWithNext: false
    };
    state = 'countdown';
    setGaming(true);
    showScreen('screen-countdown');
    $('cd-text').textContent = '准备!';
    $('cd-hint').textContent = settings.tilt ? '摆好姿势，正对观众' : '点按模式：左跳过 · 右正确';
    GameAudio.play('go');

    var calP = null;
    if (settings.tilt) {
      Tilt.setHandler(onTilt);
      Tilt.setOptions({ threshold: SENS_ANGLE[settings.sens] || 30, swap: !!settings.swap });
      calP = Tilt.calibrate(700, 2000); // 倒数期间完成基准采样
    }

    await wait(900);
    for (var n = 3; n >= 1; n--) {
      $('cd-text').textContent = n;
      if (settings.tilt) $('cd-hint').textContent = '保持住姿势…';
      GameAudio.play('tick');
      await wait(800);
    }
    if (calP) {
      var base = await calP;
      if (!base) {
        round.touchMode = true;
        toast('未检测到传感器，点按屏幕两侧玩');
      } else {
        GameAudio.play('calib');
      }
    }
    beginPlay();
  }

  // ---------- 进行中 ----------
  function beginPlay() {
    showScreen('screen-play');
    document.body.classList.toggle('touch-mode', round.touchMode);
    requestWakeLock();
    round.endTime = Date.now() + round.duration * 1000;
    nextWord();
    state = 'play';
    lastSec = -1;
    startTick();
  }

  function startTick() { stopTick(); tickTimer = setInterval(tick, 200); }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  function remainingSec() { return Math.max(0, (round.endTime - Date.now()) / 1000); }

  function tick() {
    if (!round || round.paused || round.ended) return;
    var r = remainingSec();
    var el = $('play-timer');
    el.textContent = fmt(r);
    el.classList.toggle('urgent', r <= 10.05);
    var s = Math.ceil(r);
    if (s !== lastSec) {
      lastSec = s;
      if (s <= 5 && s > 0) GameAudio.play('tick');
    }
    if (r <= 0) endRound();
  }

  function nextWord() {
    round.idx++;
    if (round.idx >= round.deck.length) { shuffle(round.deck); round.idx = 0; }
    var w = round.deck[round.idx];
    $('word-el').textContent = w;
    fitWord(w);
  }

  function fitWord(w) {
    var card = $('play-card');
    var W = card.clientWidth * 0.86;
    var H = card.clientHeight * 0.40;
    var len = Math.max(w.length, 1);
    var fs = Math.floor(Math.min(W / len, H));
    fs = Math.max(30, Math.min(fs, 400));
    $('word-el').style.fontSize = fs + 'px';
  }

  // ---------- 判定 ----------
  function onTilt(dir) {
    if (state === 'play' && round && !round.paused) judge(dir);
  }

  function judge(kind) {
    if (!round || round.ended) return;
    var w = round.deck[round.idx];
    (kind === 'correct' ? round.correct : round.skipped).push(w);
    GameAudio.play(kind === 'correct' ? 'correct' : 'skip');
    state = 'flash';
    round.flashPending = true;
    var f = $('flash');
    $('flash-text').textContent = kind === 'correct' ? '正确!' : '跳过';
    f.className = 'flash ' + (kind === 'correct' ? 'ok' : 'no');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      f.className = 'flash hiddenf';
      round.flashPending = false;
      if (state !== 'flash' || !round || round.ended) return;
      if (remainingSec() <= 0) { endRound(); return; }
      nextWord();
      state = 'play';
    }, 800);
  }

  // ---------- 暂停 / 恢复 ----------
  function pauseGame(auto) {
    if (!round || round.paused || round.ended) return;
    round.paused = true;
    round.remainMs = Math.max(0, round.endTime - Date.now());
    round.resumeWithNext = round.flashPending === true; // 闪屏被打断：当前词已计过，恢复后直接换词
    round.flashPending = false;
    stopTick();
    clearTimeout(flashTimer);
    $('flash').className = 'flash hiddenf';
    state = 'paused';
    $('pause-title').textContent = auto ? '休息一下' : '已暂停';
    $('pause-sub').textContent = auto ? '切出页面时自动暂停了' : '想结束就点「结束本局」';
    $('modal-pause').hidden = false;
  }

  async function resumeGame() {
    if (!round || !round.paused) return;
    $('modal-pause').hidden = true;
    if (settings.tilt && Tilt.orientationChanged()) {
      toast('姿势变了，重新校准…');
      var base = await Tilt.calibrate(600, 900);
      round.touchMode = !base;
      document.body.classList.toggle('touch-mode', round.touchMode);
    }
    round.paused = false;
    round.endTime = Date.now() + (round.remainMs || 0);
    if (round.resumeWithNext) { round.resumeWithNext = false; nextWord(); }
    state = 'play';
    startTick();
  }

  // ---------- 结算 ----------
  function endRound() {
    if (!round || round.ended) return;
    round.ended = true;
    state = 'result';
    stopTick();
    clearTimeout(flashTimer);
    $('flash').className = 'flash hiddenf';
    releaseWakeLock();
    setGaming(false);
    document.body.classList.remove('touch-mode');
    GameAudio.play('end');

    var used = Math.round(Math.min(round.duration, round.duration - remainingSec()));
    pushHistory({ t: Date.now(), cat: round.cat.name, dur: round.duration, used: used, ok: round.correct.length, skip: round.skipped.length });
    $('result-title').textContent = remainingSec() <= 0 ? '时间到！' : '本局结束';
    $('result-count').textContent = round.correct.length;
    $('result-sub').textContent = round.cat.name + ' · ' + round.duration + ' 秒';
    fillChips('list-ok', round.correct, 'chip-ok');
    fillChips('list-skip', round.skipped, 'chip-skip');
    var h = loadHistory();
    var best = 0;
    h.forEach(function (x) { if (x.ok > best) best = x.ok; });
    $('result-hist').textContent = '已玩 ' + h.length + ' 局 · 单局最佳 ' + best + ' 个';
    showScreen('screen-result');
  }

  function fillChips(id, words, cls) {
    var box = $(id);
    box.innerHTML = '';
    if (!words.length) { box.innerHTML = '<span class="empty">无</span>'; return; }
    words.forEach(function (w) {
      var s = document.createElement('span');
      s.className = 'chip ' + cls;
      s.textContent = w;
      box.appendChild(s);
    });
  }

  // ---------- 屏幕常亮 ----------
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
  }

  // ---------- 设置 ----------
  function renderSeg(seg, v) {
    seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === v);
    });
  }
  function bindSeg(id, get, set) {
    var seg = $(id);
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        set(b.dataset.v);
        saveSettings();
        renderSeg(seg, get());
      });
    });
    renderSeg(seg, get());
  }

  // ---------- 事件绑定 ----------
  buildGrid();
  GameAudio.setMuted(!settings.sound);
  GameAudio.loadCorrect('mp3/wo.mp3'); // 自定义「正确」音效，失败时自动回退合成音
  GameAudio.loadSkip('mp3/pass.mp3');  // 自定义「跳过」音效，失败时自动回退合成音

  // 首次交互解锁音频（iOS 要求）
  document.addEventListener('pointerdown', function once() {
    GameAudio.unlock();
    document.removeEventListener('pointerdown', once);
  });

  $('btn-settings').addEventListener('click', function () { $('modal-settings').hidden = false; });
  $('btn-close-set').addEventListener('click', function () { $('modal-settings').hidden = true; });
  $('btn-version').textContent = APP_VERSION;
  $('btn-version').addEventListener('click', function () { toast(EASTER_EGG, 3000); });
  $('btn-update').addEventListener('click', checkUpdate);

  // ---------- 战绩弹窗 ----------
  var clearArmed = false;
  var clearReset = null;
  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearReset);
    var btn = $('btn-clear-stats');
    btn.textContent = '清空战绩';
    btn.classList.remove('danger');
  }
  function renderStats() {
    var list = loadHistory().slice().reverse(); // 新一局在前
    var body = $('stats-body');
    body.innerHTML = '';
    $('stats-table').hidden = list.length === 0;
    $('stats-empty').hidden = list.length !== 0;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + fmtDate(r.t) + '</td>' +
        '<td>' + fmtUsed(r) + '</td>' +
        '<td class="num ok">' + r.ok + '</td>' +
        '<td class="num skip">' + r.skip + '</td>';
      body.appendChild(tr);
    });
  }
  function openStats() {
    disarmClear();
    renderStats();
    $('modal-stats').hidden = false;
  }
  $('btn-stats').addEventListener('click', openStats);
  $('btn-close-stats').addEventListener('click', function () { $('modal-stats').hidden = true; });
  $('btn-clear-stats').addEventListener('click', function () {
    var btn = this;
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = '再点一次确认';
      btn.classList.add('danger');
      clearTimeout(clearReset);
      clearReset = setTimeout(disarmClear, 2600);
      return;
    }
    disarmClear();
    try { localStorage.removeItem(HIST_KEY); } catch (e) {}
    renderStats();
    toast('战绩已清空');
  });
  $('btn-start').addEventListener('click', onStart);
  $('btn-back').addEventListener('click', function () { $('modal-setup').hidden = true; });

  bindSeg('seg-tilt', function () { return settings.tilt ? 'on' : 'off'; },
    function (v) { settings.tilt = v === 'on'; applyTiltRows(); });
  bindSeg('seg-sens', function () { return settings.sens; }, function (v) { settings.sens = v; });
  bindSeg('seg-swap', function () { return settings.swap ? 'yes' : 'no'; }, function (v) { settings.swap = v === 'yes'; });
  bindSeg('seg-sound', function () { return settings.sound ? 'on' : 'off'; },
    function (v) { settings.sound = v === 'on'; GameAudio.setMuted(!settings.sound); });

  // 关闭倾斜控制时隐藏灵敏度/方向设置
  function applyTiltRows() {
    $('row-sens').hidden = !settings.tilt;
    $('row-swap').hidden = !settings.tilt;
  }
  applyTiltRows();

  // 点按降级：左半屏跳过 / 右半屏正确
  $('play-card').addEventListener('pointerdown', function (e) {
    if (state !== 'play' || !round || round.paused) return;
    var rect = this.getBoundingClientRect();
    judge(e.clientX - rect.left < rect.width / 2 ? 'skip' : 'correct');
  });
  $('btn-exit').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  $('btn-exit').addEventListener('click', function (e) { e.stopPropagation(); pauseGame(false); });

  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-finish').addEventListener('click', function () { $('modal-pause').hidden = true; endRound(); });
  $('btn-again').addEventListener('click', function () {
    var c = round.cat, d = round.duration;
    beginCountdown(c, d);
  });
  $('btn-home').addEventListener('click', function () { showScreen('screen-home'); state = 'home'; });

  // 切后台自动暂停；回前台补Wake Lock
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (state === 'play' || state === 'flash') pauseGame(true);
    } else {
      requestWakeLock();
    }
  });

  window.addEventListener('resize', function () {
    if (state === 'play' && round) fitWord($('word-el').textContent);
  });

  // iOS 禁用捏合缩放
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  // Service Worker：仅 https / localhost 下生效，失败静默（file:// 打开也不报错）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  // 「检查更新」按钮：主动让 SW 对比 sw.js 是否有新版本。有更新时等新 SW 激活完
  // （install 时已 skipWaiting）再刷新，保证这一次加载就是新版；没有更新只提示不动页面；
  // 无 SW / 网络失败 / 超时则退回普通刷新兜底（离线时走旧缓存，不影响可用性）。
  function checkUpdate() {
    if (!('serviceWorker' in navigator)) { location.reload(); return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { location.reload(); return; }
      toast('正在检查更新…');
      var timer = setTimeout(function () { location.reload(); }, 8000);
      reg.update().then(function () {
        var w = reg.waiting || reg.installing;
        if (!w) { clearTimeout(timer); toast('已是最新版本'); return; }
        w.addEventListener('statechange', function () {
          if (w.state === 'activated' || w.state === 'redundant') {
            clearTimeout(timer);
            location.reload();
          }
        });
      }).catch(function () { clearTimeout(timer); location.reload(); });
    }).catch(function () { location.reload(); });
  }
})();
