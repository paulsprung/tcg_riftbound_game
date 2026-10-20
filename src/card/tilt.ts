/*
 * Pointer and gyroscope tilt, ported from the birthday-card project.
 *
 * Rotation and scale run on springs rather than a linear ease, so the card
 * overshoots a touch and settles; that elasticity is most of what makes it
 * feel like an object rather than a div. Everything is written as CSS
 * variables on the scene element, and the foil layers read them:
 *
 *   --tx/--ty   tilt, -1..1
 *   --sc        scale
 *   --px/--py   pointer over the card, 0..100
 *   --bgx/--bgy pointer remapped to a narrower travel for the foil
 *   --pfc       0 at the centre, 1 out at the corners; drives intensity
 *
 * The animation loop only runs while something is moving, so a grid of a
 * thousand cards costs nothing until you touch one.
 */

export interface TiltOptions {
  /** Keep gently swaying when nobody is touching it. */
  idle?: boolean;
  /** Follow the phone's tilt (asks for permission on iOS on first tap). */
  gyro?: boolean;
  hoverScale?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const SPRING = { k: 0.12, d: 0.72 };
const GYRO_RANGE = 26;   // degrees of phone tilt for a full card tilt

function step(cur: number, vel: number, target: number, k: number, d: number): [number, number] {
  vel += (target - cur) * k;
  vel *= d;
  return [cur + vel, vel];
}

export function createTilt(scene: HTMLElement, opts: TiltOptions = {}) {
  const { idle = false, gyro = false, hoverScale = 1.04 } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Every variable repaints the foil. On a phone, 30 writes a second look
  // the same as 60 and halve the work.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const MIN_FRAME = coarse ? 1000 / 30 : 0;

  const s = {
    tx: 0, ty: 0, vx: 0, vy: 0, sc: 1, vsc: 0, px: 50, py: 50,
    wx: 0, wy: 0, wpx: 50, wpy: 50,
  };
  let hovering = false;
  let running = false;
  let raf = 0;
  let lastWrite = 0;
  let lastInput = 0;
  let lastTouch = 0;
  let bounds: DOMRect | null = null;
  const start = performance.now();
  const written: Record<string, string> = {};

  const put = (name: string, value: string) => {
    if (written[name] === value) return;
    written[name] = value;
    scene.style.setProperty(name, value);
  };

  const settled = () =>
    Math.abs(s.tx - s.wx) + Math.abs(s.ty - s.wy) + Math.abs(s.vx) + Math.abs(s.vy) < 0.002 &&
    Math.abs(s.sc - (hovering ? hoverScale : 1)) < 0.001 &&
    Math.abs(s.px - s.wpx) + Math.abs(s.py - s.wpy) < 0.2;

  function loop(now: number) {
    raf = 0;
    if (document.hidden) { running = false; return; }

    if (idle && !reduced && now - lastInput > 2600) {
      const t = (now - start) / 1000;
      s.wx = Math.sin(t * 0.6) * 0.36;
      s.wy = Math.cos(t * 0.45) * 0.26;
      s.wpx = 50 + s.wx * 38;
      s.wpy = 50 + s.wy * 38;
      hovering = false;
    }

    if (now - lastWrite >= MIN_FRAME) {
      lastWrite = now;
      for (let i = 0; i < (MIN_FRAME ? 2 : 1); i++) {
        [s.tx, s.vx] = step(s.tx, s.vx, s.wx, SPRING.k, SPRING.d);
        [s.ty, s.vy] = step(s.ty, s.vy, s.wy, SPRING.k, SPRING.d);
        [s.sc, s.vsc] = step(s.sc, s.vsc, hovering ? hoverScale : 1, 0.1, 0.75);
        s.px += (s.wpx - s.px) * 0.17;
        s.py += (s.wpy - s.py) * 0.17;
      }
      const pfc = clamp(Math.hypot((s.px - 50) / 50, (s.py - 50) / 50), 0, 1);
      put('--tx', s.tx.toFixed(3));
      put('--ty', s.ty.toFixed(3));
      put('--sc', s.sc.toFixed(3));
      put('--px', s.px.toFixed(1));
      put('--py', s.py.toFixed(1));
      put('--bgx', (37 + s.px * 0.26).toFixed(1));
      put('--bgy', (33 + s.py * 0.34).toFixed(1));
      put('--pfc', pfc.toFixed(2));
    }

    if (!idle && !hovering && settled()) { running = false; return; }
    raf = requestAnimationFrame(loop);
  }

  function wake() {
    if (running || document.hidden) return;
    running = true;
    lastWrite = 0;
    raf = requestAnimationFrame(loop);
  }

  // The card itself is transformed every frame; measuring the untransformed
  // scene once, until something could have moved it, avoids layout thrash.
  const forget = () => { bounds = null; };

  function aim(clientX: number, clientY: number) {
    const r = bounds || (bounds = scene.getBoundingClientRect());
    if (!r.width) { bounds = null; return; }
    const nx = (clientX - r.left) / r.width;
    const ny = (clientY - r.top) / r.height;
    s.wx = clamp((nx - 0.5) * 2, -1.3, 1.3);
    s.wy = clamp((ny - 0.5) * 2, -1.3, 1.3);
    s.wpx = clamp(nx * 100, -12, 112);
    s.wpy = clamp(ny * 100, -12, 112);
    hovering = nx > -0.1 && nx < 1.1 && ny > -0.1 && ny < 1.1;
    lastInput = performance.now();
    wake();
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') lastTouch = performance.now();
    aim(e.clientX, e.clientY);
  };
  const onLeave = () => {
    hovering = false;
    s.wx = s.wy = 0;
    s.wpx = s.wpy = 50;
    lastInput = idle ? 0 : performance.now();
    wake();
  };

  /* -- gyroscope ---------------------------------------------------------
     The first reading becomes "flat", however the phone is being held.
     iOS only grants permission from inside a real tap, so we ask on taps
     until it answers. Inside an iframe the browser withholds the sensor
     entirely, and nothing the page does changes that. */
  let base: { x: number; y: number } | null = null;
  let gyroListening = false;

  function onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null && e.gamma === null) return;
    if (performance.now() - lastTouch < 1200) return;   // a finger wins
    const angle = (screen.orientation?.angle ?? 0) | 0;
    let x = e.gamma || 0;
    let y = e.beta || 0;
    if (angle === 90) { const t = x; x = y; y = -t; }
    if (angle === -90 || angle === 270) { const t = x; x = -y; y = t; }
    if (!base) base = { x, y };
    const dx = x - base.x;
    const dy = y - base.y;
    if (Math.abs(dx) > 90 || Math.abs(dy) > 90) return;   // wrapped past 180
    s.wx = clamp(dx / GYRO_RANGE, -1, 1);
    s.wy = clamp(dy / GYRO_RANGE, -1, 1);
    s.wpx = 50 + s.wx * 50;
    s.wpy = 50 + s.wy * 50;
    hovering = false;
    lastInput = performance.now();
    wake();
  }
  const recentre = () => { base = null; };

  function listenGyro() {
    if (gyroListening) return;
    gyroListening = true;
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    window.addEventListener('orientationchange', recentre, { passive: true });
  }

  type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
  const askGyro = async () => {
    const DOE = window.DeviceOrientationEvent as IOSOrientation | undefined;
    if (!DOE) return;
    if (typeof DOE.requestPermission !== 'function') { listenGyro(); return; }
    try {
      if ((await DOE.requestPermission()) === 'granted') {
        listenGyro();
        scene.removeEventListener('click', askGyro);
      }
    } catch { /* not inside a gesture yet; the next tap tries again */ }
  };

  scene.addEventListener('pointermove', onMove, { passive: true });
  scene.addEventListener('pointerdown', onMove, { passive: true });
  scene.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('resize', forget, { passive: true });
  window.addEventListener('scroll', forget, { passive: true, capture: true });
  document.addEventListener('visibilitychange', wake);
  if (gyro && !reduced) {
    const DOE = window.DeviceOrientationEvent as IOSOrientation | undefined;
    if (DOE && typeof DOE.requestPermission === 'function') scene.addEventListener('click', askGyro);
    else listenGyro();
  }
  if (idle) wake();

  return {
    destroy() {
      cancelAnimationFrame(raf);
      running = false;
      scene.removeEventListener('pointermove', onMove);
      scene.removeEventListener('pointerdown', onMove);
      scene.removeEventListener('pointerleave', onLeave);
      scene.removeEventListener('click', askGyro);
      window.removeEventListener('resize', forget);
      window.removeEventListener('scroll', forget, { capture: true });
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('orientationchange', recentre);
    },
  };
}
