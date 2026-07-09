'use client';

/**
 * 3D kadın asistan avatarı (Ready Player Me / Wolf3D rig).
 *  - Beden jesti: animations.glb klipleri (Idle / Talking_0-2) faz'a göre crossfade.
 *  - Lip-sync: TTS metninden üretilen vizem morph'ları (lipsync.ts) → ağız + çene.
 *  - Göz kırpma: prosedürel (eyeBlink morph'ları).
 *  - SARI saç (Wolf3D_Hair materyali) + sekreter GÖZLÜĞÜ (göz kemiklerine kilitli).
 * Transparan canvas + sade ışık (network'süz; Environment preset YOK).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { LipSync } from './lipsync';

const AVATAR_URL = '/avatar/assistant.glb';
const ANIM_URL = '/avatar/animations.glb';

export type Phase = 'idle' | 'listening' | 'speaking';

// yeniden kullanılan geçici matematik nesneleri
const _vL = new THREE.Vector3();
const _vR = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function Avatar({ phase, speakingText }: { phase: Phase; speakingText: string | null }) {
  const group = useRef<THREE.Group>(null);
  const glassesRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(AVATAR_URL);
  const { animations } = useGLTF(ANIM_URL);
  const { actions } = useAnimations(animations, group);

  const lip = useRef(new LipSync());
  const talkIdx = useRef(0);
  const currentClip = useRef<string>('');
  const blink = useRef({ timer: 0, next: 3, val: 0, closing: false });
  const centered = useRef(false);

  // Morph içeren skinned mesh'leri topla (Wolf3D_Head, Wolf3D_Teeth…)
  const morphMeshes = useMemo(() => {
    const list: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && m.morphTargetDictionary && m.morphTargetInfluences) list.push(m);
    });
    return list;
  }, [scene]);

  const hips = useMemo(() => scene.getObjectByName('Hips') || scene.getObjectByName('Spine'), [scene]);
  const headBone = useMemo(() => scene.getObjectByName('Head'), [scene]);
  const leftEye = useMemo(() => scene.getObjectByName('LeftEye'), [scene]);
  const rightEye = useMemo(() => scene.getObjectByName('RightEye'), [scene]);

  // SARI saç: Wolf3D_Hair materyalinin texture'ını kaldır → temiz sarı
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /hair/i.test(m.name)) {
        const arr = Array.isArray(m.material) ? m.material : [m.material];
        arr.forEach((mm) => {
          const sm = mm as THREE.MeshStandardMaterial;
          sm.map = null;
          sm.color = new THREE.Color('#e8c45a'); // sıcak sarı
          sm.roughness = 0.5; sm.metalness = 0.05;
          sm.needsUpdate = true;
        });
      }
    });
  }, [scene]);

  // Gözlük geometrileri (RPM standart ölçeği — IPD ~0.064)
  // İnce, zarif çerçeve (0.0036→0.0028 tube) + zengin metalik his — premium sekreter.
  const lensGeo = useMemo(() => new THREE.TorusGeometry(0.0208, 0.0028, 16, 48), []);
  const glassGeo = useMemo(() => new THREE.CircleGeometry(0.0195, 32), []);
  const bridgeGeo = useMemo(() => new THREE.BoxGeometry(0.022, 0.0026, 0.004), []);
  const templeGeo = useMemo(() => new THREE.BoxGeometry(0.0032, 0.0034, 0.08), []);
  const frameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1b22', metalness: 0.7, roughness: 0.28 }), []);
  const glassMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#cfe2ff', transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0, depthWrite: false,
  }), []);

  // TTS metni değişince lip-sync başlat/durdur
  useEffect(() => {
    if (phase === 'speaking' && speakingText) lip.current.begin(speakingText, performance.now());
    else lip.current.stop();
  }, [phase, speakingText]);

  // Faz → beden klibi crossfade
  useEffect(() => {
    if (!actions) return;
    let name = 'Idle';
    if (phase === 'speaking') {
      const talks = ['Talking_0', 'Talking_1', 'Talking_2'].filter((n) => actions[n]);
      name = talks.length ? talks[talkIdx.current++ % talks.length] : 'Idle';
    }
    if (name === currentClip.current && actions[name]?.isRunning()) return;
    const next = actions[name] || actions['Idle'];
    const prev = currentClip.current ? actions[currentClip.current] : null;
    if (next) next.reset().fadeIn(0.45).play();
    if (prev && prev !== next) prev.fadeOut(0.45);
    currentClip.current = next ? name : currentClip.current;
  }, [phase, actions]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // ilk frame'de iskeletten yatay ortala
    if (!centered.current && hips && group.current) {
      hips.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
      group.current.position.x -= wp.x;
      group.current.position.z -= wp.z;
      centered.current = true;
    }

    // gözlüğü göz kemiklerine kilitle (animasyonla birlikte hareket)
    if (glassesRef.current && leftEye && rightEye && headBone) {
      leftEye.getWorldPosition(_vL);
      rightEye.getWorldPosition(_vR);
      _mid.copy(_vL).add(_vR).multiplyScalar(0.5);
      headBone.getWorldQuaternion(_q);
      // DÜNYA-uzayı offset (pitch'ten bağımsız → gözlük göz hizasında sabit, oynamaz)
      glassesRef.current.position.set(_mid.x, _mid.y - 0.004, _mid.z + 0.045);
      glassesRef.current.quaternion.copy(_q); // çerçeve yüzle hizalı
    }

    const k = Math.min(1, dt * 18); // morph yumuşatma

    // göz kırpma
    const b = blink.current;
    b.timer += dt;
    if (!b.closing && b.timer > b.next) b.closing = true;
    if (b.closing) {
      const p = (b.timer - b.next) / 0.16;
      b.val = p < 0.5 ? p * 2 : Math.max(0, 2 - 2 * p);
      if (p >= 1) { b.closing = false; b.timer = 0; b.next = 2.4 + Math.random() * 3.6; b.val = 0; }
    }

    // hedef morph ağırlıkları
    const targets: Record<string, number> = {};
    if (phase === 'speaking') {
      const s = lip.current.sample(performance.now());
      if (s) {
        for (const v in s.weights) targets[v] = Math.max(targets[v] || 0, s.weights[v as keyof typeof s.weights] || 0);
        targets['jawOpen'] = s.jaw;
      }
    } else {
      targets['mouthSmileLeft'] = 0.16;
      targets['mouthSmileRight'] = 0.16;
    }
    targets['eyeBlinkLeft'] = Math.max(targets['eyeBlinkLeft'] || 0, b.val);
    targets['eyeBlinkRight'] = Math.max(targets['eyeBlinkRight'] || 0, b.val);

    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary!;
      const inf = mesh.morphTargetInfluences!;
      for (const name in dict) {
        const idx = dict[name];
        const tv = targets[name] ?? 0;
        inf[idx] += (tv - inf[idx]) * k;
      }
    }

    if (group.current) {
      const targetY = phase === 'listening' ? 0.06 : 0;
      group.current.rotation.y += (targetY - group.current.rotation.y) * Math.min(1, dt * 4);
      // Idle canlılık: yumuşak nefes (dikey) + çok hafif salınım — sekreter "yaşıyor"
      // hissi. Konuşma/dinlemede klip hareketi baskın olsun diye genlik kısılır.
      const alive = phase === 'idle' ? 1 : 0.35;
      group.current.position.y = Math.sin(t * 1.4) * 0.005 * alive;
      group.current.rotation.z = Math.sin(t * 0.6) * 0.012 * alive;
    }
  });

  return (
    <>
      <group ref={group} position={[0, 0, 0]}>
        <primitive object={scene} />
      </group>
      {/* Sekreter gözlüğü — göz kemiklerine kilitli */}
      <group ref={glassesRef}>
        <mesh geometry={lensGeo} material={frameMat} position={[-0.033, 0, 0]} />
        <mesh geometry={lensGeo} material={frameMat} position={[0.033, 0, 0]} />
        <mesh geometry={glassGeo} material={glassMat} position={[-0.033, 0, 0.0005]} />
        <mesh geometry={glassGeo} material={glassMat} position={[0.033, 0, 0.0005]} />
        <mesh geometry={bridgeGeo} material={frameMat} position={[0, 0.004, 0]} />
        <mesh geometry={templeGeo} material={frameMat} position={[-0.054, 0.006, -0.035]} />
        <mesh geometry={templeGeo} material={frameMat} position={[0.054, 0.006, -0.035]} />
      </group>
    </>
  );
}

useGLTF.preload(AVATAR_URL);
useGLTF.preload(ANIM_URL);
