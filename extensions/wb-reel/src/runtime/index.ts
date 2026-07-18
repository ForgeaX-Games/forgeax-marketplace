// reel-runtime · 影游作为引擎游戏的 bootstrap 入口（住 wb-reel 内的薄库）
//
// 形态（主程 07-06 收敛裁决）：reel game = `.forgeax/games/<slug>/` 的普通引擎游戏，
// 其 `main.ts` 薄壳 `export const bootstrap = createReelBootstrap(scenarioGuid)`。
// 播放走 play-runtime 统一 kind-blind 路径（createApp → import entry → bootstrap），
// host 零 kind 分支；reel-runtime 只把 DOM 播放器挂进 `ctx.uiRoot`、不画 3D。
//
// 里程碑：
//   A1 ✅ — 骨架：签名 + uiRoot 挂载/清理边界。
//   A2 ✅ — loadByGuid 拉 scenario → 校验 → registerUpdate/currentTime 时钟 → 视频/图/字幕/错误浮层。
//   A4 ⬅ — 从 Player.tsx 迁交互层：
//           A4.1 ✅ 核心状态机（enterScene/navigateTo/onSceneEnd/entryGate/onEnter effects/auto/FIN）。
//           A4.2 ⬜ ChoiceLayer · A4.3 ⬜ 多 shot · A4.4 ⬜ 数值背包/搜索 · A4.5 ⬜ QTE · A4.6 ⬜ unmute。

import type { ReelBootstrap, ReelHostContext, ReelWorld } from './engine-contract';
import { extractValidatedScenario } from '../scenario/schema/validateScenario';
import type {
  Branch,
  DialogueLine,
  InventoryItem,
  MinigameClip,
  QTECue,
  QTEHitWindow,
  Scenario,
  Scene,
  SearchHotspot,
  SearchSegmentClip,
} from '../scenario/types';
import {
  applyEffects,
  applyItemEffects,
  describeCondition,
  initVarState,
  isBranchAvailable,
  type ItemState,
  type VarState,
} from '../player/conditionEval';
import { computeEffectiveEndMs } from '../player/sceneEndTime';
import { isSegmentComplete, nextSearchToTrigger, segmentHotspots } from '../player/searchSegmentHit';
import { nextMinigameToTrigger, pendingMinigamesAtEnd } from '../player/minigameHit';
import { qteOverlayAmbientClass } from '../player/qteAmbient';
import { judgeHold, judgeTap, tallyQTE, type HitVerdict } from '../qte/QTEEngine';
import { firstFailedSlowMoCue, resolveActiveSlowMo } from '../qte/slowMo';
import type { MinigameEvent } from '../player/minigameMessage';
import {
  EMPTY_OVERLAY_MODEL,
  mountOverlayIsland,
  type OverlayController,
  type OverlayModel,
} from './OverlayIsland';
import {
  decideSceneEnd,
  isMultiShotScene,
  makeEvalContext,
  resolveActiveShot,
  resolveGateTarget,
  timedShots,
} from './sceneMachine';

/** QTE 全局命中窗兜底（忠实移植 Player.tsx:542）。 */
const DEFAULT_QTE_WINDOW: QTEHitWindow = { perfect: 80, great: 160, good: 280 };
/** QTE 浮层 elapsed 提交限频（~30Hz，与 Player COMMIT_INTERVAL_MS 一致）。 */
const QTE_COMMIT_MS = 33;

export type {
  ReelBootstrap,
  ReelHostContext,
  ReelWorld,
  ReelAssetsLike,
  ReelRegisterUpdate,
} from './engine-contract';
export * from './sceneMachine';

export interface ReelRuntimeOptions {
  /**
   * 把 `scene.media.ref`（打包后为 `./reel-media/<hash>.<ext>` 相对 URL）解析成可播 URL。
   * 默认 identity（打包相对 URL 直接用）；B1/C2 落地时注入 pack 基址 rebase / GUID→url。
   */
  resolveMediaUrl?: (ref: string) => string;
}

const ROOT_CLASS = 'reel-runtime-root';
const GATE_NOTICE_MS = 2600;

/** 解析挂载宿主：优先受控 `ctx.uiRoot`，缺省回退 `document.body`（契约允许）。 */
function resolveMountHost(ctx?: ReelHostContext): HTMLElement {
  return ctx?.uiRoot ?? document.body;
}

/** 建 reel 播放器根容器并挂进宿主（占满、relative 承载内部绝对定位层）。 */
function mountRoot(host: HTMLElement): HTMLDivElement {
  const root = host.ownerDocument.createElement('div');
  root.className = ROOT_CLASS;
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.overflow = 'hidden';
  root.style.background = '#000';
  host.appendChild(root);
  return root;
}

/** 媒体舞台层（承载 `<video>`/`<img>`）；在字幕层之下。 */
function mountStageLayer(root: HTMLElement): HTMLDivElement {
  const el = root.ownerDocument.createElement('div');
  el.className = 'reel-runtime-stage';
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.background = '#000';
  root.appendChild(el);
  return el;
}

/** 底栏电影字幕层（承载 DialogueLine 台词）。pointer-events:none 不拦交互。 */
function mountSubtitleLayer(root: HTMLElement): HTMLDivElement {
  const el = root.ownerDocument.createElement('div');
  el.className = 'reel-runtime-subtitle';
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.right = '0';
  el.style.bottom = '6%';
  el.style.textAlign = 'center';
  el.style.padding = '0 8%';
  el.style.color = '#fff';
  el.style.font = '500 clamp(14px, 3.2cqh, 32px)/1.4 system-ui, sans-serif';
  el.style.textShadow = '0 2px 6px rgba(0,0,0,0.9)';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'pre-wrap';
  root.appendChild(el);
  return el;
}

/**
 * 校验失败时把错误渲染进画面——**文本可选中/可复制**（用户偏好：诊断文本必须可复制），
 * 而不是让宿主拿到一块黑屏或让 bootstrap 抛错崩掉整个 app。
 */
function renderFatalError(root: HTMLElement, err: unknown): void {
  const box = root.ownerDocument.createElement('pre');
  box.className = 'reel-runtime-error';
  box.style.position = 'absolute';
  box.style.inset = '0';
  box.style.margin = '0';
  box.style.padding = '24px';
  box.style.overflow = 'auto';
  box.style.color = '#ff6b6b';
  box.style.font = '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace';
  box.style.whiteSpace = 'pre-wrap';
  box.style.userSelect = 'text';
  box.textContent = `影游加载失败：\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  root.appendChild(box);
}

/**
 * 求当前时刻应显示的台词。规则（见 DialogueLine 注释）：
 *   - 取 startMs ≤ elapsed 里 startMs 最大的一条为候选（"被下一条覆盖"自然成立）；
 *   - 候选若有 endMs 且 elapsed ≥ endMs → 空档，不显示；否则显示候选。
 * 纯函数，便于单测。
 */
export function activeDialogue(
  dialogue: readonly DialogueLine[],
  elapsedMs: number,
): DialogueLine | undefined {
  let candidate: DialogueLine | undefined;
  for (const d of dialogue) {
    if (d.startMs <= elapsedMs && (candidate === undefined || d.startMs >= candidate.startMs)) {
      candidate = d;
    }
  }
  if (candidate && candidate.endMs !== undefined && elapsedMs >= candidate.endMs) {
    return undefined;
  }
  return candidate;
}

/** 台词渲染文本：character 角色带 "名字：" 前缀，其余（旁白等）直出。 */
function dialogueText(d: DialogueLine): string {
  return d.role === 'character' && d.speaker ? `${d.speaker}：${d.text}` : d.text;
}

const SEARCH_STYLE_ID = 'reel-runtime-search-style';

/** 注入背包 HUD / 搜索热点层样式（每个 document 一次）。 */
function injectRuntimeSearchStyle(doc: Document): void {
  if (doc.getElementById(SEARCH_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = SEARCH_STYLE_ID;
  style.textContent = `
.reel-runtime-overlays{pointer-events:none;}
.reel-runtime-overlays>*{pointer-events:auto;}
.reel-runtime-unmute{position:absolute;left:16px;top:16px;z-index:50;display:inline-flex;align-items:center;
  gap:6px;font:500 13px/1 system-ui,sans-serif;padding:8px 14px;border-radius:999px;cursor:pointer;
  color:#fff;background:rgba(18,18,24,.82);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(8px);}
.reel-runtime-unmute:hover{background:rgba(30,30,40,.92);border-color:rgba(255,255,255,.4);}
.reel-runtime-hud{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:44;
  display:flex;align-items:center;gap:12px;}
.reel-runtime-search-btn{display:inline-flex;align-items:center;gap:6px;font:500 13px/1 system-ui,sans-serif;
  padding:7px 14px;border-radius:999px;cursor:pointer;color:#f1e6cf;
  background:rgba(18,18,24,.78);border:1px solid rgba(255,210,120,.35);}
.reel-runtime-search-btn.is-on{background:rgba(255,200,90,.92);color:#1a1408;border-color:transparent;}
.reel-runtime-inv-bar{display:flex;gap:8px;padding:7px 10px;border-radius:14px;
  background:rgba(14,14,20,.74);border:1px solid rgba(255,255,255,.1);}
.reel-runtime-inv-slot{position:relative;width:42px;height:42px;border-radius:10px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:13px;}
.reel-runtime-inv-slot img{width:90%;height:90%;object-fit:contain;}
.reel-runtime-inv-cnt{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 3px;
  border-radius:8px;background:#ffca5a;color:#1a1408;font:700 11px/16px system-ui,sans-serif;text-align:center;}
.reel-runtime-search{position:absolute;inset:0;z-index:42;cursor:zoom-in;}
.reel-runtime-spot{position:absolute;transform:translate(-50%,-50%);margin:0;padding:0;height:0;
  border-radius:999px;cursor:zoom-in;background:transparent;
  box-shadow:0 0 0 1.5px rgba(255,255,255,.18) inset;transition:box-shadow .2s,background .2s;}
.reel-runtime-spot:hover{box-shadow:0 0 0 2px rgba(255,214,120,.9) inset,0 0 26px 6px rgba(255,200,90,.45);
  background:radial-gradient(circle,rgba(255,214,120,.22),transparent 70%);}
.reel-runtime-spot-tip{position:absolute;left:50%;bottom:108%;transform:translateX(-50%);
  white-space:nowrap;background:rgba(12,12,16,.92);color:#ffe9bd;font:12px/1.3 system-ui,sans-serif;
  padding:3px 9px;border-radius:7px;border:1px solid rgba(255,210,120,.4);pointer-events:none;
  opacity:0;transition:opacity .15s;}
.reel-runtime-spot:hover .reel-runtime-spot-tip{opacity:1;}
`;
  (doc.head ?? doc.body ?? doc.documentElement).appendChild(style);
}

/**
 * 生成一个影游 game 的 `bootstrap(world, ctx)`。
 *
 * @param scenarioGuid 该影游 scenario 资产的引擎 GUID（B1 编译产物里写进薄 main.ts）。
 * @param options      可注入的运行时钩子（媒体 URL 解析等）。
 * @returns 结构上合法的 `@forgeax/engine-app#BootstrapEntry`。
 */
export function createReelBootstrap(
  scenarioGuid: string,
  options?: ReelRuntimeOptions,
): ReelBootstrap {
  if (!scenarioGuid || typeof scenarioGuid !== 'string') {
    throw new Error('[reel-runtime] createReelBootstrap: scenarioGuid 必填');
  }
  const resolveMediaUrl = options?.resolveMediaUrl ?? ((ref: string) => ref);

  return async function bootstrap(_world: ReelWorld, ctx?: ReelHostContext): Promise<void> {
    const host = resolveMountHost(ctx);
    const root = mountRoot(host);
    ctx?.registerCleanup?.(() => root.remove());

    // 加载 + fail-fast 校验。loader 返回 payload 原样（P1-B (a) 语义），校验在此。
    let scenario: Scenario;
    try {
      const payload = await ctx?.assets.loadByGuid(scenarioGuid);
      scenario = extractValidatedScenario(payload) as unknown as Scenario;
    } catch (err) {
      renderFatalError(root, err);
      return;
    }

    const stage = mountStageLayer(root);
    const subtitle = mountSubtitleLayer(root);
    const doc = root.ownerDocument;

    // ── 播放态（首阶段留闭包内；ECS Resource 化按 rev3 §6 属后续里程碑）───────────
    let vars: VarState = initVarState(scenario);
    let ownedItems: ItemState = {};
    const visited = new Set<string>();
    const appliedEnter = new Set<string>(); // onEnter* 每 scene 只应用一次
    let currentSceneId = scenario.rootSceneId;
    let elapsedMs = 0;
    // VIDEO 场景以 `<video>.currentTime` 为时钟真源；其余场景走 registerUpdate 墙钟。
    let clockFromVideo = false;
    let sceneEndFired = false; // per-scene 场景结束只触发一次
    let awaiting = false; // 选择层/QTE 等待玩家 → 停表
    let videoEl: HTMLVideoElement | null = null;
    let gateTimer: ReturnType<typeof setTimeout> | undefined;
    // 多 shot 切镜：非 null 时 advance() 每帧按 elapsed 重选落点镜（墙钟驱动）。
    let shotRenderer: ((ms: number) => void) | null = null;

    // ── 背包/搜索态（A4.4）──────────────────────────────────────────────────
    const items: Record<string, InventoryItem> = scenario.items ?? {};
    const lootedKeys = new Set<string>(); // `${sceneId}:${hotspotId}` 一轮去重
    let searching = false; // 手动搜查开关（放大镜）
    let activeSearch: SearchSegmentClip | null = null; // 段落型搜索：定格循环等玩家
    const completedSearch = new Set<string>(); // 已完成的搜索段 id

    // ── QTE / 小游戏 / 结算态（A4.5）───────────────────────────────────────
    let verdicts: HitVerdict[] = []; // 本场景已判定的 cue 结果
    let failTriggered = false; // slowMo fail 只触发一次
    let activeMinigame: MinigameClip | null = null; // 小游戏浮层激活中
    const triggeredMinigames = new Set<string>(); // 已触发过的 minigame id
    let settlement: { score: number; failedLabel: string } | null = null;
    let qteCommitMs = -QTE_COMMIT_MS; // 浮层 elapsed 提交限频游标
    // 交互浮层 React 岛：QTE/小游戏/结算原样复用已打磨组件（用户 A 决策）。
    const overlayContainer = doc.createElement('div');
    overlayContainer.className = 'reel-runtime-overlays';
    overlayContainer.style.position = 'absolute';
    overlayContainer.style.inset = '0';
    overlayContainer.style.pointerEvents = 'none'; // 子浮层各自开 pointer-events
    root.appendChild(overlayContainer);
    let overlay: OverlayController | null = null;

    const sceneOf = (id: string): Scene | undefined => scenario.scenes[id] as Scene | undefined;
    const evalCtx = (vOverride?: VarState, oOverride?: ItemState) =>
      makeEvalContext(vOverride ?? vars, visited, oOverride ?? ownedItems);

    function renderFrame(): void {
      const scene = sceneOf(currentSceneId);
      if (!scene) {
        subtitle.textContent = '';
        return;
      }
      const d = activeDialogue(scene.dialogue ?? [], elapsedMs);
      subtitle.textContent = d ? dialogueText(d) : '';
    }

    function pauseVideo(): void {
      if (videoEl) {
        try {
          videoEl.pause();
        } catch {
          /* ignore */
        }
      }
    }

    /** 场景结束只触发一次；awaiting（选择/QTE）态不触发。 */
    function fireSceneEnd(): void {
      if (sceneEndFired || awaiting) return;
      sceneEndFired = true;
      onSceneEnd();
    }

    /** 推进播放头到 ms：切镜（多 shot）、渲染字幕、搜索段触发，并在有效结束时触发 scene end。 */
    function advance(ms: number): void {
      elapsedMs = ms;
      shotRenderer?.(ms);
      renderFrame();
      const scene = sceneOf(currentSceneId);
      if (!scene) return;
      // 搜索段触发：到达某未完成段 startMs → 定格循环 + 进搜查态（停表），不落场景结束。
      if (!activeSearch) {
        const sg = nextSearchToTrigger({
          clips: scene.searchSegments ?? [],
          elapsedMs,
          completedIds: completedSearch,
        });
        if (sg) {
          enterSearchSegment(sg);
          return;
        }
      }
      // 小游戏触发：到达某未触发过的 clip startMs → 定格进浮层（停表），不落场景结束。
      if (!activeMinigame) {
        const mg = nextMinigameToTrigger({
          clips: scene.minigames ?? [],
          elapsedMs,
          triggeredIds: triggeredMinigames,
        });
        if (mg) {
          triggeredMinigames.add(mg.id);
          enterMinigame(mg);
          return;
        }
      }
      if (elapsedMs >= computeEffectiveEndMs(scene)) fireSceneEnd();
    }

    /** 场景结束决策树（忠实移植 Player.handleSceneEnd）。 */
    function onSceneEnd(): void {
      const scene = sceneOf(currentSceneId);
      if (!scene) return;
      // 兜底：场景正常播完前，所有还没玩过的 minigame 必须先玩（startMs 可能落在 effectiveEnd 之后）。
      const pending = pendingMinigamesAtEnd({ clips: scene.minigames ?? [], triggeredIds: triggeredMinigames });
      if (pending) {
        triggeredMinigames.add(pending.id);
        enterMinigame(pending);
        return;
      }
      const action = decideSceneEnd(scene, evalCtx());
      switch (action.type) {
        case 'navigate':
          navigateTo(action.targetSceneId);
          break;
        case 'choice':
          // 弹选择层前定格视频（背景可看）。
          awaiting = true;
          pauseVideo();
          openChoiceLayer(scene);
          break;
        case 'qte': {
          // QTE 结算：tally verdicts → passed?qte_pass:qte_fail 分支切场；缺分支则 FIN。
          awaiting = true;
          pauseVideo();
          const run = tallyQTE(scene.qte!, verdicts);
          const target = (scene.branches ?? []).find((b) =>
            run.passed ? b.kind === 'qte_pass' : b.kind === 'qte_fail',
          );
          if (target && scenario.scenes[target.targetSceneId]) {
            awaiting = false;
            navigateTo(target.targetSceneId);
          } else {
            showEnding();
          }
          break;
        }
        case 'ending':
          showEnding();
          break;
      }
    }

    /** 门槛感知的换场——剧情推进型跳转都走这里。被阻断则停在原地弹瞬时提示。 */
    function navigateTo(targetId: string, vOverride?: VarState, oOverride?: ItemState): void {
      const r = resolveGateTarget(scenario, targetId, evalCtx(vOverride, oOverride));
      if ('blocked' in r) {
        showGateNotice(r.hint ?? '条件不足，暂时无法进入这一节点');
        return;
      }
      enterScene(r.sceneId);
    }

    /** 选中一个分支（choice 经此）：先落地 effects/itemEffects（同步喂门槛），再换场。 */
    function takeBranch(branch: Branch): void {
      root.querySelector('.reel-runtime-choice')?.remove();
      let nextVars = vars;
      if (branch.effects?.length) {
        nextVars = applyEffects(branch.effects, vars, scenario);
        vars = nextVars;
      }
      let nextOwned = ownedItems;
      if (branch.itemEffects?.length) {
        nextOwned = applyItemEffects(branch.itemEffects, ownedItems);
        ownedItems = nextOwned;
      }
      navigateTo(branch.targetSceneId, nextVars, nextOwned);
    }

    /** 场景结束弹出选择层：可见 choice 卡片；lock 态灰显 + 悬停条件提示。 */
    function openChoiceLayer(scene: Scene): void {
      root.querySelector('.reel-runtime-choice')?.remove();
      searching = false; // 弹选择层时退出搜查，避免热点层压在卡片上
      root.querySelector('.reel-runtime-search')?.remove();
      const ctx = evalCtx();
      const choices = (scene.branches ?? [])
        .filter((b) => b.kind === 'choice')
        .map((b) => {
          const available = isBranchAvailable(b, ctx);
          return { branch: b, available, locked: !available && (b.gateMode ?? 'hide') === 'lock' };
        })
        .filter((c) => c.available || c.locked);

      const layer = doc.createElement('div');
      layer.className = 'reel-runtime-choice';
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.display = 'flex';
      layer.style.flexDirection = 'column';
      layer.style.alignItems = 'center';
      layer.style.justifyContent = 'center';
      layer.style.gap = '24px';
      layer.style.padding = '4vh 6vw';
      layer.style.background = 'rgba(2,4,8,0.42)';
      layer.style.backdropFilter = 'blur(10px) brightness(0.8)';

      const title = doc.createElement('div');
      title.className = 'reel-runtime-choice-title';
      title.textContent = '你的抉择';
      title.style.color = 'rgba(255,255,255,0.96)';
      title.style.font = '400 clamp(20px, 4cqh, 32px)/1.2 system-ui, sans-serif';
      title.style.letterSpacing = '0.16em';
      layer.appendChild(title);

      const grid = doc.createElement('div');
      grid.className = 'reel-runtime-choice-cards';
      grid.style.display = 'flex';
      grid.style.flexWrap = 'wrap';
      grid.style.gap = '20px';
      grid.style.justifyContent = 'center';
      grid.style.maxWidth = '100%';

      for (const c of choices) {
        const card = doc.createElement('button');
        card.type = 'button';
        card.className = c.locked ? 'reel-runtime-choice-card is-locked' : 'reel-runtime-choice-card';
        card.style.minWidth = '200px';
        card.style.maxWidth = '360px';
        card.style.padding = '18px 22px';
        card.style.borderRadius = '14px';
        card.style.border = '1px solid rgba(255,255,255,0.16)';
        card.style.background = 'rgba(8,10,16,0.6)';
        card.style.color = '#fff';
        card.style.textAlign = 'left';
        card.style.cursor = c.locked ? 'not-allowed' : 'pointer';
        card.style.font = 'inherit';

        const label = doc.createElement('div');
        label.className = 'reel-runtime-choice-label';
        label.textContent = c.branch.label ?? '——';
        label.style.font = '400 clamp(15px, 2.6cqh, 22px)/1.4 system-ui, sans-serif';
        card.appendChild(label);

        const targetTitle = sceneOf(c.branch.targetSceneId)?.title;
        const target = doc.createElement('div');
        target.className = 'reel-runtime-choice-target';
        target.textContent = `→ ${targetTitle ?? c.branch.targetSceneId}`;
        target.style.marginTop = '6px';
        target.style.font = '400 11px/1.3 ui-monospace, monospace';
        target.style.color = 'rgba(255,255,255,0.42)';
        card.appendChild(target);

        if (c.locked) {
          card.disabled = true;
          card.style.filter = 'grayscale(0.85) brightness(0.6)';
          card.style.opacity = '0.72';
          const hint = describeCondition(c.branch, scenario);
          if (hint) card.title = `未解锁 · 需要 ${hint}`;
          const lockHint = doc.createElement('div');
          lockHint.className = 'reel-runtime-choice-lock';
          lockHint.textContent = hint ? `🔒 需要 ${hint}` : '🔒 未解锁';
          lockHint.style.marginTop = '8px';
          lockHint.style.font = '400 12px/1.3 system-ui, sans-serif';
          lockHint.style.color = 'rgba(255,255,255,0.82)';
          card.appendChild(lockHint);
        } else {
          card.addEventListener('click', () => takeBranch(c.branch));
        }
        grid.appendChild(card);
      }

      layer.appendChild(grid);
      root.appendChild(layer);
    }

    /** 进入场景：一次性应用 onEnter 效果、记 visited、重置时钟、挂媒体、渲首帧。 */
    function enterScene(sceneId: string): void {
      root.querySelector('.reel-runtime-choice')?.remove(); // 清残留选择层
      currentSceneId = sceneId;
      root.dataset.reelScene = sceneId; // 可观察态（测试/调试）
      visited.add(sceneId);
      const scene = sceneOf(sceneId);
      if (scene && !appliedEnter.has(sceneId)) {
        appliedEnter.add(sceneId);
        if (scene.onEnterEffects?.length) vars = applyEffects(scene.onEnterEffects, vars, scenario);
        if (scene.onEnterItemEffects?.length) {
          ownedItems = applyItemEffects(scene.onEnterItemEffects, ownedItems);
        }
      }
      elapsedMs = 0;
      clockFromVideo = false;
      sceneEndFired = false;
      awaiting = false;
      videoEl = null;
      searching = false; // 换场自动退出搜查
      activeSearch = null;
      // QTE/小游戏/结算 per-scene 复位。
      verdicts = [];
      failTriggered = false;
      activeMinigame = null;
      settlement = null;
      qteCommitMs = -QTE_COMMIT_MS;
      if (scene) mountSceneMedia(scene);
      renderFrame();
      renderHud();
      renderSearchLayer();
      renderOverlays(0);
    }

    /** 门槛阻断的瞬时提示（可选中文本，2.6s 自动消失）。 */
    function showGateNotice(hint: string): void {
      let notice = root.querySelector<HTMLDivElement>('.reel-runtime-gate-notice');
      if (!notice) {
        notice = doc.createElement('div');
        notice.className = 'reel-runtime-gate-notice';
        notice.style.position = 'absolute';
        notice.style.left = '50%';
        notice.style.top = '12%';
        notice.style.transform = 'translateX(-50%)';
        notice.style.padding = '10px 18px';
        notice.style.borderRadius = '10px';
        notice.style.background = 'rgba(0,0,0,0.72)';
        notice.style.color = '#fff';
        notice.style.font = '500 15px/1.4 system-ui, sans-serif';
        notice.style.userSelect = 'text';
        notice.style.maxWidth = '80%';
        notice.style.textAlign = 'center';
        root.appendChild(notice);
      }
      notice.textContent = hint;
      if (gateTimer) clearTimeout(gateTimer);
      gateTimer = setTimeout(() => notice?.remove(), GATE_NOTICE_MS);
    }

    /** FIN 全剧终浮层。 */
    function showEnding(): void {
      root.dataset.reelEnded = 'true';
      pauseVideo();
      root.querySelector('.reel-runtime-hud')?.remove();
      root.querySelector('.reel-runtime-search')?.remove();
      renderOverlays(); // 清 QTE 浮层（reelEnded 后 model.qte=null）
      if (root.querySelector('.reel-runtime-ending')) return;
      const el = doc.createElement('div');
      el.className = 'reel-runtime-ending';
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.background = 'rgba(0,0,0,0.86)';
      el.style.color = '#fff';
      el.style.font = '600 clamp(20px, 6cqh, 56px)/1.2 system-ui, sans-serif';
      el.style.letterSpacing = '0.2em';
      el.style.userSelect = 'text';
      el.textContent = '全剧终';
      root.appendChild(el);
    }

    // ── A4.4 搜索段 / 背包 HUD / 搜索热点层 ─────────────────────────────────
    injectRuntimeSearchStyle(doc);

    /** 本场景当前应参与搜索的热点（段落型限定本段；手动搜查=全场景未拾取）。 */
    function activeHotspots(scene: Scene): SearchHotspot[] {
      const all = scene.searchLoot ?? [];
      const scoped = activeSearch ? segmentHotspots(activeSearch, all) : all;
      return scoped.filter((h) => !lootedKeys.has(`${scene.id}:${h.id}`));
    }

    /** 是否处于「搜索层可见」态：手动搜查 或 段落型搜索进行中。 */
    function searchActive(): boolean {
      return (searching || !!activeSearch) && !root.querySelector('.reel-runtime-choice') && !root.dataset.reelEnded;
    }

    /** 进入段落型搜索：定格（VIDEO 跳到 loopStart 并暂停）、停表、开搜查、渲热点。 */
    function enterSearchSegment(sg: SearchSegmentClip): void {
      activeSearch = sg;
      searching = true;
      awaiting = true; // 停表：墙钟/timeupdate 不再推进
      if (videoEl && clockFromVideo) {
        try {
          videoEl.currentTime = (sg.loopStartMs ?? sg.startMs) / 1000;
          videoEl.pause();
        } catch {
          /* 还没 ready */
        }
      }
      renderHud();
      renderSearchLayer();
    }

    /** 搜索段完成/跳过 → 标记完成、续播（VIDEO 跳到段末）、退出搜查、恢复走表。 */
    function resumeFromSearch(sg: SearchSegmentClip): void {
      completedSearch.add(sg.id);
      activeSearch = null;
      searching = false;
      awaiting = false;
      elapsedMs = Math.max(elapsedMs, sg.endMs);
      if (videoEl && clockFromVideo) {
        try {
          videoEl.currentTime = sg.endMs / 1000;
          playVideo(videoEl);
        } catch {
          /* 还没 ready */
        }
      }
      renderHud();
      renderSearchLayer();
    }

    /** 拾取热点：入袋、标记已拾取、提示，检查段落是否完成 → 自动续播。 */
    function handlePickup(h: SearchHotspot): void {
      const key = `${currentSceneId}:${h.id}`;
      if (lootedKeys.has(key)) return;
      lootedKeys.add(key);
      ownedItems = applyItemEffects([{ itemId: h.itemId, op: 'give', count: 1 }], ownedItems);
      showGateNotice(`获得「${items[h.itemId]?.name ?? '物品'}」`);
      renderHud();
      renderSearchLayer();
      // 段落型：本段热点按 completeWhen 搜完 → 自动续播。
      const scene = sceneOf(currentSceneId);
      if (activeSearch && scene) {
        const hs = segmentHotspots(activeSearch, scene.searchLoot ?? []);
        if (isSegmentComplete(activeSearch, scene.id, hs, lootedKeys)) resumeFromSearch(activeSearch);
      }
    }

    /** 背包 HUD（搜查开关 + 已有物品）。无物品且不可搜查时不渲染。 */
    function renderHud(): void {
      root.querySelector('.reel-runtime-hud')?.remove();
      const scene = sceneOf(currentSceneId);
      if (!scene || root.dataset.reelEnded) return;
      const canSearch = (scene.searchLoot ?? []).some((h) => !lootedKeys.has(`${scene.id}:${h.id}`));
      const owned = Object.entries(ownedItems)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ item: items[id], count: n }))
        .filter((x) => x.item);
      if (!canSearch && owned.length === 0) return;

      const hud = doc.createElement('div');
      hud.className = 'reel-runtime-hud';
      if (canSearch) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = `reel-runtime-search-btn${searching ? ' is-on' : ''}`;
        btn.textContent = searching ? '🔍 搜查中' : '🔍 搜查';
        btn.title = searching ? '退出搜查' : '搜查现场';
        // 段落型搜索进行中不允许手动关（须搜完）；纯手动搜查可切换。
        btn.addEventListener('click', () => {
          if (activeSearch) return;
          searching = !searching;
          renderHud();
          renderSearchLayer();
        });
        hud.appendChild(btn);
      }
      if (owned.length > 0) {
        const bar = doc.createElement('div');
        bar.className = 'reel-runtime-inv-bar';
        for (const { item, count } of owned) {
          const slot = doc.createElement('div');
          slot.className = 'reel-runtime-inv-slot';
          slot.title = item!.desc ? `${item!.name} — ${item!.desc}` : item!.name;
          const url = item!.iconMediaId ? resolveMediaUrl(item!.iconMediaId) : undefined;
          if (url) {
            const img = doc.createElement('img');
            img.src = url;
            img.alt = item!.name;
            slot.appendChild(img);
          } else {
            slot.textContent = item!.name.slice(0, 2);
          }
          if (count > 1) {
            const cnt = doc.createElement('span');
            cnt.className = 'reel-runtime-inv-cnt';
            cnt.textContent = String(count);
            slot.appendChild(cnt);
          }
          bar.appendChild(slot);
        }
        hud.appendChild(bar);
      }
      root.appendChild(hud);
    }

    /** 搜索热点层：搜查态下把未拾取热点按归一化坐标摆出、点击拾取。 */
    function renderSearchLayer(): void {
      root.querySelector('.reel-runtime-search')?.remove();
      const scene = sceneOf(currentSceneId);
      if (!scene || !searchActive()) return;
      const spots = activeHotspots(scene);
      if (spots.length === 0) return;
      const layer = doc.createElement('div');
      layer.className = 'reel-runtime-search';
      for (const h of spots) {
        const spot = doc.createElement('button');
        spot.type = 'button';
        spot.className = 'reel-runtime-spot';
        spot.dataset.hotspot = h.id;
        const sizePct = Math.max(2, (h.r ?? 0.05) * 100);
        spot.style.left = `${h.x * 100}%`;
        spot.style.top = `${h.y * 100}%`;
        spot.style.width = `${sizePct}%`;
        spot.style.paddingBottom = `${sizePct}%`;
        spot.setAttribute('aria-label', items[h.itemId]?.name ?? h.label ?? '搜查');
        const tip = doc.createElement('span');
        tip.className = 'reel-runtime-spot-tip';
        tip.textContent = items[h.itemId]?.name ?? h.label ?? '搜查';
        spot.appendChild(tip);
        spot.addEventListener('click', () => handlePickup(h));
        layer.appendChild(spot);
      }
      root.appendChild(layer);
    }

    // ── A4.5 QTE / 小游戏 / 结算（React 岛驱动）─────────────────────────────

    /** 按当前交互态构建浮层模型并灌进 React 岛。 */
    function renderOverlays(elapsedForQte = elapsedMs): void {
      const scene = sceneOf(currentSceneId);
      const model: OverlayModel = { ...EMPTY_OVERLAY_MODEL };
      if (scene?.qte && !root.dataset.reelEnded && !settlement) {
        model.qte = {
          spec: scene.qte,
          elapsed: elapsedForQte,
          verdicts,
          ambientClass: qteOverlayAmbientClass(scene),
        };
      }
      model.minigame = activeMinigame;
      model.settlement = settlement;
      overlay?.setModel(model);
    }

    /** QTE cue 判定：tap/hold 评分 → 记 verdict（去重）→ 刷新浮层。 */
    function handleQteResolve(cue: QTECue, deltaMs: number, holdMs?: number): void {
      const scene = sceneOf(currentSceneId);
      if (!scene?.qte) return;
      const window = scene.qte.window ?? DEFAULT_QTE_WINDOW;
      const v =
        cue.shape === 'hold'
          ? judgeHold(cue, window, scene.qte.score, deltaMs, holdMs ?? 0)
          : judgeTap(cue, window, scene.qte.score, deltaMs);
      if (!verdicts.some((x) => x.cueId === cue.id)) verdicts = [...verdicts, v];
      renderOverlays();
    }

    /** 子弹时间触发点失败：优先 failSceneId > qte_fail 分支 > 通用结算屏。 */
    function handleSlowMoFail(cue: QTECue): void {
      const scene = sceneOf(currentSceneId);
      if (!scene) return;
      if (videoEl) {
        try {
          videoEl.playbackRate = 1;
          videoEl.pause();
        } catch {
          /* ignore */
        }
      }
      awaiting = true;
      const explicit = cue.slowMo?.failSceneId;
      if (explicit && scenario.scenes[explicit]) {
        navigateTo(explicit);
        return;
      }
      const failBranch = (scene.branches ?? []).find((b) => b.kind === 'qte_fail');
      if (failBranch && scenario.scenes[failBranch.targetSceneId]) {
        navigateTo(failBranch.targetSceneId);
        return;
      }
      const total = tallyQTE(scene.qte ?? ({ score: {} } as never), verdicts).total;
      settlement = { score: total, failedLabel: cue.label ?? cue.shape };
      renderOverlays();
    }

    /** 触发小游戏：定格（停表 + 暂停视频）→ 挂 iframe 浮层。 */
    function enterMinigame(mg: MinigameClip): void {
      activeMinigame = mg;
      awaiting = true;
      pauseVideo();
      renderOverlays();
    }

    /** 小游戏通关 ≡ QTE 通过：有 qte_pass 分支 → 跳；否则走正常 end 流程。 */
    function handleMinigameWin(_e: MinigameEvent): void {
      const scene = sceneOf(currentSceneId);
      activeMinigame = null;
      renderOverlays();
      if (!scene) return;
      const pass = (scene.branches ?? []).find((b) => b.kind === 'qte_pass');
      if (pass && scenario.scenes[pass.targetSceneId]) {
        awaiting = false;
        navigateTo(pass.targetSceneId);
        return;
      }
      onSceneEnd();
    }

    /** 小游戏失败：有 qte_fail 分支 → 跳；否则保留浮层供玩家重试。 */
    function handleMinigameLose(_e: MinigameEvent): void {
      const scene = sceneOf(currentSceneId);
      if (!scene) return;
      const fail = (scene.branches ?? []).find((b) => b.kind === 'qte_fail');
      if (fail && scenario.scenes[fail.targetSceneId]) {
        activeMinigame = null;
        awaiting = false;
        renderOverlays();
        navigateTo(fail.targetSceneId);
        return;
      }
      // 无 fail 分支：保留 overlay（玩家可继续重试 / 放弃）。
    }

    /** 小游戏放弃：强制 qte_fail；没有则当作场景完成走 end。 */
    function handleMinigameAbort(): void {
      const scene = sceneOf(currentSceneId);
      activeMinigame = null;
      renderOverlays();
      if (!scene) return;
      const fail = (scene.branches ?? []).find((b) => b.kind === 'qte_fail');
      if (fail && scenario.scenes[fail.targetSceneId]) {
        awaiting = false;
        navigateTo(fail.targetSceneId);
        return;
      }
      onSceneEnd();
    }

    /** 从头重玩：清空所有运行时态，回根场景（结算屏「再来一次」/「返回」）。 */
    function replay(): void {
      settlement = null;
      vars = initVarState(scenario);
      ownedItems = {};
      lootedKeys.clear();
      completedSearch.clear();
      triggeredMinigames.clear();
      appliedEnter.clear();
      visited.clear();
      delete root.dataset.reelEnded;
      root.querySelector('.reel-runtime-ending')?.remove();
      enterScene(scenario.rootSceneId);
    }

    /** 建一个占满舞台的 `<video>`。默认**带声**（unmute 策略见 attemptPlayWithSound）。 */
    function makeStageVideo(url: string): HTMLVideoElement {
      const v = doc.createElement('video');
      v.className = 'reel-runtime-video';
      v.src = url;
      v.playsInline = true;
      v.preload = 'auto';
      v.draggable = false;
      v.style.position = 'absolute';
      v.style.inset = '0';
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.objectFit = 'contain';
      v.style.background = '#000';
      return v;
    }

    /** 尽力播放（不改静音态）——供搜索循环 / unmute 后续播复用。 */
    function playVideo(v: HTMLVideoElement): void {
      try {
        const p = v.play?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    }

    /**
     * A4.6 unmute 策略（忠实移植 Player.PlayerVideo）：先按**带声**播；被 autoplay 策略
     * 拒 → 降级静音再播、浮出「点击恢复声音」按钮；玩家点一下原位 unmute 续播。
     */
    async function attemptPlayWithSound(v: HTMLVideoElement): Promise<void> {
      v.muted = false;
      v.volume = 1;
      try {
        await v.play();
        hideUnmute();
      } catch {
        try {
          v.muted = true;
          await v.play();
          showUnmute();
        } catch {
          showUnmute();
        }
      }
    }

    /** 浮出「点击恢复声音」按钮（左上角）；点一下 unmute 当前视频并续播。 */
    function showUnmute(): void {
      if (root.querySelector('.reel-runtime-unmute')) return;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'reel-runtime-unmute';
      btn.title = '浏览器拒绝自动带声播放 · 点击恢复声音';
      btn.textContent = '🔇 点击恢复声音';
      btn.addEventListener('click', () => {
        if (videoEl) {
          videoEl.muted = false;
          videoEl.volume = 1;
          if (videoEl.paused) playVideo(videoEl);
        }
        hideUnmute();
      });
      root.appendChild(btn);
    }

    function hideUnmute(): void {
      root.querySelector('.reel-runtime-unmute')?.remove();
    }

    /** 视频加载失败浮层（可选中文本，方便复制诊断）。 */
    function showVideoError(v: HTMLVideoElement): void {
      const code = v.error?.code ?? 0;
      const msg =
        code === 1
          ? '视频加载中止'
          : code === 2
            ? '网络错误 · 视频加载失败'
            : code === 3
              ? '视频解码失败 · 可能格式不支持'
              : code === 4
                ? '视频源无法获取 · 资产可能已失效'
                : '视频加载失败';
      let box = root.querySelector<HTMLDivElement>('.reel-runtime-video-error');
      if (!box) {
        box = doc.createElement('div');
        box.className = 'reel-runtime-video-error';
        box.setAttribute('role', 'alert');
        box.style.position = 'absolute';
        box.style.left = '50%';
        box.style.top = '50%';
        box.style.transform = 'translate(-50%,-50%)';
        box.style.padding = '10px 16px';
        box.style.borderRadius = '10px';
        box.style.background = 'rgba(120,20,20,0.86)';
        box.style.color = '#fff';
        box.style.font = '500 14px/1.4 system-ui, sans-serif';
        box.style.userSelect = 'text';
        root.appendChild(box);
      }
      box.textContent = `⚠ ${msg}`;
    }

    /** 建一个占满舞台的 `<img>`。 */
    function makeStageImage(url: string): HTMLImageElement {
      const img = doc.createElement('img');
      img.className = 'reel-runtime-image';
      img.src = url;
      img.draggable = false;
      img.style.position = 'absolute';
      img.style.inset = '0';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      return img;
    }

    /**
     * 多 shot 切镜（墙钟驱动）：advance() 每帧按 elapsed 选落点镜；镜 id 变才换 DOM；
     * 空隙/首镜前/末镜后=黑场；video 仅视觉（不以 currentTime 为时钟），仅末镜 ended 兜底结束。
     */
    function setupMultiShot(scene: Scene): void {
      const shots = timedShots(scene);
      const lastId = shots[shots.length - 1]?.id;
      let mountedShotId: string | null = null;
      let atGap = false;

      shotRenderer = (ms: number) => {
        const active = resolveActiveShot(scene, ms);
        if (!active) {
          if (!atGap) {
            stage.replaceChildren(); // 黑场（尊重作者剪出的留白）
            videoEl = null;
            mountedShotId = null;
            atGap = true;
          }
          return;
        }
        if (active.id === mountedShotId) return; // 同镜不重挂
        atGap = false;
        mountedShotId = active.id;
        stage.replaceChildren();
        videoEl = null;
        const videoUrl = active.videoMediaRef ? resolveMediaUrl(active.videoMediaRef) : undefined;
        const imgUrl = active.keyframeMediaRef ? resolveMediaUrl(active.keyframeMediaRef) : undefined;
        if (videoUrl) {
          const v = makeStageVideo(videoUrl);
          if (active.id === lastId) v.addEventListener('ended', () => fireSceneEnd());
          v.addEventListener('error', () => showVideoError(v));
          stage.appendChild(v);
          videoEl = v;
          void attemptPlayWithSound(v);
        } else if (imgUrl) {
          stage.appendChild(makeStageImage(imgUrl));
        }
        // 无媒体镜 → 空舞台（黑）。
      };
      shotRenderer(0); // 首帧立即渲染当前镜（elapsed 由 enterScene 置 0）
    }

    /** 挂载一个场景的媒体到舞台，并设定时钟来源。 */
    function mountSceneMedia(scene: Scene): void {
      stage.replaceChildren();
      hideUnmute();
      root.querySelector('.reel-runtime-video-error')?.remove();
      clockFromVideo = false;
      videoEl = null;
      shotRenderer = null;
      const media = scene.media;
      const ref = media?.ref;

      // 多 shot 切镜：非整场视频 + ≥2 有时间码 shot。墙钟驱动（clockFromVideo=false）。
      if (isMultiShotScene(scene)) {
        setupMultiShot(scene);
        return;
      }

      if (media?.kind === 'VIDEO' && ref) {
        const v = makeStageVideo(resolveMediaUrl(ref));
        // VIDEO 场景：video.currentTime 是 elapsed 真源（画面/台词天然同步）。
        // awaiting（选择/QTE/搜索）态由手动循环控制 currentTime，不让 timeupdate 驱动时钟。
        v.addEventListener('timeupdate', () => {
          if (awaiting || sceneEndFired) return;
          advance(v.currentTime * 1000);
        });
        // 视频自然结束 → 场景结束（durationMs 略大于素材时长时的兜底，见 Player 注释）。
        v.addEventListener('ended', () => fireSceneEnd());
        v.addEventListener('error', () => showVideoError(v));
        stage.appendChild(v);
        videoEl = v;
        clockFromVideo = true;
        void attemptPlayWithSound(v);
      } else if ((media?.kind === 'IMAGE_PROMPT' || media?.kind === 'IMAGE_STATIC') && ref) {
        stage.appendChild(makeStageImage(resolveMediaUrl(ref)));
      }
      // PLACEHOLDER / 无 ref：纯台词节点，无媒体、走墙钟（"只有台词也能播"）。
    }

    /** 限频把当前 elapsed 提交给 QTE 浮层（~30Hz），供 cue 环平滑收缩。 */
    function commitQteElapsed(): void {
      if (!sceneOf(currentSceneId)?.qte) return;
      if (Math.abs(elapsedMs - qteCommitMs) < QTE_COMMIT_MS) return;
      qteCommitMs = elapsedMs;
      renderOverlays(elapsedMs);
    }

    // 时钟：registerUpdate 的 dt 为**秒**。VIDEO 以 currentTime 为真源；其余走墙钟×slowMo 速率。
    ctx?.registerUpdate((dtSec) => {
      const scene = sceneOf(currentSceneId);
      // 搜索段进行中：把 VIDEO 在 [loopStart, loopEnd] 之间循环（首尾相同的可循环段）。
      if (activeSearch && videoEl && clockFromVideo) {
        const loopStart = (activeSearch.loopStartMs ?? activeSearch.startMs) / 1000;
        const loopEnd = (activeSearch.loopEndMs ?? activeSearch.endMs) / 1000;
        if (videoEl.paused) playVideo(videoEl);
        if (videoEl.currentTime >= loopEnd || videoEl.currentTime < loopStart - 0.05) {
          try {
            videoEl.currentTime = loopStart;
          } catch {
            /* ignore */
          }
        }
      }
      if (awaiting || sceneEndFired || !scene) return;

      // slowMo：仅在场景有 QTE cue 时解算速率 + 失败检测（其余场景恒 rate=1）。
      let rate = 1;
      const cues = scene.qte?.cues ?? [];
      if (cues.length) {
        const window = scene.qte!.window ?? DEFAULT_QTE_WINDOW;
        const slow = resolveActiveSlowMo(cues, window, verdicts, elapsedMs);
        rate = slow.active ? slow.rate : 1;
        if (!failTriggered) {
          const failed = firstFailedSlowMoCue(cues, window, verdicts, elapsedMs);
          if (failed) {
            failTriggered = true;
            handleSlowMoFail(failed);
            return;
          }
        }
      }

      if (clockFromVideo) {
        // VIDEO：把 slowMo 速率写进 playbackRate；elapsed 由 currentTime 平滑跟随（供 cue 环）。
        if (videoEl) {
          try {
            if (Math.abs(videoEl.playbackRate - rate) > 0.001) videoEl.playbackRate = rate;
          } catch {
            /* ignore */
          }
          const ct = videoEl.currentTime;
          if (Number.isFinite(ct) && ct >= 0) elapsedMs = Math.min(scene.durationMs, ct * 1000);
        }
        commitQteElapsed();
        return;
      }
      // 墙钟 × slowMo 速率。
      advance(elapsedMs + dtSec * 1000 * rate);
      commitQteElapsed();
    });

    overlay = mountOverlayIsland(overlayContainer, {
      onQteResolve: handleQteResolve,
      onMinigameWin: handleMinigameWin,
      onMinigameLose: handleMinigameLose,
      onMinigameAbort: handleMinigameAbort,
      onReplay: replay,
      onBackEditor: replay, // 引擎播放态无"编辑器"，映射为从头重玩
    });

    ctx?.registerCleanup?.(() => {
      if (gateTimer) clearTimeout(gateTimer);
      overlay?.unmount();
      overlay = null;
    });

    enterScene(currentSceneId); // 进入根场景（不走门槛，与 Player 一致）
  };
}
