// Weapon definitions and gunplay math. One job: what each gun is and how a
// shot behaves. All numbers are tuned so stopping to aim pays: spread and
// recoil grow with movement speed and sustained fire.
export const WEAPONS = {
  pistol: {
    id: "pistol", name: "P9 SIDEWINDER", slot: 1, price: 0,
    damage: 26, headMult: 2.5, mag: 12, reserve: 48,
    interval: 0.16, auto: false, reload: 1.1,
    spreadBase: 0.55, spreadMove: 1.6, spreadAir: 2.2, spreadBloom: 0.35,
    recoilKick: 0.35, range: 60, tracer: 0xffe08a,
    sound: "pistol",
  },
  rifle: {
    id: "rifle", name: "VK-9 JACKAL", slot: 2, price: 2700,
    damage: 34, headMult: 3.0, mag: 25, reserve: 75,
    interval: 0.105, auto: true, reload: 2.1,
    spreadBase: 0.45, spreadMove: 2.4, spreadAir: 3.0, spreadBloom: 0.55,
    recoilKick: 0.7, range: 90, tracer: 0xffd27a,
    sound: "rifle",
  },
  smg: {
    id: "smg", name: "K-7 HORNET", slot: 3, price: 1500,
    damage: 22, headMult: 2.5, mag: 32, reserve: 96,
    interval: 0.068, auto: true, reload: 1.7,
    spreadBase: 0.9, spreadMove: 2.0, spreadAir: 2.6, spreadBloom: 0.5,
    recoilKick: 0.45, range: 45, tracer: 0xffe08a,
    sound: "smg",
  },
  sniper: {
    id: "sniper", name: "LONGSHOT DMR", slot: 4, price: 4750,
    damage: 78, headMult: 2.0, mag: 5, reserve: 15,
    interval: 0.95, auto: false, reload: 2.8,
    spreadBase: 0.08, spreadMove: 4.5, spreadAir: 6.0, spreadBloom: 1.4,
    recoilKick: 2.2, range: 120, tracer: 0xbfe8ff,
    sound: "sniper",
  },
};

export const GRENADE = {
  id: "grenade", name: "FRAG CHARGE", price: 300,
  fuse: 1.6, radius: 6.5, maxDamage: 110, minDamage: 18,
};

// Buy list shown in the buy menu, in key order.
export const BUY_LIST = [
  { key: "1", kind: "weapon", id: "rifle" },
  { key: "2", kind: "weapon", id: "smg" },
  { key: "3", kind: "weapon", id: "sniper" },
  { key: "4", kind: "weapon", id: "pistol" },
  { key: "5", kind: "grenade", id: "grenade" },
];

// Current spread in degrees for an agent holding weapon w.
export function spreadDeg(agent, w) {
  const speed = Math.hypot(agent.vx, agent.vz);
  const move = agent.crouch ? 0.35 : speed > 0.5 ? 1 : 0;
  const air = agent.y > 0.05 ? 1 : 0;
  let s = w.spreadBase + w.spreadMove * move + w.spreadAir * air + agent.spreadBloom;
  if (agent.walking) s *= 0.6; // slow-walk steadies the aim
  if (agent.crouch) s *= 0.75;
  return s;
}

// Damage falloff with distance: full to 60% of range, then down to 55%.
export function damageAt(w, dist, headshot) {
  const t = Math.min(1, Math.max(0, (dist - w.range * 0.6) / (w.range * 0.4)));
  let d = w.damage * (1 - 0.45 * t);
  if (headshot) d *= w.headMult;
  return d;
}

// Grenade damage at distance d from the blast, blocked halves it.
export function grenadeDamage(d, blocked) {
  if (d > GRENADE.radius) return 0;
  const f = 1 - d / GRENADE.radius;
  let dmg = GRENADE.minDamage + (GRENADE.maxDamage - GRENADE.minDamage) * f * f;
  if (blocked) dmg *= 0.45;
  return dmg;
}
