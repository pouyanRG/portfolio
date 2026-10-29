"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";
import type { Project } from "@/lib/projects";

const PALETTE = ["#7c3aff", "#3b82ff", "#d946ef"];
const HOVER_COLOR = "#e11dd4";
const CARD_W = 1.6, CARD_H = 2.0, GAP = 0.14, FLOOR_Y = -1.18, PLANE = 1.3;

const vert = /* glsl */ `
uniform float uHover;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float s = sin(uv.y * 6.2831) * uHover;      // خم S-شکل
  p.x += s * 0.10;
  p.z += (uv.y - 0.5) * uHover * 0.35 + s * 0.05;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColor;
uniform vec2 uPlane, uCard;
uniform float uSide, uHover, uReflect, uImgAspect;
varying vec2 vUv;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (vUv - 0.5) * uPlane;
  float bw = 0.09 * uCard.x;
  float d = sdRound(p, uCard * 0.5, bw);
  float inside = 1.0 - smoothstep(-0.004, 0.004, d);
  float inner  = 1.0 - smoothstep(-bw - 0.01, -bw + 0.01, d);

  vec2 innerSize = uCard - 2.0 * bw;
  vec2 iuv = p / innerSize + 0.5;
  float edge = smoothstep(-bw - 0.35, -bw, d);
  iuv -= normalize(p + 1e-5) * edge * 0.05;           // شکست نور نزدیک لبه

  float ca = innerSize.x / innerSize.y;               // cover-fit
  vec2 c = iuv - 0.5;
  if (uImgAspect > ca) c.x *= ca / uImgAspect; else c.y *= uImgAspect / ca;
  c += 0.5;

  float ab = uHover * 0.012;                          // chromatic aberration
  vec3 img = vec3(texture2D(uTex, c + vec2(ab, 0.0)).r,
                  texture2D(uTex, c).g,
                  texture2D(uTex, c - vec2(ab, 0.0)).b);
  img *= 1.0 - edge * 0.65;
  img *= 1.0 - uSide * 0.55;
  img *= 1.0 - uSide * 0.35 * (0.5 + 0.5 * sin(vUv.x * uPlane.x * 140.0)); // شیار lenticular

  vec3 bc = uColor * (0.75 + 0.35 * vUv.y);
  bc = mix(bc, uColor * 1.4, uHover * 0.3) * (1.0 - uSide * 0.35);

  vec3 col = mix(bc, img, inner);
  float glow = exp(-max(d, 0.0) * 14.0) * 0.55 * (1.0 - inside);
  vec3 outc = mix(uColor * 1.2, col, inside);
  float a = max(inside, glow);
  if (uReflect > 0.5) a *= pow(1.0 - vUv.y, 2.0) * 0.35;

  gl_FragColor = vec4(outc, a);
  #include <colorspace_fragment>
}`;

type Props = {
  projects: Project[];
  onActive: (i: number) => void;
  onSelect: (slug: string) => void;
};

type Card = {
  holder: THREE.Object3D;
  mats: THREE.ShaderMaterial[];
  angle: number;
  hover: { v: number };
  projectIndex: number;
};

export default function WorkScene({ projects, onActive, onSelect }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const cb = useRef({ onActive, onSelect });
  useEffect(() => { cb.current = { onActive, onSelect }; });

  useEffect(() => {
    const el = mount.current;
    if (!el || projects.length === 0) return;

    const N = Math.max(12, projects.length);
    const step = (Math.PI * 2) / N;
    const R = (N * (CARD_W + GAP)) / (Math.PI * 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x030108);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / el.clientHeight, 0.1, 100);
    const camBase = new THREE.Vector3(0, 1.5, R + 7.5);
    camera.position.copy(camBase);

    const color = { value: new THREE.Color(PALETTE[0]) }; // uniform مشترک بین همه
    const disposables: { dispose: () => void }[] = [];
    const loader = new THREE.TextureLoader().setCrossOrigin("anonymous");

    const fallbackTex = (i: number) => {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 320;
      const g = cv.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 256, 320);
      grad.addColorStop(0, `hsl(${(i * 47) % 360} 40% 14%)`);
      grad.addColorStop(1, `hsl(${(i * 47 + 60) % 360} 50% 28%)`);
      g.fillStyle = grad; g.fillRect(0, 0, 256, 320);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    const geo = new THREE.PlaneGeometry(CARD_W * PLANE, CARD_H * PLANE);
    disposables.push(geo);

    const ring = new THREE.Group();
    scene.add(ring);

    const cards: Card[] = [];
    const hitMeshes: THREE.Mesh[] = [];

    for (let i = 0; i < N; i++) {
      const pi = i % projects.length;
      const tex = fallbackTex(i);
      disposables.push(tex);

      const makeMat = (reflect: boolean) =>
        new THREE.ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            uTex: { value: tex },
            uColor: color,
            uPlane: { value: new THREE.Vector2(CARD_W * PLANE, CARD_H * PLANE) },
            uCard: { value: new THREE.Vector2(CARD_W, CARD_H) },
            uSide: { value: 0 },
            uHover: { value: 0 },
            uReflect: { value: reflect ? 1 : 0 },
            uImgAspect: { value: 0.8 },
          },
        });

      const m1 = makeMat(false), m2 = makeMat(true);
      disposables.push(m1, m2);

      const url = projects[pi].image_url;
      if (url) {
        loader.load(url, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          const aspect = t.image.width / t.image.height;
          for (const m of [m1, m2]) {
            m.uniforms.uTex.value = t;
            m.uniforms.uImgAspect.value = aspect;
          }
          disposables.push(t);
        });
      }

      const angle = i * step;
      const holder = new THREE.Object3D();
      holder.position.set(Math.sin(angle) * R, 0, Math.cos(angle) * R);
      holder.rotation.y = angle;

      const main = new THREE.Mesh(geo, m1);
      main.userData.card = i;
      const mirror = new THREE.Mesh(geo, m2);
      mirror.scale.y = -1;
      mirror.position.y = 2 * FLOOR_Y;

      holder.add(main, mirror);
      ring.add(holder);
      hitMeshes.push(main);
      cards.push({ holder, mats: [m1, m2], angle, hover: { v: 0 }, projectIndex: pi });
    }

    // حلقه‌ی نورانی کف
    const glowMat = (opacity: number) => {
      const m = new THREE.MeshBasicMaterial({
        color: color.value, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      m.color = color.value;
      disposables.push(m);
      return m;
    };
    const lineGeo = new THREE.RingGeometry(R + 0.02, R + 0.1, 160);
    const haloGeo = new THREE.RingGeometry(R - 0.2, R + 0.9, 160);
    disposables.push(lineGeo, haloGeo);
    for (const [g, o] of [[lineGeo, 0.9], [haloGeo, 0.1]] as const) {
      const mesh = new THREE.Mesh(g, glowMat(o));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = FLOOR_Y;
      scene.add(mesh);
    }

    // ---- state ----
    let current = 0, target = 0, active = -1, hovered = -1;
    let dragging = false, lastX = 0, moved = 0, vel = 0, snapTimer = 0;
    const pointer = new THREE.Vector2(0, 0);
    const ray = new THREE.Raycaster();

    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const snap = () => { target = Math.round(target / step) * step; };

    const setTheme = () => {
      const hex = hovered >= 0 ? HOVER_COLOR : PALETTE[Math.max(active, 0) % PALETTE.length];
      const c = new THREE.Color(hex);
      gsap.to(color.value, { r: c.r, g: c.g, b: c.b, duration: 1.4, ease: "power2.out", overwrite: true });
    };

    const pick = () => {
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(hitMeshes, false)[0];
      return hit ? (hit.object.userData.card as number) : -1;
    };

    const onDown = (e: PointerEvent) => {
      dragging = true; lastX = e.clientX; moved = 0; vel = 0;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX; moved += Math.abs(dx);
      target += dx * 0.004;
      vel = vel * 0.8 + dx * 0.004 * 0.2;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (moved < 5) {
        const idx = pick();
        if (idx >= 0) {
          const activeCard = ((Math.round(-target / step) % N) + N) % N;
          if (idx === activeCard) cb.current.onSelect(projects[cards[idx].projectIndex].slug);
          else target += wrap(-cards[idx].angle - target);
        }
      } else {
        target += vel * 14;
      }
      snap();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      target += (e.deltaY + e.deltaX) * 0.0015;
      clearTimeout(snapTimer);
      snapTimer = window.setTimeout(snap, 140);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.fov = camera.aspect < 1 ? 55 : 32;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      current += (target - current) * (1 - Math.exp(-dt * 6));
      ring.rotation.y = current;

      const idx = ((Math.round(-target / step) % N) + N) % N;
      if (idx !== active) {
        active = idx;
        cb.current.onActive(cards[idx].projectIndex);
        setTheme();
      }

      if (!dragging) {
        const h = pick();
        if (h !== hovered) {
          if (hovered >= 0) gsap.to(cards[hovered].hover, { v: 0, duration: 0.6 });
          if (h >= 0) gsap.to(cards[h].hover, { v: 1, duration: 0.6 });
          const wasHover = hovered >= 0;
          hovered = h;
          if (wasHover !== (h >= 0)) setTheme();
        }
      }

      for (const c of cards) {
        const ang = wrap(c.angle + ring.rotation.y);
        const side = Math.min(Math.abs(ang) / (step * 3.5), 1);
        for (const m of c.mats) {
          m.uniforms.uSide.value = side;
          m.uniforms.uHover.value = c.hover.v;
        }
      }

      camera.position.x += (camBase.x + pointer.x * 0.4 - camera.position.x) * 0.03;
      camera.position.y += (camBase.y - pointer.y * 0.15 - camera.position.y) * 0.03;
      camera.lookAt(0, -0.2, R);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snapTimer);
      ro.disconnect();
      gsap.killTweensOf(color.value);
      cards.forEach((c) => gsap.killTweensOf(c.hover));
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [projects]);

  return <div ref={mount} className="absolute inset-0 touch-pan-y" />;
}