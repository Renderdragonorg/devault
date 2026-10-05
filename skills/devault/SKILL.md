---
name: devault
description: Build, inspect and serve a Minecraft asset library — textures, item and isometric block icons, and every sound effect — from an open Minecraft asset mirror, using the `devault` CLI. Use when the user wants Minecraft assets, icons, textures, block/item sprites, sound effects, or to build/serve/query the devault asset API.
---

# devault

`devault` generates a Minecraft asset library from the public
`InventivetalentDev/minecraft-assets` mirror and serves it over an open, CORS-enabled API
with a small web page. No dependencies, no API keys, no database.

Run it as `devault <command>` if installed (`npm link`), otherwise `node bin/devault.mjs <command>`
from the repo root.

## Commands

| Command | What it does |
|---|---|
| `devault build` | Build assets **and** sounds |
| `devault assets` | Textures, flat item icons, isometric full-cube block icons |
| `devault sounds` | Every `.ogg` sound + the `sounds.json` event index |
| `devault serve` | Open CORS API + web page (default port 8792) |
| `devault versions` | List Minecraft versions available on the mirror |
| `devault info` | Show what is already built in the output folder |
| `devault clean <version>` / `--all` | Delete built output |
| `devault config` | Show/set defaults (persisted to `~/.config/devault/config.json`) |
| `devault skill install\|uninstall\|status` | Link this skill into opencode (`--project` for a repo-local link) |

## Common options

- `--out <dir>` — output folder. Resolution order: flag → `$DEVAULT_OUT` → config → `./out`.
- `--version <v>` — Minecraft version (default: latest release). `--version 26.3`.
- `--only <list>` — restrict sets (assets: `textures,items,blocks`; sounds: top dirs like `mob,ambient`).
- `--limit <n>`, `--concurrency <n>`, `--size <px>`, `--thumb <px>`, `--no-zip` (assets) / `--zip` (sounds).

Set persistent defaults once instead of repeating flags:

```bash
devault config set out ~/devault-assets
devault config set version 26.3
```

## Examples

```bash
devault build --version 26.3                 # everything, latest release by default
devault assets --only blocks --limit 40      # quick smoke test
devault sounds --out ~/devault-assets
devault info
devault serve --port 9000
```

## Output layout

```
out/<version>/
  textures/<name>.png
  items/10. Items/<subcat>/<Name>.png
  blocks/20. Blocks/<subcat>/<Name>.png
  sounds/<category>/[<subcategory>/]<name>.ogg
  manifest.json            # asset catalogue + per-block texture sources
  sounds.manifest.json     # sound files + category tree + game events
  sounds.json              # raw Mojang event index
```

Categories/subcategories are derived locally by name heuristics (`tools/lib/classify.mjs`).

## API (while `devault serve` is running)

Every response sends `Access-Control-Allow-Origin: *`; no auth; `/files/...` supports `Range`.

- `GET /api/versions`
- `GET /api/{v}/summary` · `/manifest` · `/categories`
- `GET /api/{v}/assets?type=blocks|items|textures&category=&subcategory=&q=&limit=&offset=`
- `GET /api/{v}/sounds?category=&subcategory=&event=&q=&limit=&offset=`
- `GET /api/{v}/sound-events[/<event>]` · `GET /api/{v}/search?q=`
- `GET /files/{v}/<path>` — raw PNG or `.ogg`

## Notes

- Block icons are full-cube isometric renders; stairs/slabs/doors and other non-cube shapes are
  skipped. Items are flat textures. Animated textures export their first frame.
- Sounds stay Ogg Vorbis (no transcoding).
- Minecraft assets belong to Mojang/Microsoft; devault is an unaffiliated index over them.
