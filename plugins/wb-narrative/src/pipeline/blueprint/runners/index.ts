/**
 * runners/index.ts — Agent Runner 注册与查找
 */
import type { AgentRunner, AgentStructureType } from "../types.js";
import { SingleTurnRunner } from "./single-turn-runner.js";
import { ChunkedRunner } from "./chunked-runner.js";
import { SequenceRunner } from "./sequence-runner.js";
import { ConditionalRunner } from "./conditional-runner.js";
import { DeterministicRunner } from "./deterministic-runner.js";

const runners = new Map<AgentStructureType, AgentRunner>();

runners.set("single-turn", new SingleTurnRunner());
runners.set("chunked", new ChunkedRunner());
runners.set("sequence", new SequenceRunner());
runners.set("conditional", new ConditionalRunner());
runners.set("deterministic", new DeterministicRunner());

export function getRunnerForStructure(type: AgentStructureType): AgentRunner {
  const runner = runners.get(type);
  if (!runner) throw new Error(`No runner registered for structure type: ${type}`);
  return runner;
}

export { SingleTurnRunner, ChunkedRunner, SequenceRunner, ConditionalRunner, DeterministicRunner };
