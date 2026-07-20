# 皮肤组件契约（overlay / interaction / HUD）

盖在视频上的展示层组件（QTE、选择、血条、漂字、转场…）都是**独立、自闭环、可替换**的 React 组件：
按 `component`（顶层组件 id）注册进 registry，运行时以 `<Comp key=… {...props}/>` 挂成子元素（各自独立 fiber / hook 作用域），
外层包了错误边界——**组件崩了只提示、自动回退，绝不拖垮游戏引擎**。json 里只需对齐 `component` 名即可切换/替换。

叩击/防反/應默/战斗技能条这类「皮肤」不是独立维度——它们各自是完全独立注册的顶层组件 id，不经由
「基础类型 + inputs 覆盖」这层间接：创建时一次性选定是哪个组件，创建后不提供「换皮肤/换类型」的编辑
入口。要不要走某种专属交互（如时间轴多拍点），永远看各自 `inputs` 里声明了什么结构，没有跨组件的
分类/家族标签。

## 三类组件的 props（输入）与 submit（输出/事件）

### 1) interaction（交互层：QTE / 选择 / 技能条 / 热点）
```ts
function MySkin({ interaction, submit, ctx }: InteractionProps) { … }
```
- `interaction`：`{ elementId, component, inputs, handles, timeoutMs? }`
  - `inputs`：该元素配置（交互目录统一 `events:[{id,label,x?,y?}]`、qte 的 `qteKind/durationMs`、你自定义的任意字段）。
  - `handles`：可用出口 id（= 各 event.id，如 `['light','heavy']`、`['pass','good','fail']`）。
- `submit(input)`：**提交玩家结果**，input = event id（引擎归一成 outcome，边用 `sourceHandle === id` 承接）：
  - choice / skill → 选项 `id`（如 `'light'`，引擎 outcome = `'light'`）。
  - qte → `'pass' | 'good' | 'fail'` 或自定义 event id。
  - hotspot → 热点 `id`。
  - 传 `undefined` = 走超时/缺省出口（引擎按 `inputs.defaultEvent` 处理）。
- `ctx?.hud`：只读游戏态 `{ entities:{[id]:{hp,maxHp}}, vars:{[id]:number}, flags, score }`（做条件显隐/数值展示用）。

### 2) overlay（表现层：漂字 / 转场 / 对话，纯展示无输入）
```ts
function MyOverlay({ overlay }: OverlayProps) { … }   // overlay = { elementId, component, inputs }
```

### 3) HUD（血条 / 数值，挂在 overlay 的 `surface:'hud'` 子件）
```ts
function MyBar({ element, ctx }: HudProps) { … }
// element = { element, show?, component?, bind?, label?, accent?, layout? }；实体数值取 ctx.hud.entities[element.bind ?? element.element]
```

## 注册 + 配置
1. 写组件（见下"自闭环规则"）。
2. 在 `skins/index.ts` 注册：`registerInteractionSkin('myId', MySkin)` 或 `registerHudRenderer('myBar', MyBar)`；
   并加进 `INTERACTION_SKINS` / `HUD_SKINS` 以出现在编辑器下拉。
3. json 对齐名字：`OverlayChild.component = 'myId'`（与 `id` 同级，**不要**写进 `inputs.component`——顶层
   `component` 字段就是唯一来源）。进 demo：`demo/nodia.graph.json`。

## 自闭环规则（可独立运行 / 直接替换）
- **只 import `react` 与 `./skinRuntime`**（`injectCss` / `ensureInkFilters` / `ensureBrushFont`）+ registry 的 props 类型。**不要** import 游戏引擎其它代码。
- 样式自己注入（`injectCss('唯一id', css)`）；需要水墨毛边滤镜就 `ensureInkFilters()`（提供 `#inkRough` / `#inkRoughNarr`）。
- 字体：`font-family` 用回退链（如 `'HYShangWei','STKaiti','KaiTi',serif`）。要与旧版逐字对齐可调 `ensureBrushFont()` 注入书法字体 HYShangWei（skinRuntime 内唯一的资产依赖，随插件入仓的 woff2；缺失时自动回落系统 KaiTi）。
- 可自由用 hooks（useState/useEffect/RAF…）——每个组件是独立 fiber，按 `elementId` 重挂。

## 错误隔离（不崩引擎）
- 组件**渲染/生命周期**抛错 → error boundary 捕获 → 顶部红色提示条 +（交互类）自动回退到默认按钮，玩家仍可推进。
- `submit` 已包 try/catch。
- ⚠ **事件回调 / RAF / setTimeout 里的异步错误 boundary 抓不到**——请在组件内自行 try/catch，避免噪音（不会崩整树，但会进 console）。
