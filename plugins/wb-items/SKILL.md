---
name: wb-items:author-guide
description: Use for ForgeaX Workbench items & icons tasks — items.json editing, 48px icon normalization, multi-style generation plans, and inventory asset QA.
---

# Workbench Items & Icons

Use when working on `@forgeax-plugin/wb-items`.

## Tools

- `items:list` — list items.json + icons
- `items:normalize-sources` — batch normalize PNG → `assets/icons/` + sync items.json
- `items:generate-style-plan` — build MCP prompts per style preset
- `items:save-document` / `items:upsert-item` — persist data

## Paths (per game slug)

- `<FORGEAX_PROJECT_ROOT>/.forgeax/games/<slug>/items.json`
- `<FORGEAX_PROJECT_ROOT>/.forgeax/games/<slug>/assets/icons/`
- `workspace/images/items/<batchId>/` — batch intermediates

## Validation

```bash
npm run typecheck
npm run build
```
