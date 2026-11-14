// Renderer. One job: turn the state store into a three.js picture. It never
// mutates game state (except reading it) and never allocates in the hot loop:
// meshes, tracers and particles are pooled up front and reused.
import * as THREE from "three";
import { MAP } from "./map.js";
import { TEAM_US } from "./state.js";

const PALETTE = {
  ground: 0xb98d54, groundDark: 0x9a7442,
  wall: 0x5b5348, warehouse: 0x8a4a2c, containerRust: 0xb5542c,
  containerTeal: 0x2e6f6a, crate: 0xa67c3d, crateDark: 0x7d5c2a,
  silo: 0xc8c2b4, pillar: 0x3a3f44, door: 0x2e4a4a,
  sky: 0xe0915a, fog: 0xd98a5f,
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();
const colorCache = new Map();
function cachedColor(hex) {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}

export function createRenderer(state, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 40, 110);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
  camera.rotation.order = "YXZ";

  // Dusk desert light: low warm sun + cool sky fill.
  const sun = new THREE.DirectionalLight(0xffc07a, 2.6);
  sun.position.set(-30, 38, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x5a4632, 1.15));
  const fill = new THREE.DirectionalLight(0x7fb0ff, 0.35);
  fill.position.set(20, 12, -30);
  scene.add(fill);

  buildMap(scene);
  const agents = buildAgents(scene);
  const viewmodel = buildViewmodel(camera);
  scene.add(camera);
  const tracers = buildTracers(scene);
  const points = buildParticles(scene);
  const bomb = buildBomb(scene);
  const flashes = buildFlashes(scene);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  return {
    renderer, scene, camera,
    render(dt) { sync(state, dt); renderer.render(scene, camera); },
    dispose() { window.removeEventListener("resize", onResize); renderer.dispose(); },
  };

  // ---- scene construction (runs once) ----

  function buildMap(scene) {
    const groundMat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    // Yard floor slab with a darker border apron.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(58, 0.1, 42),
      new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 }),
    );
    slab.position.set(0, -0.05, 0);
    slab.receiveShadow = true;
    scene.add(slab);

    const mats = {
      wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 }),
      warehouse: new THREE.MeshStandardMaterial({ color: PALETTE.warehouse, roughness: 0.85 }),
      rust: new THREE.MeshStandardMaterial({ color: PALETTE.containerRust, roughness: 0.8, metalness: 0.25 }),
      teal: new THREE.MeshStandardMaterial({ color: PALETTE.containerTeal, roughness: 0.8, metalness: 0.25 }),
      crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 1 }),
      crateDark: new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 1 }),
      silo: new THREE.MeshStandardMaterial({ color: PALETTE.silo, roughness: 0.6, metalness: 0.4 }),
      pillar: new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.9 }),
    };
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const w of MAP.walls) {
      const h = w.h;
      const mat = pickWallMat(w, mats);
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(w.x1 - w.x0, h, w.z1 - w.z0);
      m.position.set((w.x0 + w.x1) / 2, h / 2, (w.z0 + w.z1) / 2);
      m.castShadow = h > 1.5;
      m.receiveShadow = true;
      scene.add(m);
      // A darker cap on tall walls so edges read at a glance.
      if (h >= 3) {
        const cap = new THREE.Mesh(boxGeo, mats.pillar);
        cap.scale.set(w.x1 - w.x0 + 0.12, 0.14, w.z1 - w.z0 + 0.12);
        cap.position.set((w.x0 + w.x1) / 2, h + 0.07, (w.z0 + w.z1) / 2);
        scene.add(cap);
      }
    }
    // Silo cylinders on their footings.
    const siloGeo = new THREE.CylinderGeometry(1.1, 1.1, 5.4, 18);
    for (const [x, z] of [[21.5, 6.5], [24.5, 10.5]]) {
      const s = new THREE.Mesh(siloGeo, mats.silo);
      s.position.set(x, 2.7, z);
      s.castShadow = true;
      scene.add(s);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.8, 18), mats.rust);
      top.position.set(x, 5.8, z);
      scene.add(top);
    }
    // Site beacons: a vertical light pillar + floating ring over each site.
    for (const site of MAP.sites) {
      const color = site.id === "A" ? 0xe8c98a : 0x39b8a6;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 1.4, 7, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.set(site.x, 3.5, site.z);
      scene.add(beam);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.0, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.x, 0.06, site.z);
      scene.add(ring);
    }
    // Dressing props: barrels and pallets.
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5a6a72, roughness: 0.7, metalness: 0.4 });
    const palletGeo = new THREE.BoxGeometry(1.2, 0.14, 1.0);
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1 });
    for (const p of MAP.props) {
      if (p.kind === "barrel") {
        const b = new THREE.Mesh(barrelGeo, barrelMat);
        b.position.set(p.x, 0.5, p.z);
        b.castShadow = true;
        scene.add(b);
      } else {
        const pl = new THREE.Mesh(palletGeo, palletMat);
        pl.position.set(p.x, 0.08, p.z);
        pl.rotation.y = p.ry;
        scene.add(pl);
      }
    }
    // Distant skyline silhouettes so the horizon is not empty.
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x8a5a44, fog: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const d = 78 + (i % 3) * 8;
      const b = new THREE.Mesh(boxGeo, skyMat);
      const wdt = 8 + (i % 4) * 4;
      b.scale.set(wdt, 10 + (i % 5) * 6, 4);
      b.position.set(Math.cos(a) * d, 8, Math.sin(a) * d);
      scene.add(b);
    }
  }

  function pickWallMat(w, mats) {
    const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
    if (w.h <= 1.2) return (Math.abs(cx + cz) % 2 < 1) ? mats.crate : mats.crateDark;
    if (cx < -16 && cz > -14 && cz < -2) return mats.warehouse; // Site A building
    if (cx > 15 && cz > 2 && cz < 14) return mats.teal; // Site B containers
    if (w.h >= 3.4) return mats.wall; // mid wall / perimeter
    if ((cx * 7 + cz * 3) % 3 < 1) return mats.rust;
    return mats.teal;
  }

  function buildAgents(scene) {
    const list = [];
    const bodyGeo = new THREE.BoxGeometry(0.62, 0.78, 0.36);
    const headGeo = new THREE.BoxGeometry(0.34, 0.32, 0.34);
    const legGeo = new THREE.BoxGeometry(0.24, 0.8, 0.26);
    const gunGeo = new THREE.BoxGeometry(0.09, 0.14, 0.85);
    for (let i = 0; i < 10; i++) {
      const team = i < 5 ? TEAM_US : 1;
      const bodyMat = new THREE.MeshStandardMaterial({
        color: team === TEAM_US ? 0x9a7a3a : 0x8a3a28, roughness: 0.9,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: team === TEAM_US ? 0x3a5a8a : 0x6a2020, roughness: 0.7,
      });
      const g = new THREE.Group();
      const torso = new THREE.Mesh(bodyGeo, bodyMat);
      torso.position.y = 1.05; torso.castShadow = true;
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.62; head.castShadow = true;
      const legL = new THREE.Mesh(legGeo, bodyMat);
      legL.position.set(-0.16, 0.4, 0);
      const legR = new THREE.Mesh(legGeo, bodyMat);
      legR.position.set(0.16, 0.4, 0);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5, metalness: 0.6 }));
      gun.position.set(0.28, 1.15, -0.35);
      g.add(torso, head, legL, legR, gun);
      g.userData = { legL, legR, head, gun };
      g.visible = false;
      scene.add(g);
      list.push(g);
    }
    return list;
  }

  function buildViewmodel(camera) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.45, metalness: 0.7 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.9 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), dark);
    barrel.position.set(0, 0.02, -0.45);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.12), grip);
    mag.position.set(0, -0.14, -0.05);
    mag.rotation.x = 0.25;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.06), dark);
    sight.position.set(0, 0.1, -0.12);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), grip);
    stock.position.set(0, -0.01, 0.36);
    g.add(receiver, barrel, mag, sight, stock);
    g.position.set(0.26, -0.24, -0.5);
    g.userData = { baseY: -0.24, baseZ: -0.5 };
    camera.add(g);
    return g;
  }

  function buildTracers(scene) {
    const pool = [];
    const geo = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
      m.visible = false;
      scene.add(m);
      pool.push(m);
    }
    return pool;
  }

  function buildParticles(scene) {
    const MAX = 500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, pos, col, MAX };
  }

  function buildBomb(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.22, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5, metalness: 0.5 }),
    );
    body.position.y = 0.11;
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2211 }),
    );
    light.position.set(0.12, 0.26, 0);
    g.add(body, light);
    g.visible = false;
    scene.add(g);
    return { group: g, light };
  }

  function buildFlashes(scene) {
    const pool = [];
    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.visible = false;
      scene.add(m);
      pool.push(m);
    }
    return pool;
  }

  // ---- per-frame sync (reads state, writes meshes) ----

  function sync(state, dt) {
    const p = state.agents[0];
    const shake = state.shake;
    const shX = shake ? (Math.random() - 0.5) * shake * 0.12 : 0;
    const shY = shake ? (Math.random() - 0.5) * shake * 0.12 : 0;
    camera.position.set(
      p.x + shX,
      p.y + (p.crouch ? 1.15 : 1.55) + shY,
      p.z,
    );
    camera.rotation.set(p.pitch, p.yaw, 0);

    // Viewmodel: recoil kick + reload dip + walk bob.
    const vm = viewmodel;
    const kick = p.recoil * 0.03;
    const bob = p.moving ? Math.sin(state.time * 11) * 0.008 : 0;
    vm.position.z = vm.userData.baseZ + kick;
    vm.position.y = vm.userData.baseY + bob - (p.reloading ? 0.12 : 0);
    vm.rotation.x = kick * 1.2;

    // Agents.
    for (let i = 0; i < state.agents.length; i++) {
      const a = state.agents[i];
      const g = agents[i];
      if (!a || !g) continue;
      if (a.isPlayer || !a.alive) { g.visible = false; continue; }
      g.visible = true;
      g.position.set(a.x, a.y, a.z);
      g.rotation.y = a.yaw;
      const moving = a.moving ? Math.sin(state.time * 10 + i) * 0.35 : 0;
      g.userData.legL.rotation.x = moving;
      g.userData.legR.rotation.x = -moving;
      g.userData.head.visible = true;
      // Crouch: squash the group.
      g.scale.y = a.crouch ? 0.78 : 1;
    }

    // Tracers.
    for (let i = 0; i < tracers.length; i++) {
      const b = state.bullets[i];
      const m = tracers[i];
      if (!b) { m.visible = false; continue; }
      m.visible = true;
      tmpV.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      tmpV2.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      const len = tmpV2.length();
      m.position.copy(tmpV);
      m.scale.set(1, 1, Math.max(0.05, len));
      tmpV2.normalize();
      tmpQ.setFromUnitVectors(Z_AXIS, tmpV2);
      m.quaternion.copy(tmpQ);
      m.material.opacity = Math.min(1, (b.life / b.maxLife) * 1.6);
      m.material.color.setHex(b.team === TEAM_US ? 0xffd27a : 0xff9a7a);
    }

    // Particles.
    const n = Math.min(state.particles.length, points.MAX);
    for (let i = 0; i < n; i++) {
      const pt = state.particles[i];
      points.pos[i * 3] = pt.x; points.pos[i * 3 + 1] = pt.y; points.pos[i * 3 + 2] = pt.z;
      const c = cachedColor(pt.color);
      points.col[i * 3] = c.r; points.col[i * 3 + 1] = c.g; points.col[i * 3 + 2] = c.b;
    }
    points.pts.geometry.setDrawRange(0, n);
    points.pts.geometry.attributes.position.needsUpdate = true;
    points.pts.geometry.attributes.color.needsUpdate = true;

    // Muzzle flashes (first flashes in the list).
    for (let i = 0; i < flashes.length; i++) {
      const f = state.flashes[i];
      const m = flashes[i];
      if (!f) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(f.x, f.y, f.z);
      m.lookAt(camera.position);
      const s = 0.4 + Math.random() * 0.3;
      m.scale.set(s, s, 1);
      m.material.opacity = Math.min(1, f.life / 0.05);
    }

    // Bomb: planted on the ground, blinking; carried = hidden.
    const bombState = state.bomb;
    if (bombState.state === "planted" || bombState.state === "idle") {
      bomb.group.visible = true;
      bomb.group.position.set(bombState.x, 0, bombState.z);
      const blink = Math.sin(state.time * 8) > 0;
      bomb.light.material.color.setHex(blink ? 0xff2211 : 0x551111);
    } else {
      bomb.group.visible = false;
    }
  }
}
