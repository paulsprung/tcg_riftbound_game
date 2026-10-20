// holo-gl.js -- physically motivated holographic foil for Riftbound card scans.
//
// export function createHolo(canvas, { image, finish, rarity, style })
//   -> { update({tx,ty,px,py,pfc,on}), resize(cssW, cssH, dpr), destroy() }
//
// The model, in one paragraph: the card is a sheet of embossed holographic
// film (a diffraction grating) with transparent process ink printed on top.
// Light from a lamp above the viewer hits the film; the film sends back a
// white specular lobe (zeroth order) plus rainbows (first..third order) whose
// wavelength follows the grating equation  d * (V+L).g = m * lambda.  V and
// L are computed per pixel from the real 3D pose the CSS tilt gives the card
// (rotateX(-ty*14deg) rotateY(tx*14deg), perspective 1000px), so the rainbow
// is a coherent band that sweeps across the face as the card tilts, exactly
// like a real foil under a ceiling light. The ink acts as a filter the light
// passes twice: what we see is  art * (film reflectance)  -- light ink lets
// the foil bloom, dark ink keeps the art dark, saturated ink only lets its own
// hue through. Everything the art itself decides (where foil shows, etched
// contour lines and their orientation, the gold-stamped signature) is computed
// once from the scan into an aux texture.
//
// Lights: a ceiling lamp above/behind the viewer (key) and a dimmer source
// low right (fill), both fixed in the room, so the glare and the rainbow
// race across the face as the card tilts -- opposite the pointer, as a real
// card pressed down at that corner would. Only tx/ty/on drive the shading;
// px/py/pfc are accepted for API compatibility (the tilt already encodes them).
//
// Per finish (compiled as a #define variant, nothing unused runs):
//   none       varnish gloss only
//   foil/holo  film; epic adds glitter flakes (each its own tilted mirror)
//   etched     + etched lines: swirl contours (domain-warped stripes bent by
//              the art's luminance) and the art's own thin edges; each line
//              is a ridge that glints and diffracts with its own orientation
//   signature  + the white script strokes become mirror-like gold foil
//   ultimate   + cracked ice (Voronoi facets, each tilted its own way) and a
//              denser galaxy of glitter
// Precomputed at create/resize time (CPU, at display resolution capped at
// the scan's): aux (mask/etch/gold/orientation), flakes, ice shards.
//
// No dependencies, no network. WebGL1 (GLSL ES 1.00); uses WebGL2 if present.

const DEG = Math.PI / 180;
const TILT = 14 * DEG;
const PERSPECTIVE = 1000; // CSS px, same as the app's .scene
const REF = 420;          // shading geometry is normalised to a 420 px wide card

// ------------------------------------------------------------------ finishes
// foil: film strength, etch: etched lines, spark: glitter flakes,
// gold: gold-stamped signature, ice: cracked-ice shards, gloss: varnish
function finishParams(finish, rarity) {
  const p = { foil: 0, etch: 0, spark: 0, gold: 0, ice: 0, gloss: 1, grain: 0.006 };
  switch (finish) {
    case 'foil': Object.assign(p, { foil: 0.92, grain: 0.005 }); break;
    case 'holo': Object.assign(p, { foil: 1.0, grain: 0.007 }); if (rarity === 'epic') p.spark = 0.85; break;
    case 'etched': Object.assign(p, { foil: 1.15, etch: 1.0, spark: 0.35, grain: 0.008 }); break;
    case 'signature': Object.assign(p, { foil: 1.15, etch: 0.85, spark: 0.30, gold: 1.0, grain: 0.008 }); break;
    case 'ultimate': Object.assign(p, { foil: 1.2, etch: 0.3, spark: 1.0, ice: 1.0, grain: 0.009 }); break;
    default: break; // 'none': varnish gloss only
  }
  return p;
}

// ------------------------------------------------------------ GLSL sources
const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // y down, like the image
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uArt;   // premultiplied sRGB art
uniform sampler2D uAux;   // r foil mask, g etch lines, b gold mask, a etch orientation (0..pi)
uniform sampler2D uFlk;   // glitter: flake normal xy, core, star
uniform sampler2D uIce;   // cracked ice: shard normal xy, orientation, crack
uniform vec2 uTex;        // texture size (px)
uniform vec2 uCard;       // card size in reference px (shading geometry)
uniform mat3 uRot;        // CSS tilt rotation (card local -> view)
uniform vec3 uCam;        // eye position (view space, card centre at origin)
uniform vec3 uLamp;       // key light position (view space)
uniform vec4 uFill;       // fill light position + intensity
uniform float uOn;        // 0 resting .. 1 handled
uniform float uPx;        // one canvas pixel in texture px
uniform float uRadius;    // corner radius (texture px)
uniform vec4 uA;          // foil, etch, spark, gold
uniform vec4 uB;          // ice, vivid(0..1), gloss, grain
uniform float uDebug;

const float PI = 3.14159265;

vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Zucconi's 6-bump fit of the visible spectrum, 400..700 nm -> RGB.
vec3 bump3y(vec3 x, vec3 y) { vec3 r = 1.0 - x * x; return clamp(r - y, 0.0, 1.0); }
vec3 spectral(float w) {
  float x = (w - 400.0) / 300.0;
  if (x < -0.05 || x > 1.05) return vec3(0.0);
  x = clamp(x, 0.0, 1.0);
  const vec3 c1 = vec3(3.54585104, 2.93225262, 2.41593945);
  const vec3 x1 = vec3(0.69549072, 0.49228336, 0.27699880);
  const vec3 y1 = vec3(0.02312639, 0.15225084, 0.52607955);
  const vec3 c2 = vec3(3.90307140, 3.21182957, 3.96587128);
  const vec3 x2 = vec3(0.11748627, 0.86755042, 0.66077860);
  const vec3 y2 = vec3(0.84897130, 0.88445281, 0.73949448);
  return bump3y(c1 * (x - x1), y1) + bump3y(c2 * (x - x2), y2);
}

// Grating response for tangential vector u along grating direction g:
// orders 1..3 of  lambda = d * |u.g| / m.
vec3 grating(float ug, float d) {
  float a = abs(ug) * d;
  return spectral(a) + 0.45 * spectral(a * 0.5) + 0.18 * spectral(a / 3.0);
}
// first two orders only, for the secondary terms (the third barely shows)
vec3 grating2(float ug, float d) {
  float a = abs(ug) * d;
  return spectral(a) + 0.45 * spectral(a * 0.5);
}

// hue-preserving shoulder: compress the brightest channel, then let real
// over-exposure bloom towards white (as a photographed foil does). It only
// starts at 0.92 linear, so the untouched scan passes through (white -> 253).
vec3 tonemap(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m > 0.92) {
    float mm = 0.92 + 0.18 * (1.0 - exp(-(m - 0.92) / 0.18));
    c *= mm / m;
    c = mix(c, vec3(mm), clamp((m - 1.15) * 0.22, 0.0, 0.55));
  }
  return min(c, vec3(1.0));
}

// one lamp seen from this texel, in the card's local frame
struct Lit { vec2 u; vec2 hxy; float h2; float fres; float env; };
Lit lightAt(vec3 W, vec3 Vl, vec3 lamp, vec2 grain, float sig) {
  Lit o;
  vec3 L = normalize(lamp - W) * uRot;   // to card-local frame (normal = +z)
  vec3 S = Vl + L;
  vec3 H = normalize(S);
  o.u = S.xy + grain;                    // grating vector: d*(V+L).g = m*lambda
  o.hxy = H.xy;
  o.h2 = dot(H.xy, H.xy);
  float c = 1.0 - clamp(dot(Vl, H), 0.0, 1.0);
  o.fres = 0.04 + 0.96 * c * c * c * c * c;
  o.env = exp(-dot(o.u, o.u) / sig);     // diffraction efficiency vs angle
  return o;
}

// varnish clear coat: soft dielectric highlight
float glossOf(Lit l) { return (exp(-l.h2 / 0.010) * 0.9 + exp(-l.h2 / 0.06) * 0.25) * l.fres; }

// the film: rainbow orders + white zeroth order
vec3 filmOf(Lit l, vec2 g, float D, float vivid, bool full) {
  vec3 rb = full ? grating(dot(l.u, g), D) : grating2(dot(l.u, g), D);
  float rl = dot(rb, vec3(0.3, 0.55, 0.15));
  rb = mix(vec3(rl) * vec3(1.12, 0.98, 0.78), rb, mix(0.50, 1.0, vivid));   // EN: warmer pastel
  float spec0 = exp(-l.h2 / 0.0045) * 2.2 + exp(-l.h2 / 0.03) * 0.18;
  return rb * l.env * mix(1.6, 2.3, vivid) + vec3(spec0) * mix(0.8, 1.0, vivid);
}

#ifdef HAS_ETCH
// etched ridge: flanks tilt across the line, so it glints when the half
// vector lies across the line, and diffracts with its own orientation
vec3 etchOf(Lit l, vec2 gn, vec2 tl, float D, float sig) {
  float al = dot(l.u, tl), ac = dot(l.u, gn);
  float glint = exp(-al * al / 0.010) * exp(-ac * ac / 0.5);
  return grating2(ac * 1.35 + al * 0.4, D) * 3.6 * exp(-dot(l.u, l.u) / (sig * 1.3)) + vec3(glint) * 1.8;
}
#endif

void main() {
  vec4 tex = texture2D(uArt, vUv);
  // rounded corners (3 mm on a 63 mm card), anti-aliased over one canvas pixel
  vec2 tp = vUv * uTex;
  vec2 q = abs(tp - 0.5 * uTex) - (0.5 * uTex - uRadius);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float alpha = tex.a * clamp(0.5 - sd / max(uPx, 1e-3), 0.0, 1.0);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 art = tex.rgb / max(tex.a, 1e-4);
  vec3 lin = art * art;                  // light is added in (gamma 2.0) linear space
  vec4 aux = texture2D(uAux, vUv);
#ifdef DEBUG_VIEW
  float v = uDebug < 1.5 ? aux.r : uDebug < 2.5 ? aux.g : uDebug < 3.5 ? aux.b : aux.a;
  gl_FragColor = vec4(vec3(v) * alpha, alpha); return;
#endif

  float vivid = uB.y;
  float on = uOn;
  float kOn = mix(0.22, 1.0, on);       // a resting card shows only a hint

  vec3 P = vec3((vUv - 0.5) * uCard, 0.0);
  vec3 W = uRot * P;
  vec3 Vl = normalize(uCam - W) * uRot;
  float sig = mix(0.40, 0.55, vivid);   // angular spread of the diffracted light

  // micro-facets of the film: a fine, stable grain
  vec4 gh = hash42(floor(tp / max(1.0, 1.25 * uPx)));
  vec2 grain = (gh.xy - 0.5) * uB.w * (1.0 + 0.5 * vivid);

  Lit lk = lightAt(W, Vl, uLamp, grain, sig);       // ceiling lamp
  Lit lf = lightAt(W, Vl, uFill.xyz, grain, sig);   // dim fill, low right
  float fw = uFill.w;
  vec3 col = lin;

  // slowly wandering grating direction (no repeating texture)
  float ang = -0.62 + 0.42 * sin(vUv.x * 3.1 + vUv.y * 1.7 + 0.6) + 0.30 * sin(vUv.y * 4.3 - vUv.x * 2.2 + 2.0);
  vec2 g = vec2(cos(ang), sin(ang));
  float D = mix(1750.0, 1900.0, vivid);
#ifdef HAS_FOIL
  vec3 film = filmOf(lk, g, D, vivid, true) + fw * filmOf(lf, g, D, vivid, false);

#ifdef HAS_ETCH
  float e = aux.g * uA.y;
  float th = aux.a * PI;
  vec2 gn = vec2(cos(th), sin(th));          // across the etched line
  vec2 tl = vec2(-gn.y, gn.x);               // along it
  vec3 line = etchOf(lk, gn, tl, D, sig) + fw * etchOf(lf, gn, tl, D, sig);
  film = mix(film * (1.0 - 0.32 * uA.y), film * 0.3 + line, clamp(e * 1.15, 0.0, 1.0));
#endif

#ifdef HAS_ICE
  // each shard is a facet of film tilted its own way: it flashes when its
  // normal meets the half vector, and throws its own rainbow order
  vec4 ice = texture2D(uIce, vUv);           // shard normal xy, orientation, crack
  vec2 us = lk.u - (ice.xy - 0.5) * 1.1;
  float sa = ice.z * PI;
  vec2 sdir = vec2(cos(sa), sin(sa));
  float sh2 = dot(us, us);
  float lit = exp(-sh2 / 0.025);
  vec3 hue = spectral(410.0 + 280.0 * fract(ice.z * 11.7 + dot(lk.u, sdir) * 0.9));
  float senv = exp(-sh2 / (sig * 0.7));      // the shard's own diffraction envelope
  vec3 shard = (grating2(dot(us, sdir), D) * 0.9 + hue * 0.55) * (1.5 * senv + 2.2 * lit)
             + (hue * 0.5 + 0.5) * exp(-sh2 / 0.008) * 1.4;
  film = mix(film, shard, 0.72 * uB.x) + vec3(ice.w * (lit + 0.25 * senv) * 1.1);
#endif
  film *= kOn;

  // ---- compose: ink over film. The ink is a filter the light crosses
  // twice; dark ink keeps the art dark, light ink lets the film bloom.
  float mask = aux.r * uA.x;
  vec3 T = lin * (1.6 - 0.6 * lin);
  float dim = mix(0.10, 0.18, vivid) * on * (1.0 - clamp(lk.env + fw * lf.env, 0.0, 1.0) * 0.5);
  col = lin * (1.0 - dim * mask) + T * film * mask;

#ifdef HAS_GLITTER
  // glitter: tiny mirrors, each with its own normal (precomputed field)
  vec4 fl = texture2D(uFlk, vUv);            // flake normal xy, core, star
  vec2 dn = lk.hxy - (fl.xy - 0.5) * 0.95;
  float a = exp(-dot(dn, dn) / mix(0.0016, 0.0022, uB.x));
  vec3 fc = mix(vec3(1.0), spectral(420.0 + 260.0 * fract(fl.x * 7.13 + fl.y * 3.7 + dot(lk.u, g) * 1.7)), 0.55 + 0.35 * vivid);
  vec3 glit = fc * (fl.z + fl.w * smoothstep(0.5, 1.0, a) * 0.8) * a * 5.0 * uA.z * kOn;
  col += glit * mask * (T * 0.7 + 0.06 + 0.25 * uB.x);
#endif
#endif

#ifdef HAS_GOLD
  // ---- gold-stamped signature: its own mirror-like metal foil
  float gm = aux.b * uA.w;
  vec3 gold = vec3(1.0, 0.62, 0.17);
  float lobe = exp(-lk.h2 / 0.05) + fw * exp(-lf.h2 / 0.05);
  float sharp = exp(-lk.h2 / 0.006) + fw * exp(-lf.h2 / 0.006);
  vec3 grb = grating2(dot(lk.u, g) * 0.8, D);
  vec3 gcol = gold * 0.42 * (0.85 + 0.3 * gh.z)
            + kOn * (gold * (1.2 * lobe + 0.8 * (lk.env + fw * lf.env)) + gold * grb * 0.5 * lk.env * (0.3 + 0.7 * vivid)
                     + vec3(1.0, 0.92, 0.7) * sharp * 1.8);
  col = mix(col, gcol, clamp(gm, 0.0, 1.0));
#endif

  // ---- varnish: clear coat over everything (all cards, even plain stock)
  col += vec3((glossOf(lk) + fw * glossOf(lf)) * uB.z * mix(0.35, 1.0, on) * 2.2);

  col = tonemap(col);
  vec3 outc = sqrt(max(col, 0.0));
  gl_FragColor = vec4(outc * alpha, alpha);
}`;

// ------------------------------------------------------- CPU precompute
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// separable running-sum box blur, clamped edges (row-major in both passes)
function boxBlur(src, w, h, r) {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[o + (k < 0 ? 0 : k > w - 1 ? w - 1 : k)];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc * inv;
      const xa = x + r + 1, xr = x - r;
      acc += src[o + (xa < w ? xa : w - 1)] - src[o + (xr > 0 ? xr : 0)];
    }
  }
  const acc = new Float32Array(w);
  for (let k = -r; k <= r; k++) { const o = (k < 0 ? 0 : k > h - 1 ? h - 1 : k) * w; for (let x = 0; x < w; x++) acc[x] += tmp[o + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, ya = y + r + 1, yr = y - r;
    const oa = (ya < h ? ya : h - 1) * w, or = (yr > 0 ? yr : 0) * w;
    for (let x = 0; x < w; x++) { out[o + x] = acc[x] * inv; acc[x] += tmp[oa + x] - tmp[or + x]; }
  }
  return out;
}
const gauss = (src, w, h, r) => boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);

// smooth value noise on a coarse lattice (for the swirl warp)
function valueNoise(w, h, cell, seed) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  let s = seed >>> 0;
  for (let i = 0; i < grid.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; grid[i] = s / 4294967296; }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

function computeAux(px, W, H, finish) {
  const N = W * H, s = W / 744;
  const lum = new Float32Array(N), sat = new Float32Array(N), minc = new Float32Array(N), lum2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[4 * i] / 255, g = px[4 * i + 1] / 255, b = px[4 * i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; lum2[i] = lum[i] * lum[i];
    sat[i] = mx > 0.02 ? (mx - mn) / mx : 0; minc[i] = mn;
  }
  const aux = new Uint8Array(N * 4);

  // R: foil mask. Foil blooms through light, open ink; saturated ink holds
  // it back; big flat white areas (text boxes) carry an opaque white
  // underlay on real foils, so they get less.
  const rb = Math.max(1, Math.round(4 * s));
  const m1 = boxBlur(lum, W, H, rb), m2 = boxBlur(lum2, W, H, rb);
  for (let i = 0; i < N; i++) {
    const sd = Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]));
    const flat = (1 - smooth(0.02, 0.07, sd)) * smooth(0.80, 0.94, m1[i]);
    const m = (1 - 0.42 * sat[i] * Math.sqrt(sat[i])) * (1 - 0.5 * flat);
    aux[4 * i] = Math.round(255 * Math.min(1, Math.max(0, m)));
  }

  const etched = finish === 'etched' || finish === 'signature' || finish === 'ultimate';
  if (etched) {
    // G/A: etched lines, A = orientation of the line normal (mod pi).
    // 1) swirl field: evenly spaced stripes, domain-warped into the flowing
    //    marbled contours of the CN etched foils, seeded by the art and
    //    bent by its luminance, so every card gets its own texture that
    //    kinks around the figure.
    // 2) the art's own linework: Canny-style thin edges (non-max suppressed
    //    Sobel on lightly blurred luminance).
    let seed = 0; for (let i = 0; i < N; i += 997) seed = (seed * 31 + px[4 * i] + 7 * px[4 * i + 1]) >>> 0;
    const fb = (cell, sd) => valueNoise(W, H, cell * W, sd);
    const n1 = fb(0.30, seed + 1), n2 = fb(0.30, seed + 2), n3 = fb(0.13, seed + 3), n4 = fb(0.13, seed + 4);
    const lb = gauss(lum, W, H, Math.max(1, Math.round(3 * s)));
    const SPACING = W / 58;                   // px between swirl lines (~7 px on a 420 px card)
    const F = W / SPACING;
    const ca = Math.cos(0.5), sa = Math.sin(0.5);
    const f = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W, v = y / W;
      const wx = u + 0.42 * (n1[i] - 0.5) + 0.12 * (n3[i] - 0.5);
      const wy = v + 0.42 * (n2[i] - 0.5) + 0.12 * (n4[i] - 0.5);
      f[i] = (wx * ca + wy * sa) * F + (n3[i] - 0.5) * 7 + lb[i] * 3.2;
    }
    const le = gauss(lum, W, H, 1);
    const mag = new Float32Array(N), gxa = new Float32Array(N), gya = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const sx = (le[i - W + 1] + 2 * le[i + 1] + le[i + W + 1]) - (le[i - W - 1] + 2 * le[i - 1] + le[i + W - 1]);
      const sy = (le[i + W - 1] + 2 * le[i + W] + le[i + W + 1]) - (le[i - W - 1] + 2 * le[i - W] + le[i - W + 1]);
      gxa[i] = sx; gya[i] = sy; mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
    const hw = Math.max(0.55, 0.085 * SPACING); // half line width (px)
    const f0 = Math.max(2.4, 0.33 * SPACING), f1 = Math.max(3.8, 0.62 * SPACING);
    // edge density: text is a thicket of short edges, art linework is sparse
    const ed = new Float32Array(N), thin = new Uint8Array(N);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x, m = mag[i];
      if (m < 0.28) continue;
      const ux = gxa[i] / m, uy = gya[i] / m;
      if (m >= mag[Math.round(y + uy) * W + Math.round(x + ux)] && m >= mag[Math.round(y - uy) * W + Math.round(x - ux)]) { thin[i] = 1; ed[i] = 1; }
    }
    const dens = boxBlur(ed, W, H, Math.max(5, Math.round(16 * s)));
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const gx = (f[i + 1] - f[i - 1]) * 0.5, gy = (f[i + W] - f[i - W]) * 0.5;
      const gm = Math.sqrt(gx * gx + gy * gy) + 1e-6;
      const dist = Math.abs(f[i] - Math.round(f[i])) / gm;       // px to the nearest swirl line
      const line = Math.min(1, Math.max(0, 1 - (dist - hw) / 0.8));
      const fade = smooth(f0, f1, 1 / gm);                        // drop lines that crowd together
      let e = line * fade * 0.85;
      let ang = Math.atan2(gy, gx);
      // thin art edges: keep the gradient maximum across the edge only
      if (thin[i]) {
        const em = smooth(0.28, 0.8, mag[i]) * (1 - smooth(0.10, 0.20, dens[i]));
        if (em > e) { e = em; ang = Math.atan2(gya[i], gxa[i]); }
      }
      if (ang < 0) ang += Math.PI;
      if (ang >= Math.PI) ang -= Math.PI;
      aux[4 * i + 1] = Math.round(255 * e);
      aux[4 * i + 3] = Math.round(255 * ang / Math.PI) & 255;
    }
  }

  if (finish === 'signature') {
    // B: gold-stamped signature = thin pure-white script strokes in the art
    // window: white top-hat (brighter than its surroundings) + near-white,
    // grouped into connected components; only long strokes survive.
    const bg = boxBlur(lum, W, H, Math.max(2, Math.round(7 * s)));
    const y0 = Math.round(0.08 * H), y1 = Math.round(0.70 * H);
    const cand = new Uint8Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (minc[i] > 0.80 && lum[i] - bg[i] > 0.10) cand[i] = 1;
    }
    // union-find, 8-connected
    const par = new Int32Array(N).fill(-1);
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!cand[i]) continue; par[i] = i;
      const nb = [x > 0 ? i - 1 : -1, y > y0 ? i - W : -1, y > y0 && x > 0 ? i - W - 1 : -1, y > y0 && x < W - 1 ? i - W + 1 : -1];
      for (const j of nb) if (j >= 0 && cand[j]) { const a = find(i), b = find(j); if (a !== b) par[a] = b; }
    }
    const box = new Map();
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!cand[i]) continue; const r = find(i);
      let b = box.get(r); if (!b) { b = [x, y, x, y, 0, 0]; box.set(r, b); }
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; b[4]++; b[5] += sat[i];
    }
    // script strokes: long, thin, neutral white (pale-pink highlights are
    // not), and clustered around the biggest such stroke (icons are not)
    const minSpan = 0.07 * W;
    const ok = (b) => { const span = Math.max(b[2] - b[0], b[3] - b[1]), fill = b[4] / ((b[2] - b[0] + 1) * (b[3] - b[1] + 1)); return span >= minSpan * 0.5 && fill < 0.25 && b[5] / b[4] < 0.045; };
    let big = null;
    for (const b of box.values()) if (ok(b) && (!big || Math.max(b[2] - b[0], b[3] - b[1]) > Math.max(big[2] - big[0], big[3] - big[1]))) big = b;
    const pad = 0.1 * W;
    const near = (b) => big && Math.max(big[2] - big[0], big[3] - big[1]) >= minSpan * 1.5 && b[2] >= big[0] - pad && b[0] <= big[2] + pad && b[3] >= big[1] - pad && b[1] <= big[3] + pad;
    const keep = new Uint8Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!cand[i]) continue; const b = box.get(find(i));
      if (ok(b) && near(b)) keep[i] = 1;
    }
    // grow by ~1px to catch the anti-aliased rim, with a soft coverage
    const rr = Math.max(1, Math.round(1.5 * s));
    const grown = new Uint8Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      if (!keep[y * W + x]) continue;
      for (let yy = Math.max(0, y - rr); yy <= Math.min(H - 1, y + rr); yy++) for (let xx = Math.max(0, x - rr); xx <= Math.min(W - 1, x + rr); xx++) grown[yy * W + xx] = 1;
    }
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grown[i]) continue;
      const cov = keep[i] ? 1 : smooth(0.30, 0.80, minc[i]) * smooth(0.02, 0.12, lum[i] - bg[i]);
      aux[4 * i + 2] = Math.round(255 * cov);
    }
  }
  return aux;
}

// integer hash -> 4 floats in [0,1)
function hash4(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  const out = [];
  for (let k = 0; k < 4; k++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
    out.push((h >>> 0) / 4294967296); h = (h + 0x9e3779b9) | 0;
  }
  return out;
}

// Glitter field: one flake per cell, each a tiny mirror with its own normal.
// RG = flake normal (tangential, 0.5 = flat), B = gaussian core, A = 4-point star.
function computeFlakes(W, H, cells) {
  const out = new Uint8Array(W * H * 4);
  const cellPx = W / cells;
  const cw = Math.ceil(W / cellPx) + 1, ch = Math.ceil(H / cellPx) + 1;
  const cell = new Float32Array(cw * ch * 6);              // per cell: cx, cy, r, nx, ny  (hashed once)
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const h = hash4(i, j, 77), k = 6 * (j * cw + i);
    cell[k] = (i + 0.3 + 0.4 * h[0]) * cellPx; cell[k + 1] = (j + 0.3 + 0.4 * h[1]) * cellPx;
    cell[k + 2] = (0.9 + 0.8 * h[3]) * cellPx / 5; cell[k + 3] = h[2]; cell[k + 4] = hash4(i, j, 91)[0];
  }
  for (let y = 0; y < H; y++) {
    const iy = Math.floor((y + 0.5) / cellPx);
    for (let x = 0; x < W; x++) {
      const ix = Math.floor((x + 0.5) / cellPx), k = 6 * (iy * cw + ix), i = 4 * (y * W + x);
      const dx = x + 0.5 - cell[k], dy = y + 0.5 - cell[k + 1], r = cell[k + 2];
      out[i] = Math.round(255 * cell[k + 3]); out[i + 1] = Math.round(255 * cell[k + 4]);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > 12 * r && ay > 12 * r) continue;              // far from this flake: nothing to draw
      const core = Math.exp(-(dx * dx + dy * dy) / (r * r));
      const star = 0.5 * (Math.exp(-ax / (r * 2.6) - ay * ay / (0.18 * r * r)) + Math.exp(-ay / (r * 2.6) - ax * ax / (0.18 * r * r)));
      out[i + 2] = Math.round(255 * Math.min(1, core)); out[i + 3] = Math.round(255 * Math.min(1, star));
    }
  }
  return out;
}

// Cracked ice: Voronoi shards. RG = shard normal, B = grating orientation /
// hue seed, A = crack (thin seam between shards).
function computeIce(W, H, cells) {
  const out = new Uint8Array(W * H * 4);
  const cellPx = W / cells;
  const gw = Math.ceil(W / cellPx) + 2, gh = Math.ceil(H / cellPx) + 2;
  const pts = new Float32Array(gw * gh * 2), hs = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const h = hash4(i, j, 17); pts[2 * (j * gw + i)] = i + 0.05 + 0.9 * h[0]; pts[2 * (j * gw + i) + 1] = j + 0.05 + 0.9 * h[1];
    hs.push(hash4(i, j, 29));
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = (x + 0.5) / cellPx, gy = (y + 0.5) / cellPx, ix = Math.floor(gx), iy = Math.floor(gy);
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let j = Math.max(0, iy - 1); j <= Math.min(gh - 1, iy + 1); j++) for (let i = Math.max(0, ix - 1); i <= Math.min(gw - 1, ix + 1); i++) {
      const k = j * gw + i, ddx = pts[2 * k] - gx, ddy = pts[2 * k + 1] - gy, dd = ddx * ddx + ddy * ddy;
      if (dd < d1) { d2 = d1; d1 = dd; best = k; } else if (dd < d2) d2 = dd;
    }
    const h = hs[best], o = 4 * (y * W + x);
    const edge = (Math.sqrt(d2) - Math.sqrt(d1)) * cellPx;   // px to the seam (approx.)
    out[o] = Math.round(255 * h[0]); out[o + 1] = Math.round(255 * h[1]); out[o + 2] = Math.round(255 * h[2]);
    out[o + 3] = Math.round(255 * Math.max(0, 1 - smooth(0.0, 1.6, edge)));
  }
  return out;
}

// ----------------------------------------------------------------- GL utils
function compile(gl, type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('holo-gl shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}

function rotation(tx, ty) {
  // CSS: rotateX(a) rotateY(b) -> M = RX(a) * RY(b), column-major for GL
  const a = -ty * TILT, b = tx * TILT;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // RY columns: (cb,0,-sb) (0,1,0) (sb,0,cb); RX columns: (1,0,0) (0,ca,sa) (0,-sa,ca)
  const RX = [1, 0, 0, 0, ca, sa, 0, -sa, ca];
  const RY = [cb, 0, -sb, 0, 1, 0, sb, 0, cb];
  const M = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    let v = 0; for (let k = 0; k < 3; k++) v += RX[k * 3 + r] * RY[c * 3 + k];
    M[c * 3 + r] = v;
  }
  return M;
}

export function createHolo(canvas, { image, finish = 'holo', rarity = 'rare', style = 'subtle' } = {}) {
  const attrs = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  if (!gl) throw new Error('holo-gl: WebGL unavailable');
  const P = finishParams(finish, rarity);
  const debug = { mask: 1, etch: 2, gold: 3, angle: 4 }[createHolo.debug] || 0;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  const defs = [P.foil > 0 && 'HAS_FOIL', P.etch > 0 && 'HAS_ETCH', P.ice > 0 && 'HAS_ICE', P.spark > 0 && 'HAS_GLITTER', P.gold > 0 && 'HAS_GOLD', debug && 'DEBUG_VIEW']
    .filter(Boolean).map((d) => '#define ' + d + '\n').join('');
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, defs + FS));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('holo-gl link: ' + gl.getProgramInfoLog(prog));
  const U = {};
  for (const n of ['uArt', 'uAux', 'uFlk', 'uIce', 'uTex', 'uCard', 'uRot', 'uCam', 'uLamp', 'uFill', 'uOn', 'uPx', 'uRadius', 'uA', 'uB', 'uDebug']) U[n] = gl.getUniformLocation(prog, n);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const artTex = gl.createTexture(), auxTex = gl.createTexture();
  const flkTex = P.spark > 0 ? gl.createTexture() : null, iceTex = P.ice > 0 ? gl.createTexture() : null;
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  let mapW = 0, mapH = 0;
  let cssW = iw, cssH = ih, dpr = 1;

  // Build both textures at a given resolution (never above the scan's own).
  function build(w, h) {
    if (w === mapW && h === mapH) return;
    mapW = w; mapH = h;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.clearRect(0, 0, w, h);
    cx.drawImage(image, 0, 0, w, h);
    const data = cx.getImageData(0, 0, w, h).data;
    const aux = computeAux(data, w, h, finish);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // linear filtering on premultiplied colour
    if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    setTex(artTex, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);  // aux is data, not colour
    setTex(auxTex, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, aux));
    if (flkTex) { const fl = computeFlakes(w, h, P.ice > 0 ? 96 : 78); setTex(flkTex, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, fl)); }
    if (iceTex) { const ic = computeIce(w, h, 19); setTex(iceTex, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, ic)); }
  }
  function setTex(t, upload) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    upload();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize(w, h, d = 1) {
    cssW = w; cssH = h; dpr = d;
    const bw = Math.max(1, Math.round(w * d)), bh = Math.max(1, Math.round(h * d));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    // maps at display resolution (crisp etch lines, no aliasing), capped at the scan's
    let tw = Math.min(iw, bw), th = Math.round(tw * ih / iw);
    if (Math.abs(tw - mapW) / Math.max(1, mapW) < 0.12) { tw = mapW; th = mapH; }
    build(tw, th);
  }

  const lampBase = [-300, -1200, 2200];  // ceiling lamp above and behind the viewer
  const fill = [650, 900, 2000, 0.45];     // dimmer source low right (window / screen)
  let last = { tx: 0, ty: 0, px: 50, py: 50, pfc: 0, on: 0 };
  function update(state = {}) {
    const st = Object.assign(last, state);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, artTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, auxTex);
    if (flkTex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, flkTex); }
    if (iceTex) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, iceTex); }
    gl.uniform1i(U.uArt, 0); gl.uniform1i(U.uAux, 1); gl.uniform1i(U.uFlk, 2); gl.uniform1i(U.uIce, 3);
    gl.uniform2f(U.uTex, mapW, mapH);
    const k = REF / Math.min(cssW, cssH);
    gl.uniform2f(U.uCard, cssW * k, cssH * k);
    gl.uniformMatrix3fv(U.uRot, false, rotation(+st.tx || 0, +st.ty || 0));
    gl.uniform3f(U.uCam, 0, 0, PERSPECTIVE);
    gl.uniform3f(U.uLamp, lampBase[0], lampBase[1], lampBase[2]);
    gl.uniform4f(U.uFill, fill[0], fill[1], fill[2], fill[3]);
    gl.uniform1f(U.uOn, Math.min(1, Math.max(0, +st.on || 0)));
    gl.uniform1f(U.uPx, mapW / canvas.width);
    gl.uniform1f(U.uRadius, 0.0476 * Math.min(mapW, mapH));
    gl.uniform4f(U.uA, P.foil, P.etch, P.spark, P.gold);
    gl.uniform4f(U.uB, P.ice, style === 'vivid' ? 1 : 0, P.gloss, P.grain);
    gl.uniform1f(U.uDebug, debug);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    for (const t of [artTex, auxTex, flkTex, iceTex]) if (t) gl.deleteTexture(t); gl.deleteBuffer(vbo); gl.deleteProgram(prog);
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  }

  // precompute now, at the size the canvas is laid out at if we can tell
  // (so the usual resize() right after creation finds the maps ready)
  const d0 = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) resize(canvas.clientWidth, canvas.clientHeight, d0);
  else resize(iw, ih, 1);
  return { update, resize, destroy };
}
export const _internals = { computeAux, computeFlakes, computeIce }; // for tests/benchmarks
