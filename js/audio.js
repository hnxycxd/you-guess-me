// 音效：Web Audio 合成，无外部音频文件（iOS 不支持网页震动，音效+闪屏做反馈）。
// iOS 要求在用户点击手势里解锁 AudioContext，游戏在「开始」按钮里调用 unlock()。
window.GameAudio = (function () {
  var ctx = null;
  var muted = false;
  var custom = {}; // 自定义音效槽：name -> { url, buffer }

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  function unlock() {
    ensure();
    // 音频上下文解锁后（重）尝试加载所有自定义音效
    Object.keys(custom).forEach(function (k) {
      if (custom[k].url && !custom[k].buffer) loadBuffer(k);
    });
  }

  // 播放解码好的 mp3（Web Audio 在 iOS 上解锁一次后可随时播放，不依赖手势）
  function playBuffer(buf, vol) {
    var c = ensure();
    if (!c || muted) return;
    var src = c.createBufferSource();
    var g = c.createGain();
    g.gain.value = vol || 0.9;
    src.buffer = buf;
    src.connect(g); g.connect(c.destination);
    src.start();
  }

  function decode(c, ab) {
    return new Promise(function (res, rej) {
      try {
        var p = c.decodeAudioData(ab, res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      } catch (e) { rej(e); }
    });
  }

  // 加载自定义音效；失败时静默回退到合成音
  function loadBuffer(name) {
    var c = ensure();
    var slot = custom[name];
    if (!c || !slot || !slot.url || slot.buffer) return Promise.resolve(!!(slot && slot.buffer));
    return fetch(slot.url)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
      .then(function (ab) { return decode(c, ab); })
      .then(function (buf) { slot.buffer = buf; return true; })
      .catch(function () { return false; });
  }

  function loadCustom(name, url) {
    custom[name] = { url: url, buffer: null };
    return loadBuffer(name);
  }

  function beep(freq, dur, type, vol, delay) {
    var c = ensure();
    if (!c || muted) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  var sounds = {
    tick:    function () { beep(880, 0.09, 'square', 0.10); },
    go:      function () { beep(1320, 0.18, 'sine', 0.22); },
    correct: function () { beep(660, 0.12, 'sine', 0.22); beep(990, 0.2, 'sine', 0.22, 0.1); },
    skip:    function () { beep(520, 0.1, 'sine', 0.15); beep(392, 0.14, 'sine', 0.15, 0.08); },
    end:     function () { beep(392, 0.22, 'sawtooth', 0.16); beep(311, 0.22, 'sawtooth', 0.16, 0.22); beep(233, 0.4, 'sawtooth', 0.18, 0.44); },
    calib:   function () { beep(1046, 0.08, 'sine', 0.10); }
  };

  function play(name) {
    var slot = custom[name];
    if (slot && slot.buffer) { playBuffer(slot.buffer); return; }
    if (sounds[name]) sounds[name]();
  }

  return {
    unlock: unlock,
    play: play,
    loadCorrect: function (url) { return loadCustom('correct', url); },
    loadSkip: function (url) { return loadCustom('skip', url); },
    get correctReady() { return !!(custom.correct && custom.correct.buffer); },
    get skipReady() { return !!(custom.skip && custom.skip.buffer); },
    setMuted: function (m) { muted = m; },
    get muted() { return muted; }
  };
})();
