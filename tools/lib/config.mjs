import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "devault");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export const KNOWN_KEYS = ["out", "version", "channel", "size", "thumb", "port", "host", "concurrency"];

export async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

/** Resolve the output directory: flag > env > config > ./out. */
export async function resolveOut(flag, config) {
  return path.resolve(flag || process.env.DEVAULT_OUT || config?.out || "out");
}
