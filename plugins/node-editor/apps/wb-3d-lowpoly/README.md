# 3D Lowpoly Generator

ForgeaX node-programming plugin: **3D Lowpoly Generator** (3D 低多边形生成器).
Parametric low-poly geometry via a node graph, with OCCT/replicad mesh baking
and a live three.js/URDF viewer. Built on the
[`@forgeax/node-runtime`](../../packages/node-runtime) kernel.

This app lives at `apps/wb-3d-lowpoly` inside the
[`forgeax-wb-node-editor`](../../) monorepo.

## Quick start

```bash
# From the monorepo root — builds kernel + both apps:
pnpm install
pnpm -r build

# Serve the 3D Lowpoly Generator (frontend on :9565, backend on :9567):
cd apps/wb-3d-lowpoly
pnpm serve
```

`pnpm serve` runs `scripts/serve-dist.mjs`: serves `frontend/dist`, spawns
`backend/dist/main.js`, and self-proxies `/api` and `/ws` at the same origin.

> **Note:** `forgeax-plugin.json` lists `"start":"pnpm dev"` in the standalone
> entry for legacy compatibility. The real production run path is `pnpm serve`
> (serve-dist). Use `pnpm dev` only for per-subpackage development (hot-reload
> of frontend or backend individually).

## Ports

| Service | Port |
|---|---|
| Frontend (Vite / serve-dist) | 9565 |
| Backend (Fastify) | 9567 |

## Layout

```
backend/                         # Fastify backend
  src/
    main.ts                      # boot: Fastify app + 10 route groups + baker warmup
    runtime.ts                   # kernel Runtime + ProjectRegistry + battery scan
    routes/                      # REST + WS routes
    services/baker/              # OCCT/replicad WASM mesh baker
    agent/                       # agent screenshot / GLB export routes + services
    tool-handlers.ts             # Studio tool proxy (resolves backend URL)
frontend/                        # Vite + React UI
  src/
    App.tsx                      # pane router (urdf / left / center)
    workbench/WorkbenchHost.tsx  # mounts kernel <Editor> + URDF iframe
    surfaces/urdf/               # URDF/3D viewer (three.js, live-sync, screenshot, GLB)
    api/HttpApiClient.ts         # ApiClient over REST + WS (with backoff reconnect)
    theme.ts                     # plugin colour / icon overrides
batteries/                       # 85 geometry domain ops
  Generate/                      # 创建几何
    Primitive/    (8 ops)
    Profile/      (5 ops)
    Parts/        (20 ops)       # 含 6 个齿轮族：g_gear + bevel/ring/rack/planetary/worm
    Architecture/ (10 ops)
  Modify/                        # 修改 / 变换
    CSG/          (11 ops)
    Transform/    (6 ops)
    Material/     (2 ops)
    Placement/    (3 ops)
  Assemble/                      # 装配 / 关节 / 碰撞
    Assembly/     (9 ops)
    Collision/    (4 ops)
  Output/                        # 烘焙 / 校验 / 导出
    Bake/         (2 ops)
    QC/           (2 ops)
    Export/       (3 ops)
# 注：以上为快照；运行期权威清单是 `lowpoly:batteries.list` 工具（SSOT）。
# 文件夹名即调色板大类（无数字前缀）；rail 顺序由 batteryGrouping.ts 的显式
# 阶段顺序 Generate→Modify→Assemble→Output 决定。
vendor/                          # vendored geometry DSL types → vendor/dist (gitignored)
schemas/                         # .gitkeep stubs (schema files land here as batteries mature)
scripts/
  build-vendor.mjs               # compiles vendor/shared/types → vendor/dist (run before backend)
  serve-dist.mjs                 # `pnpm serve` entry
  headless-renderer.mjs          # Playwright headless URDF renderer for agent screenshots
forgeax-plugin.json              # plugin manifest (id @forgeax-plugin/wb-3d-lowpoly, 17 tools; 16 AI-exposed, screenshot.store internal)
SKILL.md                         # AI-readable op + workflow guide
```

## Status

Fully implemented. 85 active domain batteries organised by pipeline stage
(Generate / Modify / Assemble / Output) + 32 shared batteries from
`@forgeax/batteries-common`. The 15 legacy gear ops were consolidated into 6
parameterized Parts families (`g_gear` with a `tooth_profile` enum, plus
`g_ring_gear` / `g_rack_gear` / `g_planetary_gearset` / `g_bevel_gear` /
`g_worm`); the old per-profile battery ids were removed (graphs saved with them
must be re-created with `g_gear`), though the baker still understands every
underlying gear DSL op. OCCT/replicad WASM baker (flat/faceted low-poly tessellation), content-
addressed OBJ/GLB blob library, three.js URDF viewer with live-sync, per-agent
project lock, agent screenshot and GLB export tools, headless renderer daemon.

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full subsystem map and
"改 X 看哪?" reverse index.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
