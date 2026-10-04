const $ = (id) => document.getElementById(id);
const api = async (path) => (await fetch(path)).json();

const ENDPOINTS = [
  ["GET", "/api/versions", "every generated version"],
  ["GET", "/api/{v}/summary", "counts for each set"],
  ["GET", "/api/{v}/categories", "category and subcategory tree"],
  ["GET", "/api/{v}/assets?type=blocks|items|textures", "catalogue, each entry with a file url"],
  ["GET", "/api/{v}/sounds?category=&subcategory=&event=", "sound files"],
  ["GET", "/api/{v}/sound-events", "game event → sound mapping"],
  ["GET", "/api/{v}/search?q=", "search assets and sounds"],
  ["GET", "/files/{v}/{path}", "raw image or audio"],
];

function renderEndpoints(version) {
  $("endpoints").innerHTML = ENDPOINTS.map(
    ([method, path, desc]) =>
      `<li><span class="method">${method}</span>` +
      `<span class="path">${path.replace(/\{v\}/g, version)}</span>` +
      `<span class="desc">${desc}</span></li>`
  ).join("");
}

function renderExample(version) {
  const origin = location.origin;
  $("example").textContent =
    `const base = "${origin}";\n` +
    `const { items } = await fetch(\n` +
    `  \`\${base}/api/${version}/assets?type=blocks&limit=8\`\n` +
    `).then((r) => r.json());\n\n` +
    `// items[0].url -> "/files/${version}/blocks/…/Oak_Planks.png"\n` +
    `// <img src={base + items[0].url} />`;
}

function addSample(container, item, className) {
  const img = document.createElement("img");
  img.src = item.url;
  img.alt = item.name;
  img.loading = "lazy";
  if (className) img.className = className;
  img.title = item.name;
  img.onclick = () => window.open(item.url, "_blank");
  container.appendChild(img);
}

async function main() {
  let versions = [];
  try {
    versions = await api("/api/versions");
  } catch {
    $("sub").textContent = "The API server is not responding.";
    return;
  }
  if (!versions.length) {
    $("sub").textContent = "No builds yet. Run the build tools, then reload.";
    return;
  }

  const version = versions[0];
  const [summary, blocks, items, sounds] = await Promise.all([
    api(`/api/${version}/summary`),
    api(`/api/${version}/assets?type=blocks&limit=8`),
    api(`/api/${version}/assets?type=items&limit=4`),
    api(`/api/${version}/sounds?limit=1`),
  ]);

  $("sub").textContent =
    `Generated from Minecraft ${version} — blocks, items, textures and every sound. ` +
    `Open API, no key, no CORS.`;

  const art = $("artifacts");
  blocks.items.forEach((it, i) => {
    addSample(art, it);
    art.lastChild.style.animationDelay = `${i * 40}ms`;
  });
  items.items.forEach((it, i) => {
    addSample(art, it, "sm");
    art.lastChild.style.animationDelay = `${(blocks.items.length + i) * 40}ms`;
  });

  const sound = sounds.items[0];
  if (sound) {
    const btn = document.createElement("button");
    btn.className = "sound";
    btn.innerHTML = `<span class="dot">▶</span><span class="label">${sound.path}</span>`;
    btn.onclick = () => {
      const audio = $("audio");
      if (audio.src.endsWith(sound.url) && !audio.paused) audio.pause();
      else {
        audio.src = sound.url;
        audio.play();
      }
    };
    art.appendChild(btn);
  }

  renderEndpoints(version);
  renderExample(version);
  $("stats").innerHTML =
    `<b>${summary.textures.toLocaleString()}</b> textures · ` +
    `<b>${summary.items.toLocaleString()}</b> items · ` +
    `<b>${summary.blocks.toLocaleString()}</b> blocks · ` +
    `<b>${summary.sounds.toLocaleString()}</b> sounds · ` +
    `<b>${summary.soundEvents.toLocaleString()}</b> events`;
}

main();
