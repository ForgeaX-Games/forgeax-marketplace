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

        const history = await fetchHistory();
        if (cancelled) return;

        const running = history.find((e) => e.status === "running" && !!e.id);
        if (!running || !running.id) return;
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
