'use client';

/**
 * Canlı robot portresi — gerçek fotoğraf (public/robot-avatar-2.jpeg) WebGL
 * plane'e texture; fragment shader ile:
 *   • Ağız/çene konuşurken açılır (uTalk), gözler kırpar (uBlink), idle nefes
 *   • Yan/üst animasyonlu neon ışık huzmeleri (foto statik durmasın — madde 5)
 * Resme BASILI TUTUNCA push-to-talk (madde 3): /ptt/start → bırakınca /ptt/stop.
 * Voice durumu bus event'lerinden (TTS/RESPONSE) → ağız hareketi.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

const VOICE = 'http://localhost:8766';
const PHOTO = '/robot-avatar-2.jpeg';
const PHOTO_W = 600;
const PHOTO_H = 778;

// Yüz bölgesi UV (crop'lanmış pencere uzayı, 0,0 sol-alt). Foto 3/4 dönük,
// yüz hafif solda; mor dudak ~y0.42, mavi göz ~y0.62.
const MOUTH_UV = new THREE.Vector2(0.40, 0.45);
const EYE_UV = new THREE.Vector2(0.42, 0.63);
// Hafif crop: üst gövde + yüz; portre oranı korunur.
const CROP_REPEAT = new THREE.Vector2(0.92, 0.82);
const CROP_OFFSET = new THREE.Vector2(0.04, 0.16);
const CROP_ASPECT = (CROP_REPEAT.x * PHOTO_W) / (CROP_REPEAT.y * PHOTO_H);

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D uTex;
  uniform float uTime, uTalk, uBlink, uAspect, uListen;
  uniform vec2 uMouth, uEye, uRepeat, uOffset;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    uv.x += sin(uTime * 0.6) * 0.0016;
    uv.y += sin(uTime * 0.8) * 0.0012;
    uv.y += uTalk * sin(uTime * 5.0) * 0.004;

    vec2 asp = vec2(uAspect, 1.0);

    // Ağız / çene
    float md = length((uv - uMouth) * asp);
    float mouthMask = smoothstep(0.13, 0.0, md);
    float below = smoothstep(uMouth.y + 0.03, uMouth.y - 0.09, uv.y);
    uv.y += mouthMask * below * uTalk * 0.11;
    uv.x += (uv.x - uMouth.x) * mouthMask * uTalk * 0.05;

    // Göz kırpma
    float ed = length((uv - uEye) * asp);
    float eyeMask = smoothstep(0.10, 0.0, ed);
    uv.y += eyeMask * uBlink * (uEye.y - uv.y) * 1.4;

    vec2 texUv = clamp(uv, 0.0, 1.0) * uRepeat + uOffset;
    vec3 col = texture2D(uTex, texUv).rgb;

    // --- YAN/ÜST ANİMASYONLU NEON IŞIK (foto canlansın) ---
    float lx = vUv.x, ly = vUv.y;
    // Sol kenar cyan huzme
    float leftBeam = smoothstep(0.18, 0.0, lx) * (0.45 + 0.55 * sin(uTime * 1.6 + ly * 9.0));
    col += vec3(0.10, 0.45, 0.95) * leftBeam * 0.32;
    // Sağ kenar mor huzme
    float rightBeam = smoothstep(0.82, 1.0, lx) * (0.45 + 0.55 * sin(uTime * 1.3 - ly * 8.0));
    col += vec3(0.55, 0.18, 0.95) * rightBeam * 0.30;
    // Üst hafif beyaz tarama
    float topBeam = smoothstep(0.85, 1.0, ly) * (0.4 + 0.6 * sin(uTime * 0.9 + lx * 6.0));
    col += vec3(0.4, 0.6, 0.9) * topBeam * 0.12;

    // Konuşurken yüze sıcak vurgu
    col += vec3(0.3, 0.5, 0.7) * mouthMask * uTalk * 0.12;
    // Dinlerken (PTT) yeşil-cyan nabız çerçevesi
    float edge = smoothstep(0.10, 0.0, min(min(lx, 1.0 - lx), min(ly, 1.0 - ly)));
    col += vec3(0.0, 0.9, 0.6) * edge * uListen * (0.5 + 0.5 * sin(uTime * 6.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function TalkingRobot({ size = 520 }: { size?: number }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const talkTargetRef = useRef(0);
  const listenRef = useRef(0);
  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.TTS_PLAYBACK_START, EVENT_TYPES.TTS_PLAYBACK_END,
    EVENT_TYPES.RESPONSE_CHUNK, EVENT_TYPES.RESPONSE_END, EVENT_TYPES.RESPONSE_START,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    const ev = lastEvent.event;
    if (ev === EVENT_TYPES.TTS_PLAYBACK_START || ev === EVENT_TYPES.RESPONSE_START || ev === EVENT_TYPES.RESPONSE_CHUNK) {
      talkTargetRef.current = 1;
    } else if (ev === EVENT_TYPES.TTS_PLAYBACK_END || ev === EVENT_TYPES.RESPONSE_END) {
      talkTargetRef.current = 0;
    }
  }, [lastEvent]);

  // --- Push-to-talk: resme basılı tut → dinle ---
  const pttDown = useCallback(async (e: React.PointerEvent) => {
    e.preventDefault();
    listenRef.current = 1;
    try { await fetch(`${VOICE}/ptt/start`, { method: 'POST' }); } catch { /* noop */ }
  }, []);
  const pttUp = useCallback(async () => {
    listenRef.current = 0;
    try { await fetch(`${VOICE}/ptt/stop`, { method: 'POST' }); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = size;
    const H = Math.round(size / CROP_ASPECT);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    const uniforms = {
      uTex: { value: null as THREE.Texture | null },
      uTime: { value: 0 }, uTalk: { value: 0 }, uBlink: { value: 0 }, uListen: { value: 0 },
      uMouth: { value: MOUTH_UV }, uEye: { value: EYE_UV },
      uAspect: { value: CROP_ASPECT }, uRepeat: { value: CROP_REPEAT }, uOffset: { value: CROP_OFFSET },
    };
    const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let disposed = false;
    new THREE.TextureLoader().load(PHOTO, (tex) => {
      if (disposed) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
      uniforms.uTex.value = tex;
    });

    let nextBlink = 2 + Math.random() * 3;
    let blinkPhase = -1;
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      if (disposed) return;
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();
      uniforms.uTime.value = t;

      const target = talkTargetRef.current;
      const base = uniforms.uTalk.value;
      const eased = base + (target - base) * Math.min(1, dt * 6);
      const flutter = target > 0.5 ? (0.55 + 0.45 * Math.sin(t * 18.0) * Math.sin(t * 7.3 + 1.0)) : 0;
      uniforms.uTalk.value = eased * (0.35 + 0.65 * Math.abs(flutter));
      uniforms.uListen.value += (listenRef.current - uniforms.uListen.value) * Math.min(1, dt * 8);

      if (blinkPhase < 0) { nextBlink -= dt; if (nextBlink <= 0) blinkPhase = 0; }
      else {
        blinkPhase += dt * 7.0;
        uniforms.uBlink.value = blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2;
        if (blinkPhase >= 1) { blinkPhase = -1; uniforms.uBlink.value = 0; nextBlink = 2.5 + Math.random() * 3.5; }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { clock.getDelta(); tick(); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      mesh.geometry.dispose(); material.dispose(); uniforms.uTex.value?.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [size]);

  return (
    <div
      ref={mountRef}
      onPointerDown={pttDown}
      onPointerUp={pttUp}
      onPointerLeave={pttUp}
      title="Konuşmak için basılı tut"
      style={{
        width: size,
        height: Math.round(size / CROP_ASPECT),
        borderRadius: 16,
        overflow: 'hidden',
        cursor: 'pointer',
        pointerEvents: 'auto',
        boxShadow: '0 0 60px rgba(80, 160, 255, 0.3), inset 0 0 0 1px rgba(120, 200, 255, 0.25)',
      }}
    />
  );
}
