import * as THREE from "three";
import type { Project } from "@/lib/projects";

export type SceneApi = { step(d: number): void; open(): void; goTo(i: number): void; dispose(): void };
type Opts = {
  canvas: HTMLCanvasElement; host: HTMLElement; projects: Project[]; reduceMotion: boolean;
  onActive(i: number, accent: string): void; onOpen(i: number): void; onReady(): void;
};

// Geometry of the ring: cards sit on an arc of radius R, active card D units in front of the camera target.
const CW = 2.1, CH = 3.05, R = 11, D = 12, STEP = 0.225, FLOOR = -1.95, SPAN = 5.2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const HUES = [268, 24, 212, 160, 332, 44];
const hashAccent = (slug: string) => new THREE.Color().setHSL(HUES[hash(slug) % HUES.length] / 360, 0.72, 0.58);
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
function sampleAccent(img: HTMLImageElement) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), s = (mx - mn) / 255;
      const wt = s * s + 0.01; r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt; sat += s;
    }
    if (sat / 576 < 0.14) return null; // near-greyscale image: keep the neutral hash-based hue
    const col = new THREE.Color().setRGB(r / w / 255, g / w / 255, b / w / 255, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl); return col.setHSL(hsl.h, Math.max(hsl.s, 0.62), 0.58);
  } catch { return null; }
}

const reflVert = `varying vec2 vUv; varying float vH;
void main(){ vUv = uv; vH = position.y / ${CH.toFixed(2)} + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// glossy floor: fades with height and blurs more the further from the contact edge
const reflFrag = `uniform sampler2D map; uniform float uDim; varying vec2 vUv; varying float vH;
void main(){
  float b = vH * 0.035; vec3 c = texture2D(map, vUv).rgb * 0.4;
  c += texture2D(map, vUv + vec2(0.0, b)).rgb * 0.2 + texture2D(map, vUv - vec2(0.0, b)).rgb * 0.2;
  c += texture2D(map, vUv + vec2(b, 0.0)).rgb * 0.1 + texture2D(map, vUv - vec2(b, 0.0)).rgb * 0.1;
  gl_FragColor = vec4(c * uDim, pow(1.0 - vH, 1.8) * 0.5);
  #include <colorspace_fragment>
}`;
const floorVert = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const floorFrag = `varying vec3 vW; uniform vec3 uAccent; uniform float uR; uniform vec2 uC;
void main(){
  vec2 d = vW.xz - uC; float e = abs(length(d) - uR); float th = atan(d.x, -d.y);
  float m = smoothstep(1.4, 0.8, abs(th));
  float a = (exp(-e*e*1400.0) * 1.0 + exp(-e*e*0.5) * 0.3) * m;
  gl_FragColor = vec4(uAccent, a);
  #include <colorspace_fragment>
}`;

type Card = {
  i: number; pivot: THREE.Group; rpivot: THREE.Group; img: THREE.Mesh; geo: THREE.BufferGeometry;
  mat: THREE.MeshBasicMaterial; rmat: THREE.ShaderMaterial; fmat: THREE.MeshBasicMaterial;
  gmat: THREE.MeshBasicMaterial; lmat: THREE.MeshBasicMaterial; tex: THREE.Texture; accent: THREE.Color;
};

export function createWorkScene(o: Opts): SceneApi {
  const { canvas, host, projects, reduceMotion } = o, n = projects.length;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x030206, 1);
  const maxDpr = host.clientWidth < 700 ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030206, 0.018);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  const accentCur = hashAccent(projects[0].slug), accentGoal = accentCur.clone();

  // --- cards
  const stripes = canvasTex(8, 8, (x) => { x.fillStyle = "rgba(255,255,255,0.28)"; x.fillRect(0, 0, 2, 8); });
  stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping; stripes.repeat.set(70, 1);
  const glowTex = canvasTex(256, 384, (x) => {
    x.shadowColor = "#fff"; x.shadowBlur = 46; x.fillStyle = "#fff";
    x.beginPath(); x.roundRect(64, 64, 128, 256, 18); x.fill();
  });
  const frameGeo = roundedGeo(CW + 0.13, CH + 0.13, 0.17), glowGeo = new THREE.PlaneGeometry(CW + 1.5, CH + 1.5);
  const mirror = new THREE.Group(); mirror.scale.y = -1; mirror.position.y = 2 * FLOOR; scene.add(mirror);
  const cards: Card[] = [], hit: THREE.Mesh[] = [];
  const loader = { cancelled: false };

  projects.forEach((p, i) => {
    const accent = hashAccent(p.slug), geo = roundedGeo(CW, CH, 0.12); setCover(geo, 512, 768);
    let tex: THREE.Texture = fallbackTex(p, accent);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const img = new THREE.Mesh(geo, mat); img.userData.i = i; hit.push(img);
    const fmat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
    const frame = new THREE.Mesh(frameGeo, fmat); frame.position.z = -0.012;
    const gmat = new THREE.MeshBasicMaterial({ map: glowTex, color: accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(glowGeo, gmat); glow.position.z = -0.06;
    const lmat = new THREE.MeshBasicMaterial({ map: stripes, transparent: true, depthWrite: false, toneMapped: false });
    const lines = new THREE.Mesh(geo, lmat); lines.position.z = 0.004;
    const pivot = new THREE.Group(); pivot.add(glow, frame, img, lines); scene.add(pivot);
    const rmat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, uDim: { value: 0.5 } }, vertexShader: reflVert, fragmentShader: reflFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const rpivot = new THREE.Group(); rpivot.add(new THREE.Mesh(geo, rmat), new THREE.Mesh(frameGeo, fmat.clone()));
    // frame reflection: simple dim copy
    (rpivot.children[1] as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    rpivot.children[1].position.z = -0.012; mirror.add(rpivot);
    const card: Card = { i, pivot, rpivot, img, geo, mat, rmat, fmat, gmat, lmat, tex, accent };
    cards.push(card);

    if (p.image_url) {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => {
        if (loader.cancelled) return;
        const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.needsUpdate = true;
        setCover(geo, im.naturalWidth, im.naturalHeight);
        card.tex.dispose(); card.tex = tex = t; mat.map = t; mat.needsUpdate = true; rmat.uniforms.map.value = t;
        const a = sampleAccent(im); if (a) { card.accent.copy(a); if (Math.round(cur) === i) accentGoal.copy(a); }
      };
      im.src = p.image_url;
    }
  });

  // --- floor track, light shaft, dust
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    uniforms: { uAccent: { value: accentCur }, uR: { value: R }, uC: { value: new THREE.Vector2(0, -D + R) } },
    vertexShader: floorVert, fragmentShader: floorFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; floor.renderOrder = 5; scene.add(floor);

  const shaftTex = canvasTex(64, 256, (x) => {
    const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, "rgba(255,255,255,0)"); h.addColorStop(0.5, "rgba(255,255,255,1)"); h.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = h; x.fillRect(0, 0, 64, 256); x.globalCompositeOperation = "destination-in";
    const v = x.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, "rgba(255,255,255,1)"); v.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = v; x.fillRect(0, 0, 64, 256);
  });
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: accentCur, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 11), shaftMat); shaft.position.set(0, 3.2, -D - 1); scene.add(shaft);

  const dustN = 280, dp = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dp[i * 3] = (Math.random() - 0.5) * 30; dp[i * 3 + 1] = Math.random() * 9 - 3; dp[i * 3 + 2] = -Math.random() * 26 + 4; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  const dotTex = canvasTex(32, 32, (x) => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); });
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);

  // --- state & input
  let target = 0, cur = reduceMotion ? 0 : -3, vel = 0, shown = -1, px = 0, py = 0, spx = 0, spy = 0, raf = 0, snap = 0, tReady = 0;
  const setTarget = (v: number) => { target = clamp(v, -0.4, n - 0.6); };
  const snapTarget = () => { target = clamp(Math.round(target), 0, n - 1); };
  let down = false, moved = 0, lastX = 0, dragVel = 0;
  const pxPerCard = () => Math.max(120, host.clientWidth / 5.2);

  const onDown = (e: PointerEvent) => { down = true; moved = 0; lastX = e.clientX; dragVel = 0; canvas.setPointerCapture(e.pointerId); clearTimeout(snap); };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 2 - 1; py = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (!down) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx);
    setTarget(target - dx / pxPerCard()); dragVel = dx;
  };
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  const onUp = (e: PointerEvent) => {
    if (!down) return; down = false;
    if (moved < 6) {
      const r = canvas.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(v2, camera); const h = ray.intersectObjects(hit, false)[0];
      if (h) { const i = h.object.userData.i as number; if (i === Math.round(cur) && Math.abs(cur - i) < 0.3) o.onOpen(i); else target = i; return; }
    }
    target = clamp(Math.round(target - dragVel / pxPerCard() * 3), 0, n - 1);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); setTarget(target + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.0024);
    clearTimeout(snap); snap = window.setTimeout(snapTarget, 130);
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false);
    camera.aspect = w / h; const dist = D + 3.6;
    camera.fov = Math.max(32, 2 * Math.atan(7.4 / camera.aspect / 2 / dist) * 180 / Math.PI); camera.updateProjectionMatrix();
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
    const idx = clamp(Math.round(cur), 0, n - 1);
    if (idx !== shown) { shown = idx; accentGoal.copy(cards[idx].accent); o.onActive(idx, "#" + accentGoal.getHexString()); }
    accentCur.lerp(accentGoal, 1 - Math.exp(-dt * 3.2));

    for (const cd of cards) {
      const rel = cd.i - cur, vis = Math.abs(rel) < SPAN;
      cd.pivot.visible = cd.rpivot.visible = vis; if (!vis) continue;
      const th = rel * STEP, act = Math.exp(-rel * rel * 3.4), s = 1 + 0.1 * act;
      const x = R * Math.sin(th), z = -D + R * (1 - Math.cos(th)) + act * 0.45, y = act * 0.05;
      for (const g of [cd.pivot, cd.rpivot]) { g.position.set(x, y, z); g.rotation.y = -th; g.scale.set(s, s, 1); }
      const edge = clamp(1 - (Math.abs(rel) - 3.6) / 1.6, 0, 1) * intro;
      const dim = (0.36 + 0.64 * act) * edge;
      cd.mat.color.setScalar(dim); cd.rmat.uniforms.uDim.value = dim * 0.9;
      cd.fmat.color.copy(accentCur).multiplyScalar((0.22 + 0.78 * act) * edge);
      cd.gmat.color.copy(accentCur); cd.gmat.opacity = (0.08 + 0.55 * act) * edge;
      cd.lmat.opacity = (1 - act) * 0.55 * edge;
    }
    (floor.material as THREE.ShaderMaterial).uniforms.uAccent.value = col.copy(accentCur).multiplyScalar(0.6 + 0.4 * intro);
    shaftMat.color.copy(accentCur); shaftMat.opacity = 0.1 * intro;
    dust.position.y = Math.sin(t * 0.12) * 0.15; dust.rotation.y = t * 0.006;

    spx += (px - spx) * (1 - Math.exp(-dt * 2.2)); spy += (py - spy) * (1 - Math.exp(-dt * 2.2));
    const drift = reduceMotion ? 0 : 1;
    camera.position.set(spx * 0.4 + Math.sin(t * 0.17) * 0.08 * drift, 1.0 - spy * 0.12 + Math.sin(t * 0.23) * 0.04 * drift, 3.6 + (1 - intro) * 2.8);
    camera.lookAt(spx * 0.12, -0.25, -D); renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame); tReady = window.setTimeout(o.onReady, reduceMotion ? 0 : 900);

  return {
    step: (d) => { clearTimeout(snap); target = clamp(Math.round(target) + d, 0, n - 1); },
    goTo: (i) => { target = clamp(i, 0, n - 1); },
    open: () => o.onOpen(clamp(Math.round(cur), 0, n - 1)),
    dispose: () => {
      loader.cancelled = true; cancelAnimationFrame(raf); clearTimeout(snap); clearTimeout(tReady); ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp); canvas.removeEventListener("wheel", onWheel);
      scene.traverse((ob) => { const m = ob as THREE.Mesh; m.geometry?.dispose(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose()); });
      cards.forEach((c) => c.tex.dispose()); [stripes, glowTex, shaftTex, dotTex].forEach((t) => t.dispose());
      renderer.dispose(); renderer.forceContextLoss();
    },
  };
}