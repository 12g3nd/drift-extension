// Drift — Generative Landscape Engine
// Renders a living landscape driven by time of day and calm score.

(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const timeEl = document.getElementById('time');
  const dateEl = document.getElementById('date');

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const val = searchInput.value.trim();
    if (!val) return;
    const isUrl = /^(https?:\/\/|www\.)|(\.[a-z]{2,})(\/|$)/i.test(val);
    if (isUrl) {
      window.location.href = val.startsWith('http') ? val : 'https://' + val;
    } else {
      window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(val);
    }
  });

  setTimeout(() => searchInput.focus(), 80);

  const DEFAULT_LINKS = [
    { label: 'Gmail',    url: 'https://mail.google.com',    icon: 'https://www.google.com/favicon.ico' },
    { label: 'YouTube',  url: 'https://youtube.com',         icon: 'https://youtube.com/favicon.ico' },
    { label: 'GitHub',   url: 'https://github.com',          icon: 'https://github.com/favicon.ico' },
    { label: 'Maps',     url: 'https://maps.google.com',     icon: 'https://maps.google.com/favicon.ico' },
    { label: 'Notion',   url: 'https://notion.so',           icon: 'https://notion.so/favicon.ico' },
  ];

  function renderQuickLinks(links) {
    const container = document.getElementById('quick-links');
    container.innerHTML = '';
    for (const link of links) {
      const a = document.createElement('a');
      a.className = 'ql';
      a.href = link.url;
      a.innerHTML = `
        <img class="ql-favicon" src="${link.icon}" alt="" onerror="this.style.display='none'">
        ${link.label}
      `;
      container.appendChild(a);
    }
  }

  renderQuickLinks(DEFAULT_LINKS);

  let W, H;
  let calmScore = 70; 

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function loadCalm() {
    chrome.storage.local.get(['calmScore'], (res) => {
      if (res.calmScore !== undefined) calmScore = res.calmScore;
    });
  }
  loadCalm();
  setInterval(loadCalm, 15000);

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = Math.imul(s ^ (s >>> 15), 1 | s);
      s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
      return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function lerpRgb(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function rgba(c, a) {
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  }

  function applyCalm(rgb, calm) {
    const t = calm / 100;
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const desat = lerpRgb(rgb, [avg, avg, avg], (1 - t) * 0.65);
    const dark = 0.45 + t * 0.55;
    return [desat[0] * dark, desat[1] * dark, desat[2] * dark];
  }

  function getHours() {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600;
  }

  function sampleKf(kf, h) {
    const hh = h % 24;
    for (let i = 0; i < kf.length - 1; i++) {
      if (hh >= kf[i].h && hh < kf[i + 1].h) {
        const t = (hh - kf[i].h) / (kf[i + 1].h - kf[i].h);
        const out = {};
        for (const k of Object.keys(kf[i])) {
          if (k !== 'h') out[k] = lerpRgb(kf[i][k], kf[i + 1][k], t);
        }
        return out;
      }
    }
    return kf[kf.length - 1];
  }

  const SKY_KF = [
    { h: 0,    top: [5, 6, 22],       bot: [10, 10, 38] },
    { h: 4.5,  top: [8, 7, 30],       bot: [18, 12, 52] },
    { h: 5.5,  top: [25, 12, 65],     bot: [170, 65, 95] },
    { h: 6.5,  top: [45, 35, 130],    bot: [255, 145, 75] },
    { h: 7.5,  top: [55, 100, 195],   bot: [255, 205, 115] },
    { h: 9,    top: [70, 135, 225],   bot: [175, 215, 255] },
    { h: 12,   top: [75, 148, 238],   bot: [158, 208, 255] },
    { h: 15,   top: [70, 138, 228],   bot: [165, 212, 255] },
    { h: 17,   top: [58, 108, 198],   bot: [255, 182, 98] },
    { h: 18.5, top: [38, 55, 148],    bot: [255, 115, 55] },
    { h: 19.5, top: [22, 22, 88],     bot: [195, 55, 38] },
    { h: 20.5, top: [12, 12, 55],     bot: [75, 28, 65] },
    { h: 22,   top: [6, 7, 32],       bot: [12, 12, 48] },
    { h: 24,   top: [5, 6, 22],       bot: [10, 10, 38] },
  ];

  const MTN_KF = [
    { h: 0,    far: [18, 15, 45],  mid: [12, 10, 32],  near: [8, 8, 22] },
    { h: 5.5,  far: [38, 22, 75],  mid: [25, 15, 55],  near: [15, 10, 38] },
    { h: 6.5,  far: [75, 55, 138], mid: [48, 35, 95],  near: [28, 22, 62] },
    { h: 7.5,  far: [95, 95, 172], mid: [65, 72, 142], near: [38, 48, 95] },
    { h: 9,    far: [112, 132, 195], mid: [78, 95, 158], near: [48, 65, 118] },
    { h: 12,   far: [105, 135, 188], mid: [72, 98, 152], near: [42, 65, 112] },
    { h: 15,   far: [100, 128, 182], mid: [68, 92, 148], near: [40, 60, 108] },
    { h: 17,   far: [92, 115, 172], mid: [62, 82, 140], near: [38, 55, 102] },
    { h: 18.5, far: [72, 65, 135], mid: [50, 45, 105],  near: [30, 28, 72] },
    { h: 19.5, far: [45, 32, 95],  mid: [30, 22, 72],   near: [18, 14, 48] },
    { h: 21,   far: [22, 18, 55],  mid: [15, 12, 40],   near: [10, 8, 28] },
    { h: 24,   far: [18, 15, 45],  mid: [12, 10, 32],   near: [8, 8, 22] },
  ];

  const GND_KF = [
    { h: 0,    c: [6, 8, 18] },
    { h: 6,    c: [18, 14, 32] },
    { h: 7.5,  c: [32, 42, 22] },
    { h: 9,    c: [42, 58, 30] },
    { h: 12,   c: [45, 62, 32] },
    { h: 17,   c: [38, 52, 24] },
    { h: 19,   c: [28, 32, 15] },
    { h: 20.5, c: [12, 12, 18] },
    { h: 24,   c: [6, 8, 18] },
  ];

  function makeMountainWaves(seed, count) {
    const r = makeRng(seed);
    const waves = [];
    for (let i = 0; i < count; i++) {
      waves.push({
        amp: r() * 55 + 18,
        freq: r() * 0.0028 + 0.0008,
        phase: r() * Math.PI * 2,
        drift: (r() - 0.5) * 0.00015,
      });
    }
    return waves;
  }

  const FAR_WAVES  = makeMountainWaves(1001, 5);
  const MID_WAVES  = makeMountainWaves(2002, 7);
  const NEAR_WAVES = makeMountainWaves(3003, 5);

  function mountainY(waves, x, baseY, t) {
    let y = 0;
    for (const w of waves) {
      y += Math.sin(x * w.freq + w.phase + t * w.drift) * w.amp;
    }
    return baseY + y;
  }

  function drawMountainLayer(waves, baseY, color, t, alpha) {
    ctx.beginPath();
    ctx.moveTo(-1, H + 1);
    for (let x = 0; x <= W + 3; x += 2) {
      ctx.lineTo(x, mountainY(waves, x, baseY, t));
    }
    ctx.lineTo(W + 1, H + 1);
    ctx.closePath();
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
  }

  const TREES = [];
  {
    const r = makeRng(4004);
    for (let i = 0; i < 45; i++) {
      TREES.push({
        nx: r(),                         
        hFrac: r() * 0.065 + 0.032,     
        pine: r() > 0.38,
        dx: r() * 28 - 14,         
      });
    }
    TREES.sort((a, b) => a.nx - b.nx);
  }

  function drawPine(x, y, h) {
    const w = h * 0.52;
    for (let i = 0; i < 3; i++) {
      const layerBot = y - (h * 0.18 * i);
      const layerTop = layerBot - h * 0.38;
      const hw = w * (1.05 - i * 0.3);
      ctx.beginPath();
      ctx.moveTo(x, layerTop);
      ctx.lineTo(x - hw, layerBot);
      ctx.lineTo(x + hw, layerBot);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(x - w * 0.07, y, w * 0.14, h * 0.18);
  }

  function drawRoundTree(x, y, h) {
    const r1 = h * 0.42;
    const r2 = h * 0.28;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.55, r1, r1 * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + r1 * 0.3, y - h * 0.78, r2, r2 * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - h * 0.06, y - h * 0.14, h * 0.12, h * 0.18);
  }

  function drawTrees(waves, baseY, t, mtnColor, calm) {
    const treeBase = lerpRgb(
      applyCalm([22, 50, 28], calm),
      applyCalm([12, 28, 16], calm),
      (1 - calm / 100) * 0.6
    );
    ctx.fillStyle = rgba(treeBase, 0.92);
    for (const tree of TREES) {
      const tx = tree.nx * W + tree.dx;
      const ty = mountainY(waves, tx, baseY, t);
      const th = tree.hFrac * H;
      if (tree.pine) drawPine(tx, ty, th);
      else drawRoundTree(tx, ty, th);
    }
  }

  const CLOUDS = [];
  {
    const r = makeRng(5005);
    for (let i = 0; i < 14; i++) {
      CLOUDS.push({
        nx: r(),
        ny: r() * 0.38 + 0.04,
        size: r() * 0.14 + 0.05,
        speed: r() * 0.000055 + 0.000018,
        opacity: r() * 0.55 + 0.28,
        puffs: Math.floor(r() * 4) + 3,
        seed: r(),
      });
    }
  }

  function drawCloud(cloud, t, storminess) {
    const nx = (cloud.nx + t * cloud.speed) % 1.22 - 0.11;
    const cx = nx * W;
    const cy = cloud.ny * H;
    const sz = cloud.size * W;
    const stormScale = 1 + storminess * 0.55;

    const base = lerpRgb([238, 244, 255], [60, 65, 82], storminess * 0.72);
    const op = cloud.opacity * (0.45 + storminess * 0.55);

    ctx.fillStyle = rgba(base, op);

    ctx.beginPath();
    ctx.ellipse(cx, cy, sz * 0.65 * stormScale, sz * 0.38 * stormScale, 0, 0, Math.PI * 2);
    ctx.fill();

    const r = makeRng((cloud.seed * 9999) | 0);
    for (let i = 0; i < cloud.puffs; i++) {
      const angle = (i / cloud.puffs) * Math.PI * 2;
      const px = cx + Math.cos(angle) * sz * 0.42;
      const py = cy + Math.sin(angle) * sz * 0.18;
      const pr = sz * (0.32 + r() * 0.22) * stormScale;
      ctx.beginPath();
      ctx.ellipse(px, py, pr, pr * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const RAIN = [];
  for (let i = 0; i < 320; i++) {
    RAIN.push({
      x: Math.random(),
      y: Math.random(),
      spd: Math.random() * 0.009 + 0.005,
      len: Math.random() * 14 + 5,
      op: Math.random() * 0.4 + 0.15,
    });
  }

  function drawRain(storminess, t) {
    if (storminess < 0.25) return;
    const intensity = Math.pow((storminess - 0.25) / 0.75, 1.4);
    const count = Math.floor(intensity * 260);
    ctx.save();
    ctx.strokeStyle = `rgba(188, 210, 228, ${intensity * 0.28})`;
    ctx.lineWidth = 0.6;
    for (let i = 0; i < count; i++) {
      const d = RAIN[i];
      const x = ((d.x + t * 0.000035 * i * 0.012) % 1) * W;
      const y = ((d.y + t * d.spd) % 1) * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - d.len * 0.22, y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  const STARS = [];
  {
    const r = makeRng(6006);
    for (let i = 0; i < 180; i++) {
      STARS.push({
        nx: r(), ny: r() * 0.72,
        sz: r() * 1.6 + 0.3,
        twinklePhase: r() * Math.PI * 2,
        twinkleSpeed: r() * 0.0012 + 0.0004,
      });
    }
  }

  function drawStars(nightAmt, t) {
    if (nightAmt < 0.05) return;
    for (const s of STARS) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);
      ctx.fillStyle = `rgba(255, 252, 228, ${nightAmt * tw * 0.82})`;
      ctx.beginPath();
      ctx.arc(s.nx * W, s.ny * H, s.sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMoon(nightAmt, hours) {
    if (nightAmt < 0.15) return;
    const mx = 0.14 + Math.sin((hours - 21) * 0.18) * 0.07;
    const my = 0.08 + Math.abs(Math.sin((hours - 21) * 0.12)) * 0.04;
    const mr = Math.min(W, H) * 0.024;

    const g = ctx.createRadialGradient(mx * W, my * H, mr * 0.5, mx * W, my * H, mr * 5);
    g.addColorStop(0, `rgba(255, 250, 215, ${nightAmt * 0.18})`);
    g.addColorStop(1, 'rgba(255, 250, 215, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx * W, my * H, mr * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 252, 228, ${nightAmt * 0.92})`;
    ctx.beginPath();
    ctx.arc(mx * W, my * H, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSun(dayAmt, hours) {
    if (dayAmt < 0.08 || hours < 6.2 || hours > 19.8) return;
    const progress = (hours - 6.2) / (19.8 - 6.2);
    const sx = lerp(0.06, 0.94, progress);
    const sy = 0.06 + (0.5 - Math.sin(progress * Math.PI)) * 0.22;
    const sr = Math.min(W, H) * 0.028;

    const g2 = ctx.createRadialGradient(sx * W, sy * H, sr, sx * W, sy * H, sr * 7);
    const isLow = sy > 0.18; // near horizon
    g2.addColorStop(0, `rgba(255, 235, 165, ${dayAmt * (isLow ? 0.35 : 0.22)})`);
    g2.addColorStop(0.5, `rgba(255, 200, 100, ${dayAmt * (isLow ? 0.18 : 0.08)})`);
    g2.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(sx * W, sy * H, sr * 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255, 248, 210, ${dayAmt * 0.95})`;
    ctx.beginPath();
    ctx.arc(sx * W, sy * H, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFog(color, atY, storminess) {
    const op = 0.08 + storminess * 0.42;
    const g = ctx.createLinearGradient(0, atY - H * 0.10, 0, atY + H * 0.06);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.45, rgba(color, op));
    g.addColorStop(1, rgba(color, op * 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(0, atY - H * 0.10, W, H * 0.18);
  }

  function drawWaterSheen(skyBot, groundY, t, calm) {
    if (calm < 40) return; // hides in storms
    const op = ((calm - 40) / 60) * 0.12;
    const g = ctx.createLinearGradient(0, groundY, 0, groundY + H * 0.04);
    g.addColorStop(0, rgba(skyBot, op));
    g.addColorStop(1, rgba(skyBot, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY, W, H * 0.04);
  }

  function drawVignette(storminess) {
    const op = 0.28 + storminess * 0.22;
    const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.15, W / 2, H * 0.55, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${op})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function updateTimeUI() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    timeEl.textContent = `${h12}:${m} ${ampm}`;

    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    dateEl.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  }
  updateTimeUI();
  setInterval(updateTimeUI, 1000);

  function render(timestamp) {
    const t = timestamp || 0;
    const hours = getHours();
    const calm = calmScore;
    const storminess = 1 - calm / 100; 

    const nightAmt = hours < 6
      ? 1
      : hours < 7.5
        ? 1 - (hours - 6) / 1.5
        : hours > 20.5
          ? (hours - 20.5) / 2
          : hours > 22
            ? 1
            : 0;
    const dayAmt = 1 - nightAmt;

    const sky = sampleKf(SKY_KF, hours);
    const mtn = sampleKf(MTN_KF, hours);
    const gnd = sampleKf(GND_KF, hours);

    const skyTop  = applyCalm(sky.top, calm);
    const skyBot  = applyCalm(sky.bot, calm);
    const farCol  = applyCalm(mtn.far,  calm);
    const midCol  = applyCalm(mtn.mid,  calm);
    const nearCol = applyCalm(mtn.near, calm);
    const gndCol  = applyCalm(gnd.c,    calm * 0.88);
    const fogCol  = lerpRgb([195, 208, 228], [140, 150, 162], storminess);

    const skyGrd = ctx.createLinearGradient(0, 0, 0, H);
    skyGrd.addColorStop(0,    rgba(skyTop, 1));
    skyGrd.addColorStop(0.75, rgba(skyBot, 1));
    ctx.fillStyle = skyGrd;
    ctx.fillRect(0, 0, W, H);

    drawStars(nightAmt, t);

    drawMoon(nightAmt, hours);
    drawSun(dayAmt, hours);

    const farBase  = H * 0.50;
    drawMountainLayer(FAR_WAVES,  farBase,  farCol,  t, 0.82);

    const midBase  = H * 0.60;
    drawMountainLayer(MID_WAVES,  midBase,  midCol,  t, 0.90);

    const nearBase = H * 0.70;
    drawMountainLayer(NEAR_WAVES, nearBase, nearCol, t, 1.00);

    drawTrees(NEAR_WAVES, nearBase, t, nearCol, calm);

    const groundY = mountainY(NEAR_WAVES, W / 2, nearBase, t) + 2;
    {
      const grdFill = ctx.createLinearGradient(0, groundY, 0, H);
      grdFill.addColorStop(0,   rgba(gndCol, 1));
      grdFill.addColorStop(0.4, rgba(lerpRgb(gndCol, [0, 0, 0], 0.35), 1));
      grdFill.addColorStop(1,   rgba(lerpRgb(gndCol, [0, 0, 0], 0.55), 1));
      ctx.fillStyle = grdFill;
      ctx.fillRect(0, groundY, W, H - groundY);
    }

    drawWaterSheen(skyBot, groundY, t, calm);

    drawFog(fogCol, nearBase, storminess);

    for (const cloud of CLOUDS) drawCloud(cloud, t, storminess);

    drawRain(storminess, t);

    if (storminess > 0.5) {
      ctx.fillStyle = `rgba(20, 25, 42, ${(storminess - 0.5) * 0.38})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawVignette(storminess);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);

})();
