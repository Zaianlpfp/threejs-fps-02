// Bot AI. One job: decide what each bot wants to do this step. Bots write
// their intent into agent fields (wx/wz wish direction, yaw/pitch, fire,
// use, crouch); the sim executes movement and shooting for players and bots
// alike, so a bot can never cheat the gunplay rules.
import { MAP, nearestNode, findPath, losBlocked, pointBlocked } from "./map.js";
import { range, pick, chance } from "./rng.js";
import { TEAM_US, TEAM_THEM } from "./state.js";

const EYE = 1.55;
const REACT_MIN = 0.28, REACT_MAX = 0.55;

export function makeBrain(state, agent) {
  const rng = state.rng;
  const isAttack = agent.team === TEAM_US;
  const brain = {
    role: isAttack ? "attack" : "defend",
    site: chance(rng, 0.5) ? "A" : "B",
    route: [], routeI: 0,
    mode: "route",
    holdNode: -1, holdUntil: 0,
    target: null, firstSeen: -1, lastSeenT: -9, lastSeenX: 0, lastSeenZ: 0,
    burstLeft: 0, burstPauseUntil: 0,
    strafeDir: 1, strafeUntil: 0,
    scanDir: 1, scanYaw: agent.yaw,
    thinkAt: 0,
    followPlayer: false,
    planted: false,
  };
  if (!isAttack) {
    // Defenders split: 2 on A, 2 on B, 1 mid.
    const idx = agent.id - 5; // defender ids 5..9
    brain.site = idx < 2 ? "A" : idx < 4 ? "B" : "MID";
    brain.holdNode = MAP.holds[brain.site === "MID" ? "MID" : brain.site];
  } else if (agent.id === 4) {
    brain.followPlayer = true; // one friendly sticks near the player
  }
  return brain;
}

// Assign a fresh route to a site (attackers) or a hold node (defenders).
function planRoute(state, agent) {
  const b = agent.brain;
  const from = nearestNode(agent.x, agent.z);
  if (b.role === "attack") {
    const site = MAP.sites.find((s) => s.id === b.site);
    const goal = nearestNode(site.x, site.z);
    b.route = findPath(from, goal);
  } else {
    b.route = findPath(from, b.holdNode);
  }
  b.routeI = 0;
  b.mode = "route";
}

// Can `a` see `t`? Distance, field of view and a clear line of sight.
function canSee(a, t) {
  if (!t.alive) return false;
  const dx = t.x - a.x, dz = t.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > 55) return false;
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const dot = (dx * fx + dz * fz) / (d || 1);
  if (dot < 0.25 && d > 6) return false; // outside ~75° cone (point blank always seen)
  const eyeY = EYE - (a.crouch ? 0.35 : 0);
  return !losBlocked(a.x, eyeY, a.z, t.x, EYE - (t.crouch ? 0.35 : 0), t.z);
}

function nearestEnemy(state, agent) {
  let best = null, bd = Infinity;
  for (const o of state.agents) {
    if (o.team === agent.team || !o.alive) continue;
    const d = Math.hypot(o.x - agent.x, o.z - agent.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function visibleEnemy(state, agent) {
  let best = null, bd = Infinity;
  for (const o of state.agents) {
    if (o.team === agent.team || !o.alive) continue;
    if (!canSee(agent, o)) continue;
    const d = Math.hypot(o.x - agent.x, o.z - agent.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Yaw that faces (tx,tz) from the agent. Yaw 0 faces -z (north).
function yawTo(ax, az, tx, tz) {
  return Math.atan2(-(tx - ax), -(tz - az));
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export function thinkBot(state, agent, dt) {
  const b = agent.brain;
  const rng = state.rng;
  const now = state.time;
  agent.wx = 0; agent.wz = 0; agent.fire = false; agent.use = false;
  if (!agent.alive) return;

  // --- Hearing: a loud sound nearby pulls the bot to investigate. ---
  for (const s of state.sounds) {
    if (s.team === agent.team) continue;
    const d = Math.hypot(s.x - agent.x, s.z - agent.z);
    if (d < s.radius && b.mode !== "engage" && b.mode !== "plant" && b.mode !== "defuse") {
      if (chance(rng, 0.6)) {
        b.mode = "investigate";
        b.invX = s.x; b.invZ = s.z;
        b.invUntil = now + 6;
      }
    }
  }

  // --- Seeing: pick the nearest visible enemy. ---
  const seen = visibleEnemy(state, agent);
  if (seen) {
    if (b.target !== seen.id) { b.target = seen.id; b.firstSeen = now + range(rng, REACT_MIN, REACT_MAX); }
    b.lastSeenT = now; b.lastSeenX = seen.x; b.lastSeenZ = seen.z;
    b.mode = "engage";
  } else if (b.target !== null && now - b.lastSeenT > 1.2) {
    b.target = null;
    if (b.mode === "engage") { b.mode = "route"; planRoute(state, agent); }
  }

  // --- Bomb logic overrides routing. ---
  const bomb = state.bomb;
  if (agent.team === TEAM_US && bomb.state === "carried" && bomb.carrier === agent.id) {
    const site = MAP.sites.find((s) => s.id === b.site);
    if (Math.hypot(site.x - agent.x, site.z - agent.z) < site.r - 0.5 && !seen) {
      b.mode = "plant"; agent.use = true;
    }
  }
  if (agent.team === TEAM_THEM && bomb.state === "planted" && !seen) {
    const site = MAP.sites.find((s) => s.id === bomb.site);
    if (Math.hypot(site.x - agent.x, site.z - agent.z) < 1.2) {
      b.mode = "defuse"; agent.use = true;
    } else if (b.mode !== "engage") {
      b.mode = "route";
      b.route = findPath(nearestNode(agent.x, agent.z), nearestNode(site.x, site.z));
      b.routeI = 0;
    }
  }

  // --- Act on the mode. ---
  if (b.mode === "engage" && b.target !== null) {
    const t = state.agents.find((a) => a.id === b.target);
    if (t && t.alive) {
      const dx = t.x - agent.x, dz = t.z - agent.z;
      const d = Math.hypot(dx, dz);
      const wantYaw = yawTo(agent.x, agent.z, t.x, t.z);
      agent.yaw = angleLerp(agent.yaw, wantYaw, Math.min(1, dt * 10));
      const targetY = (t.crouch ? 1.15 : 1.45) - 0; // aim chest/head
      agent.pitch = angleLerp(agent.pitch, Math.atan2(targetY - EYE, d) * 0.9, Math.min(1, dt * 8));
      // Strafe sideways while fighting; never walk into a wall.
      if (now > b.strafeUntil) {
        b.strafeDir = chance(rng, 0.5) ? 1 : -1;
        b.strafeUntil = now + range(rng, 0.5, 1.4);
      }
      const sx = Math.cos(agent.yaw) * b.strafeDir, sz = -Math.sin(agent.yaw) * b.strafeDir;
      const nx = agent.x + sx * 0.6, nz = agent.z + sz * 0.6;
      if (!pointBlocked(nx, nz, 0.5)) { agent.wx = sx * 0.55; agent.wz = sz * 0.55; }
      agent.crouch = d > 18 && chance(rng, 0.3);
      // Fire in bursts once the reaction time has passed.
      if (now >= b.firstSeen && now >= b.burstPauseUntil && agent.mag > 0 && !agent.reloading) {
        if (b.burstLeft <= 0) b.burstLeft = 3 + Math.floor(rng() * 4);
        // Aim error grows with distance and target speed — bots miss too.
        const tSpeed = Math.hypot(t.vx, t.vz);
        const err = (1.1 + d * 0.045 + tSpeed * 0.5) * (Math.PI / 180);
        agent.aimErr = err;
        agent.fire = true;
        b.burstLeft--;
        if (b.burstLeft <= 0) b.burstPauseUntil = now + range(rng, 0.45, 0.9);
      }
      if (agent.mag === 0 && !agent.reloading) agent.reload = true;
      // Lob a grenade at a distant, entrenched target now and then.
      if (agent.grenades > 0 && d > 12 && now > (b.grenadeAt || 0)) {
        b.grenadeAt = now + range(rng, 14, 26);
        agent.grenadeThrow = true;
      }
      return;
    }
  }

  agent.aimErr = 0;
  agent.crouch = false;

  if (b.mode === "plant" || b.mode === "defuse") {
    // Stand still and hold E; the sim advances the action.
    return;
  }

  if (b.mode === "investigate") {
    if (now > b.invUntil) { b.mode = "route"; planRoute(state, agent); return; }
    walkTo(state, agent, b.invX, b.invZ, dt, 3.4);
    if (Math.hypot(b.invX - agent.x, b.invZ - agent.z) < 1.2) {
      b.mode = "route"; planRoute(state, agent);
    }
    return;
  }

  // Route / hold.
  if (b.mode === "route") {
    if (b.route.length === 0) planRoute(state, agent);
    if (b.followPlayer) {
      const p = state.agents[0];
      walkTo(state, agent, p.x + Math.sin(p.yaw) * 2, p.z + Math.cos(p.yaw) * 2, dt, 3.8);
      agent.yaw = angleLerp(agent.yaw, p.yaw, Math.min(1, dt * 4));
      return;
    }
    const node = MAP.nodes[b.route[Math.min(b.routeI, b.route.length - 1)]];
    if (node) {
      walkTo(state, agent, node.x, node.z, dt, 3.6);
      if (Math.hypot(node.x - agent.x, node.z - agent.z) < 1.0) {
        b.routeI++;
        if (b.routeI >= b.route.length) {
          if (b.role === "defend") {
            b.mode = "hold"; b.holdUntil = now + range(rng, 6, 14);
            b.scanYaw = agent.yaw;
          } else {
            // Attacker reached the site: hold a moment, then re-pick.
            b.mode = "hold"; b.holdUntil = now + range(rng, 2, 4);
          }
        }
      }
    }
    return;
  }

  if (b.mode === "hold") {
    // Scan the area with a slow yaw sweep; crouch sometimes.
    b.scanYaw += b.scanDir * dt * 0.5;
    if (Math.abs(b.scanYaw - agent.yaw) > 1.1) b.scanDir *= -1;
    agent.yaw = angleLerp(agent.yaw, b.scanYaw, Math.min(1, dt * 3));
    agent.crouch = chance(rng, 0.02);
    if (now > b.holdUntil) {
      if (b.role === "defend") {
        // Rotate to another hold spot sometimes.
        const spots = ["A", "B", "MID"];
        const next = pick(rng, spots);
        b.holdNode = MAP.holds[next];
        b.site = next;
      } else {
        b.site = b.site === "A" ? "B" : "A";
      }
      planRoute(state, agent);
    }
  }
}

// Walk toward (tx,tz) at `speed`, facing the walk direction.
function walkTo(state, agent, tx, tz, dt, speed) {
  const dx = tx - agent.x, dz = tz - agent.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return;
  agent.wx = (dx / d) * 0.9;
  agent.wz = (dz / d) * 0.9;
  agent.yaw = angleLerp(agent.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 6));
}
