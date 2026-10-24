// 音效：Web Audio 合成，无外部音频文件（iOS 不支持网页震动，音效+闪屏做反馈）。
// iOS 要求在用户点击手势里解锁 AudioContext，游戏在「开始」按钮里调用 unlock()。
window.GameAudio = (function () {
  var ctx = null;
  var muted = false;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  function unlock() { ensure(); }

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

  function play(name) { if (sounds[name]) sounds[name](); }

  return {
    unlock: unlock,
    play: play,
    setMuted: function (m) { muted = m; },
    get muted() { return muted; }
  };
})();
