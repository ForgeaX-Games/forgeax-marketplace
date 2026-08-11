/**
 * seat-agents.ts —— 按配置表批量注册席位 agent
 *
 * 做的事只有一件：把 seat-spec.ts 声明的**形态**盖到实现上，让每个席位实现
 * 都有自己的 AgentDef，而不是一律走 bridgeStepDescriptor 的硬编码 single-turn。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么不逐个手写 AgentDef
 * ─────────────────────────────────────────────────────────────────
 * AgentDef 里绝大多数字段（io 契约、依赖边、LLM 参数、extractOutputKey）
 * StepDescriptor 已经有了，手写一遍等于把同一件事说两次，迟早漂移。
 * 所以这里从 StepDescriptor 派生全部可派生字段，配置表只提供它独有的那一项：
 * prototype。
 *
 * ─────────────────────────────────────────────────────────────────
 * 席位形态 → agent 形态的下沉规则
 * ─────────────────────────────────────────────────────────────────
 * 配置表的「agent 类型」描述的是**席位**。席位与实现不是一对一：
 *
 *   一席一实现  该实现独自承担席位职责 → 继承席位形态
 *               （角色档案席 parallel → character_enrichment 就是那个并行体）
 *   一席多实现  席位的形态由这几个实现**串起来**才成立，单个实现是其中一阶
 *               → 每个实现是 atomic，席位的串行性由 binding 的顺序表达
 *               （故事结构席 serial = outline_batch → detailed_outline）
 *
 * 不做这层下沉的话，outline_batch 会被标成 serial，而它自己只是一次调用——
 * 画布据 prototype 推连接能力，标错会让它显示成能嵌子节点。
 *
 * ─────────────────────────────────────────────────────────────────
 * useNewRunner 一律 false，为什么
 * ─────────────────────────────────────────────────────────────────
 * 注册 AgentDef 与「交给新 runner 跑」是两件事。各 step 函数体内除了调
 * LLM 还做了大量落地工作（派生字段、修复、二次校验、分批），这些今天不在
 * 任何 runner 里。先注册形态、执行仍走 step 函数，是让 4.3 的形态声明在运行层
 * 有据可查而不改变产出；把分片与后处理搬进 runner 是逐席的后续工作，
 * 届时该席在 seat-spec 的落差登记随之消掉。
 */
import { ASSISTANT_SEATS, getSeatForAgent, type SeatBinding } from "./assistant-seats.js";
import { registerAgentDef, hasAgentDef } from "./blueprint/agent-def-registry.js";
import type { AgentDef } from "./blueprint/types.js";
import type { AgentPrototype } from "./agent-contract.js";
import { executableStructureFor, getSeatSpec } from "./seat-spec.js";
import {
  getStepRequiredInputs,
  STEP_REGISTRY,
  type StepDescriptor,
} from "./step-registry.js";

/**
 * 该实现在其席位里是否独自承担职责。
 *
 * 判据取该 agent 出现的所有 binding：只要有一条 binding 是多 agent 串成的，
 * 它就是某条席内 workflow 的一阶。
 */
function isSoleImplementation(agentId: string, bindings: readonly SeatBinding[]): boolean {
  const involved = bindings.filter((b) => b.agentIds.includes(agentId));
  return involved.length > 0 && involved.every((b) => b.agentIds.length === 1);
}

/** 该 agent 应声明的原型；不属于任何有规格的席位则返回 undefined。 */
export function seatAgentPrototype(agentId: string): AgentPrototype | undefined {
  const seat = getSeatForAgent(agentId);
  if (!seat) return undefined;
  const spec = getSeatSpec(seat.id);
  if (!spec) return undefined;
  return isSoleImplementation(agentId, seat.bindings) ? spec.prototype : "atomic";
}

/**
 * StepDescriptor + 配置表 → AgentDef。
 *
 * structure 取 executableStructureFor 给的**今天真能跑的原语**，与 prototype
 * 的落差由 seat-spec 的落差登记表负责交代。非 single-turn 原语在这里显式抛错，
 * 因为它们各自需要自己的 config（分片策略、阶段列表），派生不出来——
 * 那一天到了，应该是有人在这里加分支，而不是让它悄悄拿到一份错配置。
 */
export function buildSeatAgentDef(desc: StepDescriptor, seatId: string): AgentDef {
  const structureType = executableStructureFor(seatId);
  if (structureType !== "single-turn") {
    throw new Error(
      `席位 ${seatId} 的可执行原语已升级为 ${structureType}，`
        + "但 buildSeatAgentDef 还只会派生 single-turn 配置——请在此补该原语的 config 派生",
    );
  }

  return {
    id: desc.id,
    name: desc.name,
    prototype: seatAgentPrototype(desc.id),
    structure: {
      type: "single-turn",
      config: {
        temperature: desc.temperature ?? 0.7,
        responseFormat: desc.responseFormat ?? "json",
        retryCount: 3,
        streaming: false,
      },
    },
    prompts: {
      // 生产提示词是各 step 内联的 PromptComposer，templateId 只作标识，
      // 不指向 agent-templates/ 下的文件（那批 .md 已归档）。
      templateId: desc.id,
      skillSlots: desc.composer?.skillSlots ?? [],
    },
    io: {
      requiredInputs: getStepRequiredInputs(desc.id),
      optionalInputs: desc.optionalInputs,
      outputField: desc.outputFields[0] ?? desc.id,
      derivedFields: desc.derivedFields,
    },
    dependencies: desc.dependsOn,
    needsThreshold: desc.needsThreshold,
    needsDesignContext: desc.needsDesignContext,
    extractOutputKey: desc.extractOutputKey,
    supportsNodeFilter: desc.supportsNodeFilter,
    supportsSubEmit: desc.supportsSubEmit,
    useNewRunner: false,
  };
}

/**
 * 把各席位的实现注册成 AgentDef。返回新注册的 agent id。
 *
 * 只认 binding 里的实现，不认 alsoOwns——后者是已被合并或没接进任何模板的
 * 老形态，给它们盖形态声明没有意义（它们不会被任何管线解析到）。
 *
 * 已有手写 AgentDef 的（叙事卡带 validator 与算子消费声明）跳过：
 * 手写的信息比派生的多，覆盖它就是倒退。
 */
export function registerSeatAgentDefs(): string[] {
  const registered: string[] = [];

  for (const seat of ASSISTANT_SEATS) {
    if (!getSeatSpec(seat.id)) continue;
    for (const agentId of seat.bindings.flatMap((b) => b.agentIds)) {
      if (hasAgentDef(agentId)) continue;
      const desc = STEP_REGISTRY.get(agentId);
      if (!desc) continue; // 绑定指向未注册 step，由 assistant-seats.test 报错

      registerAgentDef(buildSeatAgentDef(desc, seat.id));
      registered.push(agentId);
    }
  }

  return registered;
}
