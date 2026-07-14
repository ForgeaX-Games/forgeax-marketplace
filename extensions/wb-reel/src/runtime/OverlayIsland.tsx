// reel-runtime · 交互浮层「React 岛」（主程 07-06 收敛 + 用户 A 决策）
//
// reel-runtime 的基底播放（video/字幕/选择层/背包搜索）是手写 vanilla DOM；
// 但 QTE / 小游戏 / 结算 三个浮层是 2000+ 行已打磨/已测的 React 组件。按用户 A 决策：
// **原样复用**这三个组件，仅在 runtime 内挂一个小 React root 作岛，由命令式状态驱动。
//
// 契约：runtime 侧持有一个 `OverlayController`，每次交互态变化调用 `setModel(...)`
// 把最新模型灌进岛；岛内 useState 提交触发这三个组件的重渲。所有回调回传给 runtime
// 的编排层（判定/切场/结算），岛本身不含任何游戏逻辑。

import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { MinigameClip, QTECue, QTESpec } from '../scenario/types';
import type { HitVerdict } from '../qte/QTEEngine';
import type { MinigameEvent } from '../player/minigameMessage';
import { QTEOverlay } from '../player/QTEOverlay';
import { MinigameOverlay } from '../player/MinigameOverlay';
import { SettlementOverlay } from '../player/SettlementOverlay';

export interface OverlayModel {
  /** QTE 节奏点层：scene 有 qte 时常驻，按 elapsed 渲染活跃 cue。 */
  qte: { spec: QTESpec; elapsed: number; verdicts: HitVerdict[]; ambientClass?: string } | null;
  /** 小游戏 iframe 浮层（触发时非空）。 */
  minigame: MinigameClip | null;
  /** QTE 失败结算屏（触发时非空）。 */
  settlement: { score: number; failedLabel: string } | null;
}

export interface OverlayCallbacks {
  onQteResolve: (cue: QTECue, deltaMs: number, holdMs?: number) => void;
  onMinigameWin: (event: MinigameEvent) => void;
  onMinigameLose: (event: MinigameEvent) => void;
  onMinigameAbort: () => void;
  onReplay: () => void;
  onBackEditor: () => void;
}

export interface OverlayController {
  setModel: (model: OverlayModel) => void;
  unmount: () => void;
}

export const EMPTY_OVERLAY_MODEL: OverlayModel = { qte: null, minigame: null, settlement: null };

function OverlayIsland({
  cb,
  bind,
}: {
  cb: OverlayCallbacks;
  bind: (setter: (m: OverlayModel) => void) => () => void;
}) {
  const [model, setModel] = useState<OverlayModel>(EMPTY_OVERLAY_MODEL);
  useEffect(() => bind(setModel), [bind]);
  return (
    <>
      {model.qte && (
        <QTEOverlay
          spec={model.qte.spec}
          elapsed={model.qte.elapsed}
          verdicts={model.qte.verdicts}
          ambientClass={model.qte.ambientClass}
          onResolve={cb.onQteResolve}
        />
      )}
      {model.minigame && (
        <MinigameOverlay
          clip={model.minigame}
          onWin={cb.onMinigameWin}
          onLose={cb.onMinigameLose}
          onAbort={cb.onMinigameAbort}
        />
      )}
      {model.settlement && (
        <SettlementOverlay
          score={model.settlement.score}
          failedLabel={model.settlement.failedLabel}
          onReplay={cb.onReplay}
          onBackEditor={cb.onBackEditor}
        />
      )}
    </>
  );
}

/** 在 container 内挂 React 岛，返回命令式控制器（runtime 侧持有）。 */
export function mountOverlayIsland(container: HTMLElement, cb: OverlayCallbacks): OverlayController {
  const root: Root = createRoot(container);
  let setter: ((m: OverlayModel) => void) | null = null;
  let latest: OverlayModel = EMPTY_OVERLAY_MODEL;
  const bind = (fn: (m: OverlayModel) => void) => {
    setter = fn;
    fn(latest); // 挂载即同步一次当前模型
    return () => {
      setter = null;
    };
  };
  root.render(<OverlayIsland cb={cb} bind={bind} />);
  return {
    setModel(model) {
      latest = model;
      setter?.(model);
    },
    unmount() {
      root.unmount();
    },
  };
}
