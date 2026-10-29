import * as THREE from "three";
import type { Project } from "@/lib/projects";

export type SceneApi = { step(d: number): void; open(): void; goTo(i: number): void; dispose(): void };
type Opts = {
  canvas: HTMLCanvasElement; host: HTMLElement; projects: Project[]; reduceMotion: boolean;
  onActive(i: number, accent: string): void; onOpen(i: number): void; onReady(): void;
};

/*
 * Ring geometry (viewed from OUTSIDE the cylinder, like the reference):
 * the ring centre sits BEHIND the cards at z = -D - R, the active card is D units in front of the target,
 * side cards curve away from the camera.
 * CH = 2.9 gives the reference's ~3:4 card (frame included).
 */
const CW = 2.1, CH = 2.9, R = 8.5, D = 12, STEP = 0.32, FLOOR = -1.75, SPAN = 5.2, FR = 0.17;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const HUES = [268, 262, 275, 258, 280, 266]; // fallback violet when an image has no usable colour
const hashAccent = (slug: string) => new THREE.Color().setHSL(HUES[hash(slug) % HUES.length] / 360, 0.8, 0.54);
const MAGENTA = new THREE.Color().setHSL(305 / 360, 0.85, 0.55); // hover colour
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

/*
 * The small monospace spec sheet printed on every card in the reference
 * (PROJECT /NN, NAME, TYPE, STACK ...). Only the alpha channel is used by the shader,
 * and it is sampled with the card-local coordinate vP, so it always sits in the same spot.
 * Only real fields from the Project row are printed.
 */
function infoTex(p: Project, pi: number) {
  return canvasTex(512, 707, (x) => {
    x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
    x.font = '500 15px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
    const L = 84, Rr = 512 - 84, W = Rr - L;
    const fit = (s: string, max: number) => { let t = s.toUpperCase(); while (t.length > 1 && x.measureText(t).width > max) t = t.slice(0, -2) + "…"; return t; };
    let y = 285;
    x.textAlign = "left"; x.fillText("PROJECT", L, y);
    x.textAlign = "right"; x.fillText("/" + String(pi + 1).padStart(2, "0"), Rr, y);
    y += 40;
    const rows: [string, string][] = [["NAME:", p.title], ["TYPE:", p.category]];
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
  });
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
    if (sat / 576 < 0.14) return null; // near-greyscale image: keep the neutral violet
    const col = new THREE.Color().setRGB(r / w / 255, g / w / 255, b / w / 255, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl); return col.setHSL(hsl.h, Math.max(hsl.s, 0.62), 0.58);
  } catch { return null; }
}

// ---------- shaders ----------
const CWf = CW.toFixed(3), CHf = CH.toFixed(3);
// Shared vertex stage: S-shaped "cloth" bend driven by uHover (same function on every layer of a card so they stay glued together).
const cardVert = `uniform float uHover; varying vec2 vUv; varying vec2 vP;
void main(){
  vUv = uv; vP = position.xy / vec2(${CWf}, ${CHf}) + 0.5;
  vec3 p = position; float yy = position.y / ${CHf};
  float s = sin(yy * 6.2831) * uHover;
  p.x += s * 0.12; p.z += yy * uHover * 0.35 + s * 0.05;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
// Image: refraction near the edge, dark glassy inner edge, lenticular grooves on every card (stronger on the sides),
// chromatic aberration on hover, and the monospace spec sheet (uInfo) printed on top.
const imgFrag = `uniform sampler2D map; uniform sampler2D info; uniform float uDim, uHover, uSide, uInfo; varying vec2 vUv; varying vec2 vP;
void main(){
  float ed = min(min(vP.x, 1.0 - vP.x) * ${CWf}, min(vP.y, 1.0 - vP.y) * ${CHf});
  float k = 1.0 - smoothstep(0.0, 0.3, ed);
  vec2 uv = vUv - (vP - 0.5) * k * 0.06;
  float ab = uHover * 0.014 * (0.4 + k);
  vec3 c = vec3(texture2D(map, uv + vec2(ab, 0.0)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(ab, 0.0)).b);
  c *= mix(0.28, 1.0, smoothstep(0.0, 0.42, ed));
  float groove = 0.5 + 0.5 * sin(vP.x * 150.0);
  c *= 1.0 - uSide * 0.18 - (0.07 + 0.3 * uSide) * groove;
  float t = texture2D(info, vP).a * uInfo;
  c = mix(c * (1.0 - 0.35 * t), vec3(1.0), t * 0.92);
  gl_FragColor = vec4(c * uDim, 1.0);
  #include <colorspace_fragment>
}`;
const frameFrag = `uniform vec3 uColor; uniform float uHover, uAlpha; varying vec2 vP;
void main(){
  vec3 c = uColor * (0.8 + 0.3 * vP.y); c = mix(c, uColor * 1.45, uHover * 0.35);
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;
const glowFrag = `uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
void main(){
  float a = texture2D(map, vUv).a;
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}`;
// reflection: bends together with the card, fades with height, blurs towards the top
const reflFrag = `uniform sampler2D map; uniform float uDim; varying vec2 vUv; varying vec2 vP;
void main(){
  float vH = vP.y;
  float b = vH * 0.035; vec3 c = texture2D(map, vUv).rgb * 0.4;
  c += texture2D(map, vUv + vec2(0.0, b)).rgb * 0.2 + texture2D(map, vUv - vec2(0.0, b)).rgb * 0.2;
  c += texture2D(map, vUv + vec2(b, 0.0)).rgb * 0.1 + texture2D(map, vUv - vec2(b, 0.0)).rgb * 0.1;
  gl_FragColor = vec4(c * uDim, pow(1.0 - vH, 1.8) * 0.5);
  #include <colorspace_fragment>
}`;
// glowing floor track: thin bright line + soft halo, centred on the ring, fading to the sides
const floorVert = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const floorFrag = `varying vec3 vW; uniform vec3 uAccent; uniform float uR; uniform vec2 uC;
void main(){
  vec2 d = vW.xz - uC; float e = abs(length(d) - uR); float th = atan(d.x, d.y);
  float m = smoothstep(1.7, 1.1, abs(th));
  float a = (exp(-e*e*260.0) * 1.0 + exp(-e*e*2.0) * 0.35) * m;
  gl_FragColor = vec4(uAccent, a);
  #include <colorspace_fragment>
}`;
// liquid cursor: jelly blob that trails the mouse, stretches with speed and wobbles
const blobVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const blobFrag = `uniform vec2 uPos, uVel; uniform float uSize, uVis, uTime, uAspect; uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 d = p - uPos; float sp = length(uVel);
  vec2 dir = sp > 1e-3 ? uVel / sp : vec2(1.0, 0.0);
  float st = 1.0 + min(sp * 0.35, 1.0);
  vec2 q = vec2(dot(d, dir) / st, dot(d, vec2(-dir.y, dir.x)) * sqrt(st));
  float ang = atan(q.y, q.x);
  float r = 0.14 * uSize * (1.0 + 0.07 * sin(ang * 3.0 + uTime * 1.6) + 0.05 * sin(ang * 5.0 - uTime * 1.1));
  float dist = length(q) - r;
  float fill = smoothstep(0.05, -0.07, dist);
  float rim = exp(-abs(dist) * 38.0);
  vec3 c = uColor * 0.75 + vec3(0.35) * rim;
  float a = (fill * 0.2 + rim * 0.26) * uVis * clamp(uSize * 1.3, 0.0, 1.0);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

type Card = {
  i: number; pivot: THREE.Group; rpivot: THREE.Group; img: THREE.Mesh;
  mat: THREE.ShaderMaterial; rmat: THREE.ShaderMaterial; fmat: THREE.ShaderMaterial; rfmat: THREE.ShaderMaterial;
  gmat: THREE.ShaderMaterial; accent: THREE.Color; hov: { value: number };
};

export function createWorkScene(o: Opts): SceneApi {
  const { canvas, host, projects, reduceMotion } = o, n = projects.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x030206, 1);
  renderer.autoClear = false; // we render two passes: the 3D scene, then the liquid cursor on top
  const maxDpr = host.clientWidth < 700 ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030206, 0.016);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  const accentCur = hashAccent(projects[0].slug), accentGoal = accentCur.clone();

  // --- cards
  const glowTex = canvasTex(256, 384, (x) => {
    x.shadowColor = "#fff"; x.shadowBlur = 40; x.fillStyle = "#fff";
    x.beginPath(); x.roundRect(43, 51, 170, 282, 22); x.fill();
  });
  const frameGeo = roundedGeo(CW + FR * 2, CH + FR * 2, 0.3), glowGeo = new THREE.PlaneGeometry(CW + 1.6, CH + 1.6);
  const mirror = new THREE.Group(); mirror.scale.y = -1; mirror.position.y = 2 * FLOOR; scene.add(mirror);
  const cards: Card[] = [], hit: THREE.Mesh[] = [];
  const loader = { cancelled: false };

  // Infinite-looking ring: tile the projects so there are always >= 21 cards (copies share textures/geometry),
  // and re-centre silently when the user settles near an end.
  const L = n >= 21 ? n : n * Math.ceil(21 / n), start = L > n ? n * Math.floor(L / n / 2) : 0;
  const geoP: THREE.BufferGeometry[] = [], texP: THREE.Texture[] = [], accP: THREE.Color[] = [], infoP: THREE.Texture[] = [];

  projects.forEach((p, pi) => {
    const accent = hashAccent(p.slug), geo = roundedGeo(CW, CH, 0.12); setCover(geo, 512, 768);
    geoP.push(geo); texP.push(fallbackTex(p, accent)); accP.push(accent); infoP.push(infoTex(p, pi));
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
    im.src = p.image_url;
  });

  for (let i = 0; i < L; i++) {
    const pi = i % n, accent = accP[pi], geo = geoP[pi], tex = texP[pi];
    const hov = { value: 0 }; // shared by every layer of this card

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, info: { value: infoP[pi] }, uDim: { value: 0.5 }, uHover: hov, uSide: { value: 0 }, uInfo: { value: 0 } },
      vertexShader: cardVert, fragmentShader: imgFrag,
    });
    const img = new THREE.Mesh(geo, mat); img.userData.i = i; hit.push(img);
    const fmat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: accent.clone() }, uHover: hov, uAlpha: { value: 1 } }, vertexShader: cardVert, fragmentShader: frameFrag });
    const frame = new THREE.Mesh(frameGeo, fmat); frame.position.z = -0.012;
    const gmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTex }, uColor: { value: accent.clone() }, uOpacity: { value: 0 }, uHover: hov },
      vertexShader: cardVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeo, gmat); glow.position.z = -0.06;
    const pivot = new THREE.Group(); pivot.add(glow, frame, img); scene.add(pivot);

    const rmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uDim: { value: 0.5 }, uHover: hov }, vertexShader: cardVert, fragmentShader: reflFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const rfmat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: accent.clone() }, uHover: hov, uAlpha: { value: 0.12 } }, vertexShader: cardVert, fragmentShader: frameFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const rframe = new THREE.Mesh(frameGeo, rfmat); rframe.position.z = -0.012;
    const rpivot = new THREE.Group(); rpivot.add(new THREE.Mesh(geo, rmat), rframe); mirror.add(rpivot);

    cards.push({ i, pivot, rpivot, img, mat, rmat, fmat, rfmat, gmat, accent, hov });
  }

  // --- floor track, light beams, dust
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
  const shaftMat = beamMat(0.1), beamMats = [beamMat(0.07), beamMat(0.07)];
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 14), shaftMat); shaft.position.set(0, 3.6, -D - 4); scene.add(shaft);
  // two diagonal beams opening from the top centre towards left / right
  const beamGeo = new THREE.PlaneGeometry(0.5, 17);
  ([1, -1] as const).forEach((sd, k) => {
    const b = new THREE.Mesh(beamGeo, beamMats[k]); b.rotation.z = sd * 1.1; b.position.set(sd * 7.4, 3.4, -D - 4); scene.add(b);
  });

  const dustN = 280, dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (Math.random() - 0.5) * 30; dp[i * 3 + 1] = Math.random() * 9 - 3; dp[i * 3 + 2] = -Math.random() * 26 + 4; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dotTex = canvasTex(32, 32, (x) => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); });
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  // --- liquid cursor (second pass, screen space)
  const hudScene = new THREE.Scene(), hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blobMat = new THREE.ShaderMaterial({
    uniforms: { uPos: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector2() }, uSize: { value: 1 }, uVis: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uColor: { value: accentCur } },
    vertexShader: blobVert, fragmentShader: blobFrag, transparent: true, depthTest: false, depthWrite: false,
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blobMat); blob.frustumCulled = false; hudScene.add(blob);
  let bx = 0, by = 0, bvx = 0, bvy = 0, inside = false, mouse = false, blobInit = false;

  // --- state & input
  let target = start, cur = reduceMotion ? start : start - 3, vel = 0, shown = -1, px = 0, py = 0, spx = 0, spy = 0, raf = 0, snap = 0, tReady = 0;
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
      if (h) { const i = h.object.userData.i as number; if (i === Math.round(cur) && Math.abs(cur - i) < 0.3) o.onOpen(i % n); else target = i; return; }
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

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false);
    camera.aspect = w / h; const dist = D + 3.6;
    const visH = camera.aspect < 1 ? 10 : 9.3;
    camera.fov = 2 * Math.atan(visH / 2 / dist) * 180 / Math.PI; camera.updateProjectionMatrix();
    blobMat.uniforms.uAspect.value = camera.aspect;
  };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  // --- loop
  const t0 = performance.now(); let last = t0; const col = new THREE.Color();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - t0) / 1000;
    const intro = reduceMotion ? 1 : 1 - Math.pow(1 - clamp(t / 2.4, 0, 1), 3);
    // critically damped spring: weight and inertia instead of a linear tween
    const k = 52, c = 2 * Math.sqrt(k) * 0.95; vel += ((target - cur) * k - vel * c) * dt; cur += vel * dt;
    if (L > n && !down && Math.abs(vel) < 0.02 && Math.abs(target - cur) < 0.05) {
      const r0 = Math.round(cur);
      if (r0 < 7 || r0 > L - 8) { const sh = Math.round((start - r0) / n) * n; cur += sh; target += sh; }
    }
    const idx = clamp(Math.round(cur), 0, L - 1);
    if (idx !== shown) { shown = idx; o.onActive(idx % n, "#" + cards[idx].accent.getHexString()); }

    // hover: raycast the visible cards under the mouse
    let hv = -1;
    if (inside && mouse && !down) {
      v2.set(px, -py); ray.setFromCamera(v2, camera);
      const h = ray.intersectObjects(hit, false).find((x) => cards[x.object.userData.i as number].pivot.visible);
      if (h) hv = h.object.userData.i as number;
    }
    canvas.style.cursor = hv >= 0 && !down ? "pointer" : "";
    accentGoal.copy(hv >= 0 ? MAGENTA : cards[idx].accent);
    accentCur.lerp(accentGoal, 1 - Math.exp(-dt * 2.4));

    for (const cd of cards) {
      cd.hov.value += ((cd.i === hv ? 1 : 0) - cd.hov.value) * (1 - Math.exp(-dt * 6));
      const rel = cd.i - cur, vis = Math.abs(rel) < SPAN;
      cd.pivot.visible = cd.rpivot.visible = vis; if (!vis) continue;
      const th = rel * STEP, act = Math.exp(-rel * rel * 3.4), s = 1 + 0.06 * act;
      const x = R * Math.sin(th), z = -D - R * (1 - Math.cos(th)) + act * 0.45, y = act * 0.05;
      for (const g of [cd.pivot, cd.rpivot]) { g.position.set(x, y, z); g.rotation.y = th; g.scale.set(s, s, 1); }
      const edge = clamp(1 - (Math.abs(rel) - 3.6) / 1.6, 0, 1) * intro;
      const dim = (0.36 + 0.64 * act) * edge;
      cd.mat.uniforms.uDim.value = dim; cd.mat.uniforms.uSide.value = (1 - act) * edge;
      // spec-sheet text: full on the active card, a faint ghost on neighbours, brightens on hover
      cd.mat.uniforms.uInfo.value = (0.28 + 0.72 * act + 0.3 * cd.hov.value) * edge;
      cd.rmat.uniforms.uDim.value = dim * 0.9;
      const fc = (0.3 + 0.7 * act) * edge;
      (cd.fmat.uniforms.uColor.value as THREE.Color).copy(accentCur).multiplyScalar(fc);
      (cd.rfmat.uniforms.uColor.value as THREE.Color).copy(accentCur); cd.rfmat.uniforms.uAlpha.value = 0.12 * edge;
      (cd.gmat.uniforms.uColor.value as THREE.Color).copy(accentCur); cd.gmat.uniforms.uOpacity.value = (0.08 + 0.45 * act) * edge;
    }
    (floor.material as THREE.ShaderMaterial).uniforms.uAccent.value = col.copy(accentCur).multiplyScalar(0.6 + 0.4 * intro);
    shaftMat.color.copy(accentCur); shaftMat.opacity = 0.1 * intro;
    beamMats.forEach((m) => { m.color.copy(accentCur); m.opacity = 0.07 * intro; });
    dust.position.y = Math.sin(t * 0.12) * 0.15; dust.rotation.y = t * 0.006;

    spx += (px - spx) * (1 - Math.exp(-dt * 2.2)); spy += (py - spy) * (1 - Math.exp(-dt * 2.2));
    const drift = reduceMotion ? 0 : 1;
    camera.position.set(spx * 0.4 + Math.sin(t * 0.17) * 0.08 * drift, 2.4 - spy * 0.15 + Math.sin(t * 0.23) * 0.04 * drift, 3.6 + (1 - intro) * 2.8);
    camera.lookAt(spx * 0.12, -0.7, -D);

    // liquid cursor: lerped follow (frame-rate independent), speed-based stretch, shrinks over a card
    const asp = camera.aspect, tx = px * asp * 0.5, ty = -py * 0.5;
    if (!blobInit && inside && mouse) { bx = tx; by = ty; blobInit = true; }
    const kb = 1 - Math.exp(-dt * 7), nx = bx + (tx - bx) * kb, ny = by + (ty - by) * kb, kv = 1 - Math.exp(-dt * 10);
    bvx += ((nx - bx) / Math.max(dt, 1e-3) - bvx) * kv; bvy += ((ny - by) / Math.max(dt, 1e-3) - bvy) * kv; bx = nx; by = ny;
    const bu = blobMat.uniforms;
    (bu.uPos.value as THREE.Vector2).set(bx, by); (bu.uVel.value as THREE.Vector2).set(bvx, bvy);
    bu.uSize.value += ((hv >= 0 ? 0.25 : 1) - bu.uSize.value) * (1 - Math.exp(-dt * 8));
    bu.uVis.value += ((inside && mouse && !down && !reduceMotion ? 1 : 0) - bu.uVis.value) * (1 - Math.exp(-dt * 6));
    bu.uTime.value = t;

    renderer.clear(); renderer.render(scene, camera); renderer.render(hudScene, hudCam);
  };
  raf = requestAnimationFrame(frame); tReady = window.setTimeout(o.onReady, reduceMotion ? 0 : 900);

  return {
    step: (d) => { clearTimeout(snap); target = clamp(Math.round(target) + d, 0, L - 1); },
    goTo: (i) => { const r = Math.round(target); let df = (((i - r) % n) + n) % n; if (df > n / 2) df -= n; target = clamp(r + df, 0, L - 1); },
    open: () => o.onOpen(clamp(Math.round(cur), 0, L - 1) % n),
    dispose: () => {
      loader.cancelled = true; cancelAnimationFrame(raf); clearTimeout(snap); clearTimeout(tReady); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerenter", onEnter); canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      [scene, hudScene].forEach((sc) => sc.traverse((ob) => { const m = ob as THREE.Mesh; m.geometry?.dispose(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose()); }));
      texP.forEach((t) => t.dispose()); infoP.forEach((t) => t.dispose()); [glowTex, shaftTex, dotTex].forEach((t) => t.dispose());
      // no forceContextLoss(): React StrictMode remounts on the same <canvas> in dev and would get a dead context
      renderer.dispose();
    },
  };
}