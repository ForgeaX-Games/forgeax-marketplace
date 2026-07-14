/**
 * blueprint/processor-registry.ts
 *
 * 业务逻辑函数注册表。将 step 函数中硬编码的 validator / normalizer /
 * processor / splitter / merger 提取为命名函数，在 AgentDef 中通过名称引用。
 *
 * 设计原则：
 *   - Runner 运行时通过名称查找函数（解耦 AgentDef 的纯数据性）
 *   - 注册在启动时完成，运行时不修改
 *   - 函数签名与 types.ts 的 Fn 类型严格对齐
 */
import type {
  ValidatorFn,
  NormalizerFn,
  ProcessorFn,
  ChunkSplitterFn,
  ChunkMergerFn,
} from "./types.js";

const validators = new Map<string, ValidatorFn>();
const normalizers = new Map<string, NormalizerFn>();
const processors = new Map<string, ProcessorFn>();
const splitters = new Map<string, ChunkSplitterFn>();
const mergers = new Map<string, ChunkMergerFn>();

// ── Registration helpers ──

export function registerValidator(name: string, fn: ValidatorFn): void {
  validators.set(name, fn);
}

export function registerNormalizer(name: string, fn: NormalizerFn): void {
  normalizers.set(name, fn);
}

export function registerProcessor(name: string, fn: ProcessorFn): void {
  processors.set(name, fn);
}

export function registerSplitter(name: string, fn: ChunkSplitterFn): void {
  splitters.set(name, fn);
}

export function registerMerger(name: string, fn: ChunkMergerFn): void {
  mergers.set(name, fn);
}

// ── Lookup helpers ──

export function getValidator(name: string): ValidatorFn {
  const fn = validators.get(name);
  if (!fn) throw new Error(`Validator not registered: ${name}`);
  return fn;
}

export function getNormalizer(name: string): NormalizerFn {
  const fn = normalizers.get(name);
  if (!fn) throw new Error(`Normalizer not registered: ${name}`);
  return fn;
}

export function getProcessor(name: string): ProcessorFn {
  const fn = processors.get(name);
  if (!fn) throw new Error(`Processor not registered: ${name}`);
  return fn;
}

export function getSplitter(name: string): ChunkSplitterFn {
  const fn = splitters.get(name);
  if (!fn) throw new Error(`ChunkSplitter not registered: ${name}`);
  return fn;
}

export function getMerger(name: string): ChunkMergerFn {
  const fn = mergers.get(name);
  if (!fn) throw new Error(`ChunkMerger not registered: ${name}`);
  return fn;
}

export function hasValidator(name: string): boolean { return validators.has(name); }
export function hasNormalizer(name: string): boolean { return normalizers.has(name); }
export function hasProcessor(name: string): boolean { return processors.has(name); }
export function hasSplitter(name: string): boolean { return splitters.has(name); }
export function hasMerger(name: string): boolean { return mergers.has(name); }
