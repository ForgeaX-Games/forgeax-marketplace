import { describe, it, expect } from "vitest";
import {
  ASSISTANT_SEATS,
  assertSeatContractComplete,
  boundAgentIds,
  getSeatForAgent,
  KNOWN_SEAT_GRAPH_DIVERGENCES,
  resolveSeatAgents,
  resolveSeatRequiredFields,
} from "../assistant-seats.js";
import {
  getStepRequiredInputs,
  missingStepInputs,
  STEP_REGISTRY,
} from "../step-registry.js";
import { getNarrativeAgentOrThrow } from "../agent-registry.js";
import "../step-registrations.js";

/** step 的传递依赖闭包（含自身）。 */
function depClosure(stepId: string): Set<string> {
  const seen = new Set<string>([stepId]);
  const queue = [stepId];
  while (queue.length > 0) {
    for (const dep of STEP_REGISTRY.get(queue.shift()!)?.dependsOn ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

/**
 * 逐个绑定比对：该绑定的依赖闭包里，是否真的能摸到席位声明的每个上游席位。
 * 摸不到就是一处落差。
 */
function actualDivergences(): Array<{
  seatId: string;
  scope: string;
  missingUpstream: string[];
}> {
  const out: Array<{ seatId: string; scope: string; missingUpstream: string[] }> = [];
  for (const seat of ASSISTANT_SEATS) {
    if (seat.upstreamSeats.length === 0) continue;
    for (const binding of seat.bindings) {
      // coveredBy 绑定本席没有自己的 step，也就没有依赖图可比——它的上游满足情况
      // 由承接席的绑定去检。在此处比对只会把「有意合并实现」误报成「缺上游」。
      if (binding.coveredBy) continue;
      const closure = new Set<string>();
      for (const agentId of binding.agentIds) {
        for (const s of depClosure(agentId)) closure.add(s);
      }
      const reachableSeats = new Set(
        [...closure].map((s) => getSeatForAgent(s)?.id).filter(Boolean) as string[],
      );
      const missing = seat.upstreamSeats.filter((u) => !reachableSeats.has(u));
      if (missing.length > 0) {
        out.push({
          seatId: seat.id,
          scope: binding.templateId ?? binding.modeId ?? "通用",
          missingUpstream: missing,
        });
      }
    }
  }
  return out;
}

/**
 * 席位契约守卫。
 *
 * 最要紧的一条是「全局无孤儿」：任何注册进 STEP_REGISTRY 的 step 都必须能
 * 回答「你是哪个单品助手的实现」。以前 step 是 SSOT，新增一个谁也不知道它
 * 对应什么产品；现在加 step 而不认领席位会直接红，逼着实现回到产品视角。
 */
describe("assistant seats", () => {
  it("契约自洽（kind 专属字段、状态与绑定、通用绑定唯一）", () => {
    expect(() => assertSeatContractComplete()).not.toThrow();
  });

  it("与 feature list 2.3.1–2.3.20 一一对应", () => {
    expect(ASSISTANT_SEATS).toHaveLength(20);
    const expected = Array.from({ length: 20 }, (_, i) => `2.3.${i + 1}`);
    expect(ASSISTANT_SEATS.map((s) => s.featureId)).toEqual(expected);
  });

  it("席位 id 唯一", () => {
    const ids = ASSISTANT_SEATS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个已注册 step 都归属某个席位（无孤儿）", () => {
    const orphans = [...STEP_REGISTRY.keys()].filter((id) => !getSeatForAgent(id));
    expect(orphans, `以下 step 没有认领席位：${orphans.join(", ")}`).toEqual([]);
  });

  it("每个 step 只归属一个席位（无双主）", () => {
    const owners = new Map<string, string[]>();
    for (const seat of ASSISTANT_SEATS) {
      const owned = [
        ...seat.bindings.flatMap((b) => b.agentIds),
        ...(seat.alsoOwns ?? []),
      ];
      for (const agentId of owned) {
        owners.set(agentId, [...(owners.get(agentId) ?? []), seat.id]);
      }
    }
    const conflicts = [...owners.entries()].filter(([, seats]) => seats.length > 1);
    expect(
      conflicts.map(([agentId, seats]) => `${agentId} → ${seats.join(" / ")}`),
    ).toEqual([]);
  });

  it("席位绑定指向的 agent 都真实注册过", () => {
    const missing = boundAgentIds().filter((id) => !STEP_REGISTRY.has(id));
    expect(missing, `席位绑了不存在的 agent：${missing.join(", ")}`).toEqual([]);
  });

  it("作用域解析：模式 > 模板 > 通用兜底", () => {
    // 通用兜底
    expect(resolveSeatAgents("outline")).toEqual(["story_framework"]);
    // 模板专属覆盖通用
    expect(resolveSeatAgents("outline", { templateId: "tpl-vn-v2" })).toEqual([
      "vn_outline_acts",
    ]);
    // 未声明该模板 → 回落通用
    expect(resolveSeatAgents("outline", { templateId: "tpl-card-game" })).toEqual([
      "story_framework",
    ]);
    // 模式绑定优先于模板
    expect(resolveSeatAgents("design_doc", { modeId: "design_auto" })).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
  });

  it("一席多步的内部 workflow 保序", () => {
    expect(resolveSeatAgents("req_list")).toEqual([
      "preference_summary",
      "preference_analysis",
    ]);
    expect(resolveSeatAgents("structure")).toEqual(["outline_batch", "detailed_outline"]);
  });

  it("上游席位都指向真实席位", () => {
    const ids = new Set(ASSISTANT_SEATS.map((s) => s.id));
    const bad = ASSISTANT_SEATS.flatMap((s) =>
      s.upstreamSeats.filter((u) => !ids.has(u)).map((u) => `${s.id} → ${u}`),
    );
    expect(bad).toEqual([]);
  });

  it("产品意图与实现依赖图的落差，恰好等于已登记的那几条", () => {
    const actual = actualDivergences();
    const asKey = (d: { seatId: string; scope: string; missingUpstream: string[] }) =>
      `${d.seatId}[${d.scope}] 缺 ${[...d.missingUpstream].sort().join("+")}`;

    const found = actual.map(asKey).sort();
    const known = KNOWN_SEAT_GRAPH_DIVERGENCES.map(asKey).sort();

    // 新冒出来的落差 = 有人改了接线却没交代
    expect(found.filter((k) => !known.includes(k)), "出现未登记的落差").toEqual([]);
    // 已消失的落差 = 清单该清理了
    expect(known.filter((k) => !found.includes(k)), "登记了但已不存在的落差").toEqual([]);
  });

  it("桥接出来的 agent 带上了输入契约与席位归属，不再是空壳", () => {
    const worldview = getNarrativeAgentOrThrow("worldview");
    expect(worldview.io.requiredInputs.length).toBeGreaterThan(0);
    expect(worldview.seatId).toBe("worldview");
    expect(worldview.roleCategory).toBe("engineer");

    // 入口步没有前置，契约就该是空的
    expect(getNarrativeAgentOrThrow("preference_summary").io.requiredInputs).toEqual([]);
  });

  it("输入体检报告缺失字段，而不是闷头跑空", () => {
    expect(getStepRequiredInputs("character_enrichment")).toContain("worldview_structure");
    expect(missingStepInputs("character_enrichment", {})).toContain("worldview_structure");
    expect(
      missingStepInputs("character_enrichment", { worldview_structure: { a: 1 } }),
    ).toEqual([]);
  });

  it("同一席位在不同管线下反查到各自的具体字段", () => {
    expect(resolveSeatRequiredFields("plot")).toContain("detailed_outlines_generated");
    expect(resolveSeatRequiredFields("plot", { templateId: "tpl-vn-v2" })).not.toContain(
      "detailed_outlines_generated",
    );
  });

  it("职责判定优先于历史命名：宏观归大纲席、微观归结构席", () => {
    expect(getSeatForAgent("story_framework")?.id).toBe("outline");
    expect(getSeatForAgent("outline_batch")?.id).toBe("structure");
    // 影游侧同理：剧本创作是「填充内容」，分镜设计才是分镜席
    expect(getSeatForAgent("vn_screenplay")?.id).toBe("plot");
    expect(getSeatForAgent("vn_storyboard")?.id).toBe("storyboard");
  });
});
