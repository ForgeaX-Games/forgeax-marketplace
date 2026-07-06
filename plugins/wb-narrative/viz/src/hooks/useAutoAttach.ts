import { useEffect, useRef } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import { fetchHistory } from "./useNarrativeStream";

/**
 * 自动挂载「外部启动的 run」。
 *
 * 场景：剧情师 Kotone（或任何 agent）通过 `narrative:start-pipeline` 工具直接打后端
 * 起了一条管线 —— 后端 run 真的在跑，但 viz 的 store 从不知道它存在，于是中间预览静默、
 * 左栏选择器不动。本 hook 让 viz **自己**周期性问后端「有没有正在跑、但我还没挂上的 run」，
 * 有就挂上：设 runningRunId（→ SSE 直播中间预览）+ 回填 INPUT/ROUTING 选择器。
 *
 * 设计要点：
 * - 只有在 viz 当前**没有**在跟踪 run（runningRunId == null）时才轮询，挂上后立即停轮询
 *   （SSE 接管），run 结束后 runningRunId 复位为 null 才恢复轮询。
 * - 同一个 runId 只自动挂载一次（attemptedRef）—— 避免后端遗留的 zombie "running" 条目
 *   被反复重连造成 SSE 抖动。
 * - 手动启动走 handleStart 已先设 runningRunId，故本轮询天然被 gate 掉，互不干扰。
 */
export function useAutoAttach(): void {
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const st = useNarrativeStore.getState();
        // 已在跟踪某个 run → 交给 SSE，不抢。
        if (st.runningRunId) return;

        // §状态机重构 gate：IP 半自动预处理期间**绝不**误挂载。
        // 现象根因：ingest job 处于 awaiting_confirmation 时后端把该 run 在 history 标为
        // status:"running"，本轮询若挂上会调 startNewRun 清空 runningProgress/ipPreviewRunId，
        // 导致"标准化预览闪一下就没 + 顶栏 C0-Cn 点击无内容 + header 假 GENERATING"。
        // 存在以下任一 IP 预处理信号时跳过挂载：预览轨/磁盘键/已 push 的 ip_* 前驱步/草稿条目。
        if (st.ipPreviewRunId || st.ipRunKey) return;
        if (st.runningProgress.some((s) => s.id.startsWith("ip_"))) return;
        if (st.inputConfirmed && !st.activeEntryStatus) return; // 草稿条目（未生成）

        const history = await fetchHistory();
        if (cancelled) return;

        // 仅挂载真正的下游生成 run：排除 IP DNA 预处理条目（其活跃 job 为 awaiting_confirmation，
        // 后端仍标 running）。draft/ip-dna kind 或对应 job 未进入下游生成的，一律不挂。
        const running = history.find((e) => e.status === "running" && !!e.id);
        if (!running || !running.id) return;
        // 二次防线：本地若已锚定同名草稿/预处理条目，交给用户的「开始生成」显式驱动，不自动抢。
        if (running.key && running.key === st.activeEntryKey && st.inputConfirmed && !st.activeEntryStatus) return;
        if (attemptedRef.current.has(running.id)) return;

        // 二次确认：异步间隙里用户/SSE 可能已抢先挂载。
        if (useNarrativeStore.getState().runningRunId) return;

        attemptedRef.current.add(running.id);
        st.startNewRun(running.id, running.key, running.tier, running.mode);
        st.setActiveConfig({
          userInput: running.userInput,
          routeGroup: running.routeGroup,
          tier: running.tier ?? null,
          mode: running.mode ?? null,
          // 注意：history 不带 genreCode，故不传（传 null 会清掉品类 chip）；
          // tier/mode/userInput 足够让左栏 STEP1/2 回填出 agent 的选型。
          hydrateToken: Date.now(),
        });
      } catch {
        // 网络/解析失败静默重试，下一轮再来。
      }
    };

    // 立即探一次 + 周期轮询。
    void tick();
    timer = window.setInterval(() => void tick(), 4000);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);
}
