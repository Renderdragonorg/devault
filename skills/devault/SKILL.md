---
name: devault
description: Build, watch, inspect and serve a Minecraft asset library — textures, item and isometric block icons, and every sound effect — from an open Minecraft asset mirror, using the `devault` CLI. Use when the user wants Minecraft assets, icons, textures, block/item sprites, sound effects, to auto-build new Minecraft releases, or to build/serve/query the devault asset API.
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
| `devault watch` | Track official Minecraft releases and build new ones automatically |
| `devault publish` | Build new releases and attach the archives to GitHub Releases |
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

`devault watch` options:

- `--source <mojang|mirror>` — where to detect versions (default: `mojang`, the official manifest).
- `--channel <release|snapshot|both>` — what to track (default: `release`; `snapshot` covers
  snapshots, pre-releases and release candidates).
- `--interval <sec>` — poll instead of checking once.
- `--all` / `--from <v>` — backfill every mirror version not built (optionally newer than `<v>`).
- `--assets-only`, `--sounds-only`, `--dry-run`.

`devault publish` options (needs the `gh` CLI and `GH_TOKEN`):

- `--repo <owner/name>` — target repo (default `$GITHUB_REPOSITORY`).
- `--version <v>` — force one version; `--all` / `--from <v>` — backfill.
- `--no-assets`, `--no-sounds`, `--tag-prefix <p>`, `--dry-run`.
- `--source <mojang|mirror>` — which version "latest" means.
- `--channel <release|snapshot|both>` — snapshots publish as GitHub pre-releases.

`.github/workflows/assets.yml` runs `devault publish` on a 6-hour schedule and on manual
dispatch, attaching `<v>.zip` and `<v>-sounds.zip` to a GitHub Release per version.

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
devault watch --interval 3600                # auto-build new official releases hourly
devault watch --channel snapshot             # track snapshots/pre-releases too
devault info
devault serve --port 9000
```

`watch` triggers off Mojang's official version manifest and builds a release once the mirror
has it; a version counts as built when it has both `manifest.json` and `sounds.manifest.json`.

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
