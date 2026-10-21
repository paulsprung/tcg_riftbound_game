// holo-gl.js -- physically motivated holographic foil for Riftbound card scans.
// (final-gl: gl-physical refined with the judges' notes and grafts from the
//  other attempts)
//
// export function createHolo(canvas, { image, finish, rarity, style })
//   -> { update({tx,ty,px,py,pfc,on}), resize(cssW, cssH, dpr), destroy() }
//
// Model: the card is embossed holographic film (a diffraction grating) under
// transparent process ink. A lamp hits the film; the film returns a white
// mirror lobe (zeroth order) plus rainbows (orders 1-2) whose wavelength
// follows the grating equation  d * (V+L).g = m * lambda,  with V and L
// computed per pixel from the real 3D pose of the CSS tilt, so the rainbow is
// one coherent band that sweeps across the face. Extended room light smears
// the orders into a soft prism that covers the whole face at low strength.
// The ink is a filter the light crosses twice:
//   * true black never blooms (no veil: a resting card is pixel-for-pixel the
//     scan apart from a faint hint of foil, black borders stay at 0);
//   * light ink lets the film bloom; big saturated fields flash as coloured
//     metal, small saturated icons keep their hue;
//   * dark mid-tone ink reads as cool polished chrome (the void armour);
//   * opaque white ink (rules text, labels, numerals) blocks the film;
//   * faces and skin keep their modelling (the white lobe and the band are
//     held back there).
//
// Lights: the key lamp is "held" by the pointer while the card is handled (its
// mirror highlight sits at the pointer and the rainbow arcs around it, so the
// glare follows the hand); at rest it relaxes to a fixed ceiling lamp. A dim
// fill lamp low right adds a second, fainter rainbow. Styles: 'subtle' (EN) is
// a warm pastel single grating; 'vivid' (CN) a saturated full spectrum with a
// second crossed grating, a stronger prism and a chroma boost under ink.
//
// Per finish (compiled as a #define variant, nothing unused runs):
//   none       plain stock: a small varnish glint while handled, nothing at rest
//   foil/holo  film; epic adds glitter: procedural mirror flakes of a fixed
//              ~1 css px size (4-point stars on the brightest) that fire near
//              the moving highlight
//   etched     + etched marbling in the spirit of the CN overnumbered foils:
//              dense, closed, flowing contour lines of a domain-warped field,
//              spacing-normalised and bent by the art's tones, drawn as thin dark
//              grooves of constant pixel width (derivatives of a 16-bit field;
//              the line direction comes from the gradient, no angle texture) on
//              a brighter film. Spot-etch: faces/skin, saturated figure parts
//              and UI panels, dense detail and the rules-text box stay smooth
//   signature  + the white script becomes embossed, saturated gold foil (bevel
//              normal, brushed-metal ripple, hot glints that follow the light)
//   ultimate   + cracked ice: mirror shards that flash one at a time in their
//              own colour, unlit shards sink a little, seams only show next to
//              a lit shard; plus a galaxy of glitter
//
// Precompute: the art analysis (foil/glyph/skin masks, etch mask and contour
// field, signature mask and bevel) runs once per image+finish at scan
// resolution and is cached (re-creating on the same canvas for a style toggle
// costs only the upload); compiled programs are cached per GL context.
// WebGL2 uploads once at scan resolution with mipmaps, so resize() is free;
// WebGL1 resamples the cached maps when the canvas size changes a lot.
// Robustness: webglcontextlost/restored are handled (rebuild on restore),
// destroy() leaves the context alive for the next holo on the same canvas,
// update()/resize() after destroy() are no-ops, canvas.style is never touched.
//
// No dependencies, no network. WebGL2 (ESSL 3.00) when available, else WebGL1
// (OES_standard_derivatives when present, texel-offset gradients otherwise).
// Debug views: set createHolo.debug = 'mask'|'etch'|'gold'|'lines'|'lum'|'film'|'skin'.

const DEG = Math.PI / 180;
const TILT = 14 * DEG;
const PERSPECTIVE = 1000; // CSS px, same as the app's .scene
const REF = 420;          // shading geometry is normalised to a 420 px wide card

// ------------------------------------------------------------------ finishes
function finishParams(finish, rarity) {
  // foil: film strength, etch: etched lines, spark: glitter, gold: signature stamp,
  // ice: cracked ice, gloss: varnish highlight, body: chrome sheen in dark mid-tones
  const p = { foil: 0, etch: 0, spark: 0, gold: 0, ice: 0, gloss: 0.65, body: 0 };
  switch (finish) {
    case 'foil': Object.assign(p, { foil: 0.9 }); break;
    case 'holo': Object.assign(p, { foil: 1.0, body: 0.25 }); if (rarity === 'epic') p.spark = 1.0; break;
    case 'etched': Object.assign(p, { foil: 1.15, etch: 1.0, spark: 0.3, body: 0.7 }); break;
    case 'signature': Object.assign(p, { foil: 1.15, etch: 0.9, spark: 0.3, gold: 1.0, body: 0.7 }); break;
    case 'ultimate': Object.assign(p, { foil: 1.1, spark: 1.0, ice: 1.0, body: 0.0 }); break;
    default: p.gloss = 1; break;   // plain stock: the varnish is all it has
  }
  return p;
}
// style: sat (rainbow chroma), gain (rainbow strength), white (zeroth order), sig (angular spread)
const STYLES = {
  subtle: { sat: 0.62, gain: 1.8, white: 0.85, sig: 0.40, second: 0.0, boost: 0.0, D: 1750, prism: 0.20 },
  vivid: { sat: 1.0, gain: 2.3, white: 0.9, sig: 0.55, second: 0.55, boost: 0.35, D: 1850, prism: 0.34 },
};

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
uniform sampler2D uAux;   // r foil mask, g etch mask, b gold mask, a skin (faces)
uniform sampler2D uFld;   // rg 16-bit contour field, b broad art luminance
uniform sampler2D uX;     // signature: gold bevel slope xy | ultimate: shard normal xy, orientation, crack
uniform vec2 uTex;        // art texture size (px)
uniform vec2 uCard;       // card size in reference px (shading geometry)
uniform mat3 uRot;        // CSS tilt rotation (card local -> view)
uniform vec3 uCam;        // eye position (view space, card centre at origin)
uniform vec3 uLamp;       // key light position (view space)
uniform vec4 uFill;       // fill light position + intensity
uniform float uOn;        // 0 resting .. 1 handled
uniform float uPx;        // one canvas pixel in texture px
uniform float uRadius;    // corner radius (texture px)
uniform vec4 uA;          // foil, etch, spark, gold
uniform vec4 uB;          // ice, vivid(0..1), gloss, body
uniform vec4 uS;          // style: sat, gain, white, sig
uniform vec4 uS2;         // style: second grating, chroma boost, grating pitch D, prism sheen
uniform vec4 uGl;         // glitter: cells x, cells y, cell size (device px), flake radius (device px)
uniform vec2 uFv;         // contour field: value range, device px per field texel (fallback gradients)
uniform vec2 uFldTex;     // field texture size
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
// grating orders 1..2 of  lambda = d * |u.g| / m  (the third is lost in the
// angular fall-off); the secondary terms use the first order only
vec3 grating2(float ug, float d) {
  float a = abs(ug) * d;
  return spectral(a) + 0.45 * spectral(a * 0.5);
}

// hue-preserving shoulder: the untouched scan passes through (white -> 253),
// real over-exposure rolls off towards white like a photographed foil
vec3 tonemap(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m > 0.92) {
    float mm = 0.92 + 0.18 * (1.0 - exp(-(m - 0.92) / 0.18));
    c *= mm / m;
    c = mix(c, vec3(mm), clamp((m - 1.15) * 0.22, 0.0, 0.55));
  }
  return min(c, vec3(1.0));
}

struct Lit { vec2 u; vec2 hxy; float h2; float fres; float env; };
Lit lightAt(vec3 W, vec3 Vl, vec3 lamp, float sig) {
  Lit o;
  vec3 L = normalize(lamp - W) * uRot;   // card-local frame (normal = +z)
  vec3 S = Vl + L;
  vec3 H = normalize(S);
  o.u = S.xy;                            // grating vector: d*(V+L).g = m*lambda
  o.hxy = H.xy;
  o.h2 = dot(H.xy, H.xy);
  float c = 1.0 - clamp(dot(Vl, H), 0.0, 1.0);
  o.fres = 0.04 + 0.96 * c * c * c * c * c;
  o.env = exp(-dot(o.u, o.u) / sig);     // diffraction efficiency vs angle
  return o;
}

vec3 rainbow(Lit l, vec2 g, float ph, bool full) {
  float ug = dot(l.u, g) + ph;
  vec3 rb = full ? grating2(ug, uS2.z) : spectral(abs(ug) * uS2.z);
  float rl = dot(rb, vec3(0.3, 0.55, 0.15));
  return max(mix(vec3(rl) * vec3(1.14, 0.98, 0.74), rb, uS.x), 0.0);  // EN: warm pastel
}

// extended lights (the room, a window) smear the orders into a soft cyclic
// prism that covers the whole face and shifts hue as the card tilts
vec3 prism(float t) { return 0.5 + 0.5 * cos(6.2832 * (t + vec3(0.0, 0.33, 0.67))); }

// the film: rainbow orders + soft prism + white zeroth order (key lamp);
// the dim fill lamp only adds its faint first-order rainbow
vec3 filmOf(Lit l, vec2 g, vec2 g2, float ph, float wk) {
  vec3 rb = rainbow(l, g, ph, true);
#ifdef HAS_SECOND
  rb += uS2.x * rainbow(l, g2, ph * 0.7, false);
#endif
  vec3 pr = prism(dot(l.u, g) * 1.8 + ph * 4.0 + dot(vUv, vec2(0.30, 0.45)));
  pr = mix(vec3(dot(pr, vec3(0.3, 0.55, 0.15))) * vec3(1.12, 1.0, 0.8), pr, uS.x);
  float spec0 = exp(-l.h2 / 0.0022) * 1.5 + exp(-l.h2 / 0.02) * 0.12;
  return rb * l.env * uS.y + pr * uS2.w * (0.55 + 0.45 * l.env) + vec3(spec0) * uS.z * wk;
}
vec3 fillOf(Lit l, vec2 g, float ph) { return rainbow(l, g, ph, false) * l.env * uS.y; }

void main() {
  vec4 tex = texture2D(uArt, vUv, -0.5);   // slight LOD bias: crisp text when minified
  // rounded corners (3 mm on a 63 mm card), anti-aliased over one canvas pixel
  vec2 tp = vUv * uTex;
  vec2 q = abs(tp - 0.5 * uTex) - (0.5 * uTex - uRadius);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float alpha = tex.a * clamp(0.5 - sd / max(uPx, 1e-3), 0.0, 1.0);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 art = tex.rgb / max(tex.a, 1e-4);
  vec3 lin = art * art;                  // light is added in (gamma 2.0) linear space
  float on = uOn;
  float kOn = mix(0.2, 1.0, on);         // a resting card shows only a hint
  float sig = uS.w;

  vec3 P = vec3((vUv - 0.5) * uCard, 0.0);
  vec3 W = uRot * P;
  vec3 Vl = normalize(uCam - W) * uRot;
  Lit lk = lightAt(W, Vl, uLamp, sig);
  vec3 col = lin;

#ifdef HAS_FOIL
  vec4 aux = texture2D(uAux, vUv);
  vec4 fld = texture2D(uFld, vUv);
#ifdef DEBUG_VIEW
  float dv = uDebug < 1.5 ? aux.r : uDebug < 2.5 ? aux.g : uDebug < 3.5 ? aux.b : uDebug < 4.5 ? fract((fld.r * 65280.0 + fld.g * 255.0) / 65535.0 * uFv.x) : uDebug < 5.5 ? fld.b : aux.a;
  gl_FragColor = vec4(vec3(dv) * alpha, alpha); return;
#endif
  Lit lf = lightAt(W, Vl, uFill.xyz, sig);
  float fw = uFill.w;
  float mxc = max(max(art.r, art.g), art.b);

  // slowly wandering grating direction (no repeating texture); the art's broad
  // tonal shapes shift the grating phase, so the band bends with the picture
  float ang = -0.62 + 0.42 * sin(vUv.x * 3.1 + vUv.y * 1.7 + 0.6) + 0.30 * sin(vUv.y * 4.3 - vUv.x * 2.2 + 2.0);
  vec2 g = vec2(cos(ang), sin(ang));
  vec2 g2 = vec2(-g.y, g.x) * 0.8 + g * 0.6;
  float ph = (fld.b - 0.5) * 0.07;
  // faces and skin keep their modelling: the white mirror lobe is held back there
  float wk = 1.0 - 0.7 * aux.a;
  vec3 film = (filmOf(lk, g, g2, ph, wk) + fw * fillOf(lf, g, ph)) * (1.0 - 0.6 * aux.a);

#ifdef HAS_ETCH
  // ---- etched marbling: thin grooves along the contours of the field
  float v = (fld.r * 65280.0 + fld.g * 255.0) / 65535.0 * uFv.x;
#ifdef HAS_DERIV
  vec2 gv = vec2(dFdx(v), -dFdy(v));
#else
  vec2 e1 = vec2(1.0 / uFldTex.x, 0.0), e2 = vec2(0.0, 1.0 / uFldTex.y);
  vec4 fx1 = texture2D(uFld, vUv + e1), fy1 = texture2D(uFld, vUv + e2);
  vec2 gv = (vec2((fx1.r * 65280.0 + fx1.g * 255.0), (fy1.r * 65280.0 + fy1.g * 255.0)) / 65535.0 * uFv.x - v) / uFv.y;
#endif
  float gl = length(gv) + 1e-5;              // contour lines per device px
  float sdist = (fract(v + 0.5) - 0.5) / gl; // signed device px to the nearest groove
  float hw = max(0.5, 0.13 / gl);            // groove half width: ~26% of the spacing
  float groove = 1.0 - smoothstep(hw - 0.55, hw + 0.55, abs(sdist));
  groove *= 1.0 - smoothstep(0.24, 0.45, gl); // too dense to resolve: let it go
  float em = aux.g * uA.y;
  float cut = groove * em;
  // the etched field is a brighter mirror film; the grooves are matte cuts
  // through it, and their flank facing the light catches a thin glint
  vec2 gn = gv / gl;
  float flank = clamp(sdist / max(hw, 0.6), -1.0, 1.0);
  float glint = max(0.0, flank * dot(gn, normalize(lk.hxy + vec2(1e-4)))) * groove * em;
  film *= 1.0 + 0.3 * em;
  film = film * (1.0 - 0.92 * cut) + rainbow(lk, gn, 0.0, false) * glint * 1.6 * lk.env;
#endif

#ifdef HAS_ICE
  // ---- cracked ice: each shard a mirror facet tilted its own way; it flashes
  // when its normal meets the half vector and throws its own rainbow order
  vec4 ice = texture2D(uX, vUv);             // shard normal xy, orientation, crack
  vec2 sn = (ice.xy - 0.5) * 0.5;
  vec2 dh = lk.hxy - sn;
  float d2 = dot(dh, dh);
  float flash = exp(-d2 / 0.0035);           // this shard mirrors the lamp
  float glow = exp(-d2 / 0.014);
  // a flat facet throws one colour over its whole area, set by its own tilt
  vec3 hue = spectral(410.0 + 290.0 * fract(ice.z * 3.7 + dot(lk.u - sn, vec2(cos(ice.z * 6.28), sin(ice.z * 6.28))) * 1.6));
  vec3 facet = hue * (glow * 0.9 + flash * 2.4) * uS.y * 0.6;
  film = film * mix(1.0, 0.45 + 0.8 * glow, uB.x) + uB.x * (facet + vec3(flash * flash) * 0.6);
  film += (hue * 0.5 + 0.5) * ice.w * (glow * 1.2 + flash) * uB.x;   // seams light up only around a lit shard
#endif
  film *= kOn;
#ifdef DEBUG_FILM
  gl_FragColor = vec4(sqrt(tonemap(film * 0.5)) * alpha, alpha); return;
#endif

  // ---- compose: ink over film
  float mask = aux.r * uA.x;
  float gate = smoothstep(0.05, 0.40, mxc);  // pure black never blooms
  vec3 T = lin * (1.6 - 0.6 * lin) * gate;
  // chrome body: dark mid-tone ink (the void armour) over the film reads as
  // cool polished metal rather than grey
  float midW = smoothstep(0.07, 0.24, mxc) * (1.0 - smoothstep(0.30, 0.62, mxc));
  T *= 1.0 + uB.w * midW * 2.2;
  film += vec3(0.55, 0.62, 0.95) * uB.w * midW * kOn * (0.25 + 0.75 * lk.env);
  float dim = (0.10 + 0.2 * uB.x) * on * (1.0 - clamp(lk.env + fw * lf.env, 0.0, 1.0) * 0.6) + uS2.w * 0.45 * kOn;
#ifdef HAS_ETCH
  float inkDim = cut * mix(0.12, 0.5, on);   // the ink in a groove sits on matte stock
#else
  float inkDim = 0.0;
#endif
  col = lin * (1.0 - dim * mask) * (1.0 - inkDim) + T * film * mask;

#ifdef HAS_GLITTER
  // ---- glitter: tiny mirror flakes of a fixed device-pixel size, procedural.
  // Each flake has its own normal; it fires when the half vector meets it, so
  // the sparkles race along with the light band.
  vec2 gp = vUv * uGl.xy;
  vec2 ci = floor(gp);
  vec4 h = hash42(ci + 19.7);
  vec2 dpx = (fract(gp) - 0.5 - (h.xy - 0.5) * 0.45) * uGl.z;
  float rr = uGl.w * mix(0.65, 1.35, h.z);
  float core = exp(-dot(dpx, dpx) / (rr * rr));
  vec2 adp = abs(dpx);
  float star = exp(-adp.x / (rr * 3.0) - adp.y * adp.y / (0.10 * rr * rr)) + exp(-adp.y / (rr * 3.0) - adp.x * adp.x / (0.10 * rr * rr));
  vec2 fn = (hash42(ci + 3.1).xy - 0.5) * 0.26;
  vec2 dn = lk.hxy - fn;
  float fire = exp(-dot(dn, dn) / 0.003);
  float bright = step(0.78, h.w);            // a few flakes are big enough for a star
  float exists = step(0.70 - 0.08 * uB.x, fract(h.z * 13.7 + h.w * 7.1)); // 30% of cells (38% on the ultimate)
  vec3 fc = mix(vec3(1.0), spectral(420.0 + 260.0 * fract(h.w * 5.3 + dot(lk.u, g) * 2.0)), 0.6 + 0.25 * uB.y + 0.15 * uB.x);
  float gk = fire * (core * (1.0 + bright) + bright * star * 0.8) * uA.z * on * exists;
  col += fc * gk * mask * ((0.35 + 0.6 * uB.x) * gate + T * 1.6) * 2.2;
#endif

  // vivid (CN): foil under coloured ink reads as more saturated metal
  float lc = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(vec3(lc) + (col - vec3(lc)) * (1.0 + uS2.y * mask * kOn * gate * (1.0 - aux.a)), 0.0);
#endif

#ifdef HAS_GOLD
  // ---- gold-stamped signature: embossed metal foil with a bevel
  float gm = aux.b * uA.w;
  if (gm > 0.002) {
    vec2 bs = (texture2D(uX, vUv).xy - 0.5) * 2.0;  // bevel slope
    vec2 hb = lk.hxy + bs * 0.22;
    float d2 = dot(hb, hb);
    float lobe = exp(-d2 / 0.05), sharp = exp(-d2 / 0.007);
    float facing = clamp(0.5 + 0.9 * dot(bs, normalize(-lk.hxy + vec2(1e-4))), 0.0, 1.0);
    vec3 gDark = vec3(0.30, 0.15, 0.012), gLit = vec3(1.0, 0.70, 0.07), gHot = vec3(1.0, 0.95, 0.70);
    float shim = sin(dot(lk.u, g) * 14.0 + vUv.x * 9.0 + vUv.y * 5.0);
    vec3 tint = mix(vec3(1.0, 0.86, 0.75), vec3(0.88, 1.06, 0.55), 0.5 + 0.5 * shim);  // yellow-green <-> amber
    // brushed-metal ripple that slides along the strokes as the card moves
    float rip = 0.5 + 0.5 * sin(dot(lk.u, vec2(17.0, 11.0)) + vUv.x * 23.0 - vUv.y * 13.0);
    float lit = clamp((0.42 + 0.25 * facing + kOn * (0.9 * lobe + 0.35 * lk.env)) * (0.82 + 0.36 * rip * kOn), 0.0, 1.5);
    vec3 gcol = mix(gDark, gLit * mix(vec3(1.0), tint, 0.35 + 0.3 * uB.y), clamp(lit, 0.0, 1.0)) * max(1.0, lit);
    gcol += gHot * (sharp * 2.0 * kOn + (0.3 * lobe + 0.25 * rip * lk.env) * facing * on);
    col = mix(col, gcol, clamp(gm, 0.0, 1.0));
  }
#endif

  // ---- varnish: a narrow clear-coat highlight while handled, nothing at rest
  // (a small crisp hot spot; its soft skirt only shows on light ink, so black
  // never turns milky)
  float inkL = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  col += vec3((exp(-lk.h2 / 0.0003) * 1.6 + exp(-lk.h2 / 0.004) * 0.4 * inkL) * lk.fres * uB.z * on);

  col = tonemap(col);
  gl_FragColor = vec4(sqrt(max(col, 0.0)) * alpha, alpha);
}`;

// ------------------------------------------------------- CPU precompute
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

// separable running-sum box blur, clamped edges
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
// a wide gaussian computed at half resolution and upsampled (bilinear): the
// result is smooth anyway, at a quarter of the cost
function gaussHalf(src, W, H, r) {
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = 2 * x, Y = 2 * y, X1 = Math.min(W - 1, X + 1), Y1 = Math.min(H - 1, Y + 1);
    d[y * w + x] = 0.25 * (src[Y * W + X] + src[Y * W + X1] + src[Y1 * W + X] + src[Y1 * W + X1]);
  }
  const b = gauss(d, w, h, Math.max(1, Math.round(r / 2)));
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y - 0.5) / 2)), y0 = Math.min(h - 2, fy | 0), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x - 0.5) / 2)), x0 = Math.min(w - 2, fx | 0), tx = fx - x0, k = y0 * w + x0;
      out[y * W + x] = (b[k] * (1 - tx) + b[k + 1] * tx) * (1 - ty) + (b[k + w] * (1 - tx) + b[k + w + 1] * tx) * ty;
    }
  }
  return out;
}

// 2D gradient noise (Perlin), seeded
function perlin(seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = p[X + p[Y]], b = p[X + 1 + p[Y]], c = p[X + p[Y + 1]], d = p[X + 1 + p[Y + 1]];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const n00 = gx[a] * xf + gy[a] * yf, n10 = gx[b] * (xf - 1) + gy[b] * yf;
    const n01 = gx[c] * xf + gy[c] * (yf - 1), n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
    const x0 = n00 + u * (n10 - n00), x1 = n01 + u * (n11 - n01);
    return x0 + v * (x1 - x0);
  };
}
const fbm = (n, x, y, oct) => { let a = 0, amp = 0.5, f = 1; for (let k = 0; k < oct; k++) { a += amp * n(x * f + k * 17.3, y * f - k * 9.1); amp *= 0.5; f *= 2.03; } return a; };

// Marbling: contour field of a domain-warped noise (closed, nested, flowing
// loops like the CN overnumbered etch), spacing-normalised so the lines keep an
// even density, and bent by the art's own tones so they kink around its shapes.
// Returned at half resolution (it is smooth; the GPU interpolates it).
function marbleField(lum, W, H, seed) {
  const w = Math.ceil(W / 2), h = Math.ceil(H / 2), n = w * h, sc = W / 744;
  const l2 = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = Math.min(W - 1, 2 * x), Y = Math.min(H - 1, 2 * y), X1 = Math.min(W - 1, X + 1), Y1 = Math.min(H - 1, Y + 1);
    l2[y * w + x] = 0.25 * (lum[Y * W + X] + lum[Y * W + X1] + lum[Y1 * W + X] + lum[Y1 * W + X1]);
  }
  const lb = gauss(l2, w, h, Math.max(1, Math.round(1.5 * sc)));
  const n0 = perlin(seed + 11), n1 = perlin(seed + 23), n2 = perlin(seed + 37), n3 = perlin(seed + 41), n4 = perlin(seed + 53);
  // the warp is smooth: evaluate it on a coarse grid and interpolate
  const gs = 4, GW = Math.ceil(w / gs) + 2, GH = Math.ceil(h / gs) + 2;
  const RX = new Float32Array(GW * GH), RY = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const u = i * gs / w, v = j * gs / w; // card-width units
    const qx = fbm(n1, u * 1.5, v * 1.5, 2), qy = fbm(n2, u * 1.5 + 5.2, v * 1.5 + 1.3, 2);
    const rx = fbm(n3, u * 1.9 + 2.4 * qx + 1.7, v * 1.9 + 2.4 * qy + 9.2, 2);
    const ry = fbm(n4, u * 1.9 + 2.4 * qx + 8.3, v * 1.9 + 2.4 * qy + 2.8, 2);
    RX[j * GW + i] = rx; RY[j * GW + i] = ry;
  }
  const F = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const fy = y / gs, y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / gs, x0 = fx | 0, tx = fx - x0, k = y0 * GW + x0;
      const rx = (RX[k] * (1 - tx) + RX[k + 1] * tx) * (1 - ty) + (RX[k + GW] * (1 - tx) + RX[k + GW + 1] * tx) * ty;
      const ry = (RY[k] * (1 - tx) + RY[k + 1] * tx) * (1 - ty) + (RY[k + GW] * (1 - tx) + RY[k + GW + 1] * tx) * ty;
      const u = x / w, v = y / w;
      F[y * w + x] = fbm(n0, u * 1.3 + 2.6 * rx, v * 1.3 + 2.6 * ry, 2);
    }
  }
  // even density: divide by the local mean gradient
  const G = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = (F[i + 1] - F[i - 1]) * 0.5, gy = (F[i + w] - F[i - w]) * 0.5;
    G[i] = Math.sqrt(gx * gx + gy * gy);
  }
  const Gb = gauss(G, w, h, Math.max(4, Math.round(16 * sc)));
  const spacing = 6.0 * sc;  // half-res px between lines (12 scan px, ~7 css px on a 420 px card)
  // floor the normaliser (half the median gradient) so flat spots of F do not
  // blow up into bull's-eyes
  const sorted = Float32Array.from(Gb.filter((_, i) => (i & 15) === 0)).sort();
  const gfloor = 0.55 * sorted[sorted.length >> 1];
  const out = new Float32Array(n);
  let vmin = 1e9, vmax = -1e9;
  for (let i = 0; i < n; i++) {
    const v = F[i] / (Math.max(Gb[i], gfloor) * spacing) + lb[i] * 1.4;
    out[i] = v; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  for (let i = 0; i < n; i++) out[i] -= vmin;
  return { w, h, v: out, range: vmax - vmin, lb };
}

function analyse(px, W, H, finish) {
  const N = W * H, s = W / 744;
  const lum = new Float32Array(N), sat = new Float32Array(N), minc = new Float32Array(N), lum2 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[4 * i] / 255, g = px[4 * i + 1] / 255, b = px[4 * i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; lum2[i] = lum[i] * lum[i];
    sat[i] = mx > 0.02 ? (mx - mn) / mx : 0; minc[i] = mn;
  }
  const aux = new Uint8Array(N * 4);
  const etched = finish === 'etched' || finish === 'signature';

  // R: foil mask. Saturated ink holds the film back a little (small icons keep
  // their hue), big flat white areas carry an opaque white underlay on real
  // foils, and opaque white ink (glyphs: near-white strokes on a darker
  // surround) blocks it almost completely, so text and labels stay white.
  const rb = Math.max(1, Math.round(4 * s));
  const m1 = boxBlur(lum, W, H, rb), m2 = boxBlur(lum2, W, H, rb);
  const glyph = new Float32Array(N);
  for (let i = 0; i < N; i++) glyph[i] = smooth(0.66, 0.84, minc[i]) * (1 - smooth(0.08, 0.2, sat[i])) * smooth(0.06, 0.2, lum[i] - m1[i]);
  const glyphG = boxBlur(glyph, W, H, Math.max(1, Math.round(1.2 * s)));
  // small saturated features (domain icons, gems) keep their hue; big
  // saturated fields (a red backdrop) flash as coloured metal
  const satL = gaussHalf(sat, W, H, Math.max(3, Math.round(12 * s)));
  for (let i = 0; i < N; i++) {
    const sd = Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]));
    const flat = (1 - smooth(0.02, 0.07, sd)) * smooth(0.80, 0.94, m1[i]);
    const gw = Math.min(1, Math.max(glyph[i], glyphG[i] * 2.2));
    const m = (1 - 0.5 * sat[i] * Math.sqrt(sat[i]) * smooth(0.12, 0.35, sat[i] - satL[i])) * (1 - 0.5 * flat) * (1 - 0.85 * gw);
    aux[4 * i] = Math.round(255 * Math.min(1, Math.max(0, m)));
  }

  // A: skin (faces, arms): the figure keeps its modelling under the foil
  const skin = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[4 * i] / 255, g = px[4 * i + 1] / 255, b = px[4 * i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), ch = mx - mn;
    if (mx !== r || ch < 0.04) continue;
    const hue = 60 * (g - b) / ch; // red-max hues: -60..60 deg; skin sits at -20 (pink) .. 30 (peach)
    skin[i] = smooth(0.40, 0.58, mx) * smooth(0.08, 0.15, sat[i]) * (1 - smooth(0.42, 0.55, sat[i])) * (1 - smooth(26, 36, hue)) * smooth(-26, -14, hue);
  }
  const skinB = gaussHalf(skin, W, H, Math.max(2, Math.round(5 * s)));
  for (let i = 0; i < N; i++) aux[4 * i + 3] = Math.round(255 * smooth(0.12, 0.45, skinB[i]));

  let seed = 0; for (let i = 0; i < N; i += 997) seed = (seed * 31 + px[4 * i] + 7 * px[4 * i + 1]) >>> 0;
  const out = { W, H, aux, fld: null, fw: 0, fh: 0, range: 1, x: null };

  if (etched) {
    // G: where the etch goes. Not on faces and skin (spot-foil look: the figure
    // stays clean), not on dense small detail (text, icons, thin frame lines).
    const le = boxBlur(lum, W, H, 1);
    const ed = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const sx = (le[i - W + 1] + 2 * le[i + 1] + le[i + W + 1]) - (le[i - W - 1] + 2 * le[i - 1] + le[i + W - 1]);
      const sy = (le[i + W - 1] + 2 * le[i + W] + le[i + W + 1]) - (le[i - W - 1] + 2 * le[i - W] + le[i - W + 1]);
      ed[i] = smooth(0.25, 0.7, Math.sqrt(sx * sx + sy * sy));
    }
    const dens = gaussHalf(ed, W, H, Math.max(3, Math.round(7 * s)));
    // strongly saturated areas are the figure and the UI panels (hair, scarf,
    // the name bar): they keep a smooth foil, the marbling lives in the backdrop
    const satB = gaussHalf(sat, W, H, Math.max(2, Math.round(4 * s)));
    const portrait = H > W;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = x / W, v = y / H;
      // the rules-text box of the portrait frame: only a trace of etch
      const box = portrait ? smooth(0.62, 0.66, v) * (1 - smooth(0.93, 0.96, v)) * smooth(0.03, 0.06, u) * (1 - smooth(0.94, 0.97, u)) : 0;
      const e = (1 - smooth(0.12, 0.45, skinB[i])) * (1 - smooth(0.14, 0.3, dens[i])) * (1 - smooth(0.48, 0.72, satB[i])) * (1 - 0.7 * box);
      aux[4 * i + 1] = Math.round(255 * e);
    }
  }
  // field texture: rg = 16-bit contour field (etched), b = broad art luminance
  {
    const mf = etched ? marbleField(lum, W, H, seed) : null;
    const fw = Math.ceil(W / 2), fh = Math.ceil(H / 2);
    // broad luminance (bends the rainbow): heavy blur at half res
    const l2 = new Float32Array(fw * fh);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) l2[y * fw + x] = lum[Math.min(H - 1, 2 * y) * W + Math.min(W - 1, 2 * x)];
    const lb = gauss(l2, fw, fh, Math.max(3, Math.round(12 * s)));
    const fld = new Uint8Array(fw * fh * 4);
    for (let i = 0; i < fw * fh; i++) {
      if (mf) { const F = Math.round(Math.min(65535, Math.max(0, mf.v[i] / mf.range * 65535))); fld[4 * i] = F >> 8; fld[4 * i + 1] = F & 255; }
      fld[4 * i + 2] = Math.round(255 * lb[i]); fld[4 * i + 3] = 255;
    }
    Object.assign(out, { fld, fw, fh, range: mf ? mf.range : 1 });
  }

  if (finish === 'signature') {
    // B: gold-stamped signature = thin pure-white script strokes in the art
    // window: white top-hat + near-white, grouped into connected components;
    // only long thin neutral strokes clustered around the biggest one survive.
    const bg = boxBlur(lum, W, H, Math.max(2, Math.round(7 * s)));
    const y0 = Math.round(0.08 * H), y1 = Math.round(0.70 * H);
    const cand = new Uint8Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (minc[i] > 0.80 && lum[i] - bg[i] > 0.10) cand[i] = 1;
    }
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
    const rr = Math.max(1, Math.round(1.5 * s));
    const grown = new Uint8Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      if (!keep[y * W + x]) continue;
      for (let yy = Math.max(0, y - rr); yy <= Math.min(H - 1, y + rr); yy++) for (let xx = Math.max(0, x - rr); xx <= Math.min(W - 1, x + rr); xx++) grown[yy * W + xx] = 1;
    }
    const gmask = new Float32Array(N);
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grown[i]) continue;
      const cov = keep[i] ? 1 : smooth(0.30, 0.80, minc[i]) * smooth(0.02, 0.12, lum[i] - bg[i]);
      gmask[i] = cov; aux[4 * i + 2] = Math.round(255 * cov);
    }
    // bevel: slope of the softened stamp (the highlight follows the light)
    const gb = boxBlur(boxBlur(gmask, W, H, Math.max(1, Math.round(1.2 * s))), W, H, 1);
    const x = new Uint8Array(N * 4), k = 2.2 * s;
    for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) {
      const i = yy * W + xx;
      const sx = Math.max(-1, Math.min(1, (gb[i + 1] - gb[i - 1]) * k)), sy = Math.max(-1, Math.min(1, (gb[i + W] - gb[i - W]) * k));
      x[4 * i] = Math.round(127.5 + 127.5 * -sx); x[4 * i + 1] = Math.round(127.5 + 127.5 * -sy); x[4 * i + 3] = 255;
    }
    out.x = x;
  }
  return out;
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

// Cracked ice: Voronoi shards. RG = shard normal, B = grating orientation, A = seam.
function computeIce(W, H, cells) {
  const out = new Uint8Array(W * H * 4);
  const cellPx = W / cells;
  const gw = Math.ceil(W / cellPx) + 2, gh = Math.ceil(H / cellPx) + 2;
  const pts = new Float32Array(gw * gh * 2), hs = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const h = hash4(i, j, 17); pts[2 * (j * gw + i)] = i + 0.05 + 0.9 * h[0]; pts[2 * (j * gw + i) + 1] = j + 0.05 + 0.9 * h[1];
    hs.push(hash4(i, j, 29));
  }
  const seamPx = Math.max(0.9, 1.4 * W / 744);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = (x + 0.5) / cellPx, gy = (y + 0.5) / cellPx, ix = Math.floor(gx), iy = Math.floor(gy);
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let j = Math.max(0, iy - 1); j <= Math.min(gh - 1, iy + 1); j++) for (let i = Math.max(0, ix - 1); i <= Math.min(gw - 1, ix + 1); i++) {
      const k = j * gw + i, ddx = pts[2 * k] - gx, ddy = pts[2 * k + 1] - gy, dd = ddx * ddx + ddy * ddy;
      if (dd < d1) { d2 = d1; d1 = dd; best = k; } else if (dd < d2) d2 = dd;
    }
    const h = hs[best], o = 4 * (y * W + x);
    const edge = (Math.sqrt(d2) - Math.sqrt(d1)) * cellPx * 0.5;   // px to the seam (approx.)
    out[o] = Math.round(255 * h[0]); out[o + 1] = Math.round(255 * h[1]); out[o + 2] = Math.round(255 * h[2]);
    out[o + 3] = Math.round(255 * Math.max(0, 1 - smooth(0.0, seamPx, edge)));
  }
  return out;
}

// bilinear resample of an RGBA8 map (data maps only; never colour)
function resampleRGBA(src, W, H, w, h) {
  if (w === W && h === H) return src;
  const out = new Uint8Array(w * h * 4), sx = W / w, sy = H / h;
  if (sx > 1.5) { // minifying: box-filter first so nothing aliases
    const r = Math.max(1, Math.round(sx / 2));
    const ch = new Float32Array(W * H), res = [];
    for (let c = 0; c < 4; c++) { for (let i = 0; i < W * H; i++) ch[i] = src[4 * i + c]; res.push(boxBlur(ch, W, H, r)); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = Math.min(W - 1, (x + 0.5) * sx - 0.5), Y = Math.min(H - 1, (y + 0.5) * sy - 0.5);
      const x0 = Math.max(0, Math.floor(X)), y0 = Math.max(0, Math.floor(Y)), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = X - x0, fy = Y - y0;
      for (let c = 0; c < 4; c++) { const A = res[c]; out[4 * (y * w + x) + c] = Math.round((A[y0 * W + x0] * (1 - fx) + A[y0 * W + x1] * fx) * (1 - fy) + (A[y1 * W + x0] * (1 - fx) + A[y1 * W + x1] * fx) * fy); }
    }
    return out;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = Math.min(W - 1, Math.max(0, (x + 0.5) * sx - 0.5)), Y = Math.min(H - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const x0 = Math.floor(X), y0 = Math.floor(Y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = X - x0, fy = Y - y0;
    for (let c = 0; c < 4; c++) out[4 * (y * w + x) + c] = Math.round((src[4 * (y0 * W + x0) + c] * (1 - fx) + src[4 * (y0 * W + x1) + c] * fx) * (1 - fy) + (src[4 * (y1 * W + x0) + c] * (1 - fx) + src[4 * (y1 * W + x1) + c] * fx) * fy);
  }
  return out;
}

// re-opening the same card (inspect view, style toggle) reuses its analysis
const CACHE = new Map();
const ICE = new Map();          // cracked-ice maps by size
const PROGS = new WeakMap();    // compiled programs per GL context
function cachedAnalysis(image, finish) {
  const src = image.currentSrc || image.src || '';
  const key = src + '|' + finish + '|' + (image.naturalWidth || image.width);
  if (src && CACHE.has(key)) { const v = CACHE.get(key); CACHE.delete(key); CACHE.set(key, v); return v; }
  const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(image, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;
  const v = analyse(data, W, H, finish);
  v.pixels = data;
  if (src) { CACHE.set(key, v); while (CACHE.size > 6) CACHE.delete(CACHE.keys().next().value); }
  return v;
}

// ----------------------------------------------------------------- GL utils
function rotation(tx, ty) {
  // CSS: rotateX(a) rotateY(b) -> M = RX(a) * RY(b), column-major for GL
  const a = -ty * TILT, b = tx * TILT;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const RX = [1, 0, 0, 0, ca, sa, 0, -sa, ca];
  const RY = [cb, 0, -sb, 0, 1, 0, sb, 0, cb];
  const M = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    let v = 0; for (let k = 0; k < 3; k++) v += RX[k * 3 + r] * RY[c * 3 + k];
    M[c * 3 + r] = v;
  }
  return M;
}
const mulM = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];

export function createHolo(canvas, { image, finish = 'holo', rarity = 'rare', style = 'subtle' } = {}) {
  const attrs = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext('webgl2', attrs);
  const gl2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  if (!gl) throw new Error('holo-gl: WebGL unavailable');
  const P = finishParams(finish, rarity);
  const S = STYLES[style] || STYLES.subtle;
  const vivid = style === 'vivid' ? 1 : 0;
  const debug = { mask: 1, etch: 2, gold: 3, lines: 4, lum: 5, film: 6, skin: 7 }[createHolo.debug] || 0;
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  const A = P.foil > 0 ? cachedAnalysis(image, finish) : null;

  let prog = null, vbo = null, U = {}, tex = {}, mapW = 0, mapH = 0, lost = false, dead = false;
  let cssW = iw, cssH = ih, dpr = 1;

  function initGL() {
    const deriv = gl2 || !!gl.getExtension('OES_standard_derivatives');
    const defs = [P.foil > 0 && 'HAS_FOIL', P.etch > 0 && 'HAS_ETCH', P.ice > 0 && 'HAS_ICE', P.spark > 0 && 'HAS_GLITTER', P.gold > 0 && 'HAS_GOLD',
      S.second > 0 && 'HAS_SECOND', deriv && 'HAS_DERIV', debug && debug !== 6 && 'DEBUG_VIEW', debug === 6 && 'DEBUG_FILM'].filter(Boolean).map((d) => '#define ' + d + '\n').join('');
    const head = gl2 ? '#version 300 es\n' : '';
    const fsHead = gl2 ? '#define varying in\n#define texture2D texture\nout highp vec4 holoFrag;\n#define gl_FragColor holoFrag\n'
      : (deriv && P.etch > 0 ? '#extension GL_OES_standard_derivatives : enable\n' : '');
    const vsHead = gl2 ? '#define attribute in\n#define varying out\n' : '';
    const compile = (type, src) => {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('holo-gl shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    // programs are cached per context: the app re-creates the holo on the same
    // canvas for every style toggle or card change
    const fsSrc = head + fsHead + defs + FS;
    let progs = PROGS.get(gl);
    if (!progs) { progs = new Map(); PROGS.set(gl, progs); }
    const hit = progs.get(fsSrc);
    if (hit && gl.isProgram(hit.prog)) { prog = hit.prog; U = hit.U; }
    else {
      prog = gl.createProgram();
      const vs = compile(gl.VERTEX_SHADER, head + vsHead + VS), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('holo-gl link: ' + gl.getProgramInfoLog(prog));
      gl.deleteShader(vs); gl.deleteShader(fs);
      U = {};
      for (const n of ['uArt', 'uAux', 'uFld', 'uX', 'uTex', 'uCard', 'uRot', 'uCam', 'uLamp', 'uFill', 'uOn', 'uPx', 'uRadius', 'uA', 'uB', 'uS', 'uS2', 'uGl', 'uFv', 'uFldTex', 'uDebug']) U[n] = gl.getUniformLocation(prog, n);
      progs.set(fsSrc, { prog, U });
    }
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    tex = { art: gl.createTexture() };
    if (A) { tex.aux = gl.createTexture(); tex.fld = gl.createTexture(); }
    if (A && (A.x || P.ice > 0)) tex.x = gl.createTexture();
    mapW = mapH = 0;
  }

  function setTex(t, w, h, data, src, mip) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Upload the maps. WebGL2: once, at scan resolution, mipmapped (any display
  // size filters correctly, resize costs nothing). WebGL1 (no NPOT mipmaps): at
  // a resolution near the canvas', a resample of the cached analysis.
  function upload(w, h) {
    if (w === mapW && h === mapH) return;
    mapW = w; mapH = h;
    const mip = gl2;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // linear filtering on premultiplied colour
    if (w === iw && h === ih) setTex(tex.art, 0, 0, null, image, mip);
    else {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(image, 0, 0, w, h);
      setTex(tex.art, 0, 0, null, cv, false);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);  // data, not colour
    if (!A) return;
    setTex(tex.aux, w, h, resampleRGBA(A.aux, A.W, A.H, w, h), null, mip);
    setTex(tex.fld, A.fw, A.fh, A.fld);   // 16-bit pairs: never mipmapped
    if (A.x) setTex(tex.x, w, h, resampleRGBA(A.x, A.W, A.H, w, h), null, mip);
    else if (P.ice > 0) {
      const key = w + 'x' + h;
      if (!ICE.has(key)) { ICE.set(key, computeIce(w, h, 17)); while (ICE.size > 3) ICE.delete(ICE.keys().next().value); }
      setTex(tex.x, w, h, ICE.get(key), null, mip);
    }
  }

  function resize(w, h, d = 1) {
    if (dead) return;
    cssW = w; cssH = h; dpr = d;
    const bw = Math.max(1, Math.round(w * d)), bh = Math.max(1, Math.round(h * d));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    if (lost) return;
    // full scan resolution (WebGL2: always, mipmapped); WebGL1: a filtered
    // copy when the canvas is much smaller
    let tw = gl2 || bw >= 0.8 * iw ? iw : bw;
    if (mapW && Math.abs(tw - mapW) / mapW < 0.2) tw = mapW;
    upload(tw, tw === iw ? ih : Math.round(tw * ih / iw));
  }

  const room = [-300, -1200, 2200];      // ceiling lamp above and behind the viewer
  const fill = [650, 900, 2000, 0.35];   // dimmer source low right (window / screen)
  let last = { tx: 0, ty: 0, px: 50, py: 50, pfc: 0, on: 0 };
  function update(state = {}) {
    if (dead) return;
    const st = Object.assign(last, state);
    if (lost || gl.isContextLost()) return;
    const tx = +st.tx || 0, ty = +st.ty || 0, on = Math.min(1, Math.max(0, +st.on || 0));
    const R = rotation(tx, ty);
    const k = REF / Math.min(cssW, cssH), cw = cssW * k, ch = cssH * k;
    // key lamp: held by the pointer while handled (its mirror highlight sits
    // at the pointer), the ceiling lamp at rest
    const ppx = st.px == null ? 50 : +st.px, ppy = st.py == null ? 50 : +st.py;
    const Pw = mulM(R, [(ppx / 100 - 0.5) * cw, (ppy / 100 - 0.5) * ch, 0]), n = mulM(R, [0, 0, 1]);
    let r = [-Pw[0], -Pw[1], PERSPECTIVE - Pw[2]]; const rl = Math.hypot(r[0], r[1], r[2]); r = r.map((x) => x / rl);
    const rn = r[0] * n[0] + r[1] * n[1] + r[2] * n[2];
    const inc = [r[0] - 2 * rn * n[0], r[1] - 2 * rn * n[1], r[2] - 2 * rn * n[2]];
    const held = [Pw[0] - inc[0] * 1800, Pw[1] - inc[1] * 1800, Pw[2] - inc[2] * 1800];
    const f = 0.8 * on;
    const lamp = [room[0] + (held[0] - room[0]) * f, room[1] + (held[1] - room[1]) * f, room[2] + (held[2] - room[2]) * f];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.art);
    if (tex.aux) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.aux); }
    if (tex.fld) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.fld); }
    if (tex.x) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.x); }
    gl.uniform1i(U.uArt, 0); gl.uniform1i(U.uAux, 1); gl.uniform1i(U.uFld, 2); gl.uniform1i(U.uX, 3);
    gl.uniform2f(U.uTex, mapW, mapH);
    gl.uniform2f(U.uCard, cw, ch);
    gl.uniformMatrix3fv(U.uRot, false, R);
    gl.uniform3f(U.uCam, 0, 0, PERSPECTIVE);
    gl.uniform3f(U.uLamp, lamp[0], lamp[1], lamp[2]);
    gl.uniform4f(U.uFill, fill[0], fill[1], fill[2], fill[3]);
    gl.uniform1f(U.uOn, on);
    gl.uniform1f(U.uPx, mapW / canvas.width);
    gl.uniform1f(U.uRadius, 0.0476 * Math.min(mapW, mapH));
    gl.uniform4f(U.uA, P.foil, P.etch, P.spark, P.gold);
    gl.uniform4f(U.uB, P.ice, vivid, P.gloss, P.body);
    gl.uniform4f(U.uS, S.sat, S.gain, S.white, S.sig);
    gl.uniform4f(U.uS2, S.second, S.boost, S.D, S.prism);
    // glitter: square cells of ~6 css px, flakes ~1 css px radius (device px)
    const cell = (P.ice > 0 ? 5.0 : 6.2) * dpr;
    gl.uniform4f(U.uGl, canvas.width / cell, canvas.height / cell, cell, Math.max(1.0, 1.0 * dpr));
    gl.uniform2f(U.uFv, A ? A.range : 1, A ? canvas.width / A.fw : 1);
    gl.uniform2f(U.uFldTex, A ? A.fw : 1, A ? A.fh : 1);
    gl.uniform1f(U.uDebug, debug);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function onLost(e) { e.preventDefault(); lost = true; PROGS.delete(gl); }
  function onRestored() {
    if (dead) return;
    lost = false;
    try { initGL(); resize(cssW, cssH, dpr); update({}); } catch (err) { lost = true; }
  }
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function destroy() {
    if (dead) return;
    dead = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    if (!gl.isContextLost()) {
      for (const t of Object.values(tex)) if (t) gl.deleteTexture(t);
      gl.deleteBuffer(vbo);   // the program stays cached on the context for the next holo
    }
    // the context is left alive: the app may create a new holo on this canvas
  }

  initGL();
  const d0 = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) resize(canvas.clientWidth, canvas.clientHeight, d0);
  else resize(iw, ih, 1);
  return { update, resize, destroy };
}
