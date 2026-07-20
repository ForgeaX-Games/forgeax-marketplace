// reel-runtime · 场景状态机的纯决策逻辑（无 DOM / 无 React，忠实移植自 Player.tsx）
//
// 这些是 Player.tsx 交互层里 React-free 的决策核心：场景结束该干什么、进入门槛链式解析。
// 抽成纯函数便于单测，DOM 侧（index.ts）只负责调用 + 渲染。

import type { Branch, Scenario, Scene, Shot } from '../scenario/types';
import { evaluateGate, isBranchAvailable, type EvalContext } from '../player/conditionEval';

// ── 多 shot 切镜（纯函数，忠实移植自 Player.tsx:1257-1293）────────────────────

/** 取带合法时间码（endMs>startMs）的 shots，按 startMs 升序。 */
export function timedShots(scene: Scene): Shot[] {
  return (scene.shots ?? [])
    .filter(
      (s) =>
        Number.isFinite(s.startMs) &&
        Number.isFinite(s.endMs) &&
        (s.endMs as number) > (s.startMs as number),
    )
    .slice()
    .sort((a, b) => (a.startMs as number) - (b.startMs as number));
}

/** 是否走多 shot 切镜：非整场视频 + ≥2 个有时间码的 shot + 至少一镜有媒体。 */
export function isMultiShotScene(scene: Scene): boolean {
  if (scene.media?.kind === 'VIDEO') return false;
  const shots = timedShots(scene);
  if (shots.length < 2) return false;
  return shots.some((s) => s.videoMediaRef || s.keyframeMediaRef);
}

/**
 * 按当前播放时间选落点 shot：命中 [startMs,endMs) 的镜；落在镜间空隙/首镜前/末镜后
 * 返回 undefined —— 调用方据此渲染黑场（尊重作者剪出的留白，所见即所得）。
 */
export function resolveActiveShot(scene: Scene, currentMs: number): Shot | undefined {
  for (const s of timedShots(scene)) {
    if (currentMs >= (s.startMs as number) && currentMs < (s.endMs as number)) return s;
  }
  return undefined;
}

/** 构造条件求值上下文（vars + visited + 背包）。 */
export function makeEvalContext(
  vars: Record<string, number>,
  visited: Iterable<string>,
  ownedItems: Record<string, number>,
): EvalContext {
  return { vars, visitedSceneIds: new Set(visited), ownedItems };
}

/**
 * 场景是否有「可见」choice 分支（决定结束时是否弹选择层）。
 * 忠实移植 Player.handleSceneEnd:741-745：kind==='choice' 且（条件满足 或 gateMode==='lock'）。
 */
export function hasVisibleChoice(scene: Scene, ctx: EvalContext): boolean {
  return (scene.branches ?? []).some(
    (b) => b.kind === 'choice' && (isBranchAvailable(b, ctx) || (b.gateMode ?? 'hide') === 'lock'),
  );
}

/** 场景结束时的下一步动作。 */
export type SceneEndAction =
  | { type: 'choice' } // 有可见 choice → 弹选择层（A4.2 渲染）
  | { type: 'navigate'; targetSceneId: string } // auto / qte 分支直接切场
  | { type: 'qte' } // 有 qte + qte_pass/fail 分支，待 verdicts 结算（A4.5）
  | { type: 'ending' }; // 无出口 → FIN

/**
 * 决定场景结束该干什么。忠实移植 Player.handleSceneEnd:730-774 的优先级：
 *   1. 有可见 choice → 弹选择层
 *   2. auto 分支 → 切到其 target（注意：auto 不应用 effects，只有 choice 经 takeBranch 才应用）
 *   3. 有 qte + qte_pass/fail 分支 → 交给 QTE 结算（A4.5；此处仅标记）
 *   4. 否则 → FIN
 */
export function decideSceneEnd(scene: Scene, ctx: EvalContext): SceneEndAction {
  if (hasVisibleChoice(scene, ctx)) return { type: 'choice' };

  const auto = (scene.branches ?? []).find((b) => b.kind === 'auto');
  if (auto) return { type: 'navigate', targetSceneId: auto.targetSceneId };

  if (scene.qte && (scene.branches ?? []).some((b) => b.kind === 'qte_pass' || b.kind === 'qte_fail')) {
    return { type: 'qte' };
  }
  return { type: 'ending' };
}

export type GateResolution = { sceneId: string } | { blocked: true; hint?: string };

/**
 * 门槛链式解析。忠实移植 Player.resolveGateTarget:865-891：
 * 从 targetId 出发按 entryGate 链求值——满足/无门槛放行；不满足+redirect 改道继续（防环+限深 50）；
 * 不满足+block（或改道缺失/成环）→ 阻断。
 */
export function resolveGateTarget(
  scenario: Scenario,
  targetId: string,
  ctx: EvalContext,
): GateResolution {
  let cur = targetId;
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const sc = scenario.scenes[cur] as Scene | undefined;
    if (!sc || !sc.entryGate) return { sceneId: cur };
    const res = evaluateGate(sc.entryGate, ctx);
    if (res.allowed) return { sceneId: cur };
    if (res.redirectSceneId && !seen.has(res.redirectSceneId)) {
      seen.add(cur);
      cur = res.redirectSceneId;
      continue;
    }
    return { blocked: true, hint: res.hint };
  }
  return { sceneId: cur };
}

/** 便捷：取一个分支上的数值/物品副作用（choice 分支经 takeBranch 应用）。 */
export function branchEffectsOf(branch: Branch): {
  effects: Branch['effects'];
  itemEffects: Branch['itemEffects'];
} {
  return { effects: branch.effects, itemEffects: branch.itemEffects };
}
