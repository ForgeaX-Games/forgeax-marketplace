---
name: generate-lowpoly-prop
description: 从一句需求或一张参考图造出一件低面、带 PBR、游戏可用的 .glb 小物件（道具 / 装备 / 家具 / 场景小物件）。当用户要一件「不是角色」的 3D 小物件，或要给已有 preview 低模补贴图 / 降面时调用。
---

# Generate a Lowpoly Prop

## When to use

- 用户要一件道具 / 装备 / 家具 / 场景小物件的 3D 资产（**不是角色**——角色走 Gen3D）
- 已有一个 preview 低模，要补 PBR 贴图或降面到目标面数
- 要把一张参考图 / 多视图变成低面 .glb
- 不要用它建枪 / 齿轮组 / 建筑 / 整场景这类**程序化 CAD**（那是 Poly / wb-3d-lowpoly）

## Procedure

1. **确认前置**：先有激活的游戏，拿到 `slug`（kebab-case）；每次调用 `aiasset:*` 都显式带 `slug`，漏了直接报错。先 `aiasset:provider-status` 看 Meshy 余额 + COS 是否就绪。
2. **拆需求**：把需求拆成「形状 + 材质 + 用途」三件事；想清楚走文生还是图生，目标面数大概多少。
3. **出 preview 低模（先看形态，最省）**：
   - 文生 → `aiasset:text-to-3d`（`model_type:lowpoly`, `mode:preview`），prompt 写清物件 + 风格 + 用途。
   - 图生 / 多视图 → 需要图片的**公网 URL**（本地图由 UI 上传 / 用户粘贴 URL 得到，AI 不直接传图），拿到 URL 后 `aiasset:image-to-3d` / `aiasset:multi-image-to-3d`。
   - **先把 preview 拿给用户确认形态**，别急着补贴图。
4. **补 PBR（形态满意后再花这笔）**：`aiasset:refine` 给 preview 加 PBR 纹理；要换风格 / 重铺材质用 `aiasset:retexture`。
5. **降面达标**：面数偏高 → `aiasset:remesh` 重拓扑到 `target polycount`（小物件控在低面区间）。
6. **交付**：`aiasset:list-assets` 核对落盘，把稳定 `assetPath`（`assets/3d/props/...`）回报用户，并提示「还能补 PBR / 再降面 / 换材质」。

## Examples

- ✅ 「一个中世纪木质宝箱，带铁包角」→ text-to-3d(lowpoly preview) → 用户点头 → refine 补木纹 + 金属 PBR → remesh 到目标面数 → 交 `assetPath`
- ✅ 用户给一张剑的参考图（URL）→ image-to-3d(lowpoly) → refine
- ❌ 一上来就跑 refine + remesh 全套，结果形态用户根本不要 —— 白烧配额
- ❌ 拿它去建「一条街 + 一排房子」的整场景 —— 那是 Poly 的活

## Anti-patterns

- 不要漏 `slug`——每次 `aiasset:*` 调用都要显式带。
- 不要跳过 preview 直接跑全套：先看形态再补贴图 / 降面。
- 不要靠解析文件名判断有没有 PBR / 降没降面——读 sidecar 结构化字段。
- 不要给下游传临时 provider URL——只传稳定 `assetPath`。
- 不要接角色（转 Gen3D）、不接程序化 CAD（转 Poly）。
