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
 * 改编规划一行（§5.1）：一行 = 一部 = 一个游戏单元 = 一个区间 [起点 ~ 终点]。
 * startPath/endPath[k] = 第 k+1 层选中的节点 id；"" / 不存在表示该层及以下"全部"（不再下钻）。
 * 起点取其解析子树的"首叶"，终点取解析子树的"末叶"（文档序），构成游戏单元的最小单元闭区间。
 */
interface PlanRow {
  id: string;
  startPath: string[];
  endPath: string[];
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

type Stage = "idle" | "confirmed" | "ingesting" | "standardized" | "scope_confirmed" | "generating" | "done" | "error";

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
   * 改编规划行（§5.1）：一行 = 一个游戏单元（部）= 一个区间 [起点 ~ 终点]。默认 1 行（整部作品 → 单品）。
   * 行数即游戏单元数：1 行=单品 single；≥2 行=系列 series（部=游戏单元）。
   */
  const [rows, setRows] = useState<PlanRow[]>([{ id: "r1", startPath: [], endPath: [] }]);
  const rowSeq = useRef(2);
  /** 自定义补充（§5.1 自由文本）：作者改编意图，空＝忠实转化。 */
  const [adaptationNotes, setAdaptationNotes] = useState<string>("");
  /**
   * 体量门控（点 4 逐步）：pending=等用户在卡 2 抉择/确认；crop=进入改编范围裁剪；
   * redecompose=正在再标准化（拆解中）。卡 3 仅在 != pending 时揭示。
   */
  const [volumeDecision, setVolumeDecision] = useState<"pending" | "crop" | "redecompose">("pending");
  /** 是否已执行过"再标准化"（影响改编范围卡的动态序号：是→再标准化卡占 2、改编占 3）。 */
  const [didRestandardize, setDidRestandardize] = useState(false);
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

  // ── 卡0：确认 IP 作品（仅揭示卡1 标准化，不触发后端）──
  const handleConfirmWorks = useCallback(() => {
    if (busy || files.length === 0) return;
    setStage("confirmed");
  }, [busy, files]);

  // ── 卡1：执行 摄入 + 标准化（半自动，停在标准化等确认）──
  const handleIngest = useCallback(async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStage("ingesting");
    setVolumeDecision("pending"); // 逐步门控：标准化完成后停在体量抉择，等用户点击再揭示改编范围
    setDidRestandardize(false);
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
    setVolumeDecision("redecompose"); // 再标准化中
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
      // 按设计：再标准化执行后直接进入改编范围（再标准化卡占序号 2、改编范围占 3），不再循环追问。
      setDidRestandardize(true);
      setVolumeDecision("crop");
    } catch (e) {
      setError((e as Error).message);
      setVolumeDecision("pending");
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

  /** id → 节点 速查。 */
  const byId = useMemo(() => {
    const m = new Map<string, IpHierarchyNode>();
    for (const n of hierarchy?.hierarchy ?? []) m.set(n.id, n);
    return m;
  }, [hierarchy]);

  /** 全部最小单元（叶）id，文档序——供区间顺延与 leafRange 解析。 */
  const allLeaves = useMemo<string[]>(() => (rootId ? collectLeaves(rootId) : []), [rootId, collectLeaves]);

  /** 路径解析：最后一个非空层级的节点 id；全空=null（整部 root）。 */
  const resolvePath = useCallback((path: string[]): string | null => {
    for (let k = path.length - 1; k >= 0; k--) if (path[k]) return path[k];
    return null;
  }, []);

  /** 路径展示标签（解析节点标题，全空=整部作品）。 */
  const resolveLabel = useCallback(
    (path: string[]): string => {
      const id = resolvePath(path);
      return id ? byId.get(id)?.title ?? id : "整部作品";
    },
    [resolvePath, byId],
  );

  /** 解析路径子树的首叶 / 末叶（文档序）。 */
  const pathStartLeaf = useCallback(
    (path: string[]): string | null => {
      const id = resolvePath(path) ?? rootId;
      const leaves = id ? collectLeaves(id) : [];
      return leaves[0] ?? null;
    },
    [resolvePath, rootId, collectLeaves],
  );
  const pathEndLeaf = useCallback(
    (path: string[]): string | null => {
      const id = resolvePath(path) ?? rootId;
      const leaves = id ? collectLeaves(id) : [];
      return leaves[leaves.length - 1] ?? null;
    },
    [resolvePath, rootId, collectLeaves],
  );

  /** 某叶子/节点的层级路径（[顶层…自身]，不含 complete root），用于把"顺延叶子"回填为选择器路径。 */
  const ancestorPath = useCallback(
    (nodeId: string): string[] => {
      const path: string[] = [];
      let cur: string | null = nodeId;
      while (cur) {
        const node = byId.get(cur);
        if (!node || node.levelType === "complete" || node.parent == null) break;
        path.unshift(cur);
        cur = node.parent;
      }
      return path;
    },
    [byId],
  );

  /** 一行 → 区间 [首叶, 末叶]（叶子 id，文档序）。 */
  const rowRange = useCallback(
    (row: PlanRow): { start: string; end: string } | null => {
      const start = pathStartLeaf(row.startPath);
      const end = pathEndLeaf(row.endPath);
      if (!start || !end) return null;
      // 若起点在终点之后（用户误选），按文档序自动取小→大。
      const si = allLeaves.indexOf(start);
      const ei = allLeaves.indexOf(end);
      if (si >= 0 && ei >= 0 && si > ei) return { start: end, end: start };
      return { start, end };
    },
    [pathStartLeaf, pathEndLeaf, allLeaves],
  );

  /** rows → scope（每部一个 leafRange 闭区间）+ full（仅 1 行且整部时全量）。 */
  const rowsToScope = useCallback((): { selections: { leafRange: { start: string; end: string } }[]; full: boolean } => {
    const wholeWork =
      rows.length === 1 && resolvePath(rows[0].startPath) === null && resolvePath(rows[0].endPath) === null;
    if (wholeWork) return { selections: [], full: true };
    const selections = rows
      .map((r) => rowRange(r))
      .filter((rg): rg is { start: string; end: string } => !!rg)
      .map((leafRange) => ({ leafRange }));
    return selections.length === 0 ? { selections: [], full: true } : { selections, full: false };
  }, [rows, resolvePath, rowRange]);

  /** rows → 显式 game_unit_plan（行→GameUnit 1:1，区间=叶子闭区间）。 */
  const rowsToGameUnitPlan = useCallback((): {
    mode: "single" | "series";
    units: Array<{ index: number; partId?: string; unitRange: { start: string; end: string }; boundary: "hard" }>;
    userSpecified: boolean;
  } => {
    const units = rows
      .map((r, i) => {
        const rg = rowRange(r);
        if (!rg) return null;
        return {
          index: i + 1,
          partId: r.startPath[0] || undefined,
          unitRange: rg,
          boundary: "hard" as const,
        };
      })
      .filter((u): u is NonNullable<typeof u> => !!u);
    return { mode: rows.length >= 2 ? "series" : "single", units, userSpecified: true };
  }, [rows, rowRange]);

  /** 改编规划预览正文（区间行 + 单元 + 补充摘要），推给中间预览 ip_adapt_plan。 */
  const buildPlanContent = useCallback(
    (full: boolean, plan: { mode: string; units: unknown[] }): string => {
      const lines = [
        "# 改编规划\n",
        `- 模式：${plan.mode === "series" ? "系列（多游戏单元）" : "单品（单游戏单元）"}`,
        `- 游戏单元数：${plan.units.length}`,
        "",
        "## 改编范围（每部=一个游戏单元=一个区间）",
      ];
      rows.forEach((r, i) => {
        const whole = full && rows.length === 1;
        lines.push(`- 第 ${i + 1} 部：${resolveLabel(r.startPath)} ~ ${resolveLabel(r.endPath)}${whole ? "（全量）" : ""}`);
      });
      lines.push("", "## 自定义补充（作者改编意图）");
      lines.push(adaptationNotes.trim() || "（未填写 → 忠实把原 IP 转化为目标品类叙事）");
      return lines.join("\n");
    },
    [rows, resolveLabel, adaptationNotes],
  );

  // ── 改编规划行编辑 ──
  const updateRow = useCallback((rowId: string, which: "start" | "end", path: string[]) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [which === "start" ? "startPath" : "endPath"]: path } : r)),
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => {
      const id = `r${rowSeq.current++}`;
      // 自动顺延：新部默认起点 = 上一部终点叶子的"下一个叶子"（连续不重叠）；终点默认到结尾（留空）。
      const last = prev[prev.length - 1];
      const prevEnd = pathEndLeaf(last.endPath);
      const idx = prevEnd ? allLeaves.indexOf(prevEnd) : -1;
      const nextLeaf = idx >= 0 && idx + 1 < allLeaves.length ? allLeaves[idx + 1] : null;
      const startPath = nextLeaf ? ancestorPath(nextLeaf) : [];
      return [...prev, { id, startPath, endPath: [] }];
    });
  }, [pathEndLeaf, allLeaves, ancestorPath]);

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

  // ── 逐步门控派生量（点 2/点 1）──
  const hierReady = !!hierarchy && stage !== "ingesting" && stage !== "idle" && stage !== "confirmed";
  /** 真·超大叶子数（仅此触发"再标准化"问题；整部体量大≠超大文件）。 */
  const oversizedUnits = hierarchy?.volume?.oversizedUnitCount ?? 0;
  /** 【问题】块：仅当确实发现超大叶子且尚未抉择时出现（无超大文件则根本不出现）。 */
  const showQuestion = hierReady && oversizedUnits > 0 && volumeDecision === "pending";
  /** 改编范围卡：已抉择 crop，或本就无超大文件（无需问题，直接进入）。 */
  const showRange = hierReady && (volumeDecision === "crop" || (oversizedUnits === 0 && volumeDecision === "pending"));
  /** 改编范围卡动态序号：经历"再标准化"则改编占 3（再标准化占 2），否则占 2。 */
  const rangeCardNo = didRestandardize ? 3 : 2;

  /** 渲染层级树（标准化卡 / 再标准化卡复用）：每个顶层节点一棵只读可展开树。 */
  const renderHierTree = () => (
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
  );

  /** 渲染区间一侧（起点/终点）：按作品层级深度逐层内联级联下拉（有几层就几个下拉，深层依赖上层）。 */
  const renderRangeSide = (rowId: string, which: "start" | "end", path: string[]) =>
    Array.from({ length: maxDepth }).map((_, lvl) => {
      const options = lvl === 0 ? topNodes : path[lvl - 1] ? childrenById(path[lvl - 1]) : [];
      const disabled = scopeReady || (lvl > 0 && !path[lvl - 1]) || options.length === 0;
      return (
        <select
          key={lvl}
          className="ip-scope-select"
          value={path[lvl] ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const next = path.slice(0, lvl);
            if (e.target.value) next[lvl] = e.target.value;
            updateRow(rowId, which, next);
          }}
        >
          <option value="">{lvl === 0 ? "全部" : "全部"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
      );
    });

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
            <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy || files.length === 0} onClick={handleConfirmWorks}>
              确认
            </button>
          </div>
        )}
        {stage !== "idle" && <p className="wb-helper ip-stage-ok">✓ 已确认 {displayItems.length} 个 IP 作品</p>}
      </div>

      {stage === "ingesting" && (
        <div className="ip-stage-progress">标准化处理中… {progress?.pct ?? 0}% {progress?.message ?? ""}</div>
      )}

      {/* 1 标准化：卡0 确认后揭示；执行才真正标准化。执行前列上传件名，执行后每件一棵只读可展开树。 */}
      {stage !== "idle" && stage !== "ingesting" && (
        <div className="ip-stage-card">
          <div className="ip-stage-card__head">
            <span className="ip-stage-card__no">1</span>
            <span className="ip-stage-card__title">标准化 · 层级化文件系统</span>
          </div>
          {hierReady ? (
            <>
              {renderHierTree()}
              {hierarchy?.noise_filtered && hierarchy.noise_filtered.length > 0 && (
                <p className="wb-helper ip-stage-noise">已过滤 {hierarchy.noise_filtered.length} 个干扰项：{hierarchy.noise_filtered.slice(0, 4).join("、")}{hierarchy.noise_filtered.length > 4 ? "…" : ""}</p>
              )}
            </>
          ) : (
            <>
              <div className="ip-stage-tree">
                {displayItems.map((it, i) => (
                  <div key={i} className="ip-tree-group ip-tree-group--pending">
                    <span className="ip-tree-caret">▸</span>
                    <span className="ip-tree-label">{it.name}</span>
                  </div>
                ))}
              </div>
              <div className="ip-stage-card__foot">
                <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleIngest}>
                  执行
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 【问题】无序号：仅当确实发现超大叶子时出现（整部体量大≠超大文件 → 70 章小说不弹）。 */}
      {showQuestion && (
        <div className="ip-stage-question">
          <p className="ip-stage-question__text">【问题】发现有超大文件（{oversizedUnits} 个超大单元），是否需要进一步拆解（再标准化）？</p>
          <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={() => setVolumeDecision("crop")}>
            否，直接确认改编范围
          </button>
          <button className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--ghost" disabled={busy} onClick={handleDecompose}>
            是，进一步标准化
          </button>
        </div>
      )}
      {volumeDecision === "redecompose" && (
        <div className="ip-stage-progress">再标准化（拆解）中… {progress?.pct ?? 0}%</div>
      )}

      {/* 2 再标准化（仅当走了"是"路径）：展示再标准化后的层级树。 */}
      {hierReady && didRestandardize && (
        <div className="ip-stage-card">
          <div className="ip-stage-card__head">
            <span className="ip-stage-card__no">2</span>
            <span className="ip-stage-card__title">再标准化</span>
          </div>
          {renderHierTree()}
        </div>
      )}

      {/* 改编范围裁剪（动态序号 2/3）：每部=一个游戏单元=一个区间 [起点~终点]，起止各按层级展开内联级联下拉。 */}
      {showRange && (
        <>
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">{rangeCardNo}</span>
              <span className="ip-stage-card__title">改编范围裁剪</span>
            </div>
            <p className="wb-helper">
              每部 = 一个游戏单元 = 一个区间 [起点 ~ 终点]；逐层下拉选择，留「全部」即该层整体。1 部=单品，＋新增一部=系列。
            </p>
            <div className="ip-plan-rows">
              {rows.map((row, ri) => (
                <div key={row.id} className="ip-plan-row">
                  <span className="ip-plan-row__no">第 {ri + 1} 部</span>
                  <div className="ip-plan-row__range">
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "start", row.startPath)}</div>
                    <span className="ip-plan-row__tilde">~</span>
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "end", row.endPath)}</div>
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
                  确认
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

          {/* 开始生成（仅范围确认后才进入此步） */}
          {scopeReady && (
            <div className="ip-stage-generate">
              {!routingReady && <p className="wb-helper">在下方 ROUTING 选择叙事路由后即可生成</p>}
              <div className="ip-stage-card__foot">
                <button className="btn-generate btn-generate--compact ip-stage-gen-btn" disabled={!generateEnabled || busy} onClick={handleGenerate}>
                  {stage === "done" ? "✓ 已生成" : stage === "generating" ? `生成中… ${progress?.pct ?? 0}%` : "开始生成（IP DNA → 下游）"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="ip-stage-error">{error}</p>}
    </div>
  );
}

export default IpStageFlow;
