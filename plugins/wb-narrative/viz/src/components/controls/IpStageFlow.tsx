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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useNarrativeStore } from "../../store/narrativeStore";
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

/** 对外展示名：一律优先用规范名 displayName（序号_《原标题》），回退原始 title。 */
function disp(n?: { displayName?: string; title?: string } | null): string {
  return n?.displayName ?? n?.title ?? "";
}

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
  const leaves: IpHierarchyNode[] = [];
  const walk = (nodes: IpHierarchyNode[], depth: number): void => {
    for (const n of [...nodes].sort((a, b) => a.index - b.index)) {
      const kids = byParent.get(n.id) ?? [];
      lines.push(`${"  ".repeat(depth)}- ${disp(n)}${n.childRange ? `（第 ${n.childRange}）` : ""}`);
      if (kids.length === 0) leaves.push(n);
      walk(kids, depth + 1);
    }
  };
  walk(roots, 0);
  if (noiseFiltered && noiseFiltered.length > 0) {
    lines.push(`\n> 已过滤 ${noiseFiltered.length} 个干扰项：${noiseFiltered.join("、")}`);
  }
  // 最小叙事单元文件清单（点1：让中间预览能看到"每个环节落了哪些文件"）：
  // 每个最小叙事单元标准化后各落一份 content.md，落点目录名即其规范名 displayName。
  if (leaves.length > 0) {
    lines.push("", `## 最小叙事单元 · 文件清单（${leaves.length}）`);
    lines.push("> 落点：`input/book/story_book/book_processing/<run>/<规范名>/content.md`");
    for (const lf of [...leaves].sort((a, b) => a.index - b.index)) {
      lines.push(`- \`${disp(lf)}/content.md\``);
    }
  }
  return lines.join("\n");
}

/**
 * C4 输出流程正文（点2：输入流程+输出流程统一预览）：把生成 job 结果（scoped IP DNA + 下游游戏单元）
 * 整理为可读结构，让中间预览在输入各步之后接续展示"输出流程"的产出概览（每单元含产出目录/状态/质量）。
 * 完整的 D0–D4 逐节点内容随生成的 output run 落盘，可在历史中打开该 run 查看。
 */
function buildExtractResultContent(result: unknown): string {
  const r = (result ?? {}) as {
    title?: string;
    node_count?: number;
    game_units?: Array<{ index: number; generated?: boolean; output_dir?: string }>;
    extraction_quality?: { passed: boolean; checks?: Array<{ name: string; passed: boolean; detail?: string }>; warnings?: string[] };
  };
  const lines: string[] = ["# 生成 scoped IP DNA → 下游叙事\n"];
  lines.push("## 输入流程产出（scoped IP DNA）");
  lines.push(`- 层级节点：${r.node_count ?? 0}`);
  if (r.extraction_quality) {
    lines.push(`- 提取质量：${r.extraction_quality.passed ? "通过" : "有告警"}`);
    for (const c of r.extraction_quality.checks ?? []) {
      lines.push(`  - ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? `：${c.detail}` : ""}`);
    }
    if (r.extraction_quality.warnings?.length) {
      lines.push(`  - 告警：${r.extraction_quality.warnings.join("；")}`);
    }
  }
  const units = r.game_units ?? [];
  lines.push("", "## 输出流程产出（游戏单元 = 剧情树）");
  if (units.length === 0) {
    lines.push("- （未生成游戏单元）");
  } else {
    for (const u of units) {
      lines.push(`- 游戏单元 ${u.index}：${u.generated ? "已生成" : "未生成"}${u.output_dir ? ` · 产出 ${u.output_dir}` : ""}`);
    }
    lines.push("", "> 各游戏单元的完整 D0–D4 逐节点叙事内容已落盘到对应 output run，可在历史中打开查看。");
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
  /** 标准化层级树「下拉栏」展开态（默认收起，跟范围区间裁剪一个形式：点开才展开树，超高滚轮查看）。 */
  const [hierPanelOpen, setHierPanelOpen] = useState(false);
  /**
   * 改编规划行（§5.1）：一行 = 一个游戏单元（部）= 一个区间 [起点 ~ 终点]。默认 1 行（整部作品 → 单品）。
   * 行数即游戏单元数：1 行=单品 single；≥2 行=系列 series（部=游戏单元）。
   */
  const [rows, setRows] = useState<PlanRow[]>([{ id: "r1", startPath: [], endPath: [] }]);
  const rowSeq = useRef(2);
  /** 自定义补充（§5.1 自由文本）：作者改编意图，空＝忠实转化。 */
  const [adaptationNotes, setAdaptationNotes] = useState<string>("");
  /**
   * 改编范围是否已确认（点3 逐步门控）：范围卡内置「确认」按钮，确认后锁定区间/单元 UI，
   * 并据此**才揭示**「自定义补充」卡；尚未最终调 API（最终确认在补充卡）。
   */
  const [rangeConfirmed, setRangeConfirmed] = useState(false);
  /**
   * 体量门控（点 4 逐步）：pending=等用户在卡 2 抉择/确认；crop=进入改编范围裁剪；
   * redecompose=正在再标准化（拆解中）。卡 3 仅在 != pending 时揭示。
   */
  const [volumeDecision, setVolumeDecision] = useState<"pending" | "crop" | "redecompose">("pending");
  /** 是否已执行过"再标准化"（影响改编范围卡的动态序号：是→再标准化卡占 2、改编占 3）。 */
  const [didRestandardize, setDidRestandardize] = useState(false);
  /**
   * 【问题】是否曾出现（粘性，点1）：仅当检出超大最小叙事单元时置真；一旦出现就保留在前端
   * （即使后续再标准化把超大单元拆没了也保留为"已处理"摘要），不随 oversized 归零而消失。
   */
  const [questionEverShown, setQuestionEverShown] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; message?: string } | null>(null);
  /** 自动模式 runId（hierarchy 未建时由 /start 的 story_timestamp 回填，修 bug#1）。 */
  const [autoRunId, setAutoRunId] = useState<string>("");

  const runId = hierarchy?.run_id || autoRunId;

  // 回填真实落盘运行键到 store，供中间预览「按环节浏览文件」按 key 读取 input/ 与 output/ 两侧文件。
  const setIpRunKey = useNarrativeStore((s) => s.setIpRunKey);
  useEffect(() => {
    if (runId) setIpRunKey(runId);
  }, [runId, setIpRunKey]);

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
          (result) => {
            for (const s of IP_AUTO_STEPS) props.onStageProgress?.(s, "completed");
            // 自动模式默认全量改编 / 按体量定档：给改编规划/提取节点补可读默认正文，避免"暂无数据"。
            props.onStageProgress?.("ip_adapt_plan", "completed", "全量 · 按体量定档", "# 改编规划\n\n- 改编范围：全量改编（自动模式未裁剪）\n- 游戏单元：按体量自动定档（>1 单元成系列）\n- 自定义补充：（自动模式未填，忠实转化）");
            // 输出流程产出接续到中间预览（点2）：展示 scoped IP DNA + 各游戏单元产出概览。
            props.onStageProgress?.("ip_dna_extract", "completed", "scoped IP DNA + 下游生成完成", buildExtractResultContent(result));
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
    setRangeConfirmed(false); // 重新摄入：复位改编范围确认门
    setQuestionEverShown(false); // 重新摄入：清空上一轮"问题"粘性

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
    setRangeConfirmed(false); // 再标准化改变层级 → 复位改编范围确认门
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

  // 标准化结果就绪：默认展开"完整作品"根（让内容默认可见，仍可手动折叠收起）。
  useEffect(() => {
    if (rootId) setExpanded((prev) => (prev.has(rootId) ? prev : new Set(prev).add(rootId)));
  }, [rootId]);

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

  /**
   * 改编范围每侧下拉 = **根列（只读"完整作品"）+ 其下真实层级列**（§"根+真实层级"）。
   * 后端 `levels[0]`=complete 根、其后为真实层级。蛊真人=[完整作品][节]=2 列；多卷=[完整作品][部][章][节]。
   */
  const realLevels = useMemo(
    () => (hierarchy?.levels ?? []).filter((l) => l.levelType !== "complete"),
    [hierarchy],
  );
  /** 交互下拉列数 = 真实层级数（root 以下）；后端缺省时回退物理树深度，至少 1。 */
  const interactiveDepth = useMemo(() => {
    if (realLevels.length > 0) return realLevels.length;
    if (!hierarchy || !rootId) return 1;
    const depthOf = (id: string, d: number): number => {
      const kids = hierarchy.hierarchy.filter((n) => n.parent === id);
      return kids.length === 0 ? d : Math.max(...kids.map((k) => depthOf(k.id, d + 1)));
    };
    return Math.max(1, depthOf(rootId, 0));
  }, [realLevels, hierarchy, rootId]);
  /** 真实层级每列标题。 */
  const realLabels = useMemo<string[]>(() => realLevels.map((l) => l.label), [realLevels]);
  /** 只读根列标题（完整作品）。 */
  const rootLabel = useMemo(
    () => hierarchy?.levels?.find((l) => l.levelType === "complete")?.label ?? "完整作品",
    [hierarchy],
  );

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
      return id ? disp(byId.get(id)) || id : "整部作品";
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
    setRangeConfirmed(false);
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
        await pollJob(jobId, (result) => {
          setStage("done");
          // 输出流程产出接续到中间预览（点2）：scoped IP DNA + 各游戏单元产出概览。
          props.onStageProgress?.("ip_dna_extract", "completed", "scoped IP DNA + 下游生成完成", buildExtractResultContent(result));
          // 下游 job 完成：收束 IP 预览轨但保留节点（finishIpPreview 不再清空 runningEntryKey）。
          const st = useNarrativeStore.getState();
          st.finishIpPreview("completed");
          useNarrativeStore.setState({ activeEntryStatus: "completed" });
        });
      } else {
        setStage("done");
        props.onStageProgress?.("ip_dna_extract", "completed", "scoped IP DNA 已生成");
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
  /** 范围 UI 是否锁定（已确认范围 或 已最终确认）：锁定后下拉/增删/确认按钮不可再编辑。 */
  const rangeLocked = rangeConfirmed || scopeReady;

  /** 改编范围卡「确认」：仅锁定范围/单元 UI，不立即调最终 API；据此揭示自定义补充卡（点3）。 */
  const handleConfirmRange = useCallback(() => {
    if (busy) return;
    setRangeConfirmed(true);
  }, [busy]);

  /** 范围「重新编辑」：最终确认前可解锁重选区间。 */
  const handleEditRange = useCallback(() => {
    if (busy || scopeReady) return;
    setRangeConfirmed(false);
  }, [busy, scopeReady]);

  // ── 逐步门控派生量 ──
  const hierReady = !!hierarchy && stage !== "ingesting" && stage !== "idle" && stage !== "confirmed";
  /** 真·超大最小叙事单元数：>0 才触发【问题】；整部体量大≠超大文件（蓝图 §5.0）。 */
  const oversizedUnits = hierarchy?.volume?.oversizedUnitCount ?? 0;
  // 粘性置位（点1）：一旦检出超大单元就记下，问题块此后常驻前端，不随 oversized 归零消失。
  useEffect(() => {
    if (oversizedUnits > 0) setQuestionEverShown(true);
  }, [oversizedUnits]);
  /**
   * 【问题】块（点1）：仅当检出超大单元时出现（无则默认直接进入确认范围）；出现后粘性保留。
   * 它是左栏的"是否再标准化"抉择门，不作为中间/右侧的管线节点（不 push 到预览）。
   */
  const showQuestion = hierReady && questionEverShown;
  /**
   * 改编范围卡：无超大单元（问题从未出现）→ 标准化后直接揭示；有超大单元 → 用户在问题块作出
   * "直接确认 / 再标准化" 抉择（volumeDecision=crop）后才揭示。
   */
  const showRange = hierReady && (volumeDecision === "crop" || (!questionEverShown && volumeDecision === "pending"));
  /** 改编范围卡动态序号：经历"再标准化"则改编占 3（再标准化占 2），否则占 2；自定义补充顺延 +1。 */
  const rangeCardNo = didRestandardize ? 3 : 2;
  const notesCardNo = rangeCardNo + 1;

  /**
   * 渲染单个层级节点（递归）：有子节点 → 可折叠（默认展开根）；叶子 → 纯文本行（无折叠箭头）。
   * 展示一律用规范名 displayName（disp）。
   */
  const renderHierNode = (node: IpHierarchyNode, depth: number) => {
    const kids = childrenById(node.id);
    const hasKids = kids.length > 0;
    const open = expanded.has(node.id);
    return (
      <div key={node.id} className="ip-tree-group" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
        {hasKids ? (
          <button className="ip-tree-toggle" onClick={() => toggleExpand(node.id)}>
            <span className="ip-tree-caret">{open ? "▾" : "▸"}</span>
            <span className="ip-tree-label">{disp(node)}</span>
            {node.childRange && <span className="ip-tree-range">第 {node.childRange}</span>}
          </button>
        ) : (
          <div className="ip-tree-child">· {disp(node)}</div>
        )}
        {hasKids && open && (
          <div className="ip-tree-children">{kids.map((c) => renderHierNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  /** 渲染层级树（标准化卡 / 再标准化卡复用）：以"完整作品"根起的一棵可折叠只读树。 */
  const renderHierTree = () => {
    const root = rootId ? byId.get(rootId) : null;
    return (
      <div className="ip-stage-tree">
        {root ? renderHierNode(root, 0) : topNodes.map((node) => renderHierNode(node, 0))}
      </div>
    );
  };

  /**
   * 标准化「层级化文件系统」下拉栏：跟范围区间裁剪一个形式——一行可点的下拉头（展示根名 + 最小叙事单元数），
   * 点开后在受限高度（max-height）的滚动容器里展示整棵只读可折叠树，超高用滚轮查看；不再直接铺在卡片里。
   */
  const renderHierDropdown = () => {
    const leafWord = realLabels.length > 0 ? realLabels[realLabels.length - 1] : "最小叙事单元";
    const summary = `${rootLabel} · ${allLeaves.length} 个${leafWord}`;
    return (
      <div className={`ip-hier-dd${hierPanelOpen ? " ip-hier-dd--open" : ""}`}>
        <button
          type="button"
          className="ip-hier-dd__head"
          aria-expanded={hierPanelOpen}
          onClick={() => setHierPanelOpen((v) => !v)}
          title={summary}
        >
          <span className="ip-hier-dd__caret">{hierPanelOpen ? "▾" : "▸"}</span>
          <span className="ip-hier-dd__summary">{summary}</span>
          <span className="ip-hier-dd__hint">{hierPanelOpen ? "收起" : "展开查看"}</span>
        </button>
        {hierPanelOpen && <div className="ip-hier-dd__body">{renderHierTree()}</div>}
      </div>
    );
  };

  /**
   * 渲染区间一侧（起点/终点）：**只读"完整作品"根列 + 其下真实层级级联下拉**（根+真实层级）。
   * 根列固定（单一作品，始终全选其下）；真实层级列有几层就几列，深层依赖上层选择，展示用规范名 disp。
   */
  const renderRangeSide = (rowId: string, which: "start" | "end", path: string[]) => (
    <>
      <select className="ip-scope-select ip-scope-select--root" disabled value="__root__" title={rootLabel}>
        <option value="__root__">{disp(rootId ? byId.get(rootId) : null) || rootLabel}</option>
      </select>
      {Array.from({ length: interactiveDepth }).map((_, lvl) => {
        const options = lvl === 0 ? topNodes : path[lvl - 1] ? childrenById(path[lvl - 1]) : [];
        const disabled = rangeLocked || (lvl > 0 && !path[lvl - 1]) || options.length === 0;
        const allLabel = realLabels[lvl] ? `全部${realLabels[lvl]}` : "全部";
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
            <option value="">{allLabel}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{disp(o)}</option>
            ))}
          </select>
        );
      })}
    </>
  );

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
              {renderHierDropdown()}
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

      {/* 【问题】无序号块（点1）：仅在检出超大最小叙事单元时出现；出现后粘性保留在前端，
          展示当前抉择状态。它只是左栏的"是否再标准化"门，不作为中间/右侧管线节点。 */}
      {showQuestion && (
        <div className="ip-stage-question">
          <p className="ip-stage-question__text">
            【问题】检出 {oversizedUnits} 个超大最小叙事单元（超出体量水准线），建议进一步拆解（再标准化）后再改编；也可直接确认改编范围。
          </p>
          {volumeDecision === "pending" ? (
            <>
              <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={() => setVolumeDecision("crop")}>
                否，直接确认改编范围
              </button>
              <button className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--ghost" disabled={busy} onClick={handleDecompose}>
                是，进一步标准化（再标准化）
              </button>
            </>
          ) : (
            <p className="wb-helper ip-stage-ok">
              {didRestandardize ? "✓ 已进一步标准化（再标准化）" : "✓ 已选择直接确认改编范围"}
            </p>
          )}
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
          {renderHierDropdown()}
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
              每部 = 一个游戏单元 = 一个区间 [起点 ~ 终点]；逐层下拉选择，留「全部」即该层整体。1 部=单品，多部=系列。
            </p>
            {/* 点3：每部两行——第一行=「第 N 部」标题（× 删除固定标题行最右）；第二行=范围区间全宽展示。 */}
            <div className="ip-plan-rows">
              {rows.map((row, ri) => (
                <div key={row.id} className="ip-plan-unit">
                  <div className="ip-plan-unit__head">
                    <span className="ip-plan-row__no">第 {ri + 1} 部</span>
                    {!rangeLocked && rows.length > 1 && (
                      <button type="button" className="ip-plan-row__del" onClick={() => removeRow(row.id)} aria-label="删除此部">
                        ×
                      </button>
                    )}
                  </div>
                  <div className="ip-plan-row__range">
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "start", row.startPath)}</div>
                    <span className="ip-plan-row__tilde">~</span>
                    <div className="ip-plan-row__side">{renderRangeSide(row.id, "end", row.endPath)}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* 点3：+号满宽（与下拉行同宽）；语义说明改为下方注释（格式同其他 wb-helper 注释）。 */}
            {!rangeLocked && (
              <>
                <button type="button" className="ip-plan-add" onClick={addRow}>
                  ＋ 新增一部
                </button>
                <p className="wb-helper ip-plan-add__hint">+1：游戏单元 → 游戏系列（每多一部即多一个游戏单元，≥2 部成系列）</p>
              </>
            )}
            {/* 范围卡内置「确认」（仅锁定范围/单元 UI，不立即调最终 API）；确认后才揭示自定义补充。 */}
            {!scopeReady && (
              <div className="ip-stage-card__foot">
                {!rangeConfirmed ? (
                  <button className="btn-generate btn-generate--compact ip-stage-btn" disabled={busy} onClick={handleConfirmRange}>
                    确认
                  </button>
                ) : (
                  <>
                    <p className="wb-helper ip-stage-ok">✓ 改编范围已确认（{rows.length} 部）</p>
                    <button className="btn-generate btn-generate--compact ip-stage-btn ip-stage-btn--auto" disabled={busy} onClick={handleEditRange}>
                      重新编辑
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 自定义补充（点4：后置门控——仅在改编范围确认后才挂载）：作者改编意图，留空＝忠实转化。
              改编规划在此卡最终确认（裁剪范围 + 游戏单元 + 补充一并提交）。 */}
          {rangeConfirmed && (
          <div className="ip-stage-card">
            <div className="ip-stage-card__head">
              <span className="ip-stage-card__no">{notesCardNo}</span>
              <span className="ip-stage-card__title">自定义补充</span>
            </div>
            <p className="wb-helper">作者改编意图，可留空＝忠实把原 IP 转化为目标品类叙事。</p>
            <textarea
              className="ip-plan-notes__input"
              rows={3}
              placeholder="例如：背景从古代改为近未来赛博朋克；主角性别反转；保留主线、弱化感情线…（留空则忠实转化为目标品类叙事）"
              value={adaptationNotes}
              disabled={scopeReady}
              onChange={(e) => setAdaptationNotes(e.target.value)}
            />
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
          )}

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
