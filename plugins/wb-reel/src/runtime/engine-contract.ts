// reel-runtime · 引擎宿主契约（窄结构镜像）
//
// ENGINE-ADOPTION: 这是 `@forgeax/engine-app` 的 `BootstrapContext` / `@forgeax/engine-ecs`
// 的 `World` 的**窄结构镜像**——只镜像 reel-runtime 实际消费的成员，type-only、编译期擦除。
//
// 为什么不直接 import 真类型：
//   - wb-reel 是独立 pnpm/vite 子模块、不在 studio workspace，`@forgeax/engine-app`
//     声明 `workspace:*` 会让 wb-reel 自身 `bun install` 失败；其 `dist` 无 `.d.ts`、
//     指向 src 又会拽入整棵 `@forgeax/engine-*` 依赖树。
//   - reel-runtime 首阶段只消费 host 传入的 `ctx`，不 runtime-import engine（ECS Resource
//     组件化按 rev3 §6 属"按需/后续"里程碑，届时才引 `@forgeax/engine-ecs`）。
//
// 防漂移：B1 生成的 game `main.ts` 里以 `export const bootstrap: BootstrapEntry = …`
// 做编译期断言（那里有真引擎类型）——若真契约变化、镜像不再兼容会在编译期炸。
// 真源：packages/editor/packages/engine/packages/app/src/game-context.ts

/** 宿主注册的每帧更新回调；`dt` 为**秒**（引擎已 clamp）。镜像 `BootstrapContext.registerUpdate`。 */
export type ReelRegisterUpdate = (fn: (dtSec: number) => void) => void;

/** 宿主的资产注册表（窄视图）；`loadByGuid` 顺 refs 递归拉齐媒体。镜像 `AssetRegistry`。 */
export interface ReelAssetsLike {
  loadByGuid<T = unknown>(guid: string): Promise<T>;
}

/**
 * 宿主 bootstrap 上下文（窄视图）。镜像 `@forgeax/engine-app#BootstrapContext` 中
 * reel-runtime 用到的成员。真 ctx 更宽（含 renderer/app/defaultScene 等），
 * 更宽 ⊆ 更窄，可安全传入本窄类型形参（参数逆变）。
 */
export interface ReelHostContext {
  /** 受控 UI 容器（`#game-ui-root`，absolute inset:0）。reel 把 DOM 播放器挂这里，
   *  Stop 时宿主整块删。缺省回退 `document.body`。 */
  readonly uiRoot?: HTMLElement;
  /** 注册每帧时钟推进。VIDEO 场景以 `<video>.currentTime` 为时钟真源，此处只推非 VIDEO 时钟。 */
  readonly registerUpdate: ReelRegisterUpdate;
  /** 资产加载（reel-game→refs→video/raw-file 递归）。 */
  readonly assets: ReelAssetsLike;
  /** 注册非 DOM 副作用的清理（removeEventListener / clearTimeout 等），Stop 时逆序 flush。
   *  DOM 由宿主删 uiRoot 兜底；缺省则宿主不支持 teardown（防御性仍注册）。 */
  readonly registerCleanup?: (fn: () => void) => void;
}

/** ECS World（不透明占位；首阶段 reel-runtime 不直接操作 world，仅签名占位）。镜像 `@forgeax/engine-ecs#World`。 */
export type ReelWorld = object;

/**
 * reel game 入口 bootstrap 签名。结构上是合法的 `@forgeax/engine-app#BootstrapEntry`
 * （`(world: World, ctx?: BootstrapContext) => void | Promise<void>`）。
 */
export type ReelBootstrap = (world: ReelWorld, ctx?: ReelHostContext) => void | Promise<void>;
