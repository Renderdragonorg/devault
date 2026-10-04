#!/usr/bin/env node
// Open, CORS-enabled API + browser over everything the build tools produce.
//
//   node tools/server.mjs                 # http://localhost:8792
//   node tools/server.mjs --port 9000 --out out
//
// Serves:
//   /                         browser UI (web/index.html)
//   /files/<version>/<path>   raw images / .ogg (Range supported)
//   /api/...                  JSON API, no auth, Access-Control-Allow-Origin: *

import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { port: 8792, out: process.env.OUT || "out", host: "0.0.0.0" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--host") out.host = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: node tools/server.mjs [--port 8792] [--out out] [--host 0.0.0.0]");
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.out);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".zip": "application/zip",
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
}

function json(res, status, body) {
  cors(res);
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

// ------------------------------------------------------------ manifests

const cache = new Map();

async function listVersions() {
  let entries = [];
  try {
    entries = await readdir(ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const versions = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(ROOT, e.name);
    const hasAssets = await exists(path.join(dir, "manifest.json"));
    const hasSounds = await exists(path.join(dir, "sounds.manifest.json"));
    if (hasAssets || hasSounds) versions.push(e.name);
  }
  return versions.sort().reverse();
}

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

async function getManifests(version) {
  if (cache.has(version)) return cache.get(version);
  const dir = path.join(ROOT, version);
  const assets = (await exists(path.join(dir, "manifest.json")))
    ? JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"))
    : null;
  const sounds = (await exists(path.join(dir, "sounds.manifest.json")))
    ? JSON.parse(await readFile(path.join(dir, "sounds.manifest.json"), "utf8"))
    : null;
  const value = { assets, sounds };
  cache.set(version, value);
  return value;
}

const assetUrl = (version, rel) => `/files/${version}/${rel.split("/").map(encodeURIComponent).join("/")}`;

function categoryTree(assets, sounds) {
  const tree = { blocks: {}, items: {}, textures: { __files: 0 }, sounds: {} };
  const bump = (obj, cat, sub) => {
    if (!cat) return;
    obj[cat] ||= {};
    obj[cat][sub || ""] = (obj[cat][sub || ""] || 0) + 1;
  };
  for (const b of assets?.files?.blocks || []) bump(tree.blocks, b.category, b.subcategory);
  for (const i of assets?.files?.items || []) bump(tree.items, i.category, i.subcategory);
  tree.textures.__files = assets?.files?.textures?.length || 0;
  for (const [cat, subs] of Object.entries(sounds?.categories || {})) {
    tree.sounds[cat] = {};
    for (const [sub, count] of Object.entries(subs)) tree.sounds[cat][sub || ""] = count;
  }
  return tree;
}

function shapeAssets(version, assets, { type, category, subcategory, q, limit, offset }) {
  const types = type ? [type] : ["blocks", "items", "textures"];
  let items = [];
  if (types.includes("blocks")) {
    for (const b of assets?.files?.blocks || [])
      items.push({ type: "block", name: path.basename(b.output), file: b.output, category: b.category, subcategory: b.subcategory, url: assetUrl(version, b.output), block: b.block });
  }
  if (types.includes("items")) {
    for (const i of assets?.files?.items || [])
      items.push({ type: "item", name: path.basename(i.output), file: i.output, category: i.category, subcategory: i.subcategory, url: assetUrl(version, i.output), source: i.source });
  }
  if (types.includes("textures")) {
    for (const t of assets?.files?.textures || [])
      items.push({ type: "texture", name: t, file: `textures/${t}`, url: assetUrl(version, `textures/${t}`) });
  }
  if (category) items = items.filter((x) => x.category === category);
  if (subcategory) items = items.filter((x) => x.subcategory === subcategory);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((x) => x.name.toLowerCase().includes(needle) || (x.block || "").includes(needle));
  }
  const total = items.length;
  if (offset) items = items.slice(offset);
  if (limit) items = items.slice(0, limit);
  return { total, count: items.length, items };
}

function shapeSounds(version, sounds, { category, subcategory, q, limit, offset, event }) {
  let items = (sounds?.files || []).map((s) => ({
    name: s.file,
    path: s.path,
    category: s.category,
    subcategory: s.subcategory,
    bytes: s.bytes,
    url: assetUrl(version, `sounds/${s.path}`),
  }));
  if (event && sounds?.events?.[event]) {
    const def = sounds.events[event];
    const wanted = new Set((def.sounds || []).map((n) => n.replace(/^minecraft:/, "")));
    items = items.filter((s) => wanted.has(s.path.replace(/\.ogg$/, "")));
  }
  if (category) items = items.filter((x) => x.category === category);
  if (subcategory) items = items.filter((x) => x.subcategory === subcategory);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((x) => x.path.toLowerCase().includes(needle));
  }
  const total = items.length;
  if (offset) items = items.slice(offset);
  if (limit) items = items.slice(0, limit);
  return { total, count: items.length, items };
}

// ------------------------------------------------------------ files

async function serveFile(req, res, version, rel) {
  const full = path.resolve(ROOT, version, rel);
  if (!full.startsWith(path.resolve(ROOT, version))) return json(res, 403, { error: "forbidden" });
  let info;
  try {
    info = await stat(full);
  } catch {
    return json(res, 404, { error: "not found" });
  }
  if (!info.isFile()) return json(res, 404, { error: "not found" });

  cors(res);
  res.setHeader("Content-Type", mimeFor(full));
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : info.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= info.size) {
      res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Length": end - start + 1,
    });
    createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": info.size });
    createReadStream(full).pipe(res);
  }
}

// ------------------------------------------------------------ router

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  try {
    if (parts[0] === "files" && parts.length >= 3) {
      return await serveFile(req, res, parts[1], parts.slice(2).join("/"));
    }

    if (parts[0] === "api") {
      if (parts.length === 1) {
        return json(res, 200, {
          name: "devault API",
          cors: "*",
          versions: await listVersions(),
          endpoints: [
            "/api/versions",
            "/api/<version>/summary",
            "/api/<version>/manifest",
            "/api/<version>/categories",
            "/api/<version>/assets?type=blocks|items|textures&category=&subcategory=&q=&limit=&offset=",
            "/api/<version>/sounds?category=&subcategory=&event=&q=&limit=&offset=",
            "/api/<version>/sound-events",
            "/api/<version>/sound-events/<event>",
            "/api/<version>/search?q=",
            "/files/<version>/<path>",
          ],
        });
      }
      if (parts[1] === "versions") return json(res, 200, await listVersions());

      const version = parts[1];
      const versions = await listVersions();
      if (!versions.includes(version)) return json(res, 404, { error: `unknown version ${version}`, versions });

      const { assets, sounds } = await getManifests(version);
      const q = url.searchParams;
      const section = parts[2] || "summary";

      if (section === "summary") {
        return json(res, 200, {
          version,
          textures: assets?.files?.textures?.length || 0,
          items: assets?.files?.items?.length || 0,
          blocks: assets?.files?.blocks?.length || 0,
          sounds: sounds?.files?.length || 0,
          soundEvents: sounds?.counts?.events || 0,
          generatedAt: assets?.generatedAt || sounds?.generatedAt || null,
        });
      }
      if (section === "manifest") {
        return json(res, 200, {
          version,
          assets: assets ? { ...assets, files: { ...assets.files } } : null,
          sounds: sounds
            ? { version: sounds.version, counts: sounds.counts, categories: sounds.categories, events: sounds.events }
            : null,
        });
      }
      if (section === "categories") return json(res, 200, categoryTree(assets, sounds));
      if (section === "assets") {
        return json(res, 200, shapeAssets(version, assets, {
          type: q.get("type"),
          category: q.get("category"),
          subcategory: q.get("subcategory"),
          q: q.get("q"),
          limit: q.get("limit") ? Number(q.get("limit")) : 0,
          offset: q.get("offset") ? Number(q.get("offset")) : 0,
        }));
      }
      if (section === "sounds") {
        return json(res, 200, shapeSounds(version, sounds, {
          category: q.get("category"),
          subcategory: q.get("subcategory"),
          event: q.get("event"),
          q: q.get("q"),
          limit: q.get("limit") ? Number(q.get("limit")) : 0,
          offset: q.get("offset") ? Number(q.get("offset")) : 0,
        }));
      }
      if (section === "sound-events") {
        if (!sounds) return json(res, 404, { error: "no sounds for this version" });
        if (parts[3]) {
          const id = parts.slice(3).join("/");
          const def = sounds.events?.[id];
          if (!def) return json(res, 404, { error: `unknown event ${id}` });
          const wanted = new Set((def.sounds || []).map((n) => n.replace(/^minecraft:/, "")));
          const files = (sounds.files || [])
            .filter((s) => wanted.has(s.path.replace(/\.ogg$/, "")))
            .map((s) => ({ ...s, url: assetUrl(version, `sounds/${s.path}`) }));
          return json(res, 200, { event: id, subtitle: def.subtitle || null, files });
        }
        return json(res, 200, sounds.events || {});
      }
      if (section === "search") {
        const query = q.get("q") || "";
        return json(res, 200, {
          assets: shapeAssets(version, assets, { q: query, limit: 100 }),
          sounds: shapeSounds(version, sounds, { q: query, limit: 100 }),
        });
      }
      return json(res, 404, { error: `unknown endpoint /api/${version}/${section}` });
    }

    // static UI (single page)
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });
    const PUBLIC = path.resolve(HERE, "..", "web");
    const rel = parts.length ? parts.join("/") : "index.html";
    const candidate = path.resolve(PUBLIC, rel);
    const file = candidate.startsWith(PUBLIC) && (await exists(candidate)) ? candidate : path.join(PUBLIC, "index.html");
    cors(res);
    res.setHeader("Content-Type", mimeFor(file));
    createReadStream(file).pipe(res);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(args.port, args.host, () => {
  console.log(`devault API on http://localhost:${args.port}  (serving ${ROOT})`);
  console.log(`open API, CORS * — try http://localhost:${args.port}/api`);
});
