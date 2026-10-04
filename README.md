# devault

Generate a Minecraft asset library — textures, item icons, isometric block icons, and every
sound effect — from the open
[`InventivetalentDev/minecraft-assets`](https://github.com/InventivetalentDev/minecraft-assets)
mirror, and serve it over an open, CORS-enabled API with a small documentation page.

No dependencies, no external API keys, no database. Everything is derived from the public
mirror and classified locally.

## Structure

```
web/                     static site — documents and demos the API
  index.html
  styles.css
  app.js
tools/                   generators + dev API server
  build-assets.mjs       textures · item icons · isometric block icons
  build-sounds.mjs       every sound + sounds.json event index
  server.mjs             open CORS API + serves web/
  lib/
    repo.mjs             mirror + version helpers
    png.mjs              dependency-free PNG codec + isometric renderer
    zip.mjs              minimal ZIP writer
    classify.mjs         name -> category/subcategory heuristics
assets/                  repo icon
```

## Quickstart

```bash
node tools/build-assets.mjs      # out/<version>/{textures,items,blocks} + manifest.json
node tools/build-sounds.mjs      # out/<version>/sounds/** + sounds.manifest.json
node tools/server.mjs            # http://localhost:8792
```

Requires Node 18+. Defaults to the latest Minecraft release; pass `--version 26.3` to pin one.
Build output goes to `out/` (gitignored).

## API

Served by `tools/server.mjs`. Every response sends `Access-Control-Allow-Origin: *`, there is
no auth, and `/files/...` supports HTTP `Range`.

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

## Options

`build-assets.mjs`: `--version`, `--out`, `--size`, `--thumb`, `--only`, `--limit`,
`--concurrency`, `--no-zip`.
`build-sounds.mjs`: `--version`, `--out`, `--only`, `--limit`, `--concurrency`, `--zip`.
`server.mjs`: `--port`, `--out`, `--host`.

## Notes

- Block icons are isometric renders of full-cube blocks; stairs, slabs, doors and other
  non-cube shapes are skipped. Item icons are the flat 16×16 textures. Animated textures
  export their first frame.
- Sounds are copied as-is (Ogg Vorbis) and categorised by their in-game folder.
- Minecraft assets are Mojang/Microsoft property. This project is an unaffiliated index over
  them; respect the Minecraft EULA and brand guidelines when redistributing.
