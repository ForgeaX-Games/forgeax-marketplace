# @forgeax-extension/wb-items

ForgeaX Workbench plugin for **items.json** + **48×48 icon** pipeline.

## Dev

```bash
npm install
npm run dev          # http://localhost:15177
npm run typecheck
npm run build
```

Standalone dev proxies `/api` to Studio (`FORGEAX_SERVER_ORIGIN`, default `http://localhost:18900`).

## Game layout

```
<FORGEAX_PROJECT_ROOT>/.forgeax/games/<slug>/
  items.json
  assets/icons/*.png
```

Batch intermediates: `workspace/images/items/<batchId>/`

## Tools

| Tool | Purpose |
|------|---------|
| `items:list` | Load items + icon previews |
| `items:normalize-sources` | PNG → 48×48 + sync items.json |
| `items:generate-style-plan` | Build MCP prompts per style preset |
| `items:save-document` | Persist items.json |
| `items:upsert-item` | Patch single item |

## Import existing art (e.g. `forgeax-studio/default`)

1. Open a game in Studio (URL gets `?slug=...`)
2. In sidebar, set **源目录** to the folder with raw PNGs
3. Click **批量规范化 PNG**
