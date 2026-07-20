# wb-lowpoly-obj

> Low-poly humanoid 3D character editor for ForgeaX. Vibe-edit (LLM) + manual edit (Blender-style gizmo) on a parametric block humanoid; bakes to engine-neutral `.glb`.

ForgeaX 工作台插件：可动方块人 3D 角色编辑器。源数据是参数化的 `LowPolySource v1` JSON（关节绑骨 + 部件几何 + 动画 clip），渲染端用 three.js 做预览，烘焙端走 `@gltf-transform/core` 输出 `.glb`，引擎中立。

## 特性 / Features

- **Vibe edit**：自然语言生成或修改角色（走 host LLM gateway，可选模型）
- **Manual edit**：Blender 风视口
  - 选中部件 → TransformControls gizmo（3 轴箭头/旋转环/缩放盒）
  - 快捷键 `G/R/S` + `X/Y/Z` 轴锁 / `Esc` 取消 / `Enter` 确认
  - 镜像编辑（`leftXxx ↔ rightXxx`）
  - 网格/角度捕捉
- **Playground**：第三人称 WASD 驱动当前角色，验证骨骼动画
- **Bake**：导出 `.glb`（首选，含骨骼+动画）/ `.obj` 兜底（静态 T-pose）
- **Mixamo 兼容**：humanoid-standard-v1 骨架命名可输出 `mixamorig:*` 前缀

## 数据流 / Data flow

```
源 JSON (SSOT)  ──bake──>  .glb  ──>  three.js / Babylon / Unity / Unreal / Godot / Bevy / Filament
      ↑
  编辑器（vibe + manual）
```

唯一 SSOT 是 `data/lowpoly-characters/<slug>/source.json`；`.glb` 是派生产物（content-addressed by sha）。

## Status

🚧 v0.1.0 — scaffold；详细设计见主仓 `docs/v2-vision/wb-lowpoly-obj-design.md`（待写）。

## License

Apache-2.0 — 跟随 ForgeaX 主仓 ADR-0002。
