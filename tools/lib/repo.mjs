// Shared helpers for talking to the minecraft-assets mirror and GitHub.

export const REPO = "InventivetalentDev/minecraft-assets";
export const RAW = "https://raw.githubusercontent.com";
export const API = "https://api.github.com";
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

/** All release branches on the mirror, ascending (snapshots/pre-releases excluded). */
export async function listReleases() {
  const names = [];
  for (let page = 1; ; page++) {
    const res = await fetchJson(`${API}/repos/${REPO}/branches?per_page=100&page=${page}`);
    names.push(...res.map((b) => b.name));
    if (res.length < 100) break;
  }
  return names.filter((n) => /^\d+(\.\d+)+$/.test(n)).sort(cmpVersion);
}

/** Highest release branch on the mirror. */
export async function latestRelease() {
  const releases = await listReleases();
  if (!releases.length) throw new Error("no release branches found");
  return releases[releases.length - 1];
}

export const rawAsset = (version, relPath) =>
  `${RAW}/${REPO}/${version}/assets/minecraft/${relPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
