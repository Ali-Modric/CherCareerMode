import * as THREE from 'three';
import { STANDS, TIERS, clamp, lerp } from './util.js';

// ---------------------------------------------------------------------------
// crowd.js — lightweight empty stands (stairways + vomitories only).
//
// All ~27,000 stadium spectators and instanced seat shells are disabled for
// 60 FPS performance on low-power GPUs; the terraced concrete stands from
// stadium.js remain intact with aisle steps and lit vomitory mouths.
// ---------------------------------------------------------------------------

const FOOT_DROP = 0.05;
const AISLE_HALF = 0.70;
const WALK = [9, 6];

const nSecOf = (id) => (id === 'north' || id === 'south' ? 12 : 8);
const standNum = { west: 1, east: 2, north: 3, south: 4 };

function hash(a, b, c, d = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1103515245) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vomAt(standId, tierIdx, k) {
  if (k < 1) return null;
  const hv = hash(standNum[standId] || 1, tierIdx, k);
  if (hv >= 0.55) return null;
  const top = WALK[tierIdx] + 1 + ((hv * 7) | 0) % 3;
  return { from: top, to: top + 4, hv };
}

function bakedShade(tierIdx, row, u) {
  const tRows = TIERS[tierIdx].rows;
  const rn = tRows > 1 ? row / (tRows - 1) : 0;
  let shade = tierIdx === 0
    ? lerp(0.78, 0.32, Math.pow(rn, 0.78))
    : lerp(0.60, 0.24, Math.pow(rn, 0.70));
  shade *= lerp(0.62, 1.0, Math.pow(Math.sin(u * Math.PI), 0.55));
  shade *= 0.86 + 0.18 * (0.5 + 0.5 * Math.sin(u * 9.1 + tierIdx * 2.3))
                + 0.08 * (0.5 + 0.5 * Math.sin(u * 23.7 + 1.7));
  return shade;
}

function makeBuilder() {
  const pos = [], col = [], idx = [];
  let base = 0;
  return {
    quad(a, b, c, d, cols) {
      for (const v of [a, b, c, d]) pos.push(v[0], v[1], v[2]);
      for (let i = 0; i < 4; i++) {
        const k = cols.length === 4 ? cols[i] : cols[0];
        col.push(k[0], k[1], k[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    },
  };
}

export function createCrowd(ctx) {
  const { scene } = ctx;

  // ---- terrace architecture: stairways + vomitories ------------------------
  const arch = makeBuilder();
  const DARK = [0.012, 0.013, 0.016];
  const HOLE = [0.006, 0.006, 0.008];

  const wp = (s, d, a, y) => (s.axis === 'x' ? [s.sign * d, y, a] : [a, y, s.sign * d]);

  const flat = (s, d0, d1, a0, a1, y, cols) =>
    arch.quad(wp(s, d0, a0, y), wp(s, d1, a0, y), wp(s, d1, a1, y), wp(s, d0, a1, y), cols);
  const upright = (s, d, a0, a1, y0, y1, cols) =>
    arch.quad(wp(s, d, a0, y0), wp(s, d, a1, y0), wp(s, d, a1, y1), wp(s, d, a0, y1), cols);

  for (const s of STANDS) {
    const n = nSecOf(s.id);
    const pitchM = s.length / n;
    for (let t = 0; t < TIERS.length; t++) {
      const tier = TIERS[t];
      const base = tier.baseDist[s.axis];
      for (let k = 1; k < n; k++) {
        const ac = k * pitchM - s.length / 2;
        const a0 = ac - AISLE_HALF, a1 = ac + AISLE_HALF;
        const v = vomAt(s.id, t, k);
        for (let r = 0; r < tier.rows; r++) {
          const d0 = base + r * tier.rowDepth;
          const y = tier.baseY + r * tier.rowRise - FOOT_DROP;
          const inVom = v && r >= v.from && r < v.to;
          if (inVom) {
            flat(s, d0 - 0.02, d0 + tier.rowDepth + 0.02, a0 - 0.06, a1 + 0.06, y + 0.012, [HOLE]);
            upright(s, d0 - 0.02, a0 - 0.06, a1 + 0.06, y - tier.rowRise, y + 0.012, [HOLE]);
            if (r === v.to - 1) {
              const yb = y + 0.012, yt = y + 2.5;
              const warmB = [1.55, 0.86, 0.42], warmT = [0.05, 0.035, 0.03];
              upright(s, d0 + tier.rowDepth, a0 - 0.06, a1 + 0.06, yb, yt,
                [warmB, warmB, warmT, warmT]);
              arch.quad(wp(s, d0 - 0.02, a0 - 0.06, yb), wp(s, d0 + tier.rowDepth, a0 - 0.06, yb),
                wp(s, d0 + tier.rowDepth, a0 - 0.06, yt), wp(s, d0 - 0.02, a0 - 0.06, yt),
                [[0.10, 0.07, 0.05], [0.30, 0.19, 0.10], [0.03, 0.025, 0.02], [0.03, 0.025, 0.02]]);
              arch.quad(wp(s, d0 + tier.rowDepth, a1 + 0.06, yb), wp(s, d0 - 0.02, a1 + 0.06, yb),
                wp(s, d0 - 0.02, a1 + 0.06, yt), wp(s, d0 + tier.rowDepth, a1 + 0.06, yt),
                [[0.30, 0.19, 0.10], [0.10, 0.07, 0.05], [0.03, 0.025, 0.02], [0.03, 0.025, 0.02]]);
              flat(s, d0 - 0.02, d0 + tier.rowDepth + 0.02, a0 - 0.06, a1 + 0.06, yt, [DARK]);
            }
            continue;
          }
          if (r === WALK[t]) continue;
          const hr = tier.rowRise * 0.5;
          const hd = tier.rowDepth * 0.5;
          const sl = clamp(bakedShade(t, r, (ac + s.length / 2) / s.length), 0.12, 1.4);
          const mid = [0.050 * sl, 0.052 * sl, 0.060 * sl];
          const tread = [0.075 * sl, 0.077 * sl, 0.088 * sl];
          const nose = [0.30 * sl, 0.295 * sl, 0.275 * sl];
          flat(s, d0 + hd, d0 + tier.rowDepth + 0.01, a0, a1, y + hr, [tread]);
          upright(s, d0 + hd, a0, a1, y, y + hr, [mid]);
          flat(s, d0, d0 + hd, a0, a1, y + 0.01, [tread]);
          flat(s, d0 + hd - 0.045, d0 + hd, a0, a1, y + hr + 0.004, [nose]);
          flat(s, d0 - 0.045, d0, a0, a1, y + 0.014, [nose]);
        }
      }
    }
  }

  const archMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const archMesh = new THREE.Mesh(arch.build(), archMat);
  archMesh.frustumCulled = false;
  archMesh.castShadow = false;
  archMesh.receiveShadow = false;

  const group = new THREE.Group();
  group.name = 'crowd';
  group.add(archMesh);
  scene.add(group);

  return {
    group,
    update() {},
  };
}
