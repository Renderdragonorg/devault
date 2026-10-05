#!/usr/bin/env node
// Build vault-style Minecraft assets from InventivetalentDev/minecraft-assets.
//
//   node tools/build-assets.mjs                 # latest release, 1024px, all sets
//   node tools/build-assets.mjs --version 26.3
//   node tools/build-assets.mjs --only blocks --limit 40
//
// Output: out/<version>/{textures,items,blocks}/… plus manifest.json and <version>.zip
// items/blocks are nested into category/subcategory folders.

import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG, scaleNearest, renderBlockIso } from "./lib/png.mjs";
import { makeZip } from "./lib/zip.mjs";
import { classifyBlock, classifyItem, relPath } from "./lib/classify.mjs";
import { REPO, RAW, fetchBuf, fetchJson, pool, latestRelease } from "./lib/repo.mjs";

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const out = {
    version: null,
    out: "out",
    size: 1024,
    thumb: 0,
    concurrency: 16,
    only: ["textures", "items", "blocks"],
    zip: true,
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--version") out.version = next();
    else if (a === "--out") out.out = next();
    else if (a === "--size") out.size = Number(next());
    else if (a === "--thumb") out.thumb = Number(next());
    else if (a === "--concurrency") out.concurrency = Number(next());
    else if (a === "--only") out.only = next().split(",").map((s) => s.trim());
    else if (a === "--limit") out.limit = Number(next());
    else if (a === "--no-zip") out.zip = false;
    else if (a === "--help" || a === "-h") {
      console.log(`usage: node tools/build-assets.mjs [options]
  --version <v>      Minecraft version/branch (default: latest release)
  --out <dir>        output root (default: out)
  --size <px>        icon size (default: 1024)
  --thumb <px>       also emit thumbnails at this size (default: off)
  --only <list>      textures,items,blocks (default: all)
  --limit <n>        cap files per set (for testing)
  --concurrency <n>  parallel downloads (default: 16)
  --no-zip           skip the .zip archive`);
      process.exit(0);
    }
  }
  return out;
}

// ---------------------------------------------------------------- fetch

// ---------------------------------------------------------------- versions

// ---------------------------------------------------------------- model resolution

const norm = (name) =>
  String(name).replace(/^minecraft:/, "").replace(/^block\//, "");

function collectTextures(modelName, models, seen = new Set()) {
  if (!modelName || seen.has(modelName)) return {};
  seen.add(modelName);
  const m = models[modelName];
  if (!m) return {};
  const inherited = m.parent ? collectTextures(norm(m.parent), models, seen) : {};
  return { ...inherited, ...(m.textures || {}) };
}

function modelElements(modelName, models, seen = new Set()) {
  if (!modelName || seen.has(modelName)) return null;
  seen.add(modelName);
  const m = models[modelName];
  if (!m) return null;
  if (m.elements) return m.elements;
  return m.parent ? modelElements(norm(m.parent), models, seen) : null;
}

function resolveRef(tex, key, seen = new Set()) {
  let v = tex[key];
  while (typeof v === "string" && v.startsWith("#")) {
    const k = v.slice(1);
    if (seen.has(k)) return undefined;
    seen.add(k);
    v = tex[k];
  }
  return typeof v === "string" ? v : undefined;
}

const texFile = (value) => {
  if (!value) return null;
  const s = value.replace(/^minecraft:/, "");
  return `${s.split("/").pop()}.png`;
};

function isFullCube(elements) {
  if (!elements) return false;
  return elements.some(
    (e) =>
      e.from &&
      e.to &&
      e.from[0] === 0 &&
      e.from[1] === 0 &&
      e.from[2] === 0 &&
      e.to[0] === 16 &&
      e.to[1] === 16 &&
      e.to[2] === 16
  );
}

function pickVariant(blockstate) {
  const variants = blockstate.variants;
  if (!variants) return null; // multipart (fences, walls, …) — not handled
  for (const value of Object.values(variants)) {
    const entry = Array.isArray(value) ? value[0] : value;
    if (entry && entry.model) return norm(entry.model);
  }
  return null;
}

// ---------------------------------------------------------------- main

export async function buildAssets(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const version = args.version || (await latestRelease());
  const root = path.join(args.out, version);
  console.log(`building Minecraft ${version} -> ${root}`);

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const base = `${RAW}/${REPO}/${version}/assets/minecraft`;
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    source: `https://github.com/${REPO}/tree/${version}`,
    geometry: "isometric (1024px reference): top 1.0, west 0.8, north 0.6",
    files: { textures: [], items: [], blocks: [] },
    skippedBlocks: [],
  };

  // Every label is derived locally from the name (no external data).
  const placements = (classify, key) => [classify(key)];

  const blockTextures = new Map();
  const itemTextures = new Map();
  const loadTextures = async (kind, store) => {
    const list = await fetchJson(`${base}/textures/${kind}/_list.json`);
    let files = list.files.filter((f) => f.endsWith(".png"));
    if (args.limit) files = files.slice(0, args.limit);
    console.log(`  ${kind}: ${files.length} PNGs`);
    let done = 0;
    await pool(files, args.concurrency, async (name) => {
      const buf = await fetchBuf(`${base}/textures/${kind}/${name}`);
      store.set(name, decodePNG(buf));
      if (++done % 250 === 0) console.log(`    ${kind} ${done}/${files.length}`);
    });
    return files;
  };

  if (args.only.includes("blocks") || args.only.includes("textures")) {
    await loadTextures("block", blockTextures);
  }
  if (args.only.includes("items")) {
    await loadTextures("item", itemTextures);
  }

  const emit = async (rel, image, thumb) => {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, encodePNG(image));
    if (thumb) {
      const t = path.join(root, "thumbnails", rel);
      await mkdir(path.dirname(t), { recursive: true });
      await writeFile(t, encodePNG(scaleNearest(image, thumb)));
    }
  };

  // textures (raw block textures, upscaled)
  if (args.only.includes("textures")) {
    console.log("emitting textures…");
    for (const [name, img] of blockTextures) {
      await emit(`textures/${name}`, scaleNearest(img, args.size), args.thumb);
      manifest.files.textures.push(name);
    }
  }

  // items (flat item textures, upscaled), nested by category/subcategory
  if (args.only.includes("items")) {
    console.log("emitting items…");
    for (const [name, img] of itemTextures) {
      const scaled = scaleNearest(img, args.size);
      for (const place of placements(classifyItem, name)) {
        const rel = path.posix.join("items", relPath(place));
        await emit(rel, scaled, args.thumb);
        manifest.files.items.push({
          source: name,
          output: rel,
          category: place.category,
          subcategory: place.subcategory || null,
        });
      }
    }
  }

  // blocks (isometric renders), nested by category/subcategory
  if (args.only.includes("blocks")) {
    const models = await fetchJson(`${base}/models/block/_all.json`);
    const blockstates = await fetchJson(`${base}/blockstates/_all.json`);
    let keys = Object.keys(blockstates);
    if (args.limit) keys = keys.slice(0, args.limit);
    console.log(`emitting blocks (${keys.length} blockstates)…`);

    let made = 0;
    for (const block of keys) {
      const modelName = pickVariant(blockstates[block]);
      if (!modelName) {
        manifest.skippedBlocks.push(block);
        continue;
      }
      const tex = collectTextures(modelName, models);
      if (!isFullCube(modelElements(modelName, models))) {
        manifest.skippedBlocks.push(block);
        continue;
      }
      const upRef = resolveRef(tex, "up") || resolveRef(tex, "top") || resolveRef(tex, "end") || resolveRef(tex, "all");
      const northRef = resolveRef(tex, "north") || resolveRef(tex, "front") || resolveRef(tex, "side") || upRef;
      const westRef = resolveRef(tex, "west") || resolveRef(tex, "side") || resolveRef(tex, "all") || northRef;
      const up = blockTextures.get(texFile(upRef));
      const north = blockTextures.get(texFile(northRef));
      const west = blockTextures.get(texFile(westRef));
      if (!up || !north || !west) {
        manifest.skippedBlocks.push(block);
        continue;
      }
      const iso = renderBlockIso(args.size, { up, north, west });
      for (const place of placements(classifyBlock, block)) {
        const rel = path.posix.join("blocks", relPath(place));
        await emit(rel, iso, args.thumb);
        manifest.files.blocks.push({
          block,
          output: rel,
          category: place.category,
          subcategory: place.subcategory || null,
          model: modelName,
          textures: { up: texFile(upRef), north: texFile(northRef), west: texFile(westRef) },
        });
      }
      if (++made % 100 === 0) console.log(`    blocks ${made}`);
    }
    console.log(`  generated ${made} block icons, skipped ${manifest.skippedBlocks.length}`);
  }

  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(
    `done: ${manifest.files.textures.length} textures, ${manifest.files.items.length} items, ` +
      `${manifest.files.blocks.length} blocks -> ${root}`
  );

  if (args.zip) {
    const { readdir, readFile } = await import("node:fs/promises");
    const entries = [];
    const walk = async (dir, prefix) => {
      for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(prefix, e.name);
        if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
        else entries.push({ name: rel, data: await readFile(path.join(root, dir, e.name)) });
      }
    };
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(e.name, e.name);
      else entries.push({ name: e.name, data: await readFile(path.join(root, e.name)) });
    }
    const zipPath = path.join(args.out, `${version}.zip`);
    await writeFile(zipPath, makeZip(entries));
    console.log(`zipped ${entries.length} files -> ${zipPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
