---
name: wb-ui:author-guide
description: Use for ForgeaX Workbench UI workshop tasks, including game UI flow generation, UI component asset generation, HUD/menu/dialog/shop prototype previews, UI token alignment, and migrating UI workshop functionality.
---

# Workbench UI Workshop

Use this skill when working on `@forgeax-plugin/wb-ui`.

## Rules

- Treat this as the standard Workbench UI ?? plugin, not a character-editor pipeline.
- Keep UI visuals aligned with the main ForgeaX token and motion system.
- Keep functional code in this plugin repository; do not reintroduce UI ?? into `wb-character`.
- Preserve the game UI matrix behavior: genre, layout/screen flow, style/component generation, component preview, and prototype output.
- Do not store API keys in the plugin. Use host/MCP configuration.

## Validation

Run:

```bash
npm run typecheck
npm run test
npm run build
```
