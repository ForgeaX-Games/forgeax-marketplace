/**
 * IP 半自动分步流程（蓝图 §5.1）—— 左侧 INPUT 区在上传 IP 作品后渲染的分步卡片。
 *
 * 流程：0 IP作品 → 1 摄入+标准化(含干扰过滤) → 2 体量判断 →(超线可拆解)→ 3 确认裁剪范围
 *       → 配置 ROUTING → 生成 scoped IP DNA + 下游叙事生成（自动串跑）。
 *
 * 左侧步骤号用纯数字；中间管线预览节点用 C0–C4 前缀（与策划 D0–D4 区分）。
 * C0 提供「自动」（全程默认直跑）与「执行」（半自动逐步确认）两个入口；其余步骤为执行/确认。
 * 同一套阶段门能力另经 narrative:ip-dna-* 工具暴露给右侧平台 agent，故此处不设「交给 AI」入口。
 * 每确认一步即把该步产物推给中间预览（由父组件通过 onStageProgress 驱动）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ipDnaIngest,
  fetchIpDnaJob,
  fetchIpDnaHierarchy,
  fetchIpHierarchy,
  ipDnaConfirmScope,
  ipDnaConfirmUnits,
  ipDnaDecompose,
  ipDnaGenerate,
  startIpDnaRun,
  type IpDnaFilePayload,
  type IpHierarchyResult,
  type IpHierarchyNode,
  type IpDnaJobStartResponse,
  type IpDnaJobStatus,
} from "../../hooks/useNarrativeStream";
import type { TierId, ModeId } from "../../types";

/** 顶层上传单体的展示信息（类型抽象符号）。 */
export interface IpUploadDisplay {
  name: string;
  kind: "text" | "docx" | "binary";
  fileType?: string;
}

/**
 * 改编规划一行（§5.1）：一行 = 一部 = 一个游戏单元。
 * levelPath[k] = 第 k+1 层选中的节点 id；"" / 不存在表示该层及以下"全部"（不再下钻）。
 */
interface PlanRow {
  id: string;
  levelPath: string[];
}

interface IpStageFlowProps {
  files: IpDnaFilePayload[];
  displayItems: IpUploadDisplay[];
  title?: string;
  tier?: TierId;
  mode?: ModeId;
  complexity?: number;
  /** ROUTING 是否已配置（叙事路由/品类已选）。与裁剪范围都就绪时"开始生成"才亮。 */
  routingReady?: boolean;
  /**
   * 半自动每步产物推给中间预览（step id ∈ ip_input/ip_standardize/ip_volume/ip_adapt_plan/ip_dna_extract）。
   * data 为该步可读正文：文本直接展示，图片/视频等以 @文件名 符号表示（中间文本视图据此渲染）。
   */
  onStageProgress?: (stepId: string, status: "running" | "completed", message?: string, data?: unknown) => void;
  /** 生成开始（jobId）回调，供父组件接管轮询/预览。 */
  onGenerateStarted?: (jobId: string, runId: string) => void;
}

type Stage = "idle" | "ingesting" | "standardized" | "scope_confirmed" | "generating" | "done" | "error";

/** 文件类型抽象符号。 */
function typeSymbol(item: IpUploadDisplay): string {
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "tar", "gz", "tgz"].includes(ext)) return "📦";
  if (item.kind === "docx" || ["doc", "docx"].includes(ext)) return "📄";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "🎬";
  if (["mp3", "wav", "m4a"].includes(ext)) return "🎵";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "🖼️";
  if (ext === "pdf") return "📕";
  return "📝";
}

/** C0 输入正文：文本类直接展示内容，多模态/二进制以 @文件名 符号表示。 */
function buildInputContent(files: IpDnaFilePayload[], items: IpUploadDisplay[]): string {
  const blocks = items.map((it, i) => {
    const f = files[i];
    const sym = typeSymbol(it);
    if (it.kind === "text" && typeof f?.content === "string" && f.content.trim()) {
      const body =
        f.content.length > 4000
          ? `${f.content.slice(0, 4000)}\n\n…（正文较长已截断，完整内容已交付后端标准化处理）`
          : f.content;
      return `### ${sym} ${it.name}\n\n${body}`;
    }
    // 多模态/压缩包/二进制：不展开正文，以 @文件名 符号表示。
    return `### ${sym} ${it.name}\n\n@${it.name}`;
  });
  return blocks.join("\n\n---\n\n");
}

/** C1 标准化层级：渲染层级树为缩进列表，附干扰项过滤摘要。可由完整 ingest 结果或只读层级摘要驱动。 */
function buildHierarchyContent(hierarchy: IpHierarchyNode[], noiseFiltered?: string[]): string {
  const byParent = new Map<string | null, IpHierarchyNode[]>();
  for (const n of hierarchy) {
    const k = n.parent ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  const ids = new Set(hierarchy.map((n) => n.id));
  const roots = hierarchy.filter((n) => !n.parent || !ids.has(n.parent));
  const lines: string[] = ["# 标准化 · 层级化文件系统\n"];
  const walk = (nodes: IpHierarchyNode[], depth: number): void => {
    for (const n of [...nodes].sort((a, b) => a.index - b.index)) {
      lines.push(`${"  ".repeat(depth)}- ${n.title}${n.childRange ? `（第 ${n.childRange}）` : ""}`);
      walk(byParent.get(n.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  if (noiseFiltered && noiseFiltered.length > 0) {
    lines.push(`\n> 已过滤 ${noiseFiltered.length} 个干扰项：${noiseFiltered.join("、")}`);
  }
  return lines.join("\n");
}

/** C2 体量判断正文。 */
function buildVolumeContent(h: IpHierarchyResult): string {
  const v = h.volume;
  if (!v) return "# 体量判断\n\n—";
  return [
    "# 体量判断\n",
    `- 判定依据：${v.thresholdBasis}`,
    `- 字符量：${v.charCount}`,
    `- 是否短篇：${v.isShort ? "是" : "否"}`,
    `- 是否超线建议拆解：${v.needsDecompose ? `是（建议 ${v.suggestedChunks} 块）` : "否"}`,
  ].join("\n");
}

const POLL_MS = 1500;

/** 前驱节点顺序（与中间预览 ip_* step id 对齐；改编规划=范围裁剪+游戏单元合并，§5.1）。 */
const IP_AUTO_STEPS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"] as const;

/**
 * 全自动 job 的 current_stage(phase) → 当前所处前驱节点下标，用于轮询时把 C0..Cn 逐步点亮
 * （≤idx-1 标 completed，idx 标 running），而不是拿到 jobId 就一次性全完成。
 * phase1 内部含体量判断，故 ip_volume 无独立 phase；phase2b_adapt 覆盖改编规划（范围+单元）。
 */
const PHASE_TO_STEP_INDEX: Record<string, number> = {
  pending: 0,
  phase0: 0,
  phase1: 1,
  phase2b_adapt: 3,
  phase2_extract: 4,
  quality: 4,
  mapping: 4,
  generation: 4,
  done: 5,
};

export function IpStageFlow(props: IpStageFlowProps) {
  const { files, displayItems, title, tier, mode, complexity, routingReady = true } = props;

  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<IpHierarchyResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * 改编规划行（§5.1）：一行 = 一个游戏单元（部）。levelPath[k] = 第 k+1 层选中的节点 id；
   * "" 表示该层及以下"全选"（不再下钻）。默认 1 行（第一部 = 整部作品 → 单品）。
   * 行数即游戏单元数：1 行=单品 single；≥2 行=系列 series（部=游戏单元）。
   */
  const [rows, setRows] = useState<PlanRow[]>([{ id: "r1", levelPath: [] }]);
  const rowSeq = useRef(2);
  /** 自定义补充（§5.1 自由文本）：作者改编意图，空＝忠实转化。 */
  const [adaptationNotes, setAdaptationNotes] = useState<string>("");
  const [progress, setProgress] = useState<{ pct: number; message?: string } | null>(null);
  /** 自动模式 runId（hierarchy 未建时由 /start 的 story_timestamp 回填，修 bug#1）。 */
  const [autoRunId, setAutoRunId] = useState<string>("");

  const runId = hierarchy?.run_id || autoRunId;

  const pollJob = useCallback(
    async (
      jobId: string,
      onDone: (result: NonNullable<IpHierarchyResult>["confirmation"] | unknown) => void,
      onTick?: (st: IpDnaJobStatus) => void,
    ): Promise<void> => {
      return new Promise((resolve) => {
        const tick = async () => {
          try {
            const st = await fetchIpDnaJob(jobId);
            setProgress({ pct: st.progress ?? 0, message: st.message });
            onTick?.(st);
            if (st.status === "awaiting_confirmation" || st.status === "completed") {
              onDone(st.result);
              resolve();
              return;
            }
            if (st.status === "failed" || st.status === "cancelled") {
              setError(st.status === "cancelled" ? "已取消生产" : (st.error ?? "任务失败"));
              setStage("error");
              resolve();
              return;
            }
          } catch (e) {
            setError((e as Error).message);
          }
          setTimeout(tick, POLL_MS);
        };
        void tick();
      });
    },
    [],
  );

  // ── 自动模式：全程走默认（默认全量 / 默认体量切分），一路直跑无暂停 ──
  const handleAuto = useCallback(async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("generating");
    props.onStageProgress?.("ip_input", "completed", `${files.length} 个上传单体`, buildInputContent(files, displayItems));
    props.onStageProgress?.("ip_standardize", "running", "自动模式：全程默认直跑");
    try {
      const resp = await startIpDnaRun(files, {
        title,
        tier,
        generationMode: mode,
        complexity,
        runGeneration: true,
      });
      const jobId = (resp as IpDnaJobStartResponse).jobId;
      // 修 bug#1：从 /start 回传 story_timestamp 立即捕获 runId，回传父组件做预览/落盘关联（不再传空）。
      const ipRunId = (resp as IpDnaJobStartResponse).story_timestamp ?? "";
      if (ipRunId) setAutoRunId(ipRunId);
      if (jobId) {
        props.onGenerateStarted?.(jobId, ipRunId);
        // 自动模式无逐步确认，但仍要让中间预览看到每步正文：一旦层级落盘即拉只读摘要补 standardize 正文。
        let hierFetched = false;
        await pollJob(
          jobId,
          () => {
            for (const s of IP_AUTO_STEPS) props.onStageProgress?.(s, "completed");
            // 自动模式默认全量改编 / 按体量定档：给改编规划/提取节点补可读默认正文，避免"暂无数据"。
            props.onStageProgress?.("ip_adapt_plan", "completed", "全量 · 按体量定档", "# 改编规划\n\n- 改编范围：全量改编（自动模式未裁剪）\n- 游戏单元：按体量自动定档（>1 单元成系列）\n- 自定义补充：（自动模式未填，忠实转化）");
            props.onStageProgress?.("ip_dna_extract", "completed", "scoped IP DNA 已生成", "# 生成 scoped IP DNA\n\n- 已按全量范围提取结构化 IP DNA，并进入下游叙事管线生成游戏叙事资产。");
            setStage("done");
          },
          async (st) => {
            // 按 job 实际 phase 逐步点亮前驱节点（C0→C4），不再瞬间全完成。
            const idx = PHASE_TO_STEP_INDEX[st.current_stage ?? ""] ?? -1;
            if (idx >= 0) {
              for (let i = 0; i < Math.min(idx, IP_AUTO_STEPS.length); i++) {
                props.onStageProgress?.(IP_AUTO_STEPS[i], "completed");
              }
              if (idx < IP_AUTO_STEPS.length) {
                props.onStageProgress?.(IP_AUTO_STEPS[idx], "running", st.message);
              }
            }
            // 层级一旦就绪（phase1+ 且拿到 run/story id），拉只读摘要补标准化正文（容错：拉不到则仅状态点亮）。
            if (!hierFetched && idx >= 1) {
              const ipId = st.result?.run_id ?? st.story_timestamp;
              if (ipId) {
                hierFetched = true;
                try {
                  const summary = await fetchIpDnaHierarchy(ipId);
                  if (summary) {
                    props.onStageProgress?.(
                      "ip_standardize",
                      "completed",
                      `${summary.node_count} 个节点`,
                      buildHierarchyContent(summary.hierarchy),
                    );
                  }
                } catch { /* 容错：拉不到层级摘要则保持仅状态点亮 */ }
              }
            }
          },
        );
      } else {
        for (const s of IP_AUTO_STEPS) props.onStageProgress?.(s, "completed");
        setStage("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, files, displayItems, title, tier, mode, complexity, runId, pollJob, props]);

  // ── 执行：① 摄入 + 标准化（半自动，停在标准化等确认）──
  const handleIngest = useCallback(async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("ingesting");
    props.onStageProgress?.("ip_input", "completed", `${files.length} 个上传单体`, buildInputContent(files, displayItems));
    props.onStageProgress?.("ip_standardize", "running", "标准化 + 干扰项过滤");
    try {
      const resp = await ipDnaIngest(files, { title, decompose: false, async: true });
      const jobId = (resp as unknown as IpDnaJobStartResponse).jobId;
      if (!jobId) {
        // 同步返回（小文件）：直接是 hierarchy 结果。
        const h = resp as IpHierarchyResult;
        setHierarchy(h);
        setStage("standardized");
        props.onStageProgress?.("ip_standardize", "completed", `${h.noise_filtered?.length ?? 0} 干扰项已过滤`, buildHierarchyContent(h.hierarchy, h.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", h.volume?.thresholdBasis, buildVolumeContent(h));
        return;
      }
      await pollJob(jobId, (result) => {
        const h = result as IpHierarchyResult;
        setHierarchy(h);
        setStage("standardized");
        props.onStageProgress?.("ip_standardize", "completed", `${h.noise_filtered?.length ?? 0} 干扰项已过滤`, buildHierarchyContent(h.hierarchy, h.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", h.volume?.thresholdBasis, buildVolumeContent(h));
      });
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, files, displayItems, title, pollJob, props]);

  // ── 拆解（超线时）──
  const handleDecompose = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    try {
      props.onStageProgress?.("ip_decompose", "running", "拆解 · 再标准化");
      const res = await ipDnaDecompose(runId);
      // 修 bug#4：拆解后重算体量——优先重拉权威 hierarchy(含新 volume)，刷新 C1/C2；
      // 失败则按返回回填并清除"建议拆解"标记，避免"建议拆解"残留。
      try {
        const fresh = await fetchIpHierarchy(runId);
        setHierarchy(fresh);
        props.onStageProgress?.("ip_standardize", "completed", `${fresh.node_count} 个节点`, buildHierarchyContent(fresh.hierarchy, fresh.noise_filtered));
        props.onStageProgress?.("ip_volume", "completed", fresh.volume?.thresholdBasis, buildVolumeContent(fresh));
      } catch {
        setHierarchy((prev) =>
          prev
            ? {
                ...prev,
                hierarchy: res.hierarchy,
                node_count: res.node_count,
                volume: prev.volume ? { ...prev.volume, needsDecompose: false } : prev.volume,
              }
            : prev,
        );
      }
      props.onStageProgress?.("ip_decompose", "completed", `拆解为 ${res.chunk_count} 块`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, runId, props]);

  // ── ③ 确认裁剪范围（递归嵌套折叠树，§4.4 第①步 / 蓝图 §4 嵌套裁剪契约）──
  const childrenById = useCallback(
    (id: string): IpHierarchyNode[] =>
      (hierarchy?.hierarchy.filter((n) => n.parent === id) ?? []).sort((a, b) => a.index - b.index),
    [hierarchy],
  );

  /** 层级树根（complete 节点）id。 */
  const rootId = useMemo(
    () => hierarchy?.hierarchy.find((n) => n.levelType === "complete" || !n.parent)?.id ?? null,
    [hierarchy],
  );

  /** 顶层节点（complete 直挂 = 各"部/卷"），按 index 排序。 */
  const topNodes = useMemo<IpHierarchyNode[]>(
    () =>
      hierarchy
        ? hierarchy.hierarchy
            .filter((n) => hierarchy.hierarchy.find((p) => p.id === n.parent)?.levelType === "complete")
            .sort((a, b) => a.index - b.index)
        : [],
    [hierarchy],
  );

  /** 层级树最大深度（不含 root）：决定每行级联下拉列数（2/3/4 层，由作品实际嵌套决定，§D1）。 */
  const maxDepth = useMemo(() => {
    if (!hierarchy || !rootId) return 1;
    const depthOf = (id: string, d: number): number => {
      const kids = hierarchy.hierarchy.filter((n) => n.parent === id);
      return kids.length === 0 ? d : Math.max(...kids.map((k) => depthOf(k.id, d + 1)));
    };
    return Math.max(1, depthOf(rootId, 0));
  }, [hierarchy, rootId]);

  /** 收集某子树的最小叙事单元（叶）id（文档序）——供 unitRange 起止用。 */
  const collectLeaves = useCallback(
    (nodeId: string): string[] => {
      const walk = (id: string): string[] => {
        const kids = childrenById(id);
        return kids.length === 0 ? [id] : kids.flatMap((k) => walk(k.id));
      };
      return walk(nodeId);
    },
    [childrenById],
  );

  /** 一行的"解析节点" = levelPath 最后一个非空选项；全空 = 整部作品（root）。 */
  const resolvedNodeId = useCallback((row: PlanRow): string | null => {
    for (let k = row.levelPath.length - 1; k >= 0; k--) {
      if (row.levelPath[k]) return row.levelPath[k];
    }
    return null;
  }, []);

  /** rows → scope_selections（各行解析子树）+ full（仅 1 行且整部时全量，§D2）。 */
  const rowsToScope = useCallback((): { selections: { nodeId: string }[]; full: boolean } => {
    const resolved = rows.map((r) => resolvedNodeId(r));
    if (rows.length === 1 && resolved[0] === null) return { selections: [], full: true };
    const selections = resolved.filter((id): id is string => !!id).map((nodeId) => ({ nodeId }));
    return selections.length === 0 ? { selections: [], full: true } : { selections, full: false };
  }, [rows, resolvedNodeId]);

  /** rows → 显式 game_unit_plan（行→GameUnit 1:1，§D3，修 bug#2）。 */
  const rowsToGameUnitPlan = useCallback((): {
    mode: "single" | "series";
    units: Array<{ index: number; partId?: string; unitRange: { start: string; end: string }; boundary: "hard" }>;
    userSpecified: boolean;
  } => {
    const units = rows
      .map((r, i) => {
        const nodeId = resolvedNodeId(r) ?? rootId;
        const leaves = nodeId ? collectLeaves(nodeId) : [];
        if (leaves.length === 0) return null;
        return {
          index: i + 1,
          partId: r.levelPath[0] || nodeId || undefined,
          unitRange: { start: leaves[0], end: leaves[leaves.length - 1] },
          boundary: "hard" as const,
        };
      })
      .filter((u): u is NonNullable<typeof u> => !!u);
    return { mode: rows.length >= 2 ? "series" : "single", units, userSpecified: true };
  }, [rows, resolvedNodeId, rootId, collectLeaves]);

  /** 改编规划预览正文（裁剪行 + 单元 + 补充摘要），推给中间预览 ip_adapt_plan。 */
  const buildPlanContent = useCallback(
    (full: boolean, plan: { mode: string; units: unknown[] }): string => {
      const labelOf = (id: string | null): string =>
        id ? hierarchy?.hierarchy.find((n) => n.id === id)?.title ?? id : "整部作品";
      const lines = [
        "# 改编规划\n",
        `- 模式：${plan.mode === "series" ? "系列（多游戏单元）" : "单品（单游戏单元）"}`,
        `- 游戏单元数：${plan.units.length}`,
        "",
        "## 改编范围（行=部=游戏单元）",
      ];
      rows.forEach((r, i) => {
        lines.push(`- 第 ${i + 1} 部：${labelOf(resolvedNodeId(r))}${full && rows.length === 1 ? "（全量）" : ""}`);
      });
      lines.push("", "## 自定义补充（作者改编意图）");
      lines.push(adaptationNotes.trim() || "（未填写 → 忠实把原 IP 转化为目标品类叙事）");
      return lines.join("\n");
    },
    [rows, hierarchy, resolvedNodeId, adaptationNotes],
  );

  // ── 改编规划行编辑 ──
  const updateRowLevel = useCallback((rowId: string, lvl: number, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        // 改某层即截断更深层（父变则子选择失效）；空值＝该层全选。
        const next = r.levelPath.slice(0, lvl);
        if (value) next[lvl] = value;
        return { ...r, levelPath: next };
      }),
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => {
      const id = `r${rowSeq.current++}`;
      // 新增部默认占用下一个未被选中的顶层节点（便于系列分部，避免重复整部）。
      const used = new Set(prev.map((r) => r.levelPath[0]).filter(Boolean));
      const nextTop = topNodes.find((n) => !used.has(n.id));
      return [...prev, { id, levelPath: nextTop ? [nextTop.id] : [] }];
    });
  }, [topNodes]);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  }, []);

  /** 重新规划（修 bug#6）：scope 确认后复位到标准化态，重开行编辑。 */
  const handleReplan = useCallback(() => {
    if (busy || stage === "generating" || stage === "done") return;
    setStage("standardized");
  }, [busy, stage]);

  // ── 改编规划：单一确认（范围裁剪 + 游戏单元 + 自定义补充，§D4）──
  const handleConfirmPlan = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    setError(null);
    try {
      const { selections, full } = rowsToScope();
      const plan = rowsToGameUnitPlan();
      // 顺序提交：范围+补充 → 游戏单元（增量合并、幂等）。
      await ipDnaConfirmScope(runId, {
        scopeSelections: full ? [] : selections,
        scopeFull: full,
        adaptationNotes: adaptationNotes.trim() || undefined,
      });
      await ipDnaConfirmUnits(runId, { gameUnitPlan: plan });
      setStage("scope_confirmed");
      props.onStageProgress?.(
        "ip_adapt_plan",
        "completed",
        `${plan.units.length} 单元 · ${full ? "全量" : `${selections.length} 处裁剪`}`,
        buildPlanContent(full, plan),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, runId, rowsToScope, rowsToGameUnitPlan, adaptationNotes, buildPlanContent, props]);

  // ── 开始生成（提取 + 下游自动串跑）：改编规划已在确认步落盘，此处仅 generate（修 bug#3）──
  const handleGenerate = useCallback(async () => {
    if (busy || !runId) return;
    setBusy(true);
    setError(null);
    setStage("generating");
    const extractText = [
      "# 生成 scoped IP DNA\n",
      `- 作品：${hierarchy?.title ?? title ?? runId}`,
      `- 层级节点：${hierarchy?.node_count ?? 0}`,
      "- 已按确认的改编规划（裁剪范围 + 游戏单元）提取结构化 IP DNA，进入下游叙事管线生成游戏叙事资产。",
    ].join("\n");
    props.onStageProgress?.("ip_dna_extract", "running", "生成 scoped IP DNA", extractText);
    try {
      const resp = await ipDnaGenerate(runId, {
        tier,
        generationMode: mode,
        complexity,
        async: true,
      });
      const jobId = (resp as unknown as IpDnaJobStartResponse).jobId;
      if (jobId) {
        props.onGenerateStarted?.(jobId, runId);
        await pollJob(jobId, () => {
          setStage("done");
          props.onStageProgress?.("ip_dna_extract", "completed");
        });
      } else {
        setStage("done");
        props.onStageProgress?.("ip_dna_extract", "completed");
      }
    } catch (e) {
      setError((e as Error).message);
      setStage("error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, runId, mode, tier, complexity, hierarchy, title, pollJob, props]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const scopeReady = stage === "scope_confirmed" || stage === "generating" || stage === "done";
  const generateEnabled = scopeReady && routingReady && stage !== "generating" && stage !== "done";

  return (
    <div className="ip-stage-flow">
      {/* 0 IP 作品 */}
      <div className="ip-stage-card">
        <div className="ip-stage-card__head">
          <span className="ip-stage-card__no">0</span>
          <span className="ip-stage-card__title">IP 作品</span>
        </div>
        <div className="ip-stage-items">
          {displayItems.map((it, i) => (
            <div key={i} className="ip-stage-item" title={it.name}>
              <span className="ip-stage-item__sym">{typeSymbol(it)}</span>
              <span className="ip-stage-item__name">{it.name}</span>
            </div>
          ))}
        </div>
        {stage === "idle" && (
          <div className="ip-stage-card__foot">
            <button
              className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--auto"
              disabled={busy || files.length === 0}
              onClick={handleAuto}
              title="全程走默认（全量 / 体量自动切分），一路直跑无暂停"
            >
              自动
            </button>
            <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy || files.length === 0} onClick={handleIngest}>
              执行
            </button>
          </div>
        )}
      </div>

      {stage === "ingesting" && (
        <div className="ip-stage-progress">标准化处理中… {progress?.pct ?? 0}% {progress?.message ?? ""}</div>
      )}

      {/* 1 标准化（可展开嵌套目录） + 2 体量 + 3 裁剪范围 */}
      {hierarchy && stage !== "ingesting" && (
        <>
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">1</span>
              <span className="ip-stage-card__title">标准化 · 层级化文件系统</span>
            </div>
            <div className="ip-stage-tree">
              {topNodes.map((node) => (
                <div key={node.id} className="ip-tree-group">
                  <button className="ip-tree-toggle" onClick={() => toggleExpand(node.id)}>
                    <span className="ip-tree-caret">{expanded.has(node.id) ? "▾" : "▸"}</span>
                    <span className="ip-tree-label">{node.title}</span>
                    {node.childRange && <span className="ip-tree-range">第 {node.childRange}</span>}
                  </button>
                  {expanded.has(node.id) && (
                    <div className="ip-tree-children">
                      {childrenById(node.id).map((c) => (
                        <div key={c.id} className="ip-tree-child">· {c.title}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {hierarchy.noise_filtered && hierarchy.noise_filtered.length > 0 && (
              <p className="wb-helper ip-stage-noise">已过滤 {hierarchy.noise_filtered.length} 个干扰项：{hierarchy.noise_filtered.slice(0, 4).join("、")}{hierarchy.noise_filtered.length > 4 ? "…" : ""}</p>
            )}
          </div>

          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">2</span>
              <span className="ip-stage-card__title">体量判断</span>
            </div>
            <p className="wb-helper">{hierarchy.volume?.thresholdBasis ?? "—"}</p>
            {hierarchy.volume?.needsDecompose && (
              <>
                <p className="wb-helper ip-stage-warn">超出体量水准线，建议拆解</p>
                <div className="ip-stage-card__foot">
                  <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleDecompose}>执行拆解</button>
                </div>
              </>
            )}
          </div>

          {/* 3 改编规划（§5.1 合并：范围裁剪 + 游戏单元 + 自定义补充，一卡一确认） */}
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">3</span>
              <span className="ip-stage-card__title">改编规划</span>
            </div>
            <p className="wb-helper">
              每行 = 一部 = 一个游戏单元；逐层下钻选裁剪范围，留「全部」即整部。1 行=单品，≥2 行=系列。
            </p>
            <div className="ip-plan-rows">
              {rows.map((row, ri) => (
                <div key={row.id} className="ip-plan-row">
                  <span className="ip-plan-row__no">第 {ri + 1} 部</span>
                  <div className="ip-plan-row__levels">
                    {Array.from({ length: maxDepth }).map((_, lvl) => {
                      const options =
                        lvl === 0 ? topNodes : row.levelPath[lvl - 1] ? childrenById(row.levelPath[lvl - 1]) : [];
                      const disabled = scopeReady || (lvl > 0 && !row.levelPath[lvl - 1]) || options.length === 0;
                      return (
                        <select
                          key={lvl}
                          className="ip-scope-select"
                          value={row.levelPath[lvl] ?? ""}
                          disabled={disabled}
                          onChange={(e) => updateRowLevel(row.id, lvl, e.target.value)}
                        >
                          <option value="">{lvl === 0 ? "全部（整部）" : "全部"}</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>{o.title}</option>
                          ))}
                        </select>
                      );
                    })}
                  </div>
                  {!scopeReady && rows.length > 1 && (
                    <button type="button" className="ip-plan-row__del" onClick={() => removeRow(row.id)} aria-label="删除此部">
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!scopeReady && (
              <button type="button" className="ip-plan-add" onClick={addRow}>
                ＋ 新增一部（+1 游戏单元 → 系列）
              </button>
            )}
            <div className="ip-plan-notes">
              <label className="wb-helper">自定义补充（作者改编意图，可留空＝忠实转化）</label>
              <textarea
                className="ip-plan-notes__input"
                rows={3}
                placeholder="例如：背景从古代改为近未来赛博朋克；主角性别反转；保留主线、弱化感情线…（留空则忠实转化为目标品类叙事）"
                value={adaptationNotes}
                disabled={scopeReady}
                onChange={(e) => setAdaptationNotes(e.target.value)}
              />
            </div>
            {!scopeReady ? (
              <div className="ip-stage-card__foot">
                <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleConfirmPlan}>
                  确认改编规划
                </button>
              </div>
            ) : (
              <div className="ip-stage-card__foot">
                <p className="wb-helper ip-stage-ok">✓ 改编规划已确认（{rows.length} 单元） · 请在下方 ROUTING 配置叙事路由</p>
                {stage !== "generating" && stage !== "done" && (
                  <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleReplan}>
                    重新规划
                  </button>
                )}
              </div>
            )}
          </div>

          {/* C4/C5 开始生成 */}
          <div className="ip-stage-generate">
            {!scopeReady && <p className="wb-helper">先确认改编规划</p>}
            {scopeReady && !routingReady && <p className="wb-helper">在下方 ROUTING 选择叙事路由后即可生成</p>}
            <div className="ip-stage-card__foot">
              <button className="btn-generate btn-generate--compact ip-stage-gen-btn" disabled={!generateEnabled || busy} onClick={handleGenerate}>
                {stage === "done" ? "✓ 已生成" : stage === "generating" ? `生成中… ${progress?.pct ?? 0}%` : "开始生成（IP DNA → 下游）"}
              </button>
            </div>
          </div>
        </>
      )}

      {error && <p className="ip-stage-error">{error}</p>}
    </div>
  );
}

export default IpStageFlow;
