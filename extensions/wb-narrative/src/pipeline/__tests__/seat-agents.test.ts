import { describe, it, expect } from "vitest";
import { ASSISTANT_SEATS } from "../assistant-seats.js";
import { getAgentDef, getAllAgentDefs } from "../blueprint/agent-def-registry.js";
import { getNarrativeAgentOrThrow } from "../agent-registry.js";
import { getSeatSpec } from "../seat-spec.js";
import { seatAgentPrototype } from "../seat-agents.js";
import "../step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/** 有规格的席位在所有作用域下的实现。 */
function speccedSeatImplementations(): Array<{ seatId: string; agentId: string }> {
  return ASSISTANT_SEATS.filter((s) => getSeatSpec(s.id)).flatMap((seat) =>
    seat.bindings.flatMap((b) => b.agentIds.map((agentId) => ({ seatId: seat.id, agentId }))),
  );
}

describe("seat agents（按配置表注册）", () => {
  it("每个席位实现都有自己的 AgentDef，不再靠硬编码桥接", () => {
    const missing = speccedSeatImplementations()
      .filter(({ agentId }) => !getAgentDef(agentId))
      .map(({ seatId, agentId }) => `${seatId} → ${agentId}`);
    expect(missing, "以下席位实现没注册 AgentDef").toEqual([]);
  });

  it("席位形态下沉到独任实现，一席多实现的各阶是原子", () => {
    // 独自承担席位职责 → 继承席位声明的形态
    expect(seatAgentPrototype("character_enrichment")).toBe("parallel");
    expect(seatAgentPrototype("item_database")).toBe("parallel");
    expect(seatAgentPrototype("scene_generation")).toBe("nested");
    expect(seatAgentPrototype("story_framework")).toBe("serial");
    expect(seatAgentPrototype("quest_generation")).toBe("parallel");
    expect(seatAgentPrototype("plot_generation")).toBe("parallel");

    // 故事结构席是 outline_batch → detailed_outline 两阶串成，单阶是原子
    expect(getSeatSpec("structure")!.prototype).toBe("serial");
    expect(seatAgentPrototype("outline_batch")).toBe("atomic");
    expect(seatAgentPrototype("detailed_outline")).toBe("atomic");
  });

  it("声明的形态真的落进了注册表（不是只算不存）", () => {
    expect(getAgentDef("character_enrichment")?.prototype).toBe("parallel");
    expect(getAgentDef("scene_generation")?.prototype).toBe("nested");
    expect(getNarrativeAgentOrThrow("scene_generation").prototype).toBe("nested");
  });

  it("派生的 AgentDef 一律不开新 runner——注册形态不改变产出", () => {
    // 手写 AgentDef 可以显式切（narrative_card 已切），派生的一律不切：
    // 派生只知道形态，不知道该 step 的落地逻辑是否已搬进 runner。
    const flipped = speccedSeatImplementations()
      .filter(({ agentId }) => !getAgentDef(agentId)?.validators)
      .filter(({ agentId }) => getAgentDef(agentId)?.useNewRunner === true)
      .map(({ agentId }) => agentId);
    expect(flipped, "有派生 AgentDef 被切到新 runner").toEqual([]);
  });

  it("手写 AgentDef 不被派生的覆盖", () => {
    const card = getAgentDef("narrative_card");
    expect(card?.validators).toEqual(["narrative_card_validator"]);
    expect(card?.io.consumesIpDna?.slots).toContain("风格算子");
    // 手写的 templateId 指向真实存在的模板，派生的只用 step id 作标识
    expect(card?.prompts.templateId).toBe("narrative-card");
    expect(getAgentDef("worldview")?.prompts.templateId).toBe("worldview");
  });

  it("走 AgentDef 也带席位归属，不比桥接的少信息", () => {
    const worldview = getNarrativeAgentOrThrow("worldview");
    expect(worldview.seatId).toBe("worldview");
    expect(worldview.roleCategory).toBe("engineer");
    expect(worldview.io.requiredInputs.length).toBeGreaterThan(0);
  });

  it("io 契约从 StepDescriptor 派生，不是空壳", () => {
    const def = getAgentDef("character_enrichment")!;
    expect(def.io.requiredInputs).toContain("worldview_structure");
    expect(def.io.outputField).toBeTruthy();
    expect(def.dependencies.length).toBeGreaterThan(0);
  });

  it("四原型在注册表里都有实例（4.3 的四类抽象在运行层可见）", () => {
    const prototypes = new Set(
      getAllAgentDefs()
        .map((d) => d.prototype)
        .filter(Boolean),
    );
    for (const p of ["atomic", "serial", "parallel", "nested"]) {
      expect(prototypes.has(p as never), `注册表里没有 ${p} 形态的 agent`).toBe(true);
    }
  });
});
