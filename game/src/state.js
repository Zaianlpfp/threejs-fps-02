// Single state store. Every mutable fact of a match lives here; the sim
// mutates it on a fixed step and the renderer only reads it. No THREE here.
import { makeRng } from "./rng.js";

export const TEAM_US = 0; // Vanguard (attackers, the player)
export const TEAM_THEM = 1; // Sentinel (defenders, bots)

export const PHASE = { BUY: "buy", LIVE: "live", END: "end", MATCH: "match" };
export const BOMB = { IDLE: "idle", CARRIED: "carried", PLANTED: "planted", EXPLODED: "exploded" };

export const WIN_ROUNDS = 5;
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;

export function createAgent(id, team, isPlayer, x, z, yaw) {
  return {
    id, team, isPlayer,
    x, z, y: 0, // feet position; eye at y + eyeH
    yaw, pitch: 0,
    vx: 0, vz: 0, vy: 0,
    hp: 100, alive: true,
    crouch: false, moving: false, walking: false,
    weapon: "pistol", // weapon id
    mag: 12, reserve: 36,
    grenades: 0,
    money: 0,
    kills: 0, deaths: 0,
    // firing
    lastShot: -9, reloadEnd: -1, reloading: false,
    spreadBloom: 0, recoil: 0,
    // bot brain (unused for the player)
    brain: null,
    // plant/defuse progress
    action: null, // { kind: 'plant'|'defuse', t: seconds accumulated }
    // last damage source for killfeed
    lastHitBy: null,
    // cosmetic: spawn-safe timer so bots do not instantly die
    spawnProt: 0,
  };
}

export function createState(seed = 1337) {
  const rng = makeRng(seed);
  return {
    seed,
    rng,
    time: 0, // match clock (sim seconds)
    phase: PHASE.BUY,
    phaseT: BUY_TIME, // seconds left in this phase
    round: 1,
    score: [0, 0],
    bomb: { state: BOMB.CARRIED, carrier: 0, site: null, x: 0, z: 0, timer: BOMB_TIME, plantT: 0, defuseT: 0, defuser: null },
    agents: [],
    bullets: [], // tracers: {x0,y0,z0,x1,y1,z1,life,maxLife,team}
    grenades: [], // {x,y,z,vx,vy,vz,owner,team,fuse, bounced}
    particles: [], // {x,y,z,vx,vy,vz,life,maxLife,size,color}
    flashes: [], // muzzle flashes: {x,y,z,life}
    sounds: [], // sound events for bots to hear: {x,z,radius,kind,heardBy:Set}
    feed: [], // killfeed entries {a,b,weapon,headshot}
    events: [], // UI events: {kind, text, t}
    banner: null, // {title, sub, cls, until}
    matchWinner: null,
    stats: { shots: 0, hits: 0, headshots: 0, kills: 0 },
    // per-frame input snapshot, written by input.js, read by sim
    input: {
      fwd: 0, strafe: 0, jump: false, crouch: false, walk: false,
      fire: false, reload: false, use: false, grenade: false,
      slot: 0, buyToggle: false,
    },
    // camera shake / feedback, written by sim, read by render
    shake: 0,
    hitmark: 0, hitmarkKill: false,
    dmgFlash: 0,
  };
}

// Reset all agents for a fresh round. Spawns come from the map module.
export function resetRound(state, spawns) {
  state.phase = PHASE.BUY;
  state.phaseT = BUY_TIME;
  state.bomb = { state: BOMB.CARRIED, carrier: 0, site: null, x: 0, z: 0, timer: BOMB_TIME, plantT: 0, defuseT: 0, defuser: null };
  state.bullets.length = 0;
  state.grenades.length = 0;
  state.particles.length = 0;
  state.flashes.length = 0;
  state.sounds.length = 0;
  for (const a of state.agents) {
    const list = spawns[a.team === 0 ? "us" : "them"];
    const s = list[a.id % list.length];
    a.x = s.x; a.z = s.z; a.y = 0; a.yaw = s.yaw; a.pitch = 0;
    a.vx = 0; a.vz = 0; a.vy = 0;
    a.hp = 100; a.alive = true;
    a.crouch = false; a.moving = false;
    a.lastShot = -9; a.reloadEnd = -1; a.reloading = false;
    a.spreadBloom = 0; a.recoil = 0;
    a.action = null; a.lastHitBy = null;
    a.spawnProt = 0.5;
    if (a.isPlayer) a.money = a.money; // money persists across rounds
  }
}

export function aliveCount(state, team) {
  let n = 0;
  for (const a of state.agents) if (a.team === team && a.alive) n++;
  return n;
}

export function player(state) { return state.agents[0]; }
