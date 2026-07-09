# CREDITS — 3D Avatar Assets

## Mini-orb assistant avatar
- **public/avatar/assistant.glb** — Ready Player Me avatar (Wolf3D rig, ARKit + Oculus viseme morph targets).
  Sourced from the MIT-licensed tutorial repo `wass08/r3f-virtual-girlfriend-frontend`
  (https://github.com/wass08/r3f-virtual-girlfriend-frontend, `public/models/64f1a714fe61576b46f27ca2.glb`).
  Used as a **placeholder** assistant avatar; intended to be replaced by the user's own
  Ready Player Me avatar (create at https://readyplayer.me with
  `?morphTargets=ARKit,Oculus Visemes`, drop the .glb in `public/avatar/assistant.glb`).

- **public/avatar/animations.glb** — Mixamo body animation clips (Idle, Talking_0/1/2, etc.),
  retargeted to the RPM/Wolf3D rig. From the same repo (`public/models/animations.glb`).
  Mixamo animations: free for use under Adobe's Mixamo license.

## Notlar
- Bu avatar kişisel masaüstü asistanı (XJarvis) için placeholder olarak kullanılıyor.
- Kullanıcı kendi RPM avatarını (sekreter görünümü) oluşturduğunda swap edilecek;
  aynı Wolf3D rig + vizem morph'ları olduğu sürece lip-sync + animasyon kodu değişmez.
