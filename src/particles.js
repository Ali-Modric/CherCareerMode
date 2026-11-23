import * as THREE from 'three';
import { PITCH, clamp, makeCanvasTexture } from './util.js';

// ---------------------------------------------------------------------------
// particles.js — Pooled GPU-instanced turf divots, chalk/dust puffs, and
// persistent slide-tackle skid marks. Zero per-frame allocations, seeded RNG.
// ---------------------------------------------------------------------------

const HL = PITCH.length / 2; // 52.5
const HW = PITCH.width / 2;  // 34.0

function isNearLine(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (Math.abs(ax - HL) < 0.45 && az <= HW + 0.4) return true;
  if (Math.abs(az - HW) < 0.45 && ax <= HL + 0.4) return true;
  if (ax < 0.42 && az <= HW + 0.4) return true;
  if (Math.abs(Math.hypot(x, z) - PITCH.centerCircleR) < 0.42) return true;
  const paX = HL - PITCH.penAreaDepth;
  const paZ = PITCH.penAreaWidth / 2;
  if (Math.abs(ax - paX) < 0.42 && az <= paZ + 0.3) return true;
  if (ax >= paX - 0.3 && ax <= HL + 0.3 && Math.abs(az - paZ) < 0.42) return true;
  return false;
}

export function createParticles(ctx) {
  const { scene, rng, quality } = ctx;
  const low = quality === 'low';
  const DIVOT_MAX = low ? 96 : 160;
  const DUST_MAX = low ? 56 : 96;
  const SKID_MAX = low ? 16 : 28;

  const _m4 = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();
  const _eu = new THREE.Euler();
  const _col = new THREE.Color();

  // ---- 1. Turf divots & grass blades -------------------------------------
  const divotGeo = new THREE.BoxGeometry(0.085, 0.024, 0.048);
  const divotMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
  });
  const divotMesh = new THREE.InstancedMesh(divotGeo, divotMat, DIVOT_MAX);
  divotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  divotMesh.frustumCulled = false;
  divotMesh.castShadow = false;
  divotMesh.receiveShadow = false;
  scene.add(divotMesh);

  const divots = [];
  for (let i = 0; i < DIVOT_MAX; i++) {
    divots.push({
      active: false,
      x: 0, y: -10, z: 0,
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      vrx: 0, vry: 0, vrz: 0,
      sx: 1, sy: 1, sz: 1,
      t: 0, dur: 0.8,
    });
    _m4.makeScale(0, 0, 0);
    divotMesh.setMatrixAt(i, _m4);
    _col.setRGB(0.22, 0.34, 0.16);
    divotMesh.setColorAt(i, _col);
  }
  divotMesh.instanceMatrix.needsUpdate = true;
  if (divotMesh.instanceColor) divotMesh.instanceColor.needsUpdate = true;
  let divotCursor = 0;

  // ---- 2. Chalk & dry dust puffs -----------------------------------------
  const dustTex = makeCanvasTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0.0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(240,244,238,0.42)');
    gr.addColorStop(1.0, 'rgba(240,244,238,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { wrap: THREE.ClampToEdgeWrapping });

  const dustGeo = new THREE.PlaneGeometry(0.44, 0.44);
  const dustMat = new THREE.MeshBasicMaterial({
    map: dustTex,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, DUST_MAX);
  dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dustMesh.frustumCulled = false;
  dustMesh.renderOrder = 4;
  scene.add(dustMesh);

  const dusts = [];
  for (let i = 0; i < DUST_MAX; i++) {
    dusts.push({
      active: false,
      x: 0, y: -10, z: 0,
      vx: 0, vy: 0, vz: 0,
      baseScale: 0.6,
      rot: 0,
      t: 0, dur: 0.55,
    });
    _m4.makeScale(0, 0, 0);
    dustMesh.setMatrixAt(i, _m4);
    _col.setRGB(0.85, 0.88, 0.80);
    dustMesh.setColorAt(i, _col);
  }
  dustMesh.instanceMatrix.needsUpdate = true;
  if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
  let dustCursor = 0;

  // ---- 3. Persistent slide-tackle turf skid marks ------------------------
  const skidTex = makeCanvasTexture(128, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(28, 24, 16, 0)');
    gr.addColorStop(0.18, 'rgba(28, 24, 16, 0.58)');
    gr.addColorStop(0.82, 'rgba(34, 28, 18, 0.52)');
    gr.addColorStop(1, 'rgba(28, 24, 16, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 4, w, h - 8);
  }, { wrap: THREE.ClampToEdgeWrapping });

  const skidGeo = new THREE.PlaneGeometry(1.15, 0.28);
  skidGeo.rotateX(-Math.PI / 2);
  const skidMat = new THREE.MeshBasicMaterial({
    map: skidTex,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, SKID_MAX);
  skidMesh.frustumCulled = false;
  skidMesh.renderOrder = 2;
  scene.add(skidMesh);

  let skidCursor = 0;
  function resetSkids() {
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < SKID_MAX; i++) skidMesh.setMatrixAt(i, _m4);
    skidMesh.instanceMatrix.needsUpdate = true;
    skidCursor = 0;
  }
  resetSkids();

  function spawnDivot(x, y, z, vx, vy, vz, isSoil) {
    const d = divots[divotCursor];
    const idx = divotCursor;
    divotCursor = (divotCursor + 1) % DIVOT_MAX;
    d.active = true;
    d.x = x; d.y = y; d.z = z;
    d.vx = vx; d.vy = vy; d.vz = vz;
    d.rx = rng() * 6.28; d.ry = rng() * 6.28; d.rz = rng() * 6.28;
    d.vrx = (rng() - 0.5) * 18;
    d.vry = (rng() - 0.5) * 18;
    d.vrz = (rng() - 0.5) * 18;
    d.sx = 0.7 + rng() * 0.9;
    d.sy = 0.7 + rng() * 0.6;
    d.sz = 0.7 + rng() * 0.9;
    d.t = 0;
    d.dur = 0.55 + rng() * 0.45;
    if (isSoil) {
      _col.setRGB(0.18 + rng() * 0.08, 0.14 + rng() * 0.06, 0.09 + rng() * 0.04);
    } else {
      _col.setRGB(0.18 + rng() * 0.10, 0.34 + rng() * 0.14, 0.12 + rng() * 0.06);
    }
    divotMesh.setColorAt(idx, _col);
    if (divotMesh.instanceColor) divotMesh.instanceColor.needsUpdate = true;
  }

  function spawnDust(x, y, z, vx, vy, vz, scale, isChalk) {
    const p = dusts[dustCursor];
    const idx = dustCursor;
    dustCursor = (dustCursor + 1) % DUST_MAX;
    p.active = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.baseScale = scale;
    p.rot = rng() * 6.28;
    p.t = 0;
    p.dur = isChalk ? 0.55 + rng() * 0.25 : 0.40 + rng() * 0.22;
    if (isChalk) {
      _col.setRGB(0.95, 0.97, 0.98);
    } else {
      _col.setRGB(0.62 + rng() * 0.10, 0.66 + rng() * 0.10, 0.52 + rng() * 0.08);
    }
    dustMesh.setColorAt(idx, _col);
    if (dustMesh.instanceColor) dustMesh.instanceColor.needsUpdate = true;
  }

  function burstTurf(x, z, vx = 0, vz = 0, count = 10, isSlide = false) {
    const chalk = isNearLine(x, z);
    const n = low ? Math.max(3, Math.round(count * 0.6)) : count;
    for (let i = 0; i < n; i++) {
      const spread = isSlide ? 2.6 : 1.9;
      const pvx = vx * (0.25 + rng() * 0.45) + (rng() - 0.5) * spread;
      const pvz = vz * (0.25 + rng() * 0.45) + (rng() - 0.5) * spread;
      const pvy = (isSlide ? 1.8 : 1.3) + rng() * (isSlide ? 2.8 : 2.1);
      spawnDivot(
        x + (rng() - 0.5) * 0.35,
        0.03 + rng() * 0.04,
        z + (rng() - 0.5) * 0.35,
        pvx, pvy, pvz,
        rng() < 0.38
      );
    }
    const dustN = isSlide ? 5 : 2;
    for (let i = 0; i < dustN; i++) {
      spawnDust(
        x + (rng() - 0.5) * 0.35,
        0.08 + rng() * 0.12,
        z + (rng() - 0.5) * 0.35,
        vx * 0.2 + (rng() - 0.5) * 1.4,
        0.45 + rng() * 0.95,
        vz * 0.2 + (rng() - 0.5) * 1.4,
        (isSlide ? 1.05 : 0.72) + rng() * 0.45,
        chalk && i % 2 === 0
      );
    }
  }

  function burstChalk(x, z, vx = 0, vz = 0, strength = 1) {
    if (!isNearLine(x, z)) return;
    const n = Math.round((low ? 3 : 6) * clamp(strength, 0.5, 1.5));
    for (let i = 0; i < n; i++) {
      spawnDust(
        x + (rng() - 0.5) * 0.25,
        0.06 + rng() * 0.1,
        z + (rng() - 0.5) * 0.25,
        vx * 0.12 + (rng() - 0.5) * 1.6,
        0.5 + rng() * 1.1,
        vz * 0.12 + (rng() - 0.5) * 1.6,
        0.75 + rng() * 0.55,
        true
      );
    }
  }

  function stampSkid(x, z, angle) {
    const idx = skidCursor;
    skidCursor = (skidCursor + 1) % SKID_MAX;
    _pos.set(x, 0.014, z);
    _eu.set(0, -angle, 0);
    _quat.setFromEuler(_eu);
    _scl.set(1.0 + (rng() - 0.5) * 0.25, 1, 0.9 + rng() * 0.35);
    _m4.compose(_pos, _quat, _scl);
    skidMesh.setMatrixAt(idx, _m4);
    skidMesh.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    for (let i = 0; i < DIVOT_MAX; i++) {
      divots[i].active = false;
      _m4.makeScale(0, 0, 0);
      divotMesh.setMatrixAt(i, _m4);
    }
    for (let i = 0; i < DUST_MAX; i++) {
      dusts[i].active = false;
      _m4.makeScale(0, 0, 0);
      dustMesh.setMatrixAt(i, _m4);
    }
    divotMesh.instanceMatrix.needsUpdate = true;
    dustMesh.instanceMatrix.needsUpdate = true;
    resetSkids();
  }

  function update(dt) {
    if (!(dt > 0)) return;
    let divotDirty = false;
    for (let i = 0; i < DIVOT_MAX; i++) {
      const d = divots[i];
      if (!d.active) continue;
      divotDirty = true;
      d.t += dt;
      if (d.t >= d.dur) {
        d.active = false;
        _m4.makeScale(0, 0, 0);
        divotMesh.setMatrixAt(i, _m4);
        continue;
      }
      d.vy -= 9.81 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < 0.012) {
        d.y = 0.012;
        d.vy = Math.abs(d.vy) * 0.22;
        d.vx *= 0.55;
        d.vz *= 0.55;
      }
      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;
      const fade = clamp(1 - Math.max(0, (d.t - d.dur * 0.65) / (d.dur * 0.35)), 0, 1);
      _pos.set(d.x, d.y, d.z);
      _eu.set(d.rx, d.ry, d.rz);
      _quat.setFromEuler(_eu);
      _scl.set(d.sx * fade, d.sy * fade, d.sz * fade);
      _m4.compose(_pos, _quat, _scl);
      divotMesh.setMatrixAt(i, _m4);
    }
    if (divotDirty) divotMesh.instanceMatrix.needsUpdate = true;

    let dustDirty = false;
    const camQ = ctx.camera ? ctx.camera.quaternion : null;
    for (let i = 0; i < DUST_MAX; i++) {
      const p = dusts[i];
      if (!p.active) continue;
      dustDirty = true;
      p.t += dt;
      if (p.t >= p.dur) {
        p.active = false;
        _m4.makeScale(0, 0, 0);
        dustMesh.setMatrixAt(i, _m4);
        continue;
      }
      const u = p.t / p.dur;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= Math.exp(-2.8 * dt);
      p.vz *= Math.exp(-2.8 * dt);
      p.vy *= Math.exp(-1.8 * dt);
      const sc = p.baseScale * (0.55 + u * 1.45) * Math.sin(u * Math.PI);
      _pos.set(p.x, p.y, p.z);
      if (camQ) _quat.copy(camQ);
      else _quat.setFromEuler(_eu.set(-Math.PI * 0.35, 0, p.rot));
      _scl.set(sc, sc, sc);
      _m4.compose(_pos, _quat, _scl);
      dustMesh.setMatrixAt(i, _m4);
    }
    if (dustDirty) dustMesh.instanceMatrix.needsUpdate = true;
  }

  return { burstTurf, burstChalk, stampSkid, reset, update };
}
