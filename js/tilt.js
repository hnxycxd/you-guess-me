// 倾斜检测。
// 不直接用 beta/gamma：横竖屏姿态不同、屏幕接近竖直时欧拉角会跳变（万向锁）。
// 这里用 deviceorientation 按规范公式重建「重力方向在设备坐标系下的单位向量」，
// 与开局校准的基准向量比较夹角。该向量对 alpha（绕屏幕法线的旋转）不敏感，
// 所以横握、竖握、斜靠在桌上都成立。
// 方向判定：设备坐标系 z 轴 = 屏幕法线。屏幕朝下压（Heads Up 的「正确」动作）
// 时 g_z 增大，屏幕翻起来（「跳过」）时 g_z 减小。iOS/Android 的
// deviceorientation 都遵循同一规范，符号约定一致，无需按平台区分。
window.Tilt = (function () {
  var D2R = Math.PI / 180;
  var NEUTRAL = 10;        // 回到中性区（度）才允许再次触发，防连触
  var COOLDOWN = 700;      // 触发后冷却（毫秒）

  var handler = null;
  var baseline = null;
  var threshold = 30;
  var swap = false;
  var samples = [];
  var calibrating = false;
  var gotEvent = false;
  var listening = false;
  var armed = true;
  var lastTrigger = 0;
  var calibOrient = null;  // 校准时的屏幕方向 'l'/'p'，中途旋转需要重新校准

  function gravity(beta, gamma) {
    var b = beta * D2R, g = gamma * D2R;
    var x = Math.sin(g) * Math.cos(b);
    var y = -Math.sin(b);
    var z = -Math.cos(g) * Math.cos(b);
    var len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    gotEvent = true;
    var g = gravity(e.beta, e.gamma);
    if (calibrating) { samples.push(g); return; }
    if (!baseline || !handler) return;

    var dot = g[0] * baseline[0] + g[1] * baseline[1] + g[2] * baseline[2];
    var angle = Math.acos(Math.max(-1, Math.min(1, dot))) / D2R;

    if (angle >= threshold && armed && Date.now() - lastTrigger > COOLDOWN) {
      var dz = g[2] - baseline[2];
      var dir = (dz > 0 ? 1 : -1) * (swap ? -1 : 1); // dz>0：屏幕朝下压 => 正确
      armed = false;
      lastTrigger = Date.now();
      handler(dir > 0 ? 'correct' : 'skip');
    } else if (angle < NEUTRAL) {
      armed = true;
    }
  }

  function attach() {
    if (listening) return;
    listening = true;
    window.addEventListener('deviceorientation', onOrient, { passive: true });
  }

  // iOS 13+ 必须在用户点击手势内调用；已授权时重复调用会静默通过
  async function prepare() {
    try {
      if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        var r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return 'denied';
      }
      attach();
      return 'granted';
    } catch (err) {
      return 'denied';
    }
  }

  // 校准基准姿势：collectMs 内持续采样求平均。
  // noDataMs 内一个事件都没收到（桌面浏览器/传感器被禁）返回 null。
  function calibrate(collectMs, noDataMs) {
    collectMs = collectMs || 700;
    noDataMs = noDataMs || 2200;
    return new Promise(function (resolve) {
      if (!listening) { resolve(null); return; }
      samples = []; calibrating = true; gotEvent = false; baseline = null;
      var started = Date.now();

      function finish(v) {
        calibrating = false; samples = [];
        if (v) {
          baseline = v;
          calibOrient = window.innerWidth > window.innerHeight ? 'l' : 'p';
        }
        resolve(v);
      }
      (function poll() {
        if (gotEvent) {
          if (Date.now() - started >= collectMs) {
            var n = samples.length;
            if (!n) { finish(null); return; }
            var ax = 0, ay = 0, az = 0;
            for (var i = 0; i < n; i++) { ax += samples[i][0]; ay += samples[i][1]; az += samples[i][2]; }
            var len = Math.hypot(ax, ay, az) || 1;
            finish([ax / len, ay / len, az / len]);
          } else setTimeout(poll, 60);
        } else if (Date.now() - started >= noDataMs) {
          finish(null);
        } else setTimeout(poll, 80);
      })();
    });
  }

  function setHandler(fn) { handler = fn; }
  function setOptions(o) {
    if (o.threshold) threshold = o.threshold;
    if (typeof o.swap === 'boolean') swap = o.swap;
  }
  function orientationChanged() {
    return !!calibOrient && calibOrient !== (window.innerWidth > window.innerHeight ? 'l' : 'p');
  }

  return { prepare: prepare, calibrate: calibrate, setHandler: setHandler, setOptions: setOptions, orientationChanged: orientationChanged };
})();
