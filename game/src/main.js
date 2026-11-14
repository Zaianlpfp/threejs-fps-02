// Bootstrap and game loop. One job: own the frame — fixed-step the sim,
// render, update the HUD and play sounds for fresh sim events. The sim is
// the only writer of game state; this file only reads it (and the input).
import { createState, PHASE, BOMB, player } from "./state.js";
import { buildRosters, step, DT, buyItem } from "./sim.js";
import { createRenderer } from "./render.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createAudio } from "./audio.js";
import { WEAPONS } from "./weapons.js";
import { MAP } from "./map.js";

const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") || "";
const SEED = Number(params.get("seed") || (DEMO ? 20261115 : (Date.now() % 100000)));

const state = createState(SEED);
buildRosters(state);

const app = document.getElementById("app");
const renderer = createRenderer(state, app);
const hud = createHud();
const audio = createAudio();
const ctx = { buyOpen: false, muted: false };

const input = createInput(state, renderer.renderer.domElement, {
  onBuyToggle() {
    if (state.phase === PHASE.BUY) ctx.buyOpen = !ctx.buyOpen;
  },
  onMute() { ctx.muted = audio.toggleMute(); },
});

let started = false;
let lastPhase = state.phase;
let lastBomb = state.bomb.state;
let lastFeed = 0;
let lastShots = new Map();
let lastHp = 100;
let lastKills = 0;
let stepTimer = 0;
let lastBombSec = -1;

function startMatch() {
  if (started) return;
  started = true;
  audio.unlock();
  input.lock();
  hud.hideStart();
}

function applyDemo() {
  const p = player(state);
  started = true;
  hud.hideStart();
  if (DEMO === "buy") {
    p.money = 2700;
    ctx.buyOpen = true;
    p.x = 3; p.z = 16; p.yaw = -0.2;
  } else if (DEMO === "fight") {
    p.money = 2700;
    buyItem(state, p, "1"); // rifle
    state.phase = PHASE.LIVE;
    state.phaseT = 80;
    p.x = 0; p.z = 7; p.yaw = 0; p.pitch = 0;
    const foes = state.agents.filter((a) => a.team === 1);
    foes[0].money = 3000; buyItem(state, foes[0], "1");
    foes[0].x = 0; foes[0].z = -4; foes[0].yaw = Math.PI;
    foes[1].x = -5; foes[1].z = -3; foes[1].yaw = Math.PI;
    foes[2].x = 7; foes[2].z = -6; foes[2].yaw = Math.PI;
    const friend = state.agents[3];
    friend.x = -2.5; friend.z = 12.5; friend.yaw = 0;
    buyItem(state, foes[0], "1");
  } else if (DEMO === "site") {
    p.money = 3250;
    buyItem(state, p, "1");
    state.phase = PHASE.LIVE;
    state.phaseT = 60;
    state.bomb.state = BOMB.PLANTED;
    state.bomb.site = "B";
    state.bomb.x = 22; state.bomb.z = 8;
    state.bomb.timer = 25;
    state.score = [2, 1];
    p.x = 14; p.z = 2; p.yaw = -0.7; p.pitch = 0;
    const foes = state.agents.filter((a) => a.team === 1);
    foes[0].x = 25; foes[0].z = 4; foes[0].yaw = Math.PI;
    foes[1].x = 16; foes[1].z = 13; foes[1].yaw = Math.PI;
    foes[2].x = 21; foes[2].z = -3; foes[2].yaw = Math.PI;
    const friend = state.agents[2];
    friend.x = 19; friend.z = 5; friend.yaw = -0.6;
  } else if (DEMO === "end") {
    state.score = [4, 4];
    state.round = 9;
    state.matchWinner = 0;
    state.phase = PHASE.MATCH;
    hud.showEnd(state);
  }
}

document.getElementById("playBtn").addEventListener("click", startMatch);
document.getElementById("againBtn").addEventListener("click", () => {
  location.reload();
});

// Fresh-sim-event sounds, polled once a frame.
function pollSounds() {
  const p = player(state);
  for (const a of state.agents) {
    const prev = lastShots.get(a.id) ?? -9;
    if (a.lastShot > prev) {
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      audio.shot(WEAPONS[a.weapon]?.sound ?? "rifle", a.isPlayer ? 0 : d);
    }
    lastShots.set(a.id, a.lastShot);
  }
  if (p.hp < lastHp) audio.hurt();
  lastHp = p.hp;
  if (state.stats.kills > lastKills) { audio.kill(); lastKills = state.stats.kills; }
  if (state.phase !== lastPhase) {
    if (state.phase === PHASE.END) {
      if (state.matchWinner === null) {
        if (state.banner?.cls === "win") audio.roundWin(); else audio.roundLose();
      }
    }
    lastPhase = state.phase;
  }
  if (state.bomb.state !== lastBomb) {
    if (state.bomb.state === BOMB.PLANTED) audio.plant();
    if (state.bomb.state === BOMB.EXPLODED) audio.explosion();
    lastBomb = state.bomb.state;
  }
  if (state.bomb.state === BOMB.PLANTED) {
    const sec = Math.ceil(state.bomb.timer);
    if (sec !== lastBombSec) { lastBombSec = sec; audio.beep(); }
  }
  if (state.feed.length !== lastFeed) lastFeed = state.feed.length;
  // Footsteps for the player.
  if (p.alive && p.moving && p.y <= 0.01) {
    stepTimer -= 1 / 60;
    if (stepTimer <= 0) {
      audio.step(!p.walk && !p.crouch);
      stepTimer = p.crouch || p.walk ? 0.55 : 0.38;
    }
  }
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (started && state.phase !== PHASE.MATCH) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 5) { step(state, DT); acc -= DT; n++; }
    if (n === 5) acc = 0;
    if (state.phase === PHASE.MATCH) hud.showEnd(state);
  }
  pollSounds();
  renderer.render(dt);
  hud.update(state, ctx);
}

if (DEMO) applyDemo();
hud.showStart();
if (DEMO) hud.hideStart();
requestAnimationFrame(frame);

// Test hook: lets a headless driver inspect the live state without touching it.
window.__dustline = { state, version: "1.0.0" };
