#!/usr/bin/env node
// Watch for new Minecraft versions and build them automatically.
//
//   node tools/watch.mjs                        # one check: build the latest release if missing
//   node tools/watch.mjs --interval 3600        # poll hourly
//   node tools/watch.mjs --channel snapshot     # track snapshots instead of releases
//   node tools/watch.mjs --all                  # backfill every known version not built yet
//   node tools/watch.mjs --dry-run              # show what would be built
//
// A version is detected from Mojang's official version manifest by default (or the
// mirror with --source mirror), for the chosen --channel (release, snapshot or both).
// A version is built when its output folder has both manifest.json (assets) and
// sounds.manifest.json (sounds).

import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssets } from "./build-assets.mjs";
import { buildSounds } from "./build-sounds.mjs";
import {
  listMirrorBranches,
  listOfficialVersions,
  latestOfficialVersion,
  cmpVersion,
  sleep,
  CHANNELS,
} from "./lib/repo.mjs";

function parseArgs(argv) {
  const out = {
    out: "out",
    source: "mojang",
    channel: "release",
    interval: 0,
    all: false,
    from: null,
    assets: true,
    sounds: true,
    dryRun: false,
    forward: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--out") out.out = next();
    else if (a === "--source") out.source = next();
    else if (a === "--channel") out.channel = next();
    else if (a === "--interval") out.interval = Number(next());
    else if (a === "--all") out.all = true;
    else if (a === "--from") out.from = next();
    else if (a === "--assets-only") out.sounds = false;
    else if (a === "--sounds-only") out.assets = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-zip") out.forward.push("--no-zip");
    else if (["--size", "--thumb", "--limit", "--concurrency"].includes(a)) out.forward.push(a, next());
    else if (a === "--help" || a === "-h") {
      console.log(`usage: node tools/watch.mjs [options]
  --out <dir>        output root (default: out)
  --source <src>     detect versions from mojang (official) or mirror (default: mojang)
  --channel <ch>     release | snapshot | both (default: release)
  --interval <sec>   poll every N seconds (default: check once and exit)
  --all              build every known version that is not built yet
  --from <version>   with --all, only versions newer than this one
  --assets-only      build icons/textures only
  --sounds-only      build sounds only
  --dry-run          report what would be built without building
  --no-zip           skip the .zip archives
  --size <px>        icon size (default: 1024)
  --thumb <px>       also emit thumbnails
  --limit <n>        cap files per set (testing)
  --concurrency <n>  parallel downloads`);
      process.exit(0);
    }
  }
  if (!["mojang", "mirror"].includes(out.source)) throw new Error(`unknown --source "${out.source}"`);
  if (!CHANNELS.includes(out.channel)) throw new Error(`unknown --channel "${out.channel}" (use ${CHANNELS.join(", ")})`);
  return out;
}

async function builtState(out, version) {
  const dir = path.join(out, version);
  const has = async (file) => {
    try {
      return (await stat(path.join(dir, file))).isFile();
    } catch {
      return false;
    }
  };
  return { assets: await has("manifest.json"), sounds: await has("sounds.manifest.json") };
}

async function checkOnce(args, out) {
  const stamp = new Date().toISOString();
  const branches = new Set(await listMirrorBranches());
  const official = await listOfficialVersions(args.channel); // newest first
  const order = official.map((v) => v.id).reverse(); // oldest first

  let candidates;
  if (args.all || args.from) {
    candidates = order.filter((id) => branches.has(id));
    if (args.from) {
      const i = candidates.indexOf(args.from);
      candidates = i >= 0 ? candidates.slice(i + 1) : candidates.filter((v) => cmpVersion(v, args.from) > 0);
    }
    console.log(`[${stamp}] checking ${args.channel} channel (${candidates.length} version(s) newer than ${args.from || "the beginning"})`);
  } else {
    const latest =
      args.source === "mirror" ? [...order].reverse().find((id) => branches.has(id)) : await latestOfficialVersion(args.channel);
    console.log(`[${stamp}] latest ${args.source} ${args.channel} version: ${latest}`);
    if (!latest) {
      console.log("  no known versions for this channel");
      return;
    }
    if (!branches.has(latest)) {
      console.log("  not on the mirror yet — will retry");
      return;
    }
    candidates = [latest];
  }

  const todo = [];
  for (const version of candidates) {
    const state = await builtState(out, version);
    if (state.assets && state.sounds) continue;
    todo.push({ version, state });
  }

  if (!todo.length) {
    console.log("  up to date — nothing to build");
    return;
  }
  console.log(`  ${todo.length} version(s) to build: ${todo.map((t) => t.version).join(", ")}`);
  if (args.dryRun) {
    for (const t of todo) {
      console.log(`    would build ${t.version} (assets:${t.state.assets ? "present" : "missing"}, sounds:${t.state.sounds ? "present" : "missing"})`);
    }
    return;
  }

  for (const { version, state } of todo) {
    const needAssets = args.assets && !state.assets;
    // assets rebuild wipes the version folder, so sounds must be rebuilt after it
    const needSounds = args.sounds && (!state.sounds || needAssets);
    if (!needAssets && !needSounds) continue;
    console.log(`  building ${version} (${needAssets ? "assets" : ""}${needAssets && needSounds ? " + " : ""}${needSounds ? "sounds" : ""})`);
    if (needAssets) await buildAssets(["--out", out, "--version", version, ...args.forward]);
    if (needSounds) await buildSounds(["--out", out, "--version", version, ...args.forward]);
  }
}

export async function watchReleases(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const out = path.resolve(args.out);
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    console.log("\nfinishing current check, then stopping…");
  });

  do {
    try {
      await checkOnce(args, out);
    } catch (err) {
      console.error(`devault watch: ${err.message}`);
    }
    if (!args.interval || stop) break;
    console.log(`next check in ${args.interval}s (Ctrl-C to stop)`);
    await sleep(args.interval * 1000);
  } while (!stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  watchReleases().catch((err) => {
    console.error(`devault watch: ${err.message}`);
    process.exit(1);
  });
}
