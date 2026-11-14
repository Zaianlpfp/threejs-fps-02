// DUSTLINE — Tactical Strike (threejs-fps-02).
// Entrypoint: copies game/ and screenshots/ from this repository to the
// output directory and writes /output/dossier.json with buildDossier from
// vendor/makefun-threejs.ts. Node 22, standard library only, no network,
// no model calls. Deterministic: the same bytes out on every run.
import { buildDossier } from "./vendor/makefun-threejs.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

function fail(message: string): never {
  console.error(`dustline: ${message}`);
  process.exit(1);
}

const gameDir = join(REPO_ROOT, "game");
const shotsDir = join(REPO_ROOT, "screenshots");
if (!existsSync(gameDir)) fail("game/ is missing from the repository");
if (!existsSync(join(gameDir, "index.html"))) fail("game/index.html is missing");
if (!existsSync(join(gameDir, "three.module.min.js"))) fail("game/three.module.min.js is missing");
if (!existsSync(join(gameDir, "three.core.min.js"))) fail("game/three.core.min.js is missing");

const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((n) => !n.startsWith("."))
  : [];
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ must hold 3 or 4 images, found ${shots.length}`);
}
for (const shot of shots) {
  const size = statSync(join(shotsDir, shot)).size;
  if (size > 262144) fail(`screenshots/${shot} is ${size} bytes, over the 256 KiB cap`);
  if (!/\.(png|jpe?g)$/i.test(shot)) fail(`screenshots/${shot} is not a PNG or JPEG`);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "game"), { recursive: true });
mkdirSync(join(OUT_DIR, "screenshots"), { recursive: true });
cpSync(gameDir, join(OUT_DIR, "game"), { recursive: true });
cpSync(shotsDir, join(OUT_DIR, "screenshots"), { recursive: true });

const dossier = buildDossier(OUT_DIR, CAPS);
writeFileSync(join(OUT_DIR, "dossier.json"), dossier);
console.log(
  `dustline: wrote ${join(OUT_DIR, "dossier.json")} (${dossier.length} bytes), ` +
    `${shots.length} screenshots, game copied`,
);
