import { describe, it, expect, vi } from "vitest";
import { executableStepFn, executableStepIds } from "../pipeline.js";
import { STEP_REGISTRY } from "../step-registry.js";
import { executeAgent } from "../agent-exec.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import "../step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * 执行内核并轨的护栏。
 *
 * run() / rerunFromStep() / runWithBlueprint() / 单 agent HTTP 入口现在都经
 * executeAgent 派发，它按 AgentDef 决定走 runner 还是 step 函数。这带来两条
 * 必须守住的不变量，否则并轨会静默改变产出：
 *
 *   1. run() 能跑的每个 step 都在 STEP_REGISTRY 登记——不登记就派发不了；
 *   2. 两处登记的是同一个函数——否则「换派发口径」等于「换实现」。
 */
describe("执行内核并轨", () => {
  it("可执行的 step 都在 StepDescriptor 注册表里", () => {
    const unregistered = executableStepIds().filter((id) => !STEP_REGISTRY.has(id));
    expect(unregistered, "以下 step 有 fn 但没登记，executeAgent 派发不了").toEqual([]);
  });

  it("run() 用的 fn 与注册表登记的 fn 是同一个函数", () => {
    const mismatched = executableStepIds().filter(
      (id) => executableStepFn(id) !== STEP_REGISTRY.get(id)?.fn,
    );
    expect(mismatched, "两处指向了不同实现").toEqual([]);
  });

  it("派发落到 legacy step 函数，且产出写回 ctx", async () => {
    const desc = STEP_REGISTRY.get("worldview")!;
    const original = desc.fn;
    const spy = vi.fn(async (ctx: NarrativeContext) => {
      (ctx as Record<string, unknown>)[desc.outputFields[0]!] = { ok: true };
    });
    // 直接改注册表里的 fn：这正是并轨后 executeAgent 取实现的地方，
    // 能被拦到就说明派发真的经过了注册表而不是绕开它。
    (desc as { fn: unknown }).fn = spy;
    try {
      const ctx = {} as NarrativeContext;
      const outcome = await executeAgent("worldview", ctx, {} as LLMClient);
      expect(spy).toHaveBeenCalledOnce();
      expect(outcome.via).toBe("legacy");
      expect(outcome.output).toEqual({ ok: true });
    } finally {
      (desc as { fn: unknown }).fn = original;
    }
  });

  /**
   * 已迁移到 runner 的席位白名单。
   *
   * 加进来的前提是该 step 的落地逻辑（分批、派生字段、修复）已经不在函数体里，
   * 且提示词 system/user 两段都由 PromptComposer 提供——否则切过去会静默丢产出。
   */
  const ON_RUNNER = ["narrative_card"];

  it("只有白名单里的席位走新 runner", () => {
    const onRunner = executableStepIds()
      .filter((id) => getAgentDef(id)?.useNewRunner === true)
      .sort();
    expect(onRunner, "有 step 被切到新 runner，请确认其后处理已迁移").toEqual(
      [...ON_RUNNER].sort(),
    );
  });

  it("切到 runner 的席位提示词不为空（不能靠空提示词跑）", async () => {
    const { PromptResolver } = await import("../blueprint/prompt-resolver.js");
    for (const id of ON_RUNNER) {
      const composer = STEP_REGISTRY.get(id)?.composer;
      expect(composer, `${id} 没有 PromptComposer，切 runner 会发空提示词`).toBeTruthy();
      const prompts = PromptResolver.resolveFromComposer(
        composer!,
        { user_input: "一个消除游戏" } as NarrativeContext,
      );
      expect(prompts.systemPrompt.length, `${id} system prompt 为空`).toBeGreaterThan(100);
      expect(prompts.userPromptTemplate.length, `${id} user prompt 为空`).toBeGreaterThan(50);
    }
  });
});
