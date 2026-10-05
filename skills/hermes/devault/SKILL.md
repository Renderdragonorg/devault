---
name: devault
description: "Build and serve Minecraft icons, textures and sounds."
version: 1.0.0
author: Coder-soft (Renderdragon)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [minecraft, assets, icons, textures, sounds, cli, api]
    category: devops
---

# devault Skill

`devault` generates a Minecraft asset library — textures, flat item icons, isometric block
icons, and every `.ogg` sound effect — from the public
`InventivetalentDev/minecraft-assets` mirror, then serves it over an open CORS API with a small
docs page. It is dependency-free (Node 18+), needs no API key, and stores to any folder.

It does not render mobs/entities (those come from Mojang's own packs) and only renders
full-cube blocks.

## When to Use

- The user wants Minecraft assets: item/block icons, textures, or sound effects.
- The user wants to build, host, browse, or query a devault asset library or its API.
- The user references a `devault` folder, the Renderdragonorg/devault repo, or an
  `out/<version>/` tree of icons/textures/sounds.

## Prerequisites

- Node 18+ available to `terminal`.
- The devault checkout. Run from its root, or use the installed `devault` command
  (`npm link`), otherwise `node bin/devault.mjs`.

## How to Run

```bash
devault build                 # assets + sounds for the latest release
devault assets --only blocks --limit 40
devault sounds --out ~/devault-assets
devault serve --port 8792     # open API + web page
devault info
```

Output folder resolution: `--out` → `$DEVAULT_OUT` → `config.out` → `./out`. Persist defaults
with `devault config set out ~/devault-assets`.

## Quick Reference

| Command | Purpose |
|---|---|
| `build` | assets and sounds |
| `assets` | textures, item icons, block icons |
| `sounds` | every sound + `sounds.json` |
| `serve` | open CORS API + docs page |
| `versions` | Minecraft versions on the mirror |
| `info` | what is built in the output folder |
| `clean <version>` / `--all` | delete built output |
| `config` | show/set defaults |
| `skill install [--project] [--hermes]` | link the skill into an agent |

Options: `--version <v>`, `--out <dir>`, `--only`, `--limit`, `--concurrency`, `--size`,
`--thumb`, `--no-zip` (assets), `--zip` (sounds), `--port` (serve).

## Procedure

1. Confirm Node and the checkout: run `node --version` and `bin/devault.mjs --help` through
   `terminal`.
2. Build: `devault build --version <v>`. Large runs stream progress; sounds total ~360 MB.
3. Inspect: `devault info` prints per-version counts from `out/<version>/manifest.json` and
   `sounds.manifest.json`.
4. Serve: `devault serve --port 8792`; the page is at `/`, the API at `/api`. Verify with
   `curl -s http://localhost:8792/api/versions`.
5. Query: `GET /api/{v}/assets?type=blocks|items|textures`, `/sounds`, `/categories`,
   `/sound-events[/<event>]`, `/search?q=`; raw files at `/files/{v}/<path>` (Range enabled,
   CORS `*`).

## Pitfalls

- Block icons cover full-cube blocks only; stairs, slabs, doors and multipart blockstates are
  skipped. Item icons are flat textures, not 3D renders.
- Animated textures export their first frame; sounds are copied as-is (Ogg Vorbis).
- `versions` calls the GitHub API unauthenticated; set `GITHUB_TOKEN` to avoid rate limits.
- The first build downloads from the mirror and can take minutes; pass `--only`/`--limit` to
  smoke-test.

## Verification

- `devault info` lists the version with nonzero counts for the sets you built.
- `node bin/devault.mjs --help` prints usage without error.
- With `serve` running, `curl -s http://localhost:8792/api/26.3/summary` returns JSON counts.

Minecraft assets belong to Mojang/Microsoft; devault is an unaffiliated index over them.
