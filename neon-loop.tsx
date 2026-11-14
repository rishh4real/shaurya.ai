"use client"

// Neon Loop by Louis Studios.
// 140+ more hand-made React components at https://studios.lou15.com/?ref=21st-code

import * as React from "react"

/**
 * NeonLoop: two linked crowns of bold extruded capitals that spin through each
 * other, lit with an iridescent neon gradient and a heavy bloom over a warm red
 * vignette. WebGL2: every letter is a ray-marched extrusion of a canvas-rasterised
 * signed distance field, followed by a dual-filter bloom. Without WebGL2 a
 * layered 2D canvas draws the same rings.
 */
export interface NeonLoopProps {
  /** Text that runs around each ring. It is fitted to the ring, repeated when short and condensed when long. */
  text?: string
  /** CSS font-family stack for the letters. Heavy condensed faces look closest to the original. */
  font?: string
  /** Font weight used to rasterise the letters. */
  fontWeight?: number
  /** Gradient stops for the neon finish, from the lit front (cool) to the far top (warm). Two or more colours. */
  colors?: string[]
  /** Backdrop colour at the corners of the vignette. */
  background?: string
  /** Warm halo colour glowing behind the rings. */
  halo?: string
  /** Bloom strength. 0 turns the glow off, 1 is the default neon glow, 2 is twice as strong. */
  glow?: number
  /** Spin speed multiplier. 1 is the default pace (one text repeat every 13.9 s), 0 freezes the letters, negative values reverse them. */
  speed?: number
  /** Extra lean of the rings towards the viewer, in degrees. 0 keeps the default view. */
  tilt?: number
  /** Extrusion depth of the letters as a share of the letter height. */
  depth?: number
  /** When true the pointer tilts the rings and dragging spins them with inertia. */
  interactive?: boolean
  /** Extra class names for the wrapper element. */
  className?: string
  /** Inline styles for the wrapper element. */
  style?: React.CSSProperties
}

/* ---------- scene, measured from the 720 x 720 reference ---------- */
const SCENE = {
  fov: 93.844, // vertical field of view, degrees: the original is shot close up on a wide lens
  dist: 5, // camera distance from the target
  elev: -11.286, // camera elevation, degrees
  target: [0, 0, 0] as [number, number, number],
  R: 0.91, // ring radius: a tight ring, so the big letters crowd at the back
  H: 0.8, // cap height of the letters (front caps fill about a fifth of the frame, as in the original)
  lean: -13.883, // letters lean inside the band, degrees (they are not parallel to the ring axis)
  rings: [
    { c: [-0.304, -0.698, 2.3], roll: -31.233, pitch: 30.057, yaw: -19.698, dir: 1, phase: 0 },
    { c: [0.397, -0.821, 2.086], roll: 169.413, pitch: -155.746, yaw: -279.734, dir: 1, phase: 2.1 },
  ],
  slot: 0.45, // target angle per letter, radians: one pass of the text, about 14 letters per ring
  omega: (2 * Math.PI) / 13.9, // radians per second at speed 1: one turn, and one repeat, every 13.9 s
}

const TAU = Math.PI * 2

/* ---------- colour helpers ---------- */
let colorCtx: CanvasRenderingContext2D | null = null
function parseColor(c: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof document === "undefined") return fallback
  if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d")
  if (!colorCtx) return fallback
  colorCtx.fillStyle = "#000000" // ls:keep
  colorCtx.fillStyle = c
  const s = String(colorCtx.fillStyle)
  if (s[0] === "#") {
    const n = parseInt(s.slice(1, 7), 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  const m = s.match(/[\d.]+/g)
  if (!m || m.length < 3) return fallback
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255]
}

/* ---------- glyph atlas with signed distance fields ---------- */
interface Glyph {
  ch: string
  adv: number // advance in world units
  box: [number, number, number, number] // cell rect in local units: x0, y0, x1, y1
  uv: [number, number, number, number]
  canvas?: HTMLCanvasElement // white glyph on transparent, used by the 2D fallback
}
interface Atlas {
  glyphs: Map<string, Glyph>
  data: Float32Array
  w: number
  h: number
}

const INF = 1e20
function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  f[0] = grid[offset]
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]
    const q2 = q * q
    do {
      const r = v[k]
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2
    } while (s <= z[k] && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++
    const r = v[k]
    const qr = q - r
    grid[offset + q * stride] = f[r] + qr * qr
  }
}
function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const v = new Uint16Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z)
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z)
}

function buildAtlas(chars: string[], font: string, weight: number, H: number, wantCanvas: boolean): Atlas {
  const FS = 128
  const PAD = 14
  const c = document.createElement("canvas")
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  const fontStr = `${weight} ${FS}px ${font}`
  const condense = () => {
    try {
      ;(ctx as any).fontStretch = "condensed"
    } catch {}
  }
  ctx.font = fontStr
  condense()
  const capM = ctx.measureText("H")
  const cap = Math.max(10, capM.actualBoundingBoxAscent || FS * 0.72)
  const unit = H / cap // world units per pixel
  let desc = 0
  const metrics = chars.map((ch) => {
    const m = ctx.measureText(ch)
    desc = Math.max(desc, m.actualBoundingBoxDescent || 0)
    return m
  })
  let asc = cap
  metrics.forEach((m) => (asc = Math.max(asc, m.actualBoundingBoxAscent || 0)))
  const cellH = Math.ceil(asc + desc + PAD * 2)
  const widths = metrics.map((m) => Math.ceil(Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)) + PAD * 2))
  const cols = Math.max(1, Math.ceil(Math.sqrt(chars.length)))
  const rows = Math.ceil(chars.length / cols)
  let rowW = 0
  for (let r = 0; r < rows; r++) {
    let s = 0
    for (let k = r * cols; k < Math.min(chars.length, (r + 1) * cols); k++) s += widths[k]
    rowW = Math.max(rowW, s)
  }
  const W = Math.max(4, rowW)
  const Hh = Math.max(4, rows * cellH)
  c.width = W
  c.height = Hh
  ctx.font = fontStr
  condense()
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = "center"
  ctx.fillStyle = "#ffffff" // ls:keep
  const glyphs = new Map<string, Glyph>()
  const pos: { x: number; y: number; w: number }[] = []
  let x = 0
  let y = 0
  chars.forEach((ch, i) => {
    if (i % cols === 0) {
      x = 0
      y = Math.floor(i / cols) * cellH
    }
    const w = widths[i]
    const m = metrics[i]
    const cx = x + w / 2 + ((m.actualBoundingBoxLeft || 0) - (m.actualBoundingBoxRight || 0)) / 2 + (m.actualBoundingBoxRight || 0) - (m.actualBoundingBoxLeft || 0) - ((m.actualBoundingBoxRight || 0) - (m.actualBoundingBoxLeft || 0)) / 2
    ctx.fillText(ch, cx, y + PAD + asc)
    pos.push({ x, y, w })
    x += w
  })
  const img = ctx.getImageData(0, 0, W, Hh).data
  const N = W * Hh
  const outer = new Float64Array(N)
  const inner = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const a = img[i * 4 + 3] / 255
    outer[i] = a >= 0.999 ? 0 : a <= 0.001 ? INF : Math.pow(Math.max(0, 0.5 - a), 2)
    inner[i] = a >= 0.999 ? INF : a <= 0.001 ? 0 : Math.pow(Math.max(0, a - 0.5), 2)
  }
  edt2d(outer, W, Hh)
  edt2d(inner, W, Hh)
  const data = new Float32Array(N)
  const cap2 = PAD * 1.6
  for (let i = 0; i < N; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i])
    data[i] = Math.min(cap2, d) * unit
  }
  chars.forEach((ch, i) => {
    const p = pos[i]
    const m = metrics[i]
    const g: Glyph = {
      ch,
      adv: m.width * unit,
      // local x is centred on the cell, local y = 0 sits on the baseline
      box: [(-p.w / 2) * unit, -(cellH - PAD - asc) * unit, (p.w / 2) * unit, (PAD + asc) * unit],
      uv: [p.x / W, (p.y + cellH) / Hh, (p.x + p.w) / W, p.y / Hh],
    }
    if (wantCanvas) {
      const gc = document.createElement("canvas")
      gc.width = p.w
      gc.height = cellH
      gc.getContext("2d")!.drawImage(c, p.x, p.y, p.w, cellH, 0, 0, p.w, cellH)
      g.canvas = gc
    }
    glyphs.set(ch, g)
  })
  return { glyphs, data, w: W, h: Hh }
}

/* ---------- letter layout around a ring ---------- */
interface Slot {
  g: Glyph
  theta: number
  sx: number // horizontal squeeze
}
function layoutRing(text: string, atlas: Atlas, R: number): Slot[] {
  const chars = Array.from(text.length ? text : " ")
  // measure every character in "letter slots": a capital is one slot, spaces and punctuation are narrow
  const letterAdvs = chars.map((ch) => atlas.glyphs.get(ch)?.adv ?? 0).filter((a, i) => a > 0 && /[A-Za-z0-9]/.test(chars[i]))
  letterAdvs.sort((a, b) => a - b)
  const unit = letterAdvs.length ? letterAdvs[Math.floor(letterAdvs.length / 2)] : atlas.glyphs.values().next().value?.adv ?? 0.5
  const eq = chars.map((ch) => {
    const g = atlas.glyphs.get(ch)
    if (!g || !ch.trim()) return 0.24
    if (!/[A-Za-z0-9]/.test(ch)) return Math.min(0.42, g.adv / unit)
    return Math.max(0.5, Math.min(1.6, g.adv / unit))
  })
  const total = eq.reduce((a, b) => a + b, 0)
  const circ = TAU
  // repeat the text to land near the original density
  const copies = Math.max(1, Math.round(circ / (total * SCENE.slot)))
  const slot = circ / (copies * total) // angle per letter slot
  // glyphs are drawn a touch wider than their slot so neighbours touch, like the original
  const sx = (slot * R * 0.92) / unit
  const slots: Slot[] = []
  let acc = 0
  for (let k = 0; k < copies; k++) {
    chars.forEach((ch, i) => {
      const a = eq[i] * slot
      const g = atlas.glyphs.get(ch)
      if (g) slots.push({ g, theta: acc + a / 2, sx })
      acc += a
    })
  }
  return slots
}

/* ---------- small matrix helpers ---------- */
type V3 = [number, number, number]
type M3 = number[] // column major 3x3
const rad = (d: number) => (d * Math.PI) / 180
function m3mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0)
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k]
  return o
}
function rotX(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [1, 0, 0, 0, c, s, 0, -s, c]
}
function rotY(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, 0, -s, 0, 1, 0, s, 0, c]
}
function rotZ(a: number): M3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, s, 0, -s, c, 0, 0, 0, 1]
}
function m3v(m: M3, v: V3): V3 {
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => scl(a, 1 / Math.hypot(a[0], a[1], a[2]))

interface Camera {
  eye: V3
  right: V3
  up: V3
  fwd: V3
  f: number // focal factor: 1 / tan(fov / 2)
  aspect: number
  vp: Float32Array
}
function makeCamera(aspect: number): Camera {
  const el = rad(SCENE.elev)
  const T = SCENE.target as V3
  const eye: V3 = add(T, [0, Math.sin(el) * SCENE.dist, Math.cos(el) * SCENE.dist])
  const back = norm(sub(eye, T))
  const right = norm(cross([0, 1, 0], back))
  const up = cross(back, right)
  // keep the reference framing (fitted to a square) inside any aspect ratio
  const f0 = 1 / Math.tan(rad(SCENE.fov) / 2)
  const f = aspect >= 1 ? f0 : f0 * aspect
  const near = 0.1, far = 40
  const view = [right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right, eye), -dot(up, eye), -dot(back, eye), 1]
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  const vp = new Float32Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k]
    vp[c * 4 + r] = s
  }
  return { eye, right, up, fwd: scl(back, -1), f, aspect, vp }
}

/* ---------- shaders ---------- */
const LETTER_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 iBox;
layout(location=2) in vec4 iUV;
layout(location=3) in vec3 iSlot;
uniform mat4 uVP;
uniform vec3 uEye;
uniform mat3 uRot[2];
uniform vec3 uPos[2];
uniform float uPhase[2];
uniform float uR;
uniform float uDepth;
uniform float uLean;
out vec3 vLocal;
flat out vec3 vEyeL;
flat out vec4 vBox;
flat out vec4 vUV;
flat out vec3 vO;
flat out vec3 vBx;
flat out vec3 vBy;
flat out vec3 vBz;
flat out float vSx;
void main(){
  int r = int(iSlot.x + 0.5);
  float th = iSlot.y + uPhase[r];
  mat3 R = uRot[r];
  vec3 N = R * vec3(sin(th), 0.0, cos(th));
  vec3 T0 = R * vec3(cos(th), 0.0, -sin(th));
  vec3 U0 = R * vec3(0.0, 1.0, 0.0);
  vec3 U = cos(uLean) * U0 + sin(uLean) * T0;
  vec3 T = cos(uLean) * T0 - sin(uLean) * U0;
  vec3 o = uPos[r] + N * uR;
  vec3 lo = vec3(iBox.x * iSlot.z, iBox.y, -uDepth * 0.5);
  vec3 hi = vec3(iBox.z * iSlot.z, iBox.w, uDepth * 0.5);
  vec3 l = mix(lo, hi, aPos);
  vec3 w = o + T * l.x + U * l.y + N * l.z;
  vLocal = l;
  vec3 e = uEye - o;
  vEyeL = vec3(dot(e, T), dot(e, U), dot(e, N));
  vBox = iBox; vUV = iUV; vO = o; vBx = T; vBy = U; vBz = N; vSx = iSlot.z;
  gl_Position = uVP * vec4(w, 1.0);
}`

const LETTER_FS = `#version 300 es
precision highp float;
in vec3 vLocal;
flat in vec3 vEyeL;
flat in vec4 vBox;
flat in vec4 vUV;
flat in vec3 vO;
flat in vec3 vBx;
flat in vec3 vBy;
flat in vec3 vBz;
flat in float vSx;
uniform sampler2D uSdf;
uniform mat4 uVP;
uniform vec3 uEye;
uniform float uDepth;
uniform float uBevel;
uniform vec3 uCols[5];
uniform int uNCols;
uniform vec3 uCenter;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamB;
out vec4 outColor;
float sd2(vec2 p){
  p.x /= vSx;
  vec2 sz = vBox.zw - vBox.xy;
  vec2 q = (p - vBox.xy) / sz;
  vec2 qc = clamp(q, 0.0, 1.0);
  float d = texture(uSdf, mix(vUV.xy, vUV.zw, qc)).r;
  return d + length((q - qc) * sz);
}
float sd3(vec3 p){
  float d2 = sd2(p.xy) * min(vSx, 1.0);
  vec2 w = vec2(d2 + uBevel, abs(p.z) - uDepth * 0.5 + uBevel);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - uBevel;
}
vec3 palette(float s){
  s = clamp(s, 0.0, 1.0) * float(uNCols - 1);
  int i = int(floor(s));
  int j = min(i + 1, uNCols - 1);
  float f = s - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uCols[i], uCols[j], f);
}
void main(){
  vec3 ro = vEyeL;
  vec3 rd = normalize(vLocal - vEyeL);
  vec3 lo = vec3(vBox.x * vSx, vBox.y, -uDepth * 0.5);
  vec3 hi = vec3(vBox.z * vSx, vBox.w, uDepth * 0.5);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (lo - ro) * inv, t1 = (hi - ro) * inv;
  vec3 tmn = min(t0, t1), tmx = max(t0, t1);
  float tn = max(max(tmn.x, tmn.y), tmn.z);
  float tf = min(min(tmx.x, tmx.y), tmx.z);
  float t = max(tn, 0.0);
  bool hit = false;
  vec3 p;
  for (int i = 0; i < 72; i++) {
    p = ro + rd * t;
    float d = sd3(p);
    if (d < 0.0012) { hit = true; break; }
    t += max(d * 0.92, 0.0015);
    if (t > tf) break;
  }
  if (!hit) discard;
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.008;
  vec3 nl = normalize(k.xyy * sd3(p + k.xyy * e) + k.yyx * sd3(p + k.yyx * e) + k.yxy * sd3(p + k.yxy * e) + k.xxx * sd3(p + k.xxx * e));
  vec3 wp = vO + vBx * p.x + vBy * p.y + vBz * p.z;
  vec3 n = normalize(vBx * nl.x + vBy * nl.y + vBz * nl.z);
  vec3 v = normalize(uEye - wp);
  float ndv = dot(n, v);
  vec3 q0 = wp - uCenter;
  vec3 q = vec3(dot(q0, uCamR), dot(q0, uCamU), dot(q0, uCamB));
  // iridescent ramp: cyan and electric blue on the lit lower left, hot pink and orange to the upper right
  float s = 0.5 + 0.55 * q.y + 0.3 * q.x - 0.12 * q.z + 0.08 * dot(n, uCamU);
  float facing = abs(ndv);
  float az = abs(nl.z); // 1 on the letter faces, 0 on the extrusion walls
  // letters on the far side of the ring show their inner faces: keep them darker so the back sits behind
  float farF = smoothstep(0.15, -0.35, dot(vBz, normalize(uEye - vO)));
  vec3 col;
  if (ndv >= 0.0) {
    col = palette(s) * (0.88 + 0.14 * facing);
    // extrusion walls run hot pink
    vec3 wall = mix(palette(s + 0.3) * 0.9, pow(palette(0.62), vec3(1.5)) * 0.45, farF);
    col = mix(col, wall, smoothstep(0.75, 0.2, az));
    col = mix(col, pow(palette(mix(0.5, 0.8, clamp(s, 0.0, 1.0))), vec3(1.5)) * 0.8, farF);
  } else {
    // insides of the rings: dark magenta
    // grazing samples: on near letters they are silhouette corners, so shade them like the walls
    col = mix(palette(s + 0.3) * 0.8, palette(mix(0.5, 0.7, clamp(s, 0.0, 1.0))) * (0.15 + 0.07 * facing), farF);
  }
  // bright white bevel along the lit edges
  float bev = smoothstep(0.1, 0.4, az) * (1.0 - smoothstep(0.75, 0.95, az));
  vec3 ldir = normalize(uCamU * 0.85 - uCamR * 0.35 + uCamB * 0.4);
  float lit = pow(max(dot(n, ldir), 0.0), 1.5);
  // white-hot top and front-left faces
  if (ndv >= 0.0) col = mix(col, vec3(1.0, 0.98, 1.0), pow(max(dot(n, ldir), 0.0), 2.0) * 0.75 * (0.35 + 0.65 * smoothstep(0.6, 0.0, s)) * (1.0 - 0.8 * farF)); // ls:keep
  col = mix(col, vec3(1.0, 0.97, 1.0), clamp(bev * lit * 1.6, 0.0, 0.92) * (ndv >= 0.0 ? 1.0 : 0.5) * (1.0 - 0.5 * farF)); // ls:keep
  // a soft white sheen where the face catches the key light
  vec3 hdir = normalize(ldir + v);
  col += vec3(1.0, 0.96, 0.98) * pow(max(dot(n, hdir), 0.0), 40.0) * 0.35; // ls:keep
  vec4 clip = uVP * vec4(wp, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  outColor = vec4(col, 1.0);
}`

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uKnee;
out vec4 o;
vec3 tap(vec2 uv){ vec3 c = texture(uTex, uv).rgb; return uKnee > 0.0 ? max(c - uKnee, 0.0) * 1.3 + c * 0.15 : c; }
void main(){
  vec2 h = uTexel;
  vec3 s = tap(vUv) * 4.0;
  s += tap(vUv + vec2(-h.x, -h.y)) + tap(vUv + vec2(h.x, -h.y)) + tap(vUv + vec2(-h.x, h.y)) + tap(vUv + vec2(h.x, h.y));
  o = vec4(s / 8.0, 1.0);
}`

const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uGain;
out vec4 o;
void main(){
  vec2 h = uTexel;
  vec3 s = texture(uTex, vUv + vec2(-2.0 * h.x, 0.0)).rgb + texture(uTex, vUv + vec2(2.0 * h.x, 0.0)).rgb
         + texture(uTex, vUv + vec2(0.0, -2.0 * h.y)).rgb + texture(uTex, vUv + vec2(0.0, 2.0 * h.y)).rgb;
  s += (texture(uTex, vUv + vec2(-h.x, h.y)).rgb + texture(uTex, vUv + vec2(h.x, h.y)).rgb
      + texture(uTex, vUv + vec2(-h.x, -h.y)).rgb + texture(uTex, vUv + vec2(h.x, -h.y)).rgb) * 2.0;
  o = vec4(s / 12.0 * uGain, 1.0);
}`

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uAspect;
uniform float uGlow;
uniform float uSceneGain;
uniform vec3 uBg;
uniform vec3 uHalo;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  // square reference coordinates, centred, y down
  vec2 p = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0));
  p.y = -p.y;
  vec2 c = p + 0.5;
  vec4 sc = texture(uScene, vUv);
  vec3 bl = texture(uBloom, vUv).rgb;
  // the glow loses green on its way out: cyan letters bleed blue, peach letters bleed red, as in the original
  bl *= vec3(1.0, 0.55, 1.15); // ls:keep
  vec3 col = sc.rgb * uSceneGain + bl * uGlow;
  vec3 over = max(col - 0.88, 0.0);
  col = min(col, 0.88) + 0.12 * (1.0 - exp(-over / 0.12));
  col = clamp(col, 0.0, 1.0);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  float alpha = max(sc.a, smoothstep(0.008, 0.28, max(bl.r, max(bl.g, bl.b))));
  o = vec4(col, alpha);
}`

/* ---------- component ---------- */
export function NeonLoop({
  text = "LOUIS STUDIOS · ",
  font = 'Anton, "Helvetica Neue Condensed Black", HelveticaNeue-CondensedBlack, "Roboto Condensed", "Arial Narrow", sans-serif',
  fontWeight = 900,
  colors = ["#3ef4ff", "#76a0ff", "#b08cff", "#ff7a8c", "#ffc09a"],
  background = "#1d1a2c",
  halo = "#d81c2c",
  glow = 1,
  speed = 1,
  tilt = 0,
  depth = 0.18,
  interactive = true,
  className,
  style,
}: NeonLoopProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const live = React.useRef({ glow, speed, tilt, depth, interactive, colors, background, halo })
  live.current = { glow, speed, tilt, depth, interactive, colors, background, halo }
  const kick = React.useRef<() => void>(() => {})

  React.useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let disposed = false
    let raf = 0
    let visible = true
    let onScreen = true
    const reduce = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null

    // interaction state
    const ptr = { tx: 0, ty: 0, x: 0, y: 0, down: false, lastX: 0, spin: 0, vel: 0, id: -1 }

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false }) as WebGL2RenderingContext | null
    const chars = Array.from(new Set(Array.from(text).filter((ch) => ch.trim().length > 0)))
    const atlas = buildAtlas(chars.length ? chars : ["O"], font, fontWeight, SCENE.H, !gl)
    const slotsA = layoutRing(text, atlas, SCENE.R)
    const slots = [
      ...slotsA.map((s) => ({ ...s, ring: 0 })),
      ...slotsA.map((s) => ({ ...s, ring: 1 })),
    ]

    let W = 1, Hh = 1, ss = 1
    const ringState = () => {
      const L = live.current
      const out: { rot: M3; pos: V3 }[] = []
      const tiltA = rad(L.tilt + ptr.y * 7)
      const yawA = rad(ptr.x * 10)
      const G = m3mul(rotY(yawA), rotX(tiltA))
      const pivot = SCENE.rings.reduce((a, r) => add(a, scl(r.c as V3, 1 / SCENE.rings.length)), [0, 0, 0] as V3)
      SCENE.rings.forEach((r) => {
        const base = m3mul(rotZ(rad(r.roll)), m3mul(rotX(rad(r.pitch)), rotY(rad(r.yaw))))
        const rot = m3mul(G, base)
        const pos = add(pivot, m3v(G, sub(r.c as V3, pivot)))
        out.push({ rot, pos })
      })
      return out
    }

    let clock = 0
    let last = performance.now()
    let schedule: () => void = () => {}
    let resize: () => void = () => {}
    let cleanup: () => void = () => {}
    const phases = (t: number) => SCENE.rings.map((r) => r.phase - r.dir * (SCENE.omega * t + ptr.spin))

    /* ---------------- WebGL2 path ---------------- */
    if (gl) {
      const hdr = !!gl.getExtension("EXT_color_buffer_float")
      gl.getExtension("OES_texture_float_linear")
      const compile = (vs: string, fs: string) => {
        const p = gl.createProgram()!
        const mk = (type: number, src: string) => {
          const s = gl.createShader(type)!
          gl.shaderSource(s, src)
          gl.compileShader(s)
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
          gl.attachShader(p, s)
          return s
        }
        mk(gl.VERTEX_SHADER, vs)
        mk(gl.FRAGMENT_SHADER, fs)
        gl.linkProgram(p)
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p))
        const u: Record<string, WebGLUniformLocation | null> = {}
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
        for (let i = 0; i < n; i++) {
          const info = gl.getActiveUniform(p, i)!
          const name = info.name.replace(/\[0\]$/, "")
          u[name] = gl.getUniformLocation(p, info.name)
        }
        return { p, u }
      }
      const letterP = compile(LETTER_VS, LETTER_FS)
      const downP = compile(QUAD_VS, DOWN_FS)
      const upP = compile(QUAD_VS, UP_FS)
      const compP = compile(QUAD_VS, COMP_FS)

      // SDF texture
      const sdfTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, sdfTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, atlas.w, atlas.h, 0, gl.RED, gl.FLOAT, atlas.data)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      // letter boxes: one cube, one instance per letter
      const cube = new Float32Array([
        0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, // +z
        1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, // -z
        1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, // +x
        0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, // -x
        0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, // +y
        0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, // -y
      ])
      const inst = new Float32Array(slots.length * 11)
      slots.forEach((s, i) => {
        inst.set([...s.g.box, ...s.g.uv, s.ring, s.theta, s.sx], i * 11)
      })
      const vao = gl.createVertexArray()
      gl.bindVertexArray(vao)
      const cb = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, cb)
      gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0)
      const ib = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, ib)
      gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW)
      const attr = (loc: number, size: number, off: number) => {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 44, off * 4)
        gl.vertexAttribDivisor(loc, 1)
      }
      attr(1, 4, 0)
      attr(2, 4, 4)
      attr(3, 3, 8)
      gl.bindVertexArray(null)

      const quadVao = gl.createVertexArray()
      gl.bindVertexArray(quadVao)
      const qb = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, qb)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)

      interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; depth?: WebGLRenderbuffer }
      const makeTarget = (w: number, h: number, withDepth: boolean): Target => {
        const tex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, tex)
        if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        const fb = gl.createFramebuffer()!
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        let depthRb: WebGLRenderbuffer | undefined
        if (withDepth) {
          depthRb = gl.createRenderbuffer()!
          gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb)
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h)
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb)
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return { fb, tex, w, h, depth: depthRb }
      }
      const freeTarget = (t: Target) => {
        gl.deleteFramebuffer(t.fb)
        gl.deleteTexture(t.tex)
        if (t.depth) gl.deleteRenderbuffer(t.depth)
      }
      let scene: Target | null = null
      let mips: Target[] = []
      const resizeTargets = () => {
        if (scene) freeTarget(scene)
        mips.forEach(freeTarget)
        scene = makeTarget(W * ss, Hh * ss, true)
        mips = []
        let w = W, h = Hh
        for (let i = 0; i < 6; i++) {
          w = Math.max(1, Math.round(w / 2))
          h = Math.max(1, Math.round(h / 2))
          mips.push(makeTarget(w, h, false))
        }
      }

      const drawQuad = () => {
        gl.bindVertexArray(quadVao)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }

      const render = (t: number) => {
        if (!scene) return
        const L = live.current
        const aspect = W / Hh
        const cam = makeCamera(aspect)
        const rs = ringState()
        const ph = phases(t)
        // letters
        gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb)
        gl.viewport(0, 0, scene.w, scene.h)
        gl.clearColor(0, 0, 0, 0)
        gl.clearDepth(1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LESS)
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
        gl.useProgram(letterP.p)
        const u = letterP.u
        gl.uniformMatrix4fv(u.uVP, false, cam.vp)
        gl.uniform3fv(u.uEye, cam.eye)
        gl.uniformMatrix3fv(u.uRot, false, new Float32Array([...rs[0].rot, ...rs[1].rot]))
        gl.uniform3fv(u.uPos, new Float32Array([...rs[0].pos, ...rs[1].pos]))
        gl.uniform1fv(u.uPhase, new Float32Array(ph))
        gl.uniform1f(u.uR, SCENE.R)
        gl.uniform1f(u.uLean, rad(SCENE.lean))
        gl.uniform1f(u.uDepth, Math.max(0.01, L.depth) * SCENE.H)
        gl.uniform1f(u.uBevel, 0.02)
        const cols = (L.colors && L.colors.length >= 2 ? L.colors : ["#3ef4ff", "#ffb27a"]).slice(0, 5)
        const cf = new Float32Array(15)
        cols.forEach((c, i) => cf.set(parseColor(c, [1, 1, 1]), i * 3))
        gl.uniform3fv(u.uCols, cf)
        gl.uniform1i(u.uNCols, cols.length)
        const mid = rs.reduce((a, r) => add(a, scl(add(r.pos, scl(m3v(r.rot, [0, 1, 0]), SCENE.H / 2)), 1 / rs.length)), [0, 0, 0] as V3)
        gl.uniform3fv(u.uCenter, mid)
        gl.uniform3fv(u.uCamR, cam.right)
        gl.uniform3fv(u.uCamU, cam.up)
        gl.uniform3fv(u.uCamB, scl(cam.fwd, -1))
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sdfTex)
        gl.uniform1i(u.uSdf, 0)
        gl.bindVertexArray(vao)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, slots.length)
        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)

        // bloom: dual filter down and up
        gl.useProgram(downP.p)
        let src: Target = scene
        mips.forEach((m, i) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb)
          gl.viewport(0, 0, m.w, m.h)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, src.tex)
          gl.uniform1i(downP.u.uTex, 0)
          gl.uniform2f(downP.u.uTexel, 0.5 / src.w, 0.5 / src.h)
          gl.uniform1f(downP.u.uKnee, i === 0 ? 0.5 : 0.0)
          drawQuad()
          src = m
        })
        gl.useProgram(upP.p)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE)
        for (let i = mips.length - 1; i > 1; i--) {
          const from = mips[i], to = mips[i - 1]
          gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb)
          gl.viewport(0, 0, to.w, to.h)
          gl.bindTexture(gl.TEXTURE_2D, from.tex)
          gl.uniform1i(upP.u.uTex, 0)
          gl.uniform2f(upP.u.uTexel, 0.5 / from.w, 0.5 / from.h)
          gl.uniform1f(upP.u.uGain, i >= 5 ? 2.4 : i === 4 ? 1.3 : 1.0) // the deep levels carry the ring-sized halo
          drawQuad()
        }
        gl.disable(gl.BLEND)

        // composite
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, W, Hh)
        gl.useProgram(compP.p)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, scene.tex)
        gl.uniform1i(compP.u.uScene, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, mips[1].tex)
        gl.uniform1i(compP.u.uBloom, 1)
        gl.uniform2f(compP.u.uRes, W, Hh)
        gl.uniform1f(compP.u.uAspect, aspect)
        gl.uniform1f(compP.u.uGlow, Math.max(0, L.glow) * 0.72)
        gl.uniform1f(compP.u.uSceneGain, 1)
        gl.uniform3fv(compP.u.uBg, parseColor(L.background, [0.11, 0.1, 0.17]))
        gl.uniform3fv(compP.u.uHalo, parseColor(L.halo, [0.85, 0.11, 0.17]))
        drawQuad()
        gl.activeTexture(gl.TEXTURE0)
      }

      resize = () => {
        const r = wrap.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        W = Math.max(2, Math.round(r.width * dpr))
        Hh = Math.max(2, Math.round(r.height * dpr))
        ss = dpr < 1.5 && W * Hh < 1400 * 1400 ? 2 : 1
        canvas.width = W
        canvas.height = Hh
        resizeTargets()
      }
      resize()

      const frame = (now: number) => {
        raf = 0
        if (disposed) return
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
        last = now
        const L = live.current
        const still = !!reduce?.matches
        if (!still) clock += dt * L.speed
        // pointer easing and spin inertia
        const ease = 1 - Math.exp(-dt * 4)
        ptr.x += (ptr.tx - ptr.x) * ease
        ptr.y += (ptr.ty - ptr.y) * ease
        if (!ptr.down) {
          ptr.spin += ptr.vel * dt
          ptr.vel *= Math.exp(-dt * 2.2)
        }
        render(clock)
        if (!still || Math.abs(ptr.vel) > 1e-3 || Math.abs(ptr.tx - ptr.x) + Math.abs(ptr.ty - ptr.y) > 1e-3 || ptr.down) schedule()
      }
      schedule = () => {
        if (!raf && visible && onScreen && !disposed) raf = requestAnimationFrame(frame)
      }
      cleanup = () => {
        if (scene) freeTarget(scene)
        mips.forEach(freeTarget)
        gl.deleteTexture(sdfTex)
        ;[cb, ib, qb].forEach((b) => gl.deleteBuffer(b))
        gl.deleteVertexArray(vao)
        gl.deleteVertexArray(quadVao)
        ;[letterP, downP, upP, compP].forEach((p) => gl.deleteProgram(p.p))
      }
    } else {
      /* ---------------- 2D canvas fallback ---------------- */
      const ctx = canvas.getContext("2d")!
      const render2d = (t: number) => {
        const L = live.current
        const aspect = W / Hh
        const cam = makeCamera(aspect)
        const rs = ringState()
        const ph = phases(t)
        const S = Math.min(W, Hh) / 2
        const proj = (p: V3): [number, number, number] => {
          const q = sub(p, cam.eye)
          const z = dot(q, cam.fwd)
          return [W / 2 + (dot(q, cam.right) / z) * cam.f * Hh / 2 * (aspect >= 1 ? 1 : 1), Hh / 2 - (dot(q, cam.up) / z) * cam.f * Hh / 2, z]
        }
        ctx.globalCompositeOperation = "source-over"
        ctx.clearRect(0, 0, W, Hh)
        const cols = L.colors && L.colors.length >= 2 ? L.colors : ["#3ef4ff", "#ffb27a"]
        const items: { z: number; draw: () => void }[] = []
        const mid = rs.reduce((a, r) => add(a, scl(add(r.pos, scl(m3v(r.rot, [0, 1, 0]), SCENE.H / 2)), 1 / rs.length)), [0, 0, 0] as V3)
        slots.forEach((s) => {
          const r = rs[s.ring]
          const th = s.theta + ph[s.ring]
          const N = m3v(r.rot, [Math.sin(th), 0, Math.cos(th)])
          const T0 = m3v(r.rot, [Math.cos(th), 0, -Math.sin(th)])
          const U0 = m3v(r.rot, [0, 1, 0])
          const ln = rad(SCENE.lean)
          const U = add(scl(U0, Math.cos(ln)), scl(T0, Math.sin(ln)))
          const T = sub(scl(T0, Math.cos(ln)), scl(U0, Math.sin(ln)))
          const o = add(r.pos, scl(N, SCENE.R))
          const b = s.g.box
          const P = (x: number, y: number, z: number) => proj(add(o, add(add(scl(T, x * s.sx), scl(U, y)), scl(N, z))))
          const d = Math.max(0.01, L.depth) * SCENE.H
          const toCam = sub(cam.eye, o)
          const facing = dot(N, norm(toCam))
          const q0 = sub(add(o, scl(U, SCENE.H / 2)), mid)
          let ramp = 0.5 + 0.55 * dot(q0, cam.up) + 0.3 * dot(q0, cam.right) + 0.12 * dot(q0, cam.fwd)
          if (facing < 0) ramp = 0.45 + 0.25 * Math.max(0, Math.min(1, ramp))
          const ci = Math.max(0, Math.min(cols.length - 1, Math.round(ramp * (cols.length - 1))))
          const layers = 6
          items.push({
            z: proj(o)[2],
            draw: () => {
              for (let k = 0; k <= layers; k++) {
                const z = facing >= 0 ? -d / 2 + (d * k) / layers : d / 2 - (d * k) / layers
                const a = P(b[0], b[3], z), bx = P(b[2], b[3], z), c = P(b[0], b[1], z)
                const gw = s.g.canvas!.width, gh = s.g.canvas!.height
                ctx.setTransform((bx[0] - a[0]) / gw, (bx[1] - a[1]) / gw, (c[0] - a[0]) / gh, (c[1] - a[1]) / gh, a[0], a[1])
                ctx.globalAlpha = k === layers ? (facing >= 0 ? 1 : 0.42) : facing >= 0 ? 0.9 : 0.5
                ctx.filter = k === layers ? "none" : "brightness(1.8)"
                ctx.drawImage(tinted(s.g, cols[ci], k === layers ? 1 : 0.6), 0, 0)
              }
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              ctx.filter = "none"
              ctx.globalAlpha = 1
            },
          })
        })
        items.sort((a, b) => b.z - a.z)
        ctx.save()
        ctx.shadowColor = cols[0]
        ctx.shadowBlur = 18 * Math.max(0, L.glow) * (S / 360)
        items.forEach((it) => it.draw())
        ctx.restore()
      }
      const tintCache = new Map<string, HTMLCanvasElement>()
      const tinted = (g: Glyph, col: string, k: number) => {
        const key = g.ch + col + k
        let c = tintCache.get(key)
        if (!c) {
          c = document.createElement("canvas")
          c.width = g.canvas!.width
          c.height = g.canvas!.height
          const x = c.getContext("2d")!
          x.drawImage(g.canvas!, 0, 0)
          x.globalCompositeOperation = "source-in"
          x.fillStyle = col
          x.fillRect(0, 0, c.width, c.height)
          if (k < 1) {
            x.globalCompositeOperation = "source-atop"
            x.fillStyle = "rgba(255,255,255,0.5)" // ls:keep
            x.fillRect(0, 0, c.width, c.height)
          }
          tintCache.set(key, c)
        }
        return c
      }
      resize = () => {
        const r = wrap.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        W = Math.max(2, Math.round(r.width * dpr))
        Hh = Math.max(2, Math.round(r.height * dpr))
        canvas.width = W
        canvas.height = Hh
      }
      resize()
      const frame = (now: number) => {
        raf = 0
        if (disposed) return
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
        last = now
        const L = live.current
        const still = !!reduce?.matches
        if (!still) clock += dt * L.speed
        const ease = 1 - Math.exp(-dt * 4)
        ptr.x += (ptr.tx - ptr.x) * ease
        ptr.y += (ptr.ty - ptr.y) * ease
        if (!ptr.down) {
          ptr.spin += ptr.vel * dt
          ptr.vel *= Math.exp(-dt * 2.2)
        }
        render2d(clock)
        if (!still || Math.abs(ptr.vel) > 1e-3 || ptr.down) schedule()
      }
      schedule = () => {
        if (!raf && visible && onScreen && !disposed) raf = requestAnimationFrame(frame)
      }
      cleanup = () => tintCache.clear()
    }

    const ro = new ResizeObserver(() => {
      resize()
      last = performance.now()
      schedule()
    })
    ro.observe(wrap)
    const io = new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting)
      last = performance.now()
      schedule()
    })
    io.observe(wrap)
    const onVis = () => {
      visible = document.visibilityState !== "hidden"
      last = performance.now()
      schedule()
    }
    document.addEventListener("visibilitychange", onVis)
    const onMotion = () => {
      last = performance.now()
      schedule()
    }
    reduce?.addEventListener?.("change", onMotion)

    const local = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect()
      return [((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1]
    }
    const onMove = (e: PointerEvent) => {
      if (!live.current.interactive) return
      const [x, y] = local(e)
      ptr.tx = Math.max(-1, Math.min(1, x))
      ptr.ty = Math.max(-1, Math.min(1, y))
      if (ptr.down && e.pointerId === ptr.id) {
        const r = wrap.getBoundingClientRect()
        const dx = (e.clientX - ptr.lastX) / Math.max(1, r.width)
        ptr.lastX = e.clientX
        const d = dx * 3.2
        ptr.spin -= d
        ptr.vel = ptr.vel * 0.6 + (-d / Math.max(1 / 120, 1 / 60)) * 0.4
      }
      schedule()
    }
    const onDown = (e: PointerEvent) => {
      if (!live.current.interactive) return
      ptr.down = true
      ptr.id = e.pointerId
      ptr.lastX = e.clientX
      ptr.vel = 0
      try {
        wrap.setPointerCapture(e.pointerId)
      } catch {}
      schedule()
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== ptr.id) return
      ptr.down = false
      ptr.id = -1
      schedule()
    }
    const onLeave = () => {
      if (ptr.down) return
      ptr.tx = 0
      ptr.ty = 0
      schedule()
    }
    wrap.addEventListener("pointermove", onMove)
    wrap.addEventListener("pointerdown", onDown)
    wrap.addEventListener("pointerup", onUp)
    wrap.addEventListener("pointercancel", onUp)
    wrap.addEventListener("pointerleave", onLeave)
    last = performance.now()
    kick.current = () => {
      last = performance.now()
      schedule()
    }
    schedule()

    return () => {
      kick.current = () => {}
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      reduce?.removeEventListener?.("change", onMotion)
      wrap.removeEventListener("pointermove", onMove)
      wrap.removeEventListener("pointerdown", onDown)
      wrap.removeEventListener("pointerup", onUp)
      wrap.removeEventListener("pointercancel", onUp)
      wrap.removeEventListener("pointerleave", onLeave)
      cleanup()
    }
  }, [text, font, fontWeight])

  // redraw once when a live prop changes, so a paused or reduced-motion view still updates
  const colorKey = (colors || []).join("|")
  React.useEffect(() => kick.current(), [glow, speed, tilt, depth, colorKey, background, halo])

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: "relative", overflow: "hidden", background, touchAction: interactive ? "none" : undefined, cursor: interactive ? "grab" : undefined, ...style }}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  )
}

export default NeonLoop
