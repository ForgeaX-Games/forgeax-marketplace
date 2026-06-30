# Scene Generator

ForgeaX node-programming workbench app: **Scene Generator** (场景生成器). Built
on the monorepo kernel [`@forgeax/node-runtime`](../../packages/node-runtime) +
[`@forgeax/node-runtime-react`](../../packages/node-runtime-react).

This app lives at `apps/wb-scene-generator/` inside the
[`forgeax-wb-node-editor`](../../) pnpm monorepo.

## Quick start

```bash
# From the monorepo root — build kernel packages first:
pnpm install
pnpm -r build

# Then launch this app:
cd apps/wb-scene-generator
pnpm serve          # self-builds if dist is missing; starts backend :9557 + frontend :9555
```

For development (watch mode with HMR):

```bash
cd apps/wb-scene-generator
pnpm dev            # runs backend + frontend in dev/watch mode
```

```bash
# Headless checks:
pnpm smoke:batteries    # battery load + executeNode in-process
pnpm accept             # forgeax CLI headless determinism loop
```

## Kernel dependency

The kernel (`@forgeax/node-runtime`, `@forgeax/node-runtime-react`,
`@forgeax/editor-host`, `@forgeax/batteries-common`, `@forgeax/i18n`) lives in
the monorepo `packages/*` and is consumed via `workspace:*` — source, not
pre-built dist. One `pnpm -r build` from the monorepo root rebuilds everything.

There is no `external/` directory, no `link:` protocol, no `kernel:setup` or
`kernel:build` script, and no submodule pin to bump.

## Layout

```
backend/                    # Fastify backend; registers kernel runtime + domain routes
  src/
    main.ts                 # boot: build Fastify app, register 11 route groups + /health (PORT 9557)
    runtime.ts              # kernel Runtime + ProjectRegistry (defaultType:'scene')
    tool-handlers.ts        # Studio tool proxy
    routes/                 # queries / mutations / execute / ws / projects / pipelineImport /
                            #   groupTemplates / assets / batteryCategories
    library/                # SQLite asset-store (db.ts opens materials/asset-store/library.db)
    agent/                  # screenshot service + renderer commands
    ops/index.ts            # empty stub — all ops are file-based batteries
frontend/                   # Vite + React UI
  src/
    App.tsx                 # pane router (?pane= routing)
    workbench/              # WorkbenchHost.tsx mounts kernel <Editor>; protocol.ts (7 postMessage types)
    renderer/               # bridge / modes (free3d, iso, top, topBillboard) / framework / host
    surfaces/               # RendererSurface.tsx / AssetStoreSurface.tsx / library/
    panels/                 # scenePanels.ts (custom inspector panels)
    api/                    # HttpApiClient.ts
batteries/                  # ~276 scene domain batteries (file-based; scanned by kernel loader)
materials/asset-store/      # built-in content-addressed asset library (library.db + blobs/)
vendor/shared/types/        # vendored shared types; build:vendor → vendor/dist/ (gitignored)
schemas/                    # JSON schemas for batteries / ops
forgeax-plugin.json         # ForgeaX plugin manifest (id @forgeax-plugin/wb-scene-generator)
SKILL.md                    # AI-readable op + workflow guide
```

## Batteries

Batteries are the scene domain's op library — `~276` app batteries (big tags:
`scene30` ~120, `alg_store` ~50, `components` ~31, `basic` ~28, `scenealg` ~22,
`special` ~12, `scene` ~8, `ai` ~5; plus `groups/` and `templates/` JSON-only
entries) plus 32 from `@forgeax/batteries-common`.

Each battery is a `{meta.json, index.ts}` directory pair under `batteries/`.
The kernel loader (`createBatteryLoader`) scans them from
`resolveBatteryScanRoots(repoRoot)` in `@forgeax/editor-host/backend`.

```bash
pnpm build:vendor       # compile vendor/shared/types → vendor/dist/shared/types
pnpm smoke:batteries    # load all batteries + run executeNode (in-process)
pnpm accept             # drive the forgeax CLI headlessly; assert deterministic output
```

## Status

Fully implemented: renderer 4 modes (free3d / iso / top / topBillboard), asset
store (zone / search / paginated grid), multi-project management, per-agent
exclusive lock, ~276 batteries, SQLite asset library, pipeline import/export,
undo/redo, and the full LLM/CLI tool surface (18 tools).

## Ports

| Service | Port |
|---|---|
| Frontend (served by `serve-dist.mjs`) | 9555 |
| Backend (Fastify) | 9557 |

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
