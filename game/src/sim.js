// Fixed-step simulation. One job: advance the single state store by dt
// (always 1/60 s from the main loop). Pure math — no THREE, no DOM, no
// network — so the same inputs always produce the same match.
import { MAP, moveCircle, rayWall, losBlocked, pointBlocked } from "./map.js";
import { WEAPONS, GRENADE, BUY_LIST, spreadDeg, damageAt, grenadeDamage } from "./weapons.js";
import { thinkBot, makeBrain } from "./bots.js";
import {
  TEAM_US, TEAM_THEM, PHASE, BOMB,
  WIN_ROUNDS, ROUND_TIME, BUY_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
  createAgent, resetRound, aliveCount, player,
} from "./state.js";
import { chance, range } from "./rng.js";

export const DT = 1 / 60;
const EYE_STAND = 1.55, EYE_CROUCH = 1.15;
const RADIUS = 0.45;
const GRAVITY = 14;

export function eyeY(a) { return a.y + (a.crouch ? EYE_CROUCH : EYE_STAND); }

// Build the 5v5 rosters once (called by main.js on match start).
export function buildRosters(state) {
  state.agents.length = 0;
  for (let i = 0; i < 5; i++) {
    const s = MAP.spawns.us[i];
    const a = createAgent(i, TEAM_US, i === 0, s.x, s.z, s.yaw);
    a.money = 800;
    state.agents.push(a);
  }
  for (let i = 0; i < 5; i++) {
    const s = MAP.spawns.them[i];
    const a = createAgent(5 + i, TEAM_THEM, false, s.x, s.z, s.yaw);
    a.money = 800;
    state.agents.push(a);
  }
  for (const a of state.agents) {
    a.brain = makeBrain(state, a);
    // Bots start with a pistol; they buy during the buy phase.
    a.weapon = "pistol";
    a.owned = { pistol: true };
  }
  resetRound(state, MAP.spawns);
}

// --- Shooting ------------------------------------------------------------

// Ray vs sphere. Returns t or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

export function fireWeapon(state, agent) {
  const w = WEAPONS[agent.weapon];
  if (!w || agent.mag <= 0 || agent.reloading) return;
  if (state.time - agent.lastShot < w.interval) return;
  agent.lastShot = state.time;
  agent.mag--;
  if (agent.isPlayer) state.stats.shots++;

  const rng = state.rng;
  // Random spread azimuth, stored so the shot is reproducible in-sequence.
  const az = rng() * Math.PI * 2;
  const spread = spreadDeg(agent, w) * (Math.PI / 180);
  const err = agent.aimErr || 0;
  const total = spread + err;
  const yaw = agent.yaw + Math.cos(az) * total;
  const pitch = agent.pitch + Math.sin(az) * total + agent.recoil * 0.004;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  const ox = agent.x, oy = eyeY(agent), oz = agent.z;
  const mx = ox - Math.sin(agent.yaw) * 0.4, my = oy - 0.12, mz = oz - Math.cos(agent.yaw) * 0.4;

  const wallT = rayWall(ox, oy, oz, dx, dy, dz, w.range);
  let bestT = Math.min(wallT, w.range);
  let hitAgent = null, headshot = false;
  for (const o of state.agents) {
    if (o === agent || !o.alive || o.team === agent.team) continue;
    const th = raySphere(ox, oy, oz, dx, dy, dz, o.x, o.y + 1.52, o.z, 0.30);
    const tb = raySphere(ox, oy, oz, dx, dy, dz, o.x, o.y + 0.85, o.z, 0.55);
    const t = Math.min(th, tb);
    if (t < bestT) { bestT = t; hitAgent = o; headshot = th <= tb; }
  }
  const hx = ox + dx * bestT, hy = oy + dy * bestT, hz = oz + dz * bestT;
  state.bullets.push({ x0: mx, y0: my, z0: mz, x1: hx, y1: hy, z1: hz, life: 0.09, maxLife: 0.09, team: agent.team });
  state.flashes.push({ x: mx, y: my, z: mz, life: 0.05 });
  agent.spreadBloom = Math.min(3, agent.spreadBloom + w.spreadBloom * 0.14);
  agent.recoil = Math.min(2.5, agent.recoil + w.recoilKick * 0.35);
  if (agent.isPlayer) agent.pitch += w.recoilKick * 0.010;
  state.sounds.push({ x: agent.x, z: agent.z, radius: w.sound === "sniper" ? 34 : 26, team: agent.team, t: state.time, kind: "shot" });

  if (hitAgent) {
    const dmg = damageAt(w, bestT, headshot);
    if (agent.isPlayer) {
      state.stats.hits++; if (headshot) state.stats.headshots++;
      state.hitmark = 0.25; state.hitmarkKill = false;
    }
    damageAgent(state, hitAgent, dmg, agent, w.name, headshot);
    spawnImpact(state, hx, hy, hz, 0xffcc66);
  } else if (wallT < w.range) {
    spawnImpact(state, hx, hy, hz, 0xcccccc);
  }
}

export function spawnImpact(state, x, y, z, color) {
  for (let i = 0; i < 6; i++) {
    const a = state.rng() * Math.PI * 2, s = 1 + state.rng() * 2.5;
    state.particles.push({
      x, y, z, vx: Math.cos(a) * s, vy: 1 + state.rng() * 2, vz: Math.sin(a) * s,
      life: 0.35, maxLife: 0.35, size: 0.05, color,
    });
  }
}

export function damageAgent(state, victim, dmg, attacker, weaponName, headshot) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastHitBy = attacker ? attacker.id : null;
  if (victim.isPlayer) state.dmgFlash = 0.9;
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deaths++;
    if (attacker) {
      attacker.kills++;
      if (attacker.isPlayer) { state.stats.kills++; state.hitmarkKill = true; }
      attacker.money += 300;
    }
    state.feed.unshift({ a: attacker ? attacker.id : -1, b: victim.id, weapon: weaponName, headshot: !!headshot });
    if (state.feed.length > 5) state.feed.pop();
    // Death burst.
    for (let i = 0; i < 14; i++) {
      const a = state.rng() * Math.PI * 2;
      state.particles.push({
        x: victim.x, y: victim.y + 1, z: victim.z,
        vx: Math.cos(a) * (1 + state.rng() * 2), vy: 1 + state.rng() * 3, vz: Math.sin(a) * (1 + state.rng() * 2),
        life: 0.6, maxLife: 0.6, size: 0.08, color: 0xd06a2e,
      });
    }
    // Drop the bomb where the carrier died.
    if (state.bomb.state === BOMB.CARRIED && state.bomb.carrier === victim.id) {
      state.bomb.state = BOMB.IDLE;
      state.bomb.x = victim.x; state.bomb.z = victim.z;
      state.bomb.carrier = null;
    }
  }
}

// --- Grenades ------------------------------------------------------------

function throwGrenade(state, agent) {
  if (agent.grenades <= 0) return;
  agent.grenades--;
  const yaw = agent.yaw, pitch = agent.pitch + 0.35;
  const sp = 13;
  state.grenades.push({
    x: agent.x, y: eyeY(agent) - 0.2, z: agent.z,
    vx: -Math.sin(yaw) * Math.cos(pitch) * sp,
    vy: Math.sin(pitch) * sp + 2,
    vz: -Math.cos(yaw) * Math.cos(pitch) * sp,
    owner: agent.id, team: agent.team, fuse: GRENADE.fuse, bounced: 0,
  });
  state.sounds.push({ x: agent.x, z: agent.z, radius: 10, team: agent.team, t: state.time, kind: "throw" });
}

function explodeGrenade(state, g) {
  state.sounds.push({ x: g.x, z: g.z, radius: 42, team: g.team, t: state.time, kind: "explosion" });
  state.shake = Math.max(state.shake, 0.5);
  for (let i = 0; i < 26; i++) {
    const a = state.rng() * Math.PI * 2, s = 2 + state.rng() * 6;
    state.particles.push({
      x: g.x, y: g.y, z: g.z,
      vx: Math.cos(a) * s, vy: 1 + state.rng() * 5, vz: Math.sin(a) * s,
      life: 0.7, maxLife: 0.7, size: 0.12, color: i % 3 ? 0xffa040 : 0x666666,
    });
  }
  for (const a of state.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - g.x, (a.y + 0.9) - g.y, a.z - g.z);
    if (d > GRENADE.radius) continue;
    const blocked = losBlocked(g.x, g.y, g.z, a.x, a.y + 1, a.z);
    const dmg = grenadeDamage(d, blocked);
    if (dmg > 0) {
      const owner = state.agents.find((x) => x.id === g.owner);
      damageAgent(state, a, dmg, owner, "FRAG CHARGE", false);
    }
  }
}

// --- Buying --------------------------------------------------------------

export function buyItem(state, agent, key) {
  const item = BUY_LIST.find((b) => b.key === key);
  if (!item) return false;
  if (item.kind === "weapon") {
    const w = WEAPONS[item.id];
    if (agent.weapon === item.id) return false;
    if (agent.money < w.price) return false;
    agent.money -= w.price;
    agent.weapon = item.id;
    agent.owned = agent.owned || { pistol: true };
    agent.owned[item.id] = true;
    agent.mag = w.mag; agent.reserve = w.reserve;
    agent.reloading = false;
    return true;
  }
  if (agent.money < GRENADE.price || agent.grenades >= 2) return false;
  agent.money -= GRENADE.price;
  agent.grenades++;
  return true;
}

// Bots spend their money at the start of each buy phase.
function botBuy(state, agent) {
  const rng = state.rng;
  const w = WEAPONS[agent.weapon];
  if (agent.money >= 4750 && chance(rng, 0.2)) buyItem(state, agent, "3");
  else if (agent.money >= 2700) buyItem(state, agent, "1");
  else if (agent.money >= 1500 && w.price < 1500) buyItem(state, agent, "2");
  if (agent.money >= 300 && chance(rng, 0.5)) buyItem(state, agent, "5");
}

// --- Round flow ----------------------------------------------------------

function endRound(state, winner, reason) {
  if (state.phase === PHASE.END || state.phase === PHASE.MATCH) return;
  state.score[winner]++;
  const p = player(state);
  for (const a of state.agents) {
    if (a.team === winner) a.money += 3250;
    else a.money += 1900;
  }
  const win = winner === TEAM_US;
  state.banner = {
    title: win ? "ROUND WON" : "ROUND LOST",
    sub: reason,
    cls: win ? "win" : "lose",
    until: state.time + 4,
  };
  state.events.push({ kind: "round", text: reason, t: state.time });
  state.phase = PHASE.END;
  state.phaseT = 4;
  if (state.score[winner] >= WIN_ROUNDS) {
    state.matchWinner = winner;
  }
}

function startNextRound(state) {
  if (state.matchWinner !== null) {
    state.phase = PHASE.MATCH;
    return;
  }
  state.round++;
  // The bomb carrier rotates among attackers.
  const attackers = state.agents.filter((a) => a.team === TEAM_US);
  const carrier = attackers[(state.round - 1) % attackers.length];
  resetRound(state, MAP.spawns);
  state.bomb.carrier = carrier.id;
  state.bomb.state = BOMB.CARRIED;
  // Bots buy; the player keeps their loadout unless they rebuy.
  for (const a of state.agents) if (!a.isPlayer) botBuy(state, a);
  // Attackers re-pick a site each round.
  for (const a of state.agents) {
    if (a.brain) {
      a.brain.site = chance(state.rng, 0.5) ? "A" : "B";
      a.brain.target = null; a.brain.mode = "route"; a.brain.route = [];
    }
  }
  state.events.push({ kind: "round", text: `Round ${state.round} — plant at A or B`, t: state.time });
}

function checkRoundEnd(state) {
  const us = aliveCount(state, TEAM_US);
  const them = aliveCount(state, TEAM_THEM);
  const bomb = state.bomb;
  if (bomb.state === BOMB.PLANTED) {
    if (us === 0) {
      // Defenders still have to defuse; the round only ends on the timer.
      return;
    }
    if (them === 0) {
      // No defenders left to defuse: the bomb still has to go off.
      return;
    }
    return;
  }
  if (us === 0) return endRound(state, TEAM_THEM, "Vanguard eliminated");
  if (them === 0) return endRound(state, TEAM_US, "Sentinel eliminated");
}

// --- Per-agent step ------------------------------------------------------

function stepAgent(state, agent, dt) {
  if (!agent.alive) return;
  const inp = state.input;
  if (agent.isPlayer) {
    // Wish direction from keys, relative to the player's yaw.
    const f = inp.fwd, s = inp.strafe;
    const sy = Math.sin(agent.yaw), cy = Math.cos(agent.yaw);
    agent.wx = -sy * f + cy * s;
    agent.wz = -cy * f - sy * s;
    agent.fire = inp.fire;
    agent.use = inp.use;
    agent.crouch = inp.crouch;
    agent.walk = inp.walk;
    agent.reload = inp.reload;
    inp.reload = false;
    if (inp.jump && agent.y <= 0.01) { agent.vy = 5.4; agent.y = 0.02; }
    if (inp.grenade) { throwGrenade(state, agent); inp.grenade = false; }
    if (inp.slot >= 1 && inp.slot <= 4) {
      const id = ["pistol", "rifle", "smg", "sniper"][inp.slot - 1];
      if (agent.weapon !== id && agent.owned && agent.owned[id]) {
        agent.weapon = id;
        agent.mag = WEAPONS[id].mag; agent.reserve = WEAPONS[id].reserve;
        agent.reloading = false;
      }
      inp.slot = 0;
    }
  } else {
    thinkBot(state, agent, dt);
    if (agent.reload) { agent.reload = false; startReload(state, agent); }
    if (agent.grenadeThrow) { agent.grenadeThrow = false; throwGrenade(state, agent); }
  }

  // Movement: acceleration toward the wish velocity, friction otherwise.
  const speed = agent.crouch ? 2.0 : agent.walk ? 2.2 : 4.3;
  const wx = agent.wx || 0, wz = agent.wz || 0;
  const wl = Math.hypot(wx, wz) || 1;
  const tx = (wx / wl) * speed * (Math.hypot(wx, wz) > 0.1 ? 1 : 0);
  const tz = (wz / wl) * speed * (Math.hypot(wx, wz) > 0.1 ? 1 : 0);
  const accel = agent.y > 0.01 ? 14 : 42;
  agent.vx += clamp(tx - agent.vx, -accel * dt, accel * dt);
  agent.vz += clamp(tz - agent.vz, -accel * dt, accel * dt);
  agent.moving = Math.hypot(agent.vx, agent.vz) > 0.4;
  const moved = moveCircle(agent.x, agent.z, RADIUS, agent.vx * dt, agent.vz * dt);
  agent.x = moved.x; agent.z = moved.z;
  // Keep inside the map bounds.
  agent.x = clamp(agent.x, MAP.bounds.x0 + RADIUS, MAP.bounds.x1 - RADIUS);
  agent.z = clamp(agent.z, MAP.bounds.z0 + RADIUS, MAP.bounds.z1 - RADIUS);

  // Vertical: jump / fall.
  if (agent.y > 0 || agent.vy !== 0) {
    agent.vy -= GRAVITY * dt;
    agent.y += agent.vy * dt;
    if (agent.y <= 0) { agent.y = 0; agent.vy = 0; }
  }

  // Reload.
  if (agent.reloading && state.time >= agent.reloadEnd) {
    const w = WEAPONS[agent.weapon];
    const need = w.mag - agent.mag;
    const take = Math.min(need, agent.reserve);
    agent.mag += take; agent.reserve -= take;
    agent.reloading = false;
  }
  if (agent.reload) {
    agent.reload = false;
    startReload(state, agent);
  }

  // Firing: auto weapons fire while held; semi-auto fires once per queued
  // press edge, so a fast click is never lost between slow frames.
  const w = WEAPONS[agent.weapon];
  const pressed = agent.isPlayer && (inp.fireEdge || 0) > 0;
  if (pressed) inp.fireEdge--;
  if (agent.fire || pressed) {
    if (!w.auto && agent.isPlayer) {
      if (pressed) fireWeapon(state, agent);
    } else {
      fireWeapon(state, agent);
    }
  }
  // Decay bloom and recoil.
  agent.spreadBloom = Math.max(0, agent.spreadBloom - 3 * dt);
  agent.recoil = Math.max(0, agent.recoil - 4 * dt);

  // Pick up a dropped bomb by walking over it.
  if (agent.team === TEAM_US && state.bomb.state === BOMB.IDLE) {
    if (Math.hypot(state.bomb.x - agent.x, state.bomb.z - agent.z) < 1.0) {
      state.bomb.state = BOMB.CARRIED;
      state.bomb.carrier = agent.id;
      state.events.push({ kind: "bomb", text: agent.isPlayer ? "You picked up the charge" : "Charge recovered", t: state.time });
    }
  }

  // Plant / defuse progress.
  stepAction(state, agent, dt);
}

function startReload(state, agent) {
  const w = WEAPONS[agent.weapon];
  if (agent.reloading || agent.mag >= w.mag || agent.reserve <= 0) return;
  agent.reloading = true;
  agent.reloadEnd = state.time + w.reload;
}

function stepAction(state, agent, dt) {
  const bomb = state.bomb;
  const site = bomb.site ? MAP.sites.find((s) => s.id === bomb.site) : null;
  const inSite = (s) => s && Math.hypot(s.x - agent.x, s.z - agent.z) < s.r;
  const wantPlant = agent.use && agent.team === TEAM_US && bomb.state === BOMB.CARRIED
    && bomb.carrier === agent.id && MAP.sites.some(inSite);
  const wantDefuse = agent.use && agent.team === TEAM_THEM && bomb.state === BOMB.PLANTED
    && site && Math.hypot(site.x - agent.x, site.z - agent.z) < 1.4;

  if (wantPlant) {
    if (!agent.action || agent.action.kind !== "plant") agent.action = { kind: "plant", t: 0 };
    agent.action.t += dt;
    if (agent.isPlayer) state.plantProgress = agent.action.t / PLANT_TIME;
    if (agent.action.t >= PLANT_TIME) {
      const s = MAP.sites.find(inSite);
      bomb.state = BOMB.PLANTED;
      bomb.site = s.id; bomb.x = s.x; bomb.z = s.z;
      bomb.timer = BOMB_TIME; bomb.carrier = null;
      agent.money += 300;
      agent.action = null;
      state.plantProgress = 0;
      state.events.push({ kind: "bomb", text: `Charge planted at Site ${s.id} — ${BOMB_TIME}s to detonation`, t: state.time });
      state.sounds.push({ x: s.x, z: s.z, radius: 50, team: agent.team, t: state.time, kind: "plant" });
    }
  } else if (wantDefuse) {
    if (!agent.action || agent.action.kind !== "defuse") agent.action = { kind: "defuse", t: 0 };
    agent.action.t += dt;
    if (agent.action.t >= DEFUSE_TIME) {
      bomb.state = BOMB.IDLE;
      agent.action = null;
      agent.money += 300;
      endRound(state, TEAM_THEM, "Charge defused");
    }
  } else {
    if (agent.action) { agent.action = null; if (agent.isPlayer) state.plantProgress = 0; }
  }
}

// --- Main step -----------------------------------------------------------

export function step(state, dt) {
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 1.5);
  state.hitmark = Math.max(0, state.hitmark - dt);
  state.dmgFlash = Math.max(0, state.dmgFlash - dt * 2);
  // Trim old sounds and finished fx.
  state.sounds = state.sounds.filter((s) => state.time - s.t < 0.6);
  state.bullets = state.bullets.filter((b) => (b.life -= dt) > 0);
  state.flashes = state.flashes.filter((f) => (f.life -= dt) > 0);
  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 6 * dt;
    if (p.y < 0.02) { p.y = 0.02; p.vy = 0; }
  }
  state.particles = state.particles.filter((p) => p.life > 0);

  // Buy input (only during the buy phase; stale keys never carry over).
  if (state.phase === PHASE.BUY && state.input.buyKey) {
    buyItem(state, player(state), state.input.buyKey);
    state.input.buyKey = null;
  } else if (state.phase !== PHASE.BUY) {
    state.input.buyKey = null;
  }

  // Phase timers.
  if (state.phase === PHASE.BUY) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseT = ROUND_TIME;
      state.events.push({ kind: "round", text: `Round ${state.round} — go`, t: state.time });
    }
  } else if (state.phase === PHASE.LIVE) {
    state.phaseT -= dt;
    if (state.bomb.state === BOMB.PLANTED) {
      state.bomb.timer -= dt;
      if (state.bomb.timer <= 0) {
        state.bomb.state = BOMB.EXPLODED;
        explodeBomb(state);
        endRound(state, TEAM_US, "Charge detonated");
      }
    }
    if (state.phaseT <= 0 && state.phase === PHASE.LIVE) {
      if (state.bomb.state !== BOMB.PLANTED) endRound(state, TEAM_THEM, "Time expired — charge never planted");
    }
  } else if (state.phase === PHASE.END) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) startNextRound(state);
  }

  if (state.phase === PHASE.LIVE) {
    for (const a of state.agents) stepAgent(state, a, dt);
  }

  // Grenade physics.
  for (const g of state.grenades) {
    g.fuse -= dt;
    g.vy -= GRAVITY * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    if (ny < 0.06) { ny = 0.06; g.vy = Math.abs(g.vy) * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounced++; }
    if (pointBlocked(nx, nz, 0.12)) {
      if (pointBlocked(g.x + g.vx * dt, g.z, 0.12)) g.vx *= -0.45;
      if (pointBlocked(g.x, g.z + g.vz * dt, 0.12)) g.vz *= -0.45;
      nx = g.x; nz = g.z; g.bounced++;
    }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.fuse <= 0) explodeGrenade(state, g);
  }
  state.grenades = state.grenades.filter((g) => g.fuse > 0);

  if (state.phase === PHASE.LIVE) checkRoundEnd(state);
  if (state.banner && state.time > state.banner.until) state.banner = null;
}

function explodeBomb(state) {
  const s = MAP.sites.find((x) => x.id === state.bomb.site);
  if (!s) return;
  state.shake = 1;
  for (let i = 0; i < 40; i++) {
    const a = state.rng() * Math.PI * 2, sp = 3 + state.rng() * 8;
    state.particles.push({
      x: s.x, y: 0.5, z: s.z,
      vx: Math.cos(a) * sp, vy: 2 + state.rng() * 7, vz: Math.sin(a) * sp,
      life: 1, maxLife: 1, size: 0.2, color: i % 2 ? 0xff7722 : 0x333333,
    });
  }
  for (const a of state.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - s.x, a.z - s.z);
    if (d < 9) damageAgent(state, a, 200, null, "CHARGE", false);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
