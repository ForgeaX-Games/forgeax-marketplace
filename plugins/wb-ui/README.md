# ForgeaX Workbench UI Workshop

`@forgeax-plugin/wb-ui` is the standard Workbench UI workshop plugin. It migrates the complete local `ui-design-module-transfer` feature into a standalone Workbench plugin.

## What It Does

- Select game genre, screen flow, and visual style.
- Validate UI module/layout combinations.
- Generate UI component assets through the MCP Gemini image service.
- Preview HUD, menu, shop, dialog, result, and other game UI screens.
- Export a generated interactive prototype preview.

## Source Of Truth

The UI language must follow the main ForgeaX design system:

- `packages/interface/src/styles/tokens.css`
- `packages/interface/src/styles/motion.css`
- `packages/interface/src/styles/forgeax-preview/DESIGN-SYSTEM.md`

This plugin keeps local fallback tokens only for standalone development. When embedded in Studio, host tokens should drive the final visual language.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```

Standalone dev runs on port `7821`.

## API

The Vite dev server mounts:

- `POST /__ce-api__/ui-design/generate-assets`

The endpoint depends on MCP Gemini image generation and `sharp` for asset normalization.
