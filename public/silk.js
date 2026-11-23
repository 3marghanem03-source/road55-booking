// Silk light ribbons for the hero, canvas 2D. No assets.
// Adapts quality on slow devices, pauses off screen, static frame for prefers-reduced-motion.

const RIBBONS = [
  { c: ['#ff2e93', '#8a2be2'], y: 0.36, amp: 0.10, freq: 0.9, speed: 0.22, phase: 0.0, spread: 0.16, twist: 0.7, alpha: 0.55 },
  { c: ['#3b6cff', '#22d3ee'], y: 0.58, amp: 0.12, freq: 0.7, speed: 0.17, phase: 2.1, spread: 0.20, twist: 0.55, alpha: 0.5 },
  { c: ['#8a2be2', '#3b6cff'], y: 0.74, amp: 0.08, freq: 1.1, speed: 0.26, phase: 4.0, spread: 0.12, twist: 0.9, alpha: 0.45 },
  { c: ['#ff2e93', '#22d3ee'], y: 0.22, amp: 0.06, freq: 1.3, speed: 0.14, phase: 5.2, spread: 0.08, twist: 1.1, alpha: 0.3 },
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, f) => {
  const A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * f)).join(',')})`;
};

export function startSilk(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { stop() {} };
  const weak = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 3;
  // Rendered below CSS resolution on purpose: the soft upscale looks like silk glow and keeps it cheap.
  let strands = weak ? 9 : 14;
  let scale = weak ? 0.4 : 0.5;
  let W = 0, H = 0, colors = [], raf = 0, running = false, visible = true;
  let last = 0, t = Math.random() * 50, frames = 0, slowSum = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * scale));
    H = Math.max(1, Math.round(r.height * scale));
    canvas.width = W; canvas.height = H;
    colors = RIBBONS.map((rb) => Array.from({ length: strands }, (_, k) => mix(rb.c[0], rb.c[1], strands === 1 ? 0 : k / (strands - 1))));
    if (!running) draw();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // slight diagonal flow like silk across the screen
    const portrait = H > W;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(portrait ? -0.5 : -0.22);
    const span = Math.hypot(W, H) * 1.1;
    const Hs = portrait ? H * 0.75 : H;
    ctx.translate(-span / 2, -Hs / 2);
    const step = span / 28;
    const TAU = Math.PI * 2;

    RIBBONS.forEach((rb, i) => {
      const yAt = (x, u) => {
        const fx = x / span;
        return Hs * rb.y
          + Hs * rb.amp * Math.sin(fx * rb.freq * TAU + t * rb.speed + rb.phase)
          + Hs * 0.04 * Math.sin(fx * 3.1 * TAU / 3 - t * rb.speed * 0.7 + rb.phase * 2)
          + u * Hs * rb.spread * Math.sin(fx * rb.twist * TAU + t * rb.speed * 0.6 + rb.phase);
      };
      // fine strands (the soft glow comes from CSS gradients behind the canvas: wide strokes are too slow)
      ctx.lineWidth = 1;
      for (let k = 0; k < strands; k++) {
        ctx.strokeStyle = colors[i][k];
        const u = strands === 1 ? 0 : k / (strands - 1) - 0.5;
        ctx.globalAlpha = rb.alpha * (0.25 + 0.75 * (1 - Math.abs(u) * 1.6)) * 0.5;
        if (ctx.globalAlpha <= 0.01) continue;
        ctx.beginPath();
        for (let x = 0; x <= span; x += step) x === 0 ? ctx.moveTo(x, yAt(x, u)) : ctx.lineTo(x, yAt(x, u));
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(ts) {
    if (!running) return;
    const dt = last ? Math.min(ts - last, 100) : 16;
    last = ts;
    t += dt / 1000;
    draw();
    // adaptive quality: if average frame time is slow, cut strands and resolution
    frames++; slowSum += dt;
    if (frames === 30) {
      if (slowSum / frames > 22 && (strands > 5 || scale > 0.3)) {
        strands = Math.max(5, Math.round(strands * 0.7));
        scale = Math.max(0.3, scale * 0.8);
        resize();
      }
      frames = 0; slowSum = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || reduced || !visible || document.hidden) return;
    running = true; last = 0; raf = requestAnimationFrame(frame);
  }
  function pause() { running = false; cancelAnimationFrame(raf); }

  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(resize, 150); }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); }).observe(canvas);
  }
  resize();
  draw();
  play();
  return {
    stop() { pause(); },
    snapshot(bg = '#070b1f') {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, W, H); x.drawImage(canvas, 0, 0);
      return c.toDataURL('image/jpeg', 0.7);
    },
  };
}
