#!/usr/bin/env node
// devault — one CLI for everything the tools do.

import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, rm, readFile, readdir, lstat, symlink, writeFile } from "node:fs/promises";
import { buildAssets } from "../tools/build-assets.mjs";
import { buildSounds } from "../tools/build-sounds.mjs";
import { startServer } from "../tools/server.mjs";
import { listReleases } from "../tools/lib/repo.mjs";
import { loadConfig, saveConfig, resolveOut, CONFIG_PATH, KNOWN_KEYS } from "../tools/lib/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// where each agent loads skills from, and the skill source for it
const SKILLS = {
  opencode: {
    src: path.join(ROOT, "skills", "devault"),
    target: (project) =>
      project
        ? path.join(process.cwd(), ".opencode", "skills", "devault")
        : path.join(os.homedir(), ".config", "opencode", "skills", "devault"),
  },
  hermes: {
    src: path.join(ROOT, "skills", "hermes", "devault"),
    target: (project) =>
      project
        ? path.join(process.cwd(), ".hermes", "skills", "devault")
        : path.join(os.homedir(), ".hermes", "skills", "devops", "devault"),
  },
};

const HELP = `devault — Minecraft asset library builder and API

usage: devault <command> [options]

commands
  build              build assets and sounds
  assets             build textures, item icons and isometric block icons
  sounds             download every sound effect
  serve              run the open CORS API and the web page
  versions           list Minecraft versions available on the mirror
  info               show what is built in the output folder
  clean <version>    delete a built version (or --all)
  config             show or change defaults
  skill <install|uninstall|status>   link the skill (opencode; add --hermes or --project)

common options
  --out <dir>        output folder      (flag > $DEVAULT_OUT > config > ./out)
  --version <v>      Minecraft version  (default: latest release)
  -h, --help         show this help
  -V, --version      show the devault version

examples
  devault build --version 26.3
  devault assets --only blocks --limit 40
  devault sounds --out ~/devault-assets
  devault info
  devault serve --port 9000`;

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const config = await loadConfig();

const hasFlag = (args, name) =>
  args.includes(name) || args.some((a) => a.startsWith(`${name}=`));

function forward(argv, { out, version } = {}) {
  const args = [...argv];
  if (out && !hasFlag(args, "--out")) args.push("--out", out);
  if (version && !hasFlag(args, "--version")) args.push("--version", version);
  return args;
}

const readJson = async (p) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
};

async function showInfo(outDir) {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  const rows = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(outDir, e.name);
    const assets = await readJson(path.join(dir, "manifest.json"));
    const sounds = await readJson(path.join(dir, "sounds.manifest.json"));
    if (!assets && !sounds) continue;
    rows.push({
      version: e.name,
      textures: assets?.files?.textures?.length ?? 0,
      items: assets?.files?.items?.length ?? 0,
      blocks: assets?.files?.blocks?.length ?? 0,
      sounds: sounds?.files?.length ?? 0,
    });
  }
  if (!rows.length) {
    console.log(`nothing built in ${outDir}`);
    return;
  }
  console.log(`output: ${outDir}`);
  for (const r of rows.reverse()) {
    console.log(
      `  ${r.version}  ${r.textures} textures, ${r.items} items, ${r.blocks} blocks, ${r.sounds} sounds`
    );
  }
}

async function clean(outDir, version, all) {
  if (!version && !all) throw new Error("specify a version or --all");
  const versions = all
    ? (await readdir(outDir, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [version];
  if (!versions.length) {
    console.log(`nothing to clean in ${outDir}`);
    return;
  }
  for (const v of versions) {
    await rm(path.join(outDir, v), { recursive: true, force: true });
    await rm(path.join(outDir, `${v}.zip`), { force: true });
    await rm(path.join(outDir, `${v}-sounds.zip`), { force: true });
    console.log(`removed ${v}`);
  }
}

async function runConfig(rest) {
  const [action, key, ...valueParts] = rest;
  if (!action) {
    console.log(CONFIG_PATH);
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  if (action === "get") {
    if (!key) return console.log(JSON.stringify(config, null, 2));
    return console.log(config[key] ?? "");
  }
  if (action === "set") {
    if (!key || !valueParts.length) throw new Error("usage: devault config set <key> <value>");
    if (!KNOWN_KEYS.includes(key)) console.warn(`note: "${key}" is not a known key (${KNOWN_KEYS.join(", ")})`);
    config[key] = valueParts.join(" ");
    await saveConfig(config);
    return console.log(`${key} = ${config[key]}`);
  }
  if (action === "unset") {
    delete config[key];
    await saveConfig(config);
    return console.log(`unset ${key}`);
  }
  if (action === "path") return console.log(CONFIG_PATH);
  throw new Error(`unknown config action "${action}"`);
}

function skillTarget(agent, project) {
  return SKILLS[agent].target(project);
}

async function runSkill(rest) {
  const agent = rest.includes("--hermes") ? "hermes" : "opencode";
  const project = rest.includes("--project");
  const action = rest.find((a) => !a.startsWith("-")) || "status";
  const target = skillTarget(agent, project);
  const source = SKILLS[agent].src;

  if (action === "status") {
    try {
      const info = await lstat(target);
      console.log(`${target} -> ${info.isSymbolicLink() ? "symlink" : "present"}`);
    } catch {
      console.log(`not linked (${target})`);
    }
    return;
  }
  if (action === "install") {
    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await symlink(source, target, "dir");
    console.log(`linked ${source}\n    -> ${target}`);
    console.log(agent === "hermes" ? "restart hermes to load the skill" : "restart opencode to load the skill");
    return;
  }
  if (action === "uninstall") {
    await rm(target, { recursive: true, force: true });
    console.log(`unlinked ${target}`);
    return;
  }
  throw new Error(`unknown skill action "${action}"`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === "help" || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "-V" || command === "--version" || command === "version") {
    console.log(pkg.version);
    return;
  }

  const out = await resolveOut(
    rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : undefined,
    config
  );
  const version = config.version;

  switch (command) {
    case "build":
      await buildAssets(forward(rest, { out, version }));
      await buildSounds(forward(rest, { out, version }));
      return;
    case "assets":
      return buildAssets(forward(rest, { out, version }));
    case "sounds":
      return buildSounds(forward(rest, { out, version }));
    case "serve":
      return startServer(forward(rest, { out }));
    case "versions": {
      const releases = await listReleases();
      const n = rest.includes("--limit") ? Number(rest[rest.indexOf("--limit") + 1]) : 20;
      console.log(releases.slice(-n).join("\n"));
      return;
    }
    case "info":
      return showInfo(out);
    case "clean":
      return clean(out, rest.find((a) => !a.startsWith("-")), rest.includes("--all"));
    case "config":
      return runConfig(rest);
    case "skill":
      return runSkill(rest);
    default:
      console.error(`unknown command "${command}"\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`devault: ${err.message}`);
  process.exit(1);
});
