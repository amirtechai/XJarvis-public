'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { EVENT_TYPES } from '@/lib/events';

type Mode = 'IDLE' | 'LISTENING' | 'SPEAKING';

interface Props { size?: number }

/**
 * 3D embodied JARVIS orb — Three.js sphere with vertex-shader displacement
 * driven by simplex noise + a "voice intensity" uniform. While SPEAKING the
 * surface boils harder; while LISTENING it ripples; IDLE it breathes.
 *
 * Drop-in replacement for the 2D orb when localStorage["xjarvis:orb3d"] === '1'.
 */
export function Jarvis3DOrb({ size = 260 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<Mode>('IDLE');
  const intensityRef = useRef(0);

  const { lastEvent } = useJarvisEvents([
    EVENT_TYPES.LISTENING_START,
    EVENT_TYPES.LISTENING_STOP,
    EVENT_TYPES.RESPONSE_START,
    EVENT_TYPES.RESPONSE_END,
    EVENT_TYPES.WAKE_WORD_DETECTED,
  ]);

  useEffect(() => {
    if (!lastEvent) return;
    const t = lastEvent.event;
    if (t === EVENT_TYPES.WAKE_WORD_DETECTED || t === EVENT_TYPES.LISTENING_START) {
      modeRef.current = 'LISTENING';
    } else if (t === EVENT_TYPES.RESPONSE_START) {
      modeRef.current = 'SPEAKING';
    } else if (t === EVENT_TYPES.RESPONSE_END || t === EVENT_TYPES.LISTENING_STOP) {
      modeRef.current = 'IDLE';
    }
  }, [lastEvent]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3.5;

    // Sphere with custom shader for vertex displacement + emissive surface
    const geometry = new THREE.IcosahedronGeometry(1, 32);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        u_time: { value: 0 },
        u_intensity: { value: 0 },
        u_color: { value: new THREE.Color('#00d4ff') },
      },
      vertexShader: `
        uniform float u_time;
        uniform float u_intensity;
        varying float v_disp;
        varying vec3 v_normal;

        // 3D simplex noise (Ashima)
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
          const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
          const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3  ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ * ns.x + ns.yyyy;
          vec4 y = y_ * ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0) * 2.0 + 1.0;
          vec4 s1 = floor(b1) * 2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
        }

        void main() {
          float n = snoise(position * 1.6 + vec3(u_time * 0.6));
          float disp = n * (0.18 + u_intensity * 0.55);
          v_disp = disp;
          v_normal = normal;
          vec3 displaced = position + normal * disp;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 u_color;
        uniform float u_intensity;
        varying float v_disp;
        varying vec3 v_normal;
        void main() {
          float fres = pow(1.0 - max(dot(normalize(v_normal), vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
          vec3 col = u_color * (0.6 + v_disp * 1.4) + vec3(1.0) * fres * 0.7;
          float a = 0.55 + fres * 0.35 + u_intensity * 0.2;
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // Outer halo
    const haloGeo = new THREE.SphereGeometry(1.35, 64, 64);
    const haloMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      uniforms: { u_color: { value: new THREE.Color('#00d4ff') }, u_intensity: { value: 0 } },
      vertexShader: 'varying vec3 v_normal; void main() { v_normal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 u_color; uniform float u_intensity; varying vec3 v_normal; void main() { float i = pow(0.65 - dot(v_normal, vec3(0.0,0.0,1.0)), 2.0); gl_FragColor = vec4(u_color, i * (0.5 + u_intensity)); }',
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    scene.add(halo);

    let raf = 0;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;

      // Smoothly approach a target intensity based on the current mode.
      const target = modeRef.current === 'SPEAKING' ? 1.0 : modeRef.current === 'LISTENING' ? 0.55 : 0.18;
      intensityRef.current += (target - intensityRef.current) * 0.05;

      const color = modeRef.current === 'SPEAKING' ? '#ffb347' : modeRef.current === 'LISTENING' ? '#00e5ff' : '#00d4ff';
      (material.uniforms.u_color.value as THREE.Color).set(color);
      (haloMat.uniforms.u_color.value as THREE.Color).set(color);
      material.uniforms.u_time.value = t;
      material.uniforms.u_intensity.value = intensityRef.current;
      haloMat.uniforms.u_intensity.value = intensityRef.current * 0.6;

      sphere.rotation.y = t * 0.18;
      sphere.rotation.x = Math.sin(t * 0.13) * 0.2;

      if (!document.hidden) {
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div ref={containerRef} style={{ width: size, height: size, pointerEvents: 'none' }} />;
}
