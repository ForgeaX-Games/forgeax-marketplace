/**
 * node-dependency-vn.test.ts (Gap B)
 * ─────────────────────────────────────────────────────────────────
 * 验证 VN/互动影游链 (branch_tree → dialogue_script + cinematic_storyboard)
 * 的节点级影响推导（DAG BFS 下溯）。
 */
import { describe, it, expect } from "vitest";
import { traceNodeSubtree, isNodeLevelStep, buildNodeFilter } from "../node-dependency.js";
import type { NarrativeContext } from "../../types/index.js";

function buildVNContext(): NarrativeContext {
  // 三幕互动影游：每幕 3 个节点，全部 dialogue + storyboard 都按 node_id 1:1 对齐
  const ctx = {
    branch_tree: {
      root_id: "A1-1",
      nodes: [
        { id: "A1-1", title: "醒来" },
        { id: "A1-2", title: "选择" },
        { id: "A1-3", title: "结束" },
        { id: "A2-1", title: "醒来 2" },
        { id: "A2-2", title: "回忆" },
      ],
      endings: [{ id: "E1" }],
    },
    dialogue_script: {
      scripts: [
        { node_id: "A1-1", lines: [] },
        { node_id: "A1-2", lines: [] },
        { node_id: "A1-3", lines: [] },
        { node_id: "A2-1", lines: [] },
        { node_id: "A2-2", lines: [] },
      ],
    },
    cinematic_storyboard: {
      storyboards: [
        { node_id: "A1-1", shots: [] },
        { node_id: "A1-2", shots: [] },
        { node_id: "A1-3", shots: [] },
        { node_id: "A2-1", shots: [] },
        { node_id: "A2-2", shots: [] },
      ],
    },
  } as unknown as NarrativeContext;
  return ctx;
}

describe("traceNodeSubtree - VN 链 DAG 下溯", () => {
  it("修改 branch_tree 一个节点 → 推导出 dialogue + storyboard 同节点", () => {
    const ctx = buildVNContext();
    const impacts = traceNodeSubtree("branch_tree", ["A1-2"], ctx);

    // 三个 step 都应该出现：branch_tree (本身) + dialogue_script + cinematic_storyboard
    const stepIds = impacts.map(i => i.stepId).sort();
    expect(stepIds).toEqual(["branch_tree", "cinematic_storyboard", "dialogue_script"]);

    // 每个 step 受影响的就是 A1-2
    for (const imp of impacts) {
      expect(imp.affectedNodeIds).toEqual(["A1-2"]);
      expect(imp.preservedNodeIds).toContain("A1-1");
      expect(imp.preservedNodeIds).toContain("A2-1");
    }
  });

  it("修改 branch_tree 多个节点 → 下游受影响节点对应", () => {
    const ctx = buildVNContext();
    const impacts = traceNodeSubtree("branch_tree", ["A1-1", "A2-2"], ctx);

    const dialogueImp = impacts.find(i => i.stepId === "dialogue_script");
    expect(dialogueImp?.affectedNodeIds.sort()).toEqual(["A1-1", "A2-2"]);

    const sbImp = impacts.find(i => i.stepId === "cinematic_storyboard");
    expect(sbImp?.affectedNodeIds.sort()).toEqual(["A1-1", "A2-2"]);
  });

  it("修改 dialogue_script 节点 → 不影响上游 branch_tree、不影响平级 cinematic_storyboard", () => {
    const ctx = buildVNContext();
    const impacts = traceNodeSubtree("dialogue_script", ["A1-2"], ctx);

    expect(impacts.map(i => i.stepId)).toEqual(["dialogue_script"]);
  });

  it("修改 cinematic_storyboard 节点 → 不影响上游与平级", () => {
    const ctx = buildVNContext();
    const impacts = traceNodeSubtree("cinematic_storyboard", ["A1-3"], ctx);

    expect(impacts.map(i => i.stepId)).toEqual(["cinematic_storyboard"]);
  });

  it("空 nodeIds 返回空", () => {
    const ctx = buildVNContext();
    expect(traceNodeSubtree("branch_tree", [], ctx)).toEqual([]);
  });

  it("非节点级步骤返回空", () => {
    const ctx = buildVNContext();
    expect(traceNodeSubtree("worldview", ["any"], ctx)).toEqual([]);
  });
});

describe("isNodeLevelStep", () => {
  it("覆盖 RPG 链 + VN 链", () => {
    expect(isNodeLevelStep("story_framework")).toBe(true);
    expect(isNodeLevelStep("scene_generation")).toBe(true);
    expect(isNodeLevelStep("branch_tree")).toBe(true);
    expect(isNodeLevelStep("dialogue_script")).toBe(true);
    expect(isNodeLevelStep("cinematic_storyboard")).toBe(true);

    expect(isNodeLevelStep("worldview")).toBe(false);
    expect(isNodeLevelStep("initial_plan")).toBe(false);
  });
});

describe("buildNodeFilter", () => {
  it("把 NodeImpact[] 折叠成 { stepId: nodeIds }", () => {
    const ctx = buildVNContext();
    const impacts = traceNodeSubtree("branch_tree", ["A2-1"], ctx);
    const filter = buildNodeFilter(impacts);
    expect(filter.branch_tree).toEqual(["A2-1"]);
    expect(filter.dialogue_script).toEqual(["A2-1"]);
    expect(filter.cinematic_storyboard).toEqual(["A2-1"]);
  });
});
