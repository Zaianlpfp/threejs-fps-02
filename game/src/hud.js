// HUD. One job: mirror the state store into the DOM. It never mutates game
// state; it only reads it and writes text, widths and classes.
import { WEAPONS, BUY_LIST, GRENADE } from "./weapons.js";
import { TEAM_US, TEAM_THEM, PHASE, BOMB } from "./state.js";
import { MAP } from "./map.js";

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    timer: $("timer"), scoreUs: $("scoreUs"), scoreThem: $("scoreThem"),
    roundLabel: $("roundLabel"), objective: $("objective"), compass: $("compass"),
    money: $("moneyBox"), pipsUs: $("pipsUs"), pipsThem: $("pipsThem"),
    feed: $("feed"), healthNum: $("healthNum"), healthFill: $("healthFill"),
    ammoNum: $("ammoNum"), weaponName: $("weaponName"), reloadHint: $("reloadHint"),
    banner: $("banner"), plantBar: $("plantBar"), hint: $("hint"),
    buy: $("buy"), buyTable: $("buyTable"), buyMoney: $("buyMoney"),
    xhair: $("xhair"), hitmark: $("hitmark"), dmg: $("dmg"),
    start: $("startScreen"), end: $("endScreen"),
    endTitle: $("endTitle"), endSub: $("endSub"), endStats: $("endStats"),
  };
  let lastFeedLen = 0;
  let lastBanner = null;

  function fmtTime(t) {
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderBuy(state) {
    const p = state.agents[0];
    el.buyMoney.textContent = `$${p.money}`;
    let html = "";
    for (const item of BUY_LIST) {
      const isW = item.kind === "weapon";
      const w = isW ? WEAPONS[item.id] : null;
      const name = isW ? w.name : `${GRENADE.name} ×1`;
      const price = isW ? w.price : GRENADE.price;
      const owned = isW ? p.owned?.[item.id] : p.grenades >= 2;
      const afford = p.money >= price;
      const cls = owned ? "owned" : afford ? "" : "cant";
      const note = isW
        ? `${w.damage} dmg · ${w.mag} mag · ${w.auto ? "auto" : "semi"}`
        : `throwable · ${GRENADE.maxDamage} max dmg`;
      html += `<tr class="${cls}"><td class="key">${item.key}</td><td>${name}<br><small style="color:#9fb3ad">${note}</small></td><td class="price">${owned ? "OWNED" : "$" + price}</td></tr>`;
    }
    el.buyTable.innerHTML = html;
  }

  return {
    showStart() { el.start.classList.remove("hidden"); el.end.classList.add("hidden"); },
    hideStart() { el.start.classList.add("hidden"); },
    showEnd(state) {
      const win = state.matchWinner === TEAM_US;
      el.endTitle.textContent = win ? "VICTORY" : "DEFEAT";
      el.endTitle.style.color = win ? "#7ee2c8" : "#ff6a4d";
      el.endSub.textContent = win ? "VANGUARD TAKES YARD 7" : "SENTINEL HOLDS YARD 7";
      const s = state.stats;
      const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
      el.endStats.textContent =
        `Final score ${state.score[0]}–${state.score[1]} · ${s.kills} kills · ${acc}% accuracy ` +
        `(${s.hits}/${s.shots} hits, ${s.headshots} headshots)`;
      el.end.classList.remove("hidden");
    },
    hideEnd() { el.end.classList.add("hidden"); },

    update(state, ctx) {
      const p = state.agents[0];
      const w = WEAPONS[p.weapon];

      // Timer: buy clock, round clock, or the bomb clock when planted.
      let t = state.phaseT;
      let label = `Round ${state.round} · First to 5`;
      if (state.bomb.state === BOMB.PLANTED) { t = state.bomb.timer; label = `BOMB PLANTED — SITE ${state.bomb.site}`; }
      else if (state.phase === PHASE.BUY) label = `Round ${state.round} · Buy phase`;
      else if (state.phase === PHASE.END) label = state.matchWinner !== null ? "Match over" : "Round over";
      el.timer.textContent = fmtTime(t);
      el.timer.classList.toggle("low", t <= 10 && state.phase === PHASE.LIVE);
      el.roundLabel.textContent = label;
      el.scoreUs.textContent = state.score[TEAM_US];
      el.scoreThem.textContent = state.score[TEAM_THEM];

      // Objective line.
      if (state.bomb.state === BOMB.PLANTED) {
        el.objective.innerHTML = `Bomb planted at <span class="siteA">SITE ${state.bomb.site}</span> — defend it or die trying`;
      } else if (state.bomb.state === BOMB.CARRIED && state.bomb.carrier === 0) {
        el.objective.innerHTML = `You carry the charge — plant at <span class="siteA">SITE A</span> or <span class="siteB">SITE B</span> (hold E)`;
      } else if (state.bomb.state === BOMB.IDLE) {
        el.objective.innerHTML = `The charge is on the ground — pick it up`;
      } else {
        el.objective.innerHTML = `Plant the charge at <span class="siteA">SITE A</span> or <span class="siteB">SITE B</span>`;
      }

      // Compass heading from yaw.
      const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      const deg = ((-p.yaw * 180) / Math.PI % 360 + 360) % 360;
      el.compass.textContent = dirs[Math.round(deg / 45) % 8] + " · " + Math.round(deg) + "°";

      // Money and alive pips.
      el.money.childNodes[0].textContent = `$${p.money}`;
      let pips = "";
      for (const a of state.agents) if (a.team === TEAM_US) pips += `<span class="pip us${a.alive ? "" : " dead"}"></span>`;
      el.pipsUs.innerHTML = pips;
      pips = "";
      for (const a of state.agents) if (a.team === TEAM_THEM) pips += `<span class="pip them${a.alive ? "" : " dead"}"></span>`;
      el.pipsThem.innerHTML = pips;

      // Health / ammo.
      el.healthNum.textContent = Math.ceil(p.hp);
      el.healthNum.classList.toggle("low", p.hp <= 30);
      el.healthFill.style.width = `${Math.max(0, p.hp)}%`;
      el.healthFill.classList.toggle("low", p.hp <= 30);
      el.ammoNum.innerHTML = `${p.mag} <small>/ ${p.reserve}</small>`;
      el.ammoNum.classList.toggle("empty", p.mag === 0);
      el.weaponName.textContent = w.name + (p.grenades ? ` · ${p.grenades} FRAG` : "");
      el.reloadHint.textContent = p.reloading ? "RELOADING…" : p.mag === 0 ? "PRESS R TO RELOAD" : "";

      // Crosshair gap grows with spread: stopping to aim pays, visibly.
      const spread = (p.spreadBloom || 0) + (p.moving ? 4 : 0) + (p.crouch ? -2 : 0);
      el.xhair.style.setProperty("--gap", `${Math.max(6, 9 + spread * 2.2)}px`);
      el.xhair.style.opacity = state.phase === PHASE.MATCH ? 0 : 1;

      // Hitmarker + damage vignette.
      el.hitmark.style.opacity = state.hitmark > 0 ? 1 : 0;
      el.hitmark.classList.toggle("kill", state.hitmarkKill);
      el.dmg.style.opacity = state.dmgFlash > 0 ? Math.min(1, state.dmgFlash) : 0;

      // Killfeed (only new entries).
      if (state.feed.length !== lastFeedLen) {
        lastFeedLen = state.feed.length;
        el.feed.innerHTML = state.feed.slice(0, 5).map((f) => {
          const a = state.agents.find((x) => x.id === f.a);
          const b = state.agents.find((x) => x.id === f.b);
          const an = a ? (a.isPlayer ? "YOU" : `BOT ${a.id}`) : "—";
          const bn = b ? (b.isPlayer ? "YOU" : `BOT ${b.id}`) : "—";
          const ac = a ? (a.team === TEAM_US ? "us" : "them") : "";
          const bc = b ? (b.team === TEAM_US ? "us" : "them") : "";
          return `<div><span class="${ac}">${an}</span> <span class="w">${f.headshot ? "☠ " : ""}[${f.weapon}]</span> <span class="${bc}">${bn}</span></div>`;
        }).join("");
      }

      // Round banner.
      if (state.banner) {
        if (lastBanner !== state.banner) {
          lastBanner = state.banner;
          el.banner.querySelector("h1").textContent = state.banner.title;
          el.banner.querySelector("h1").className = state.banner.cls;
          el.banner.querySelector("p").textContent = state.banner.sub;
          el.banner.classList.remove("hidden");
        }
      } else if (lastBanner) {
        lastBanner = null;
        el.banner.classList.add("hidden");
      }

      // Plant/defuse progress bar.
      const prog = state.plantProgress;
      if (prog > 0 && prog < 1) {
        el.plantBar.classList.remove("hidden");
        el.plantBar.querySelector(".fill").style.width = `${Math.round(prog * 100)}%`;
        el.plantBar.querySelector(".lbl").textContent = "PLANTING…";
      } else if (p.action && p.action.kind === "defuse") {
        el.plantBar.classList.remove("hidden");
        el.plantBar.querySelector(".fill").style.width = `${Math.round((p.action.t / 5) * 100)}%`;
        el.plantBar.querySelector(".lbl").textContent = "DEFUSING…";
      } else {
        el.plantBar.classList.add("hidden");
      }

      // Context hint.
      let hint = "";
      if (state.phase === PHASE.BUY) hint = "Buy phase — press B for the buy menu";
      else if (state.bomb.state === BOMB.CARRIED && state.bomb.carrier === 0) {
        const s = MAP.sites.find((x) => Math.hypot(x.x - p.x, x.z - p.z) < x.r);
        if (s) hint = "Hold E to plant the charge";
      } else if (state.bomb.state === BOMB.PLANTED) {
        hint = "Bomb is ticking — Sentinel will try to defuse";
      }
      el.hint.textContent = hint;
      el.hint.classList.toggle("hidden", !hint);

      // Buy menu.
      if (ctx.buyOpen && state.phase === PHASE.BUY) {
        el.buy.classList.remove("hidden");
        renderBuy(state);
      } else {
        el.buy.classList.add("hidden");
      }
    },
  };
}
