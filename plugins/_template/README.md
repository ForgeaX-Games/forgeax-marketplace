# `_template` — Split-Surface Plugin Scaffold

Minimum-viable plugin that implements the **three-pane embedding spec**
(see `docs/v2-vision/modules/16-three-pane-embedding.md`).

This plugin is `hidden: true` in its manifest — Studio doesn't list it as a
workbench tab. It exists purely as a copy-paste starting point.

## Creating a new plugin

```bash
cp -r packages/marketplace/plugins/_template packages/marketplace/plugins/wb-my-thing
cd packages/marketplace/plugins/wb-my-thing

# 1. Rename in forgeax-plugin.json:  id, displayName, workbench.id, workbench.bus.surfaceId
# 2. Rename in package.json:         name
# 3. Replace tools in schemas/, server/router.ts and src/ui/* with your own
# 4. Drop "hidden": true once you want it shown

npm install
npm run dev   # standalone mode, opens at http://localhost:7820
```

## The three modes

| Mode | How to run | What you see |
|------|-----------|--------------|
| **standalone** | `npm run dev` | Full 3-pane UI; no Studio host needed |
| **embedded** | Studio host loads the built `dist/` | Sidebar+MainArea iframes (same html, different `?pane=`) |
| **rpc-only** | `curl POST /api/bus/tools/template:echo` | Server router runs; iframes (if any) auto-refresh |

## File map

```
forgeax-plugin.json          manifest (split-surface declared here)
index.html                   single entry — both panes load it
src/main.ts                  reads ?pane=, mounts only what's visible
src/state/GlobalState.ts     BroadcastChannel-backed pub/sub
src/platform/Bridge.ts       postMessage <-> Studio host
src/ui/styles.css            data-pane CSS gating contract
src/ui/{left,center,shared}/ pane-specific renderers
server/router.ts             Hono router; Studio host mounts at /api/wb/template
schemas/                     JSON schemas for tool args/returns
SKILL.md                     AI-facing doc
```

## Anti-patterns this scaffold avoids

- **No React** at this level — keep the template framework-agnostic so plugins
  can choose Vue / Solid / plain DOM. Use whatever inside your own plugin.
- **No bundling of vendor SDKs** — the plugin calls model channels through
  `Bridge.callTool` and lets the host's `bus.callModel` resolve the vendor.
- **No own auth/key storage** — secrets live in `~/.forgeax/key/` and are
  injected by the host. Plugins never read raw API keys.
