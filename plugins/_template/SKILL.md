---
name: wb-template:author-guide
description: Demo skill for the split-surface template plugin. AI uses this to learn how the plugin's tools work.
trigger: /template
---

# Template Plugin · AI Skill

This plugin is the **scaffold** for split-surface workbench plugins. It does
nothing useful on its own — copy `packages/marketplace/plugins/_template/`
when starting a new plugin.

## Tools you can call

### `template:echo({ text: string })`

Trivially echoes the argument back, plus a timestamp. Triggers a
`template:echo-result` SURFACE_DISPATCH so any open Studio iframe re-renders.

Example:
```
bus.call('template:echo', { text: 'hello' })
→ { echoed: 'hello', at: 1748000000000 }
```

## Three-pane architecture

This plugin demonstrates the spec in
[`docs/v2-vision/modules/16-three-pane-embedding.md`](../../../docs/v2-vision/modules/16-three-pane-embedding.md):

- `?pane=left` URL renders only the parameter form (Sidebar in Studio).
- `?pane=center` URL renders only the viewport (MainArea in Studio).
- No pane query = standalone three-column dev mode.

State sync flows:
- transient UI ↔ `BroadcastChannel('forgeax-plugin.@forgeax-plugin/_template')`
- business state ↔ bus surface `template` (visible to forgeax-cli)
