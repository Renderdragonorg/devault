// Shared helpers for talking to the minecraft-assets mirror and GitHub.

export const REPO = "InventivetalentDev/minecraft-assets";
export const RAW = "https://raw.githubusercontent.com";
export const API = "https://api.github.com";
export const MOJANG_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const GH_HEADERS = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchBuf(url, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "vault-asset-builder", ...GH_HEADERS },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === tries - 1) throw err;
      await sleep(300 * (attempt + 1));
    }
  }
}

export const fetchJson = async (url) => JSON.parse((await fetchBuf(url)).toString("utf8"));

export async function pool(items, limit, worker) {
  let cursor = 0;
  const run = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
}

export function cmpVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** A plain release id (all-numeric): snapshots/pre-releases have a tag suffix. */
export const isReleaseVersion = (v) => /^\d+(\.\d+)+$/.test(v);

/** Every branch name on the mirror (releases, snapshots, pre-releases, …). */
export async function listMirrorBranches() {
  const names = [];
  for (let page = 1; ; page++) {
    const res = await fetchJson(`${API}/repos/${REPO}/branches?per_page=100&page=${page}`);
    names.push(...res.map((b) => b.name));
    if (res.length < 100) break;
  }
  return names;
}

/** All release branches on the mirror, ascending (snapshots/pre-releases excluded). */
export async function listReleases() {
  return (await listMirrorBranches()).filter(isReleaseVersion).sort(cmpVersion);
}

/** Highest release branch on the mirror. */
export async function latestRelease() {
  const releases = await listReleases();
  if (!releases.length) throw new Error("no release branches found");
  return releases[releases.length - 1];
}

export const CHANNELS = ["release", "snapshot", "both"];

const channelTypes = (channel) =>
  channel === "snapshot" ? ["snapshot"] : channel === "both" ? ["release", "snapshot"] : ["release"];

/** Official Mojang versions for a channel, newest first: `[{ id, type }]`. */
export async function listOfficialVersions(channel = "release") {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel "${channel}" (use ${CHANNELS.join(", ")})`);
  const types = channelTypes(channel);
  const data = await fetchJson(MOJANG_MANIFEST);
  return (data.versions || [])
    .filter((v) => types.includes(v.type))
    .map((v) => ({ id: v.id, type: v.type }));
}

/** Latest official version id for a channel (snapshots included for `snapshot`/`both`). */
export async function latestOfficialVersion(channel = "release") {
  const [first] = await listOfficialVersions(channel);
  if (!first) throw new Error(`no official versions for channel "${channel}"`);
  return first.id;
}

/** Latest official release id from Mojang's version manifest. */
export async function latestOfficialRelease() {
  return latestOfficialVersion("release");
}

/** Buildable versions on the mirror for a channel, ascending (Mojang order). */
export async function listChannelVersions(channel = "release") {
  const branches = new Set(await listMirrorBranches());
  const official = await listOfficialVersions(channel); // newest first
  return official
    .map((v) => v.id)
    .filter((id) => branches.has(id))
    .reverse(); // oldest first
}

export const rawAsset = (version, relPath) =>
  `${RAW}/${REPO}/${version}/assets/minecraft/${relPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
