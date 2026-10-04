#!/usr/bin/env node
// Download every Minecraft sound from the minecraft-assets mirror, organised into
// its category folders, plus the sounds.json event index.
//
//   node tools/build-sounds.mjs                 # latest release, all sounds
//   node tools/build-sounds.mjs --version 26.3
//   node tools/build-sounds.mjs --only mob,ambient --limit 50
//
// Output: out/<version>/sounds/<category>/…/*.ogg, sounds.json, sounds.manifest.json

import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, API, fetchBuf, fetchJson, pool, latestRelease, rawAsset } from "./lib/repo.mjs";
import { makeZip } from "./lib/zip.mjs";

function parseArgs(argv) {
  const out = { version: null, out: "out", only: [], limit: 0, concurrency: 24, zip: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--version") out.version = next();
    else if (a === "--out") out.out = next();
    else if (a === "--only") out.only = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") out.limit = Number(next());
    else if (a === "--concurrency") out.concurrency = Number(next());
    else if (a === "--zip") out.zip = true;
    else if (a === "--help" || a === "-h") {
      console.log(`usage: node tools/build-sounds.mjs [options]
  --version <v>      Minecraft version/branch (default: latest release)
  --out <dir>        output root (default: out)
  --only <list>      only these top-level sound dirs (e.g. mob,ambient,block)
  --limit <n>        cap the number of files (for testing)
  --concurrency <n>  parallel downloads (default: 24)
  --zip              also write <version>-sounds.zip`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version || (await latestRelease());
  const root = path.join(args.out, version);
  const soundsDir = path.join(root, "sounds");
  console.log(`building Minecraft ${version} sounds -> ${soundsDir}`);

  // only manage the sounds/ subtree; keep generated images intact
  await rm(soundsDir, { recursive: true, force: true });
  await mkdir(soundsDir, { recursive: true });

  const tree = await fetchJson(
    `${API}/repos/${REPO}/git/trees/${version}:assets/minecraft/sounds?recursive=1`
  );
  if (tree.truncated) console.warn("warning: git tree was truncated");
  let blobs = tree.tree.filter((t) => t.type === "blob" && t.path.endsWith(".ogg"));
  if (args.only.length) blobs = blobs.filter((b) => args.only.includes(b.path.split("/")[0]));
  if (args.limit) blobs = blobs.slice(0, args.limit);
  console.log(`  ${blobs.length} sound files`);

  const files = [];
  const categories = {};
  let done = 0;
  await pool(blobs, args.concurrency, async (node) => {
    const buf = await fetchBuf(rawAsset(version, `sounds/${node.path}`));
    const dest = path.join(soundsDir, node.path);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buf);

    const parts = node.path.split("/");
    const category = parts[0];
    const subcategory = parts.length > 2 ? parts[1] : null;
    const file = parts[parts.length - 1];
    (categories[category] ||= {});
    categories[category][subcategory || ""] = (categories[category][subcategory || ""] || 0) + 1;
    files.push({ path: node.path, file, category, subcategory, bytes: buf.length });
    if (++done % 500 === 0) console.log(`    ${done}/${blobs.length}`);
  });

  // sounds.json event index (event id -> sound files + subtitle)
  const raw = await fetchBuf(rawAsset(version, "sounds.json"));
  await writeFile(path.join(root, "sounds.json"), raw);
  const events = JSON.parse(raw.toString("utf8"));

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    source: `https://github.com/${REPO}/tree/${version}`,
    counts: { files: files.length, categories: Object.keys(categories).length, events: Object.keys(events).length },
    categories,
    files,
    events,
  };
  await writeFile(path.join(root, "sounds.manifest.json"), JSON.stringify(manifest));
  console.log(
    `done: ${files.length} sounds across ${Object.keys(categories).length} categories -> ${soundsDir}`
  );

  if (args.zip) {
    const entries = await Promise.all(
      files.map(async (f) => ({
        name: `sounds/${f.path}`,
        data: await readFile(path.join(soundsDir, f.path)),
      }))
    );
    const zipPath = path.join(args.out, `${version}-sounds.zip`);
    await writeFile(zipPath, makeZip(entries));
    console.log(`zipped ${entries.length} sounds -> ${zipPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
