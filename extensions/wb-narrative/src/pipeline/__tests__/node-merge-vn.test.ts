/**
 * node-merge-vn.test.ts (Gap B)
 * ─────────────────────────────────────────────────────────────────
 * partialClearNodes / snapshotStepNodes / mergeNodesBack 在 VN 三步上的行为，
 * 重点验证 cinematic_storyboard 与派生 video_prompts 的同步切片。
 */
import { describe, it, expect } from "vitest";
import {
  partialClearNodes,
  snapshotStepNodes,
  mergeNodesBack,
} from "../node-merge.js";
import type { NarrativeContext } from "../../types/index.js";

function buildSnapshotCtx(): NarrativeContext {
  return {
    branch_tree: {
      nodes: [
        { id: "A1", title: "醒来" },
        { id: "A2", title: "选择" },
        { id: "A3", title: "结束" },
      ],
    },
    dialogue_script: {
      scripts: [
        { node_id: "A1", lines: [{ role: "我", text: "梦?" }] },
        { node_id: "A2", lines: [{ role: "我", text: "怎么回事" }] },
        { node_id: "A3", lines: [{ role: "我", text: "再来" }] },
      ],
    },
    cinematic_storyboard: {
      storyboards: [
        { node_id: "A1", shots: [{ shot_id: "A1_S1" }] },
        { node_id: "A2", shots: [{ shot_id: "A2_S1" }] },
        { node_id: "A3", shots: [{ shot_id: "A3_S1" }] },
      ],
    },
    video_prompts: {
      keyframes: [
        { shot_id: "A1_S1", node_id: "A1", prompt_zh: "old A1", prompt_en: "old A1" },
        { shot_id: "A2_S1", node_id: "A2", prompt_zh: "old A2", prompt_en: "old A2" },
        { shot_id: "A3_S1", node_id: "A3", prompt_zh: "old A3", prompt_en: "old A3" },
      ],
      video_segments: [
        { shot_id: "A1_S1", node_id: "A1", duration_sec: 4, prompt_zh: "old A1 v", prompt_en: "old A1 v" },
        { shot_id: "A2_S1", node_id: "A2", duration_sec: 4, prompt_zh: "old A2 v", prompt_en: "old A2 v" },
        { shot_id: "A3_S1", node_id: "A3", duration_sec: 4, prompt_zh: "old A3 v", prompt_en: "old A3 v" },
      ],
    },
  } as unknown as NarrativeContext;
}

describe("partialClearNodes - VN 三步", () => {
  it("branch_tree 按 id 删", () => {
    const ctx = buildSnapshotCtx();
    partialClearNodes(ctx, "branch_tree", ["A2"]);
    const bt = (ctx as Record<string, unknown>).branch_tree as { nodes: { id: string }[] };
    expect(bt.nodes.map(n => n.id)).toEqual(["A1", "A3"]);
  });

  it("dialogue_script 按 node_id 删", () => {
    const ctx = buildSnapshotCtx();
    partialClearNodes(ctx, "dialogue_script", ["A1", "A3"]);
    const ds = (ctx as Record<string, unknown>).dialogue_script as { scripts: { node_id: string }[] };
    expect(ds.scripts.map(s => s.node_id)).toEqual(["A2"]);
  });

  it("cinematic_storyboard 同步删 storyboards 和 video_prompts", () => {
    const ctx = buildSnapshotCtx();
    partialClearNodes(ctx, "cinematic_storyboard", ["A2"]);
    const cs = (ctx as Record<string, unknown>).cinematic_storyboard as { storyboards: { node_id: string }[] };
    const vp = (ctx as Record<string, unknown>).video_prompts as {
      keyframes: { node_id: string }[];
      video_segments: { node_id: string }[];
    };
    expect(cs.storyboards.map(s => s.node_id)).toEqual(["A1", "A3"]);
    expect(vp.keyframes.map(k => k.node_id)).toEqual(["A1", "A3"]);
    expect(vp.video_segments.map(v => v.node_id)).toEqual(["A1", "A3"]);
  });
});

describe("snapshotStepNodes + mergeNodesBack - VN 三步", () => {
  it("branch_tree 切片合并：保留未受影响节点 + 用 current 覆盖受影响节点", () => {
    const ctx = buildSnapshotCtx();
    const snapshot = snapshotStepNodes(ctx, "branch_tree");

    // 模拟 step.fn 重新生成全部节点（不识别 _nodeFilter 的退化场景）
    const ctxRaw = ctx as Record<string, unknown>;
    ctxRaw.branch_tree = {
      nodes: [
        { id: "A1", title: "新 A1" }, // step.fn 重写了，但不属于 nodeFilter
        { id: "A2", title: "新 A2 (target)" }, // nodeFilter 内
        { id: "A3", title: "新 A3" }, // step.fn 重写了，但不属于 nodeFilter
      ],
    };

    mergeNodesBack(ctx, "branch_tree", ["A2"], snapshot);

    const final = (ctxRaw.branch_tree as { nodes: Array<{ id: string; title: string }> }).nodes;
    const byId = Object.fromEntries(final.map(n => [n.id, n.title]));
    // A2 来自 current（受影响），A1/A3 应来自 snapshot（保留）
    expect(byId.A1).toBe("醒来");
    expect(byId.A2).toBe("新 A2 (target)");
    expect(byId.A3).toBe("结束");
    expect(final.length).toBe(3); // 不重复
  });

  it("dialogue_script 切片合并", () => {
    const ctx = buildSnapshotCtx();
    const snapshot = snapshotStepNodes(ctx, "dialogue_script");

    const ctxRaw = ctx as Record<string, unknown>;
    ctxRaw.dialogue_script = {
      scripts: [
        { node_id: "A1", lines: [{ role: "我", text: "新 A1" }] },
        { node_id: "A2", lines: [{ role: "我", text: "新 A2 (target)" }] },
      ],
    };

    mergeNodesBack(ctx, "dialogue_script", ["A2"], snapshot);
    const final = (ctxRaw.dialogue_script as { scripts: Array<{ node_id: string; lines: Array<{ text: string }> }> }).scripts;
    const byId = Object.fromEntries(final.map(s => [s.node_id, s.lines[0].text]));
    expect(byId.A1).toBe("梦?");
    expect(byId.A2).toBe("新 A2 (target)");
    expect(byId.A3).toBe("再来");
  });

  it("cinematic_storyboard 切片合并 + video_prompts 同步切片", () => {
    const ctx = buildSnapshotCtx();
    const snapshot = snapshotStepNodes(ctx, "cinematic_storyboard");

    const ctxRaw = ctx as Record<string, unknown>;
    ctxRaw.cinematic_storyboard = {
      storyboards: [
        { node_id: "A1", shots: [{ shot_id: "A1_NEW" }] },
        { node_id: "A2", shots: [{ shot_id: "A2_NEW" }] },
        { node_id: "A3", shots: [{ shot_id: "A3_NEW" }] },
      ],
    };
    // 模拟 cinematic-storyboard step.fn 内部重新调用 assembleVideoPrompts
    ctxRaw.video_prompts = {
      keyframes: [
        { shot_id: "A1_NEW", node_id: "A1", prompt_zh: "new", prompt_en: "new" },
        { shot_id: "A2_NEW", node_id: "A2", prompt_zh: "new (target)", prompt_en: "new (target)" },
        { shot_id: "A3_NEW", node_id: "A3", prompt_zh: "new", prompt_en: "new" },
      ],
      video_segments: [
        { shot_id: "A1_NEW", node_id: "A1", duration_sec: 5, prompt_zh: "new", prompt_en: "new" },
        { shot_id: "A2_NEW", node_id: "A2", duration_sec: 5, prompt_zh: "new (target)", prompt_en: "new (target)" },
        { shot_id: "A3_NEW", node_id: "A3", duration_sec: 5, prompt_zh: "new", prompt_en: "new" },
      ],
    };

    mergeNodesBack(ctx, "cinematic_storyboard", ["A2"], snapshot);

    const cs = (ctxRaw.cinematic_storyboard as { storyboards: Array<{ node_id: string; shots: Array<{ shot_id: string }> }> }).storyboards;
    const csById = Object.fromEntries(cs.map(s => [s.node_id, s.shots[0].shot_id]));
    expect(csById.A1).toBe("A1_S1");        // 旧的（snapshot）
    expect(csById.A2).toBe("A2_NEW");        // 新的（current[idSet]）
    expect(csById.A3).toBe("A3_S1");        // 旧的

    const vp = ctxRaw.video_prompts as {
      keyframes: Array<{ node_id: string; prompt_zh: string }>;
      video_segments: Array<{ node_id: string; prompt_zh: string }>;
    };
    expect(vp.keyframes.find(k => k.node_id === "A1")?.prompt_zh).toBe("old A1");
    expect(vp.keyframes.find(k => k.node_id === "A2")?.prompt_zh).toBe("new (target)");
    expect(vp.keyframes.find(k => k.node_id === "A3")?.prompt_zh).toBe("old A3");

    expect(vp.video_segments.find(v => v.node_id === "A1")?.prompt_zh).toBe("old A1 v");
    expect(vp.video_segments.find(v => v.node_id === "A2")?.prompt_zh).toBe("new (target)");
    expect(vp.video_segments.find(v => v.node_id === "A3")?.prompt_zh).toBe("old A3 v");
  });
});
