import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Project } from "@/lib/projects";

export type Quality = 0 | 1 | 2; // low / medium / high
export type SceneApi = { step(d: number): void; open(): void; goTo(i: number): void; setQuality(q: Quality): void; dispose(): void };
type Opts = {
  canvas: HTMLCanvasElement; host: HTMLElement; projects: Project[]; reduceMotion: boolean; quality: Quality;
  onActive(i: number, accent: string): void; onOpen(i: number): void; onReady(): void;
};

/*
 * Ring seen from OUTSIDE the cylinder: ring centre is BEHIND the cards at z = -D - R,
 * the active card sits D units in front of the target, side cards curve away from the camera.
 * Post chain: scene -> UnrealBloom (neon) -> liquid lens (refracts the frame under the cursor) -> sRGB output.
 *
 * Cards: hover/click NEVER changes the card's shape, size or angle. Only the image gets an effect (see imgFx in imgFrag).
 */
const CW = 2.1, CH = 2.85, R = 8.5, D = 12, STEP = 0.29, FLOOR = -1.75, SPAN = 5.2, FR = 0.08;
const CARD_RADIUS = 0.16, FRAME_RADIUS = 0.24;
const BLOOM = [0, 0.75, 1.0] as const;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const HUES = [268, 262, 275, 258, 280, 266];
const hashAccent = (slug: string) => new THREE.Color().setHSL(HUES[hash(slug) % HUES.length] / 360, 0.85, 0.5);
const MAGENTA = new THREE.Color().setHSL(305 / 360, 0.9, 0.55);
const rgba = (c: THREE.Color, a: number) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

function roundedGeo(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ShapeGeometry(s, 10);
  setCover(g, 1, 1);
  return g;
}
// "object-fit: cover" baked into the UVs
function setCover(g: THREE.BufferGeometry, iw: number, ih: number) {
  const ia = iw / ih, ca = CW / CH;
  const sx = ia > ca ? ca / ia : 1, sy = ia > ca ? 1 : ia / ca;
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + (p.getX(i) / CW) * sx, 0.5 + (p.getY(i) / CH) * sy);
  uv.needsUpdate = true;
}
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, srgb = false) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function fallbackTex(p: Project, accent: THREE.Color) {
  return canvasTex(512, 768, (x) => {
    const g = x.createLinearGradient(0, 0, 512, 768); g.addColorStop(0, "#0c0b12"); g.addColorStop(1, "#18141f");
    x.fillStyle = g; x.fillRect(0, 0, 512, 768);
    const r = x.createRadialGradient(360, 250, 0, 360, 250, 380);
    r.addColorStop(0, rgba(accent, 0.5)); r.addColorStop(1, rgba(accent, 0)); x.fillStyle = r; x.fillRect(0, 0, 512, 768);
    for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; x.fillRect(Math.random() * 512, Math.random() * 768, 1.5, 1.5); }
    x.fillStyle = "#f4f1ee"; x.font = "500 58px Georgia, serif"; x.textBaseline = "alphabetic";
    const words = p.title.split(" "); let line = "", y = 640 - Math.max(0, Math.ceil(p.title.length / 14) - 1) * 62;
    for (const w of words) { const t = line ? line + " " + w : w; if (x.measureText(t).width > 430 && line) { x.fillText(line, 44, y); y += 62; line = w; } else line = t; }
    x.fillText(line, 44, y);
  }, true);
}

/* Monospace spec sheet printed on a card while it is hovered. Only the alpha channel is used by the shader. */
function drawInfo(x: CanvasRenderingContext2D, p: Project, pi: number, fam: string) {
  x.clearRect(0, 0, 512, 707);
  x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
  x.font = `500 15px ${fam}`;
  const L = 84, Rr = 512 - 84, W = Rr - L;
  const fit = (s: string, max: number) => { let t = s.toUpperCase(); while (t.length > 1 && x.measureText(t).width > max) t = t.slice(0, -2) + "…"; return t; };
  let y = 285;
  x.textAlign = "left"; x.fillText("PROJECT", L, y);
  x.textAlign = "right"; x.fillText("/" + String(pi + 1).padStart(2, "0"), Rr, y);
  y += 40;
  const rows: [string, string][] = [["NAME:", p.title], ["TYPE:", p.category]];
  if (p.emotion) rows.push(["MOOD:", p.emotion]);
  if (p.status) rows.push(["STATUS:", p.status]);
  for (const [k, v] of rows) {
    x.textAlign = "left"; x.fillText(k, L, y);
    x.textAlign = "right"; x.fillText(fit(v, W - x.measureText(k).width - 14), Rr, y);
    y += 28;
  }
  if (p.tech.length) {
    y += 6; x.textAlign = "left"; x.fillText("STACK:", L, y);
    x.textAlign = "right";
    for (const t of p.tech.slice(0, 4)) { x.fillText(fit(t, W - 90), Rr, y); y += 22; }
  }
}
function sampleAccent(img: HTMLImageElement) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), s = (mx - mn) / 255;
      const wt = s * s + 0.01; r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt; sat += s;
    }
    if (sat / 576 < 0.14) return null;
    const col = new THREE.Color().setRGB(r / w / 255, g / w / 255, b / w / 255, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl); return col.setHSL(hsl.h, Math.max(hsl.s, 0.7), 0.55);
  } catch { return null; }
}

// ---------- shaders ----------
const CWf = CW.toFixed(3), CHf = CH.toFixed(3);
// Shared vertex stage. Flat on purpose: hover must not bend, scale or rotate the card.
const cardVert = `varying vec2 vUv; varying vec2 vP;
void main(){
  vUv = uv; vP = position.xy / vec2(${CWf}, ${CHf}) + 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const imgFrag = `uniform sampler2D map; uniform sampler2D info;
uniform float uDim, uHover, uSide, uInfo, uClick, uTime; uniform vec2 uMouse;
varying vec2 vUv; varying vec2 vP;

// ===== HOVER / CLICK EFFECT (image only). Swap this function to change the effect. =====
// uv: image coords, w (out): hover strength around the cursor 0..1.
// uMouse = cursor position on the card (0..1), uClick = 1 right after a click, fades to 0.
vec2 imgFx(vec2 uv, out float w){
  vec2 d = vP - uMouse; d.x *= ${CWf} / ${CHf};
  float r = length(d); vec2 dir = d / (r + 1e-4);
  w = uHover * exp(-r * r * 14.0);
  float ripple = sin(r * 40.0 - uTime * 7.0) * w;
  float q = (r - (1.0 - uClick) * 1.1) * 9.0;
  float shock = uClick * exp(-q * q);
  return uv + dir * (ripple * 0.010 + shock * 0.035);
}

void main(){
  float ed = min(min(vP.x, 1.0 - vP.x) * ${CWf}, min(vP.y, 1.0 - vP.y) * ${CHf});
  float k = 1.0 - smoothstep(0.0, 0.3, ed);
  vec2 uv = vUv - (vP - 0.5) * k * 0.06;
  float w; uv = imgFx(uv, w);
  float ab = w * 0.012 + uClick * 0.01;
  vec3 c = vec3(texture2D(map, uv + vec2(ab, 0.0)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(ab, 0.0)).b);
  c *= mix(0.3, 1.0, smoothstep(0.0, 0.4, ed));
  float groove = 0.5 + 0.5 * sin(vP.x * 150.0);
  c *= 1.0 - uSide * 0.18 - (0.07 + 0.3 * uSide) * groove;
  float t = texture2D(info, vP).a * uInfo;
  c = mix(c * (1.0 - 0.4 * t), vec3(1.0), t * 0.92);
  gl_FragColor = vec4(c * uDim, 1.0);
  #include <colorspace_fragment>
}`;
const frameFrag = `uniform vec3 uColor; uniform float uAlpha; varying vec2 vP;
void main(){
  vec3 c = uColor * (0.85 + 0.3 * vP.y);
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;
const glowFrag = `uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main(){
  float a = texture2D(map, vUv).a;
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}`;
// reflection: short and soft so it reads as a glossy floor, not a mirror
const reflFrag = `uniform sampler2D map; uniform float uDim; varying vec2 vUv; varying vec2 vP;
void main(){
  float vH = vP.y;
  float b = 0.012 + vH * 0.06; vec3 c = texture2D(map, vUv).rgb * 0.36;
  c += texture2D(map, vUv + vec2(0.0, b)).rgb * 0.2 + texture2D(map, vUv - vec2(0.0, b)).rgb * 0.2;
  c += texture2D(map, vUv + vec2(b, 0.0)).rgb * 0.12 + texture2D(map, vUv - vec2(b, 0.0)).rgb * 0.12;
  gl_FragColor = vec4(c * uDim, pow(clamp(1.0 - vH, 0.0, 1.0), 2.8) * 0.34);
  #include <colorspace_fragment>
}`;
const floorVert = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const floorFrag = `varying vec3 vW; uniform vec3 uAccent; uniform float uR; uniform vec2 uC;
void main(){
  vec2 d = vW.xz - uC; float e = abs(length(d) - uR); float th = atan(d.x, d.y);
  float m = 1.0 - smoothstep(1.1, 1.7, abs(th));
  float a = (exp(-e*e*220.0) * 1.0 + exp(-e*e*1.6) * 0.42) * m;
  gl_FragColor = vec4(uAccent, a);
  #include <colorspace_fragment>
}`;
// drifting smoke: domain-warped fbm, tinted by the accent. uMode 0 = vertical haze at the top, 1 = ground haze.
const smokeVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const smokeFrag = `uniform float uTime, uOp, uMode; uniform vec3 uColor; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * nz(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec2 p = vUv * vec2(4.0, 2.2);
  vec2 q = vec2(fbm(p + vec2(uTime * 0.035, 0.0)), fbm(p + vec2(3.1, uTime * 0.028)));
  float f = smoothstep(0.34, 0.86, fbm(p + q * 1.7 + vec2(0.0, -uTime * 0.02)));
  float sx = smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x));
  float top = smoothstep(0.3, 1.0, vUv.y) * sx;
  float gnd = smoothstep(0.0, 0.45, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y)) * sx;
  gl_FragColor = vec4(uColor, f * mix(top, gnd, uMode) * uOp);
  #include <colorspace_fragment>
}`;
// liquid lens: a jelly blob follows the cursor and REFRACTS the already rendered frame (magnify + edge bend + chromatic split)
const lensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, uPos: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector2() },
    uSize: { value: 1 }, uVis: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uPos, uVel; uniform float uSize, uVis, uTime, uAspect; varying vec2 vUv;
float sdf(vec2 p){
  vec2 d = p - uPos; float sp = length(uVel);
  vec2 dir = sp > 1e-3 ? uVel / sp : vec2(1.0, 0.0);
  float st = 1.0 + min(sp * 0.35, 1.0);
  vec2 q = vec2(dot(d, dir) / st, dot(d, vec2(-dir.y, dir.x)) * sqrt(st));
  float ang = atan(q.y, q.x + 1e-5);
  float r = 0.1 * uSize * (1.0 + 0.08 * sin(ang * 3.0 + uTime * 1.6) + 0.05 * sin(ang * 5.0 - uTime * 1.1));
  return length(q) - r;
}
void main(){
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (vUv - 0.5) * asp;
  float k = uVis * clamp(uSize * 1.3, 0.0, 1.0);
  if (k < 0.002) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
  float d = sdf(p);
  vec2 e = vec2(0.003, 0.0);
  vec2 n = normalize(vec2(sdf(p + e.xy) - sdf(p - e.xy), sdf(p + e.yx) - sdf(p - e.yx)) + 1e-6);
  float inside = smoothstep(0.012, -0.012, d);
  float edge = exp(-abs(d) * 55.0);
  vec2 off = (-n * edge * 0.05 + (uPos - p) * 0.28 * inside) / asp * k;
  vec2 cn = n / asp * edge * 0.012 * k;
  vec3 c = vec3(texture2D(tDiffuse, vUv + off + cn).r, texture2D(tDiffuse, vUv + off).g, texture2D(tDiffuse, vUv + off - cn).b);
  c += vec3(0.55, 0.5, 0.7) * edge * 0.18 * k + vec3(0.07) * inside * k;
  gl_FragColor = vec4(c, 1.0);
}`,
};

type Card = {
  i: number; pivot: THREE.Group; rpivot: THREE.Group; img: THREE.Mesh;
  mat: THREE.ShaderMaterial; rmat: THREE.ShaderMaterial; fmat: THREE.ShaderMaterial; rfmat: THREE.ShaderMaterial;
  gmat: THREE.ShaderMaterial; accent: THREE.Color; hov: { value: number };
};

export function createWorkScene(o: Opts): SceneApi {
  const { canvas, host, projects, reduceMotion } = o, n = projects.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x030206, 1); // canvas MSAA is useless with a composer; the offscreen target below is multisampled instead
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  const accentCur = hashAccent(projects[0].slug), accentGoal = accentCur.clone();

  // --- cards
  const glowTex = canvasTex(256, 384, (x) => {
    x.shadowColor = "#fff"; x.shadowBlur = 40; x.fillStyle = "#fff";
    x.beginPath(); x.roundRect(43, 51, 170, 282, 22); x.fill();
  });
  const frameGeo = roundedGeo(CW + FR * 2, CH + FR * 2, FRAME_RADIUS), glowGeo = new THREE.PlaneGeometry(CW + 1.6, CH + 1.6);
  const mirror = new THREE.Group(); mirror.scale.y = -1; mirror.position.y = 2 * FLOOR; scene.add(mirror);
  const cards: Card[] = [], hit: THREE.Mesh[] = [];
  const loader = { cancelled: false };

  // Fonts: the spec sheet is drawn into a canvas, so wait for the real font and redraw (next/font renames families).
  const monoFam = () => {
    const v = getComputedStyle(host).getPropertyValue("--font-plex-mono").trim();
    return (v ? v + "," : "") + "ui-monospace, Menlo, Consolas, monospace";
  };

  // Infinite-looking ring: tile the projects so there are always >= 21 cards (copies share textures/geometry).
  const L = n >= 21 ? n : n * Math.ceil(21 / n), start = L > n ? n * Math.floor(L / n / 2) : 0;
  const geoP: THREE.BufferGeometry[] = [], texP: THREE.Texture[] = [], accP: THREE.Color[] = [], infoP: THREE.CanvasTexture[] = [];

  projects.forEach((p, pi) => {
    const accent = hashAccent(p.slug), geo = roundedGeo(CW, CH, CARD_RADIUS); setCover(geo, 512, 768);
    const fam0 = monoFam();
    geoP.push(geo); texP.push(fallbackTex(p, accent)); accP.push(accent);
    infoP.push(canvasTex(512, 707, (x) => drawInfo(x, p, pi, fam0)));
    if (!p.image_url) return;
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => {
      if (loader.cancelled) return;
      const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.needsUpdate = true;
      setCover(geoP[pi], im.naturalWidth, im.naturalHeight);
      texP[pi].dispose(); texP[pi] = t;
      for (const cd of cards) if (cd.i % n === pi) { cd.mat.uniforms.map.value = t; cd.rmat.uniforms.map.value = t; }
      const a = sampleAccent(im);
      if (a) { accP[pi].copy(a); if (shown >= 0 && shown % n === pi) o.onActive(pi, "#" + a.getHexString()); }
    };
    im.onerror = () => console.error("[work] image failed to load (private bucket / CORS / bad URL?):", p.image_url);
    im.src = p.image_url;
  });
  if (document.fonts) {
    const fam = monoFam();
    document.fonts.load(`500 15px ${fam}`).catch(() => undefined).then(() => {
      if (loader.cancelled) return;
      projects.forEach((p, pi) => {
        const cv = infoP[pi].image as HTMLCanvasElement;
        drawInfo(cv.getContext("2d")!, p, pi, fam); infoP[pi].needsUpdate = true;
      });
    });
  }

  for (let i = 0; i < L; i++) {
    const pi = i % n, accent = accP[pi], geo = geoP[pi], tex = texP[pi];
    const hov = { value: 0 };

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex }, info: { value: infoP[pi] }, uDim: { value: 0.5 }, uHover: hov, uSide: { value: 0 }, uInfo: { value: 0 },
        uClick: { value: 0 }, uTime: { value: 0 }, uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: cardVert, fragmentShader: imgFrag,
    });
    const img = new THREE.Mesh(geo, mat); img.userData.i = i; hit.push(img);
    const fmat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: accent.clone() }, uAlpha: { value: 1 } }, vertexShader: cardVert, fragmentShader: frameFrag });
    const frame = new THREE.Mesh(frameGeo, fmat); frame.position.z = -0.012;
    const gmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTex }, uColor: { value: accent.clone() }, uOpacity: { value: 0 } },
      vertexShader: cardVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, gmat); glow.position.z = -0.06;
    const pivot = new THREE.Group(); pivot.add(glow, frame, img); scene.add(pivot);

    const rmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uDim: { value: 0.5 } }, vertexShader: cardVert, fragmentShader: reflFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const rfmat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: accent.clone() }, uAlpha: { value: 0.1 } }, vertexShader: cardVert, fragmentShader: frameFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const rframe = new THREE.Mesh(frameGeo, rfmat); rframe.position.z = -0.012;
    const rpivot = new THREE.Group(); rpivot.add(new THREE.Mesh(geo, rmat), rframe); mirror.add(rpivot);

    cards.push({ i, pivot, rpivot, img, mat, rmat, fmat, rfmat, gmat, accent, hov });
  }

  // --- floor track, light beams, smoke, dust
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    uniforms: { uAccent: { value: new THREE.Color() }, uR: { value: R + 0.1 }, uC: { value: new THREE.Vector2(0, -D - R) } },
    vertexShader: floorVert, fragmentShader: floorFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; floor.renderOrder = 5; scene.add(floor);

  const shaftTex = canvasTex(64, 256, (x) => {
    const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, "rgba(255,255,255,0)"); h.addColorStop(0.5, "rgba(255,255,255,1)"); h.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = h; x.fillRect(0, 0, 64, 256); x.globalCompositeOperation = "destination-in";
    const v = x.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, "rgba(255,255,255,1)"); v.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = v; x.fillRect(0, 0, 64, 256);
  });
  const beamMat = (op: number) => new THREE.MeshBasicMaterial({ map: shaftTex, color: accentCur, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const shaftMat = beamMat(0.2), beamMats = [beamMat(0.12), beamMat(0.12)];
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 14), shaftMat); shaft.position.set(0, 3.6, -D - 4); scene.add(shaft);
  const beamGeo = new THREE.PlaneGeometry(0.5, 17);
  ([1, -1] as const).forEach((sd, k) => {
    const b = new THREE.Mesh(beamGeo, beamMats[k]); b.rotation.z = sd * 1.1; b.position.set(sd * 7.4, 3.4, -D - 4); scene.add(b);
  });

  const smokeMat = (mode: number) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOp: { value: 0 }, uMode: { value: mode }, uColor: { value: accentCur } },
    vertexShader: smokeVert, fragmentShader: smokeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const smokeTop = new THREE.Mesh(new THREE.PlaneGeometry(64, 24), smokeMat(0)); smokeTop.position.set(0, 3, -D - 7); scene.add(smokeTop);
  const smokeGnd = new THREE.Mesh(new THREE.PlaneGeometry(56, 34), smokeMat(1)); smokeGnd.rotation.x = -Math.PI / 2; smokeGnd.position.set(0, FLOOR + 0.04, -D - 6); smokeGnd.renderOrder = 6; scene.add(smokeGnd);
  const smokes = [smokeTop, smokeGnd];

  const dustN = 280, dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (Math.random() - 0.5) * 30; dp[i * 3 + 1] = Math.random() * 9 - 3; dp[i * 3 + 2] = -Math.random() * 26 + 4; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dotTex = canvasTex(32, 32, (x) => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); });
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  // --- post processing
  const msaa = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, msaa);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.75, 0.22);
  composer.addPass(bloom);
  const lens = new ShaderPass(lensShader);
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; const dist = D + 3.6;
    const visH = camera.aspect < 1 ? 10 : 9.3;
    camera.fov = 2 * Math.atan(visH / 2 / dist) * 180 / Math.PI; camera.updateProjectionMatrix();
    lens.uniforms.uAspect.value = camera.aspect;
  };
  let quality: Quality = o.quality;
  const applyQuality = (q: Quality) => {
    quality = q;
    const cap = q === 0 ? 1 : q === 1 ? 1.5 : host.clientWidth < 700 ? 1.5 : 2;
    const pr = Math.min(window.devicePixelRatio || 1, cap);
    renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    bloom.enabled = q > 0; smokes.forEach((m) => { m.visible = q > 0; });
    resize();
  };
  const ro = new ResizeObserver(resize); ro.observe(host); applyQuality(quality);

  // --- state & input
  let target = start, cur = reduceMotion ? start : start - 3, vel = 0, shown = -1, px = 0, py = 0, spx = 0, spy = 0, raf = 0, snap = 0, tReady = 0, kick = 0;
  let bx = 0, by = 0, bvx = 0, bvy = 0, inside = false, mouse = false, blobInit = false;
  const setTarget = (v: number) => { target = clamp(v, -0.4, L - 0.6); };
  const snapTarget = () => { target = clamp(Math.round(target), 0, L - 1); };
  let down = false, moved = 0, lastX = 0, dragVel = 0;
  const pxPerCard = () => Math.max(120, host.clientWidth / 5.2);

  const onDown = (e: PointerEvent) => { down = true; moved = 0; lastX = e.clientX; dragVel = 0; canvas.setPointerCapture(e.pointerId); clearTimeout(snap); };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 2 - 1; py = ((e.clientY - r.top) / r.height) * 2 - 1;
    mouse = e.pointerType === "mouse"; inside = true;
    if (!down) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx);
    setTarget(target - dx / pxPerCard()); dragVel = dx;
  };
  const onEnter = () => { inside = true; };
  const onLeave = () => { inside = false; };
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  const onUp = (e: PointerEvent) => {
    if (!down) return; down = false;
    if (moved < 6) {
      const r = canvas.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(v2, camera); const h = ray.intersectObjects(hit, false).find((x) => cards[x.object.userData.i as number].pivot.visible);
      if (h) {
        const i = h.object.userData.i as number;
        // click effect on the image only: aim it at the click point, then let it play out
        const cd = cards[i], l = cd.img.worldToLocal(h.point.clone());
        (cd.mat.uniforms.uMouse.value as THREE.Vector2).set(l.x / CW + 0.5, l.y / CH + 0.5);
        cd.mat.uniforms.uClick.value = 1;
        if (i === Math.round(cur) && Math.abs(cur - i) < 0.3) o.onOpen(i % n); else target = i;
        return;
      }
    }
    target = clamp(Math.round(target - dragVel / pxPerCard() * 3), 0, L - 1);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); setTarget(target + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.0024);
    clearTimeout(snap); snap = window.setTimeout(snapTarget, 130);
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerenter", onEnter); canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // --- loop
  const t0 = performance.now(); let last = t0; const col = new THREE.Color();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - t0) / 1000;
    const intro = reduceMotion ? 1 : 1 - Math.pow(1 - clamp(t / 2.4, 0, 1), 3);
    const k = 52, c = 2 * Math.sqrt(k) * 0.95; vel += ((target - cur) * k - vel * c) * dt; cur += vel * dt;
    if (L > n && !down && Math.abs(vel) < 0.02 && Math.abs(target - cur) < 0.05) {
      const r0 = Math.round(cur);
      if (r0 < 7 || r0 > L - 8) { const sh = Math.round((start - r0) / n) * n; cur += sh; target += sh; }
    }
    const idx = clamp(Math.round(cur), 0, L - 1);
    if (idx !== shown) { if (shown >= 0) kick = 0.45; shown = idx; o.onActive(idx % n, "#" + cards[idx].accent.getHexString()); }
    kick *= Math.exp(-dt * 3.2);

    let hv = -1; const hp = new THREE.Vector3();
    if (inside && mouse && !down) {
      v2.set(px, -py); ray.setFromCamera(v2, camera);
      const h = ray.intersectObjects(hit, false).find((x) => cards[x.object.userData.i as number].pivot.visible);
      if (h) { hv = h.object.userData.i as number; hp.copy(h.point); }
    }
    canvas.style.cursor = hv >= 0 && !down ? "pointer" : "";
    accentGoal.copy(hv >= 0 ? MAGENTA : cards[idx].accent);
    accentCur.lerp(accentGoal, 1 - Math.exp(-dt * 2.4));

    // cursor position on the hovered card (0..1), used by the image effect
    if (hv >= 0) {
      const l = cards[hv].img.worldToLocal(hp.clone());
      (cards[hv].mat.uniforms.uMouse.value as THREE.Vector2).set(l.x / CW + 0.5, l.y / CH + 0.5);
    }

    for (const cd of cards) {
      cd.hov.value += ((cd.i === hv ? 1 : 0) - cd.hov.value) * (1 - Math.exp(-dt * 6));
      cd.mat.uniforms.uTime.value = t;
      cd.mat.uniforms.uClick.value = Math.max(0, (cd.mat.uniforms.uClick.value as number) - dt * 1.1);
      const rel = cd.i - cur, vis = Math.abs(rel) < SPAN;
      cd.pivot.visible = cd.rpivot.visible = vis; if (!vis) continue;
      // act: tight curve for the small pop of the centre card. lit: wide curve for light, so neighbours stay fairly bright.
      const th = rel * STEP, act = Math.exp(-rel * rel * 3.4), lit = Math.exp(-rel * rel * 0.9), s = 1 + 0.06 * act;
      const x = R * Math.sin(th), z = -D - R * (1 - Math.cos(th)) + act * 0.45, y = act * 0.05;
      for (const g of [cd.pivot, cd.rpivot]) { g.position.set(x, y, z); g.rotation.y = th; g.scale.set(s, s, 1); }
      const edge = clamp(1 - (Math.abs(rel) - 3.6) / 1.6, 0, 1) * intro;
      const dim = (0.3 + 0.7 * lit) * edge; // centre 1.0, neighbour ~0.59, further ~0.32
      cd.mat.uniforms.uDim.value = dim; cd.mat.uniforms.uSide.value = (1 - lit) * edge;
      cd.mat.uniforms.uInfo.value = cd.hov.value * edge; // spec sheet only while hovered
      cd.rmat.uniforms.uDim.value = dim * 0.6;
      // frame goes above 1.0 on the active card, which is what the bloom pass picks up
      const fc = (0.3 + 0.9 * lit) * edge;
      (cd.fmat.uniforms.uColor.value as THREE.Color).copy(accentCur).multiplyScalar(fc);
      (cd.rfmat.uniforms.uColor.value as THREE.Color).copy(accentCur); cd.rfmat.uniforms.uAlpha.value = 0.1 * edge;
      (cd.gmat.uniforms.uColor.value as THREE.Color).copy(accentCur); cd.gmat.uniforms.uOpacity.value = (0.06 + 0.4 * lit) * edge;
    }
    (floor.material as THREE.ShaderMaterial).uniforms.uAccent.value = col.copy(accentCur).multiplyScalar((0.6 + 0.4 * intro) * 1.25);
    const flick = 1 + 0.12 * Math.sin(t * 1.3) + 0.06 * Math.sin(t * 3.1);
    shaftMat.color.copy(accentCur); shaftMat.opacity = 0.2 * intro * flick;
    beamMats.forEach((m, i) => { m.color.copy(accentCur); m.opacity = 0.12 * intro * (1 + 0.1 * Math.sin(t * 0.9 + i * 2)); });
    smokes.forEach((m) => { const u = (m.material as THREE.ShaderMaterial).uniforms; u.uTime.value = t; u.uOp.value = 0.34 * intro; });
    dust.position.y = Math.sin(t * 0.12) * 0.15; dust.rotation.y = t * 0.006;

    spx += (px - spx) * (1 - Math.exp(-dt * 2.2)); spy += (py - spy) * (1 - Math.exp(-dt * 2.2));
    const drift = reduceMotion ? 0 : 1;
    camera.position.set(spx * 0.4 + Math.sin(t * 0.17) * 0.08 * drift, 2.4 - spy * 0.15 + Math.sin(t * 0.23) * 0.04 * drift, 3.6 + (1 - intro) * 2.8);
    camera.lookAt(spx * 0.12, -0.7, -D);

    // liquid lens follows the cursor with lag, stretches with speed; switched off over a card so it doesn't fight the image effect
    const asp = camera.aspect, tx = px * asp * 0.5, ty = -py * 0.5;
    if (!blobInit && inside && mouse) { bx = tx; by = ty; blobInit = true; }
    const kb = 1 - Math.exp(-dt * 7), nx = bx + (tx - bx) * kb, ny = by + (ty - by) * kb, kv = 1 - Math.exp(-dt * 10);
    bvx += ((nx - bx) / Math.max(dt, 1e-3) - bvx) * kv; bvy += ((ny - by) / Math.max(dt, 1e-3) - bvy) * kv; bx = nx; by = ny;
    const bu = lens.uniforms;
    (bu.uPos.value as THREE.Vector2).set(bx, by); (bu.uVel.value as THREE.Vector2).set(bvx, bvy);
    bu.uSize.value += ((hv >= 0 ? 0 : 1) - bu.uSize.value) * (1 - Math.exp(-dt * 8));
    bu.uVis.value += ((inside && mouse && !down && !reduceMotion ? 1 : 0) - bu.uVis.value) * (1 - Math.exp(-dt * 6));
    bu.uTime.value = t;

    bloom.strength = BLOOM[quality] + kick;
    composer.render(dt);
  };
  raf = requestAnimationFrame(frame); tReady = window.setTimeout(o.onReady, reduceMotion ? 0 : 900);

  return {
    step: (d) => { clearTimeout(snap); target = clamp(Math.round(target) + d, 0, L - 1); },
    goTo: (i) => { const r = Math.round(target); let df = (((i - r) % n) + n) % n; if (df > n / 2) df -= n; target = clamp(r + df, 0, L - 1); },
    open: () => o.onOpen(clamp(Math.round(cur), 0, L - 1) % n),
    setQuality: applyQuality,
    dispose: () => {
      loader.cancelled = true; cancelAnimationFrame(raf); clearTimeout(snap); clearTimeout(tReady); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerenter", onEnter); canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse((ob) => { const m = ob as THREE.Mesh; m.geometry?.dispose(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose()); });
      texP.forEach((t) => t.dispose()); infoP.forEach((t) => t.dispose()); [glowTex, shaftTex, dotTex].forEach((t) => t.dispose());
      bloom.dispose(); composer.dispose();
      // no forceContextLoss(): React StrictMode remounts on the same <canvas> in dev and would get a dead context
      renderer.dispose();
    },
  };
}