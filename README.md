# devault

A CLI that generates a Minecraft asset library — textures, item icons, isometric block icons,
and every sound effect — from the open
[`InventivetalentDev/minecraft-assets`](https://github.com/InventivetalentDev/minecraft-assets)
mirror, then serves it over an open, CORS-enabled API with a small docs page.

No dependencies, no API keys, no database.

## Structure

```
bin/devault.mjs          CLI entry point
web/                     static site — documents and demos the API
tools/                   the engines the CLI drives
  build-assets.mjs       textures · item icons · isometric block icons
  build-sounds.mjs       every sound + sounds.json event index
  server.mjs             open CORS API + serves web/
  lib/
    repo.mjs             mirror + version helpers
    png.mjs              dependency-free PNG codec + isometric renderer
    zip.mjs              minimal ZIP writer
    classify.mjs         name -> category/subcategory heuristics
    config.mjs           ~/.config/devault/config.json
skills/devault/SKILL.md          opencode skill
skills/hermes/devault/SKILL.md   hermes skill
assets/icon.svg
```

## Install

```bash
npm link            # optional: exposes the `devault` command
node bin/devault.mjs --help
```

Requires Node 18+.

## CLI

```bash
devault build                  # assets + sounds (latest release)
devault build --version 26.3
devault assets --only blocks --limit 40
devault sounds --out ~/devault-assets
devault serve --port 9000
devault info
devault clean 26.3             # or --all
```

| Command | Purpose |
|---|---|
| `build` | build assets and sounds |
| `assets` | textures, item icons, block icons |
| `sounds` | every `.ogg` sound + `sounds.json` |
| `watch` | poll for new official releases and build them |
| `publish` | build new releases and attach the archives to GitHub Releases |
| `serve` | open CORS API + web page (default port 8792) |
| `versions` | Minecraft versions available on the mirror |
| `info` | what is built in the output folder |
| `clean <version>` / `--all` | delete built output |
| `config` | show/set defaults |
| `skill install\|uninstall\|status` | link the opencode skill |

Output folder resolution: `--out <dir>` → `$DEVAULT_OUT` → `config.out` → `./out`.
Set persistent defaults:

```bash
devault config set out ~/devault-assets
devault config set version 26.3
```

## Watching for new releases

`watch` checks for new Minecraft versions and builds anything not already in the output
folder. By default it reads Mojang's official version manifest, so it will notice a version
before the mirror is updated and build it as soon as the mirror catches up.

`--channel` picks what to track: `release` (default), `snapshot` (snapshots, pre-releases and
release candidates), or `both`.

```bash
devault watch                        # check once; build the latest release if missing
devault watch --interval 3600        # keep polling every hour
devault watch --channel snapshot     # track snapshots/pre-releases instead
devault watch --channel both --all   # backfill releases and snapshots
devault watch --dry-run              # show what would be built
devault watch --source mirror        # use the mirror instead of Mojang as the trigger
```

Run it in the background to keep the library current:

```bash
nohup devault watch --interval 3600 --channel both --out ~/devault-assets </dev/null >watch.log 2>&1 &
```

A version counts as fully built when its folder contains both `manifest.json` (assets) and
`sounds.manifest.json` (sounds); only the missing parts are (re)built. Set a default channel
once with `devault config set channel both`. Snapshot ids keep their suffix (`26.4-snapshot-3`).

> `versions`/`watch`/`publish` page through the mirror's branches via the GitHub API. Set
> `GITHUB_TOKEN` to raise the rate limit (60/hr unauthenticated).

## Automated builds on GitHub Actions

`.github/workflows/assets.yml` runs `devault publish` every 6 hours and on demand. When a new
official release appears (and the mirror has it), the workflow builds the icons/textures and
sounds and attaches them to a GitHub Release tagged with the version:

```
Release 26.3
  26.3.zip          icons + textures + isometric block icons
  26.3-sounds.zip   every sound effect + sounds.json
```

Trigger it manually from the Actions tab; inputs let you force a version, choose a channel, or
backfill every version that has no GitHub Release yet. Snapshots/pre-releases are published as
GitHub pre-releases. Assets are large, so a release is only created when the version isn't
already published — the scheduled run is a cheap check the rest of the time.

Note: GitHub pauses scheduled workflows after ~60 days without repository activity, so re-enable
it from the Actions tab if the builds stop. A manual `Run workflow` also reactivates the schedule.

`publish` uses the `gh` CLI, so it works locally too:

```bash
devault publish --repo owner/name              # latest release, if missing
devault publish --repo owner/name --all        # backfill every unpublished mirror release
devault publish --repo owner/name --dry-run    # show the plan
```

> Minecraft assets belong to Mojang/Microsoft. Publishing them to Releases redistributes
> Mojang's files — make sure that fits the Minecraft EULA and brand guidelines for your use.

## Agent skills

```bash
devault skill install            # link into ~/.config/opencode/skills/devault
devault skill install --hermes   # link into ~/.hermes/skills/devops/devault
devault skill install --project  # link into ./.opencode/skills/devault (gitignored)
```

Skill sources live at `skills/devault/SKILL.md` (opencode) and `skills/hermes/devault/SKILL.md`
(hermes). Links are symlinks, so edits to the sources are picked up. Restart the agent to load.

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
out/<version>.zip          # asset archive
```

## API

Served by `devault serve`. Every response sends `Access-Control-Allow-Origin: *`, there is no
auth, and `/files/...` supports HTTP `Range`.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/versions` | generated versions |
| `GET` | `/api/{v}/summary` | counts for each set |
| `GET` | `/api/{v}/manifest` | full catalogue + sound events |
| `GET` | `/api/{v}/categories` | category/subcategory tree |
| `GET` | `/api/{v}/assets?type=blocks\|items\|textures&category=&subcategory=&q=&limit=&offset=` | asset list with file urls |
| `GET` | `/api/{v}/sounds?category=&subcategory=&event=&q=&limit=&offset=` | sound list |
| `GET` | `/api/{v}/sound-events` | game event → sound files |
| `GET` | `/api/{v}/search?q=` | assets + sounds |
| `GET` | `/files/{v}/{path}` | raw image or `.ogg` |

```js
const { items } = await fetch("/api/26.3/assets?type=blocks&limit=8").then((r) => r.json());
// items[0].url -> "/files/26.3/blocks/02. Planks/Oak_Planks.png"
```

## Notes

- Block icons are isometric renders of full-cube blocks; stairs, slabs, doors and other non-cube
  shapes are skipped. Items are the flat 16×16 textures. Animated textures export their first frame.
- Sounds are copied as-is (Ogg Vorbis) and categorised by their in-game folder.
- Minecraft assets are Mojang/Microsoft property. This project is an unaffiliated index over them;
  respect the Minecraft EULA and brand guidelines when redistributing.
