// Yard 7 — an original industrial yard map. One job: the map's geometry,
// collision, line-of-sight and the waypoint graph bots walk. All numbers are
// metres; x runs west(-) to east(+), z runs north(-) to south(+). Attackers
// (Vanguard) spawn south, defenders (Sentinel) north. Site A is the west
// warehouse, Site B the east silo yard, joined by West lane, Mid and Long.
import { makeRng } from "./rng.js";

export const MAP = {
  bounds: { x0: -28, x1: 28, z0: -20, z1: 20 },
  sites: [
    { id: "A", name: "SITE A", x: -22, z: -8, r: 4.5 },
    { id: "B", name: "SITE B", x: 22, z: 8, r: 4.5 },
  ],
  spawns: {
    us: [ // Vanguard, south — yaw 0 faces north, into the yard
      { x: -6, z: 17, yaw: 0 }, { x: -2, z: 17.5, yaw: 0 },
      { x: 2, z: 17.5, yaw: 0 }, { x: 6, z: 17, yaw: 0 },
      { x: 0, z: 15, yaw: 0 },
    ],
    them: [ // Sentinel, north — yaw PI faces south, into the yard
      { x: -20, z: -15, yaw: Math.PI }, { x: -8, z: -16, yaw: Math.PI },
      { x: 4, z: -16, yaw: Math.PI }, { x: 16, z: -15, yaw: Math.PI },
      { x: 24, z: -12, yaw: Math.PI },
    ],
  },
  // Walls and solid boxes: {x0,z0,x1,z1,h} axis-aligned, h = height.
  walls: [],
  // Waypoint graph for bots: nodes {x,z}, edges as index pairs.
  nodes: [],
  edges: [],
  // Visual dressing: {kind,x,z,ry,s} — barrels, pipes, pallets (no collision
  // unless listed in walls).
  props: [],
};

// Helper to add a wall.
function W(x0, z0, x1, z1, h) {
  MAP.walls.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h });
}

(function build() {
  const B = MAP.bounds;
  // Perimeter (thick outer walls).
  W(B.x0 - 1, B.z0 - 1, B.x0, B.z1 + 1, 4);
  W(B.x1, B.z0 - 1, B.x1 + 1, B.z1 + 1, 4);
  W(B.x0, B.z0 - 1, B.x1, B.z0, 4);
  W(B.x0, B.z1, B.x1, B.z1 + 1, 4);

  // --- Site A warehouse (west): a roofed box with two door gaps. ---
  // North wall with a door at x -24..-21, south wall with a door at -20..-17.
  W(-27, -13, -24, -12, 3.2); W(-21, -13, -17, -12, 3.2); // north
  W(-27, -4, -20, -3, 3.2); W(-17, -4, -17, -3, 3.2); // south (door -20..-17)
  W(-27, -13, -26, -3, 3.2); // west
  W(-17, -13, -16, -9, 3.2); W(-17, -7, -16, -3, 3.2); // east (door -9..-7)
  // Interior crate stack inside A.
  W(-24.5, -10.5, -22.5, -9, 1.2);
  W(-20.5, -6.5, -18.5, -5, 1.2);

  // --- Site B silo yard (east): three silos + container walls. ---
  W(18, 3, 26, 4, 2.6); // south container row (gap at x 18..19? keep solid)
  W(18, 12, 19, 13, 2.6);
  W(25, 5, 26, 12, 2.6);
  // Silos are cylinders visually; their collision is a square footing.
  W(20.4, 5.4, 22.6, 7.6, 5);
  W(23.4, 9.4, 25.6, 11.6, 5);
  // Low crate cover inside B.
  W(19, 9.5, 21, 11, 1.1);

  // --- Mid: a cross-wall with a double door, splitting north/south. ---
  W(-14, -0.8, -2, 0.8, 3.4);
  W(2, -0.8, 14, 0.8, 3.4);
  // Mid crates for cover on both sides of the doors.
  W(-5, 3.5, -3, 5.5, 1.2);
  W(3, -5.5, 5, -3.5, 1.2);

  // --- Long (east lane) cover + West lane cover. ---
  W(15, -8, 17, -6, 1.2); // long corner crate
  W(15, -14, 17, -12.5, 2.4); // long container
  W(-17, 6, -15, 8, 1.2); // west lane crate
  W(-17, -1, -15, 1, 2.4); // west container
  W(-8, 10, -6, 12, 1.2); // attacker-side crate
  W(8, 10, 10, 12, 1.2);
  W(-10, -14, -8, -12, 1.2); // defender-side crates
  W(6, -14, 8, -12, 1.2);
  // Central pillar block at mid-south, breaks the spawn sightline.
  W(-1.5, 8, 1.5, 10, 2.6);

  // --- Waypoint graph. ---
  const N = (x, z) => { MAP.nodes.push({ x, z }); return MAP.nodes.length - 1; };
  const nSpawnS = N(0, 16), nSpawnW = N(-4, 15), nSpawnE = N(4, 15);
  const nMidS = N(0, 6), nMidDoor = N(0, 0), nMidN = N(0, -6);
  const nWest1 = N(-12, 10), nWest2 = N(-16, 4), nWestA = N(-20, -6);
  const nLong1 = N(12, 8), nLong2 = N(16, -2), nLongB = N(20, 4);
  const nA = N(-22, -8), nB = N(22, 8);
  const nDefA = N(-14, -10), nDefB = N(18, 12), nDefMid = N(6, -10);
  const nAout = N(-14, -6), nBout = N(16, 6);
  const E = (...pairs) => { for (const [a, b] of pairs) MAP.edges.push([a, b]); };
  E([nSpawnS, nMidS], [nSpawnW, nWest1], [nSpawnE, nLong1],
    [nSpawnS, nSpawnW], [nSpawnS, nSpawnE],
    [nMidS, nMidDoor], [nMidDoor, nMidN],
    [nWest1, nWest2], [nWest2, nWestA], [nWestA, nA], [nWestA, nAout],
    [nLong1, nLong2], [nLong2, nLongB], [nLongB, nB], [nLongB, nBout],
    [nMidN, nDefMid], [nMidN, nDefA], [nMidN, nDefB],
    [nA, nAout], [nA, nDefA], [nB, nBout], [nB, nDefB],
    [nDefA, nAout], [nDefB, nBout], [nMidN, nAout], [nMidN, nBout]);
  MAP.holds = { A: nDefA, B: nDefB, MID: nDefMid, AOUT: nAout, BOUT: nBout };

  // --- Dressing props (seeded, visual only). ---
  const rng = makeRng(20261115);
  for (let i = 0; i < 26; i++) {
    const x = -26 + rng() * 52, z = -18 + rng() * 36;
    if (pointBlocked(x, z, 1.2)) continue;
    if (Math.abs(x) < 3 && z > 12) continue; // keep spawns clear
    MAP.props.push({ kind: rng() < 0.5 ? "barrel" : "pallet", x, z, ry: rng() * Math.PI * 2, s: 0.8 + rng() * 0.5 });
  }
})();

// --- Collision & sight helpers (pure math, no THREE). ---

// Circle (radius r) at (x,z) overlapping any wall?
export function pointBlocked(x, z, r) {
  for (const w of MAP.walls) {
    if (x + r > w.x0 && x - r < w.x1 && z + r > w.z0 && z - r < w.z1) return true;
  }
  return false;
}

// Move a circle by (dx,dz) with axis-separated sliding. Returns new {x,z}.
export function moveCircle(x, z, r, dx, dz) {
  let nx = x + dx;
  if (pointBlocked(nx, z, r)) {
    // try smaller steps to slide along the wall
    nx = x;
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const tx = x + (dx * i) / steps;
      if (!pointBlocked(tx, z, r)) nx = tx; else break;
    }
  }
  let nz = z + dz;
  if (pointBlocked(nx, nz, r)) {
    nz = z;
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const tz = z + (dz * i) / steps;
      if (!pointBlocked(nx, tz, r)) nz = tz; else break;
    }
  }
  return { x: nx, z: nz };
}

// Slab test: does segment p0->p1 intersect AABB w (with y from 0..h)?
function segHitsWall(p0, p1, w) {
  let tmin = 0, tmax = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  const mn = [w.x0, 0, w.z0], mx = [w.x1, w.h, w.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return false;
    } else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// True when a straight line between two points is blocked by a wall.
export function losBlocked(x0, y0, z0, x1, y1, z1) {
  const p0 = { x: x0, y: y0, z: z0 }, p1 = { x: x1, y: y1, z: z1 };
  for (const w of MAP.walls) if (segHitsWall(p0, p1, w)) return true;
  return false;
}

// Distance along a ray to the nearest wall, or Infinity.
export function rayWall(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  const p0 = { x: ox, y: oy, z: oz };
  for (const w of MAP.walls) {
    // slab test returning entry t
    let tmin = 0, tmax = maxDist;
    const d = [dx, dy, dz], o = [ox, oy, oz];
    const mn = [w.x0, 0, w.z0], mx = [w.x1, w.h, w.z1];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; }
      } else {
        let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin < best) best = tmin;
  }
  return best;
}

// Nearest waypoint node index to (x,z).
export function nearestNode(x, z) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < MAP.nodes.length; i++) {
    const n = MAP.nodes[i];
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

// Breadth-first path of node indices from `from` to `to`.
export function findPath(from, to) {
  if (from === to) return [to];
  const adj = new Map();
  for (const [a, b] of MAP.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  const prev = new Map([[from, -1]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    if (cur === to) break;
    for (const nb of adj.get(cur) ?? []) {
      if (!prev.has(nb)) { prev.set(nb, cur); q.push(nb); }
    }
  }
  if (!prev.has(to)) return [to];
  const path = [];
  for (let c = to; c !== -1; c = prev.get(c)) path.unshift(c);
  return path;
}
