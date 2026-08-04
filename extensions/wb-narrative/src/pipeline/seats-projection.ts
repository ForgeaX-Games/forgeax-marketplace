/**
 * seats-projection.ts — 把后端席位注册表渲染成前端可直接 import 的模块源码。
 *
 * viz 的 tsconfig 只收 viz/src，跨不过来读后端；而席位是 feature list 的产品事实源，
 * 在前端另抄一份迟早会漂。折中是生成：后端改席位 → 跑 scripts/gen-seats.ts → 前端跟着变，
 * 忘了跑会被 seats-generated.test.ts 拦下来。
 *
 * 渲染逻辑放在 src 下（它是源码、要被测试引用），脚本只负责落盘。
 * 只投影前端用得着的字段；职责原文、上游席位、落差登记留在后端。
 */
import { ASSISTANT_SEATS, type AssistantSeat } from "./assistant-seats.js";
import { STEP_FILE_MAP } from "./step-files.js";

/**
 * 该席位产物的文件名前缀。
 *
 * 由「席位拥有的全部 agent + 顺带落盘的派生产物」查 STEP_FILE_MAP 得出，
 * 前端两库据此归类。手抄前缀表是上一版两库分错类的直接原因——
 * 07 故事大纲被归到大纲席，而它其实是结构席的第一步。
 */
function filePrefixesOf(seat: AssistantSeat): string[] {
  const keys = [
    ...seat.bindings.flatMap((b) => b.agentIds),
    ...(seat.alsoOwns ?? []),
    ...(seat.derivedArtifacts ?? []),
  ];
  const prefixes = new Set<string>();
  for (const key of keys) {
    const entry = STEP_FILE_MAP[key];
    if (entry) prefixes.add(`${entry.index}_`);
  }
  return [...prefixes].sort();
}

export function renderSeatsModule(): string {
  const rows = ASSISTANT_SEATS.map((seat) => {
    const bindings = seat.bindings.map((b) => {
      const scope = b.templateId ?? b.modeId ?? null;
      return `      { scope: ${scope ? JSON.stringify(scope) : "null"}, agentIds: ${JSON.stringify(b.agentIds)} }`;
    });
    return [
      "  {",
      `    id: ${JSON.stringify(seat.id)},`,
      `    featureId: ${JSON.stringify(seat.featureId)},`,
      `    name: ${JSON.stringify(seat.name)},`,
      `    kind: ${JSON.stringify(seat.kind)},`,
      `    status: ${JSON.stringify(seat.status)},`,
      `    contentType: ${seat.contentType ? JSON.stringify(seat.contentType) : "null"},`,
      `    filePrefixes: ${JSON.stringify(filePrefixesOf(seat))},`,
      bindings.length > 0
        ? `    bindings: [\n${bindings.join(",\n")},\n    ],`
        : "    bindings: [],",
      "  }",
    ].join("\n");
  });

  return `/**
 * 由 scripts/gen-seats.ts 从 src/pipeline/assistant-seats.ts 生成——请勿手改。
 * 改席位请改后端注册表，然后跑 \`npm run gen:seats\`。
 */

export type SeatKind = "generator" | "validator" | "polisher" | "retriever";

export interface SeatBindingView {
  /** 管线模板 id 或运行模式 id；null = 通用兜底。 */
  scope: string | null;
  agentIds: string[];
}

export interface SeatView {
  id: string;
  featureId: string;
  name: string;
  kind: SeatKind;
  /** planned = 契约已立、后端实现待建：可拖可 @，不可单跑。 */
  status: "active" | "planned";
  /** 产物落到哪个内容类别（对应 lib/contentTypes.ts）。 */
  contentType: string | null;
  /** 该席位产物的文件名前缀，两库据此归类。 */
  filePrefixes: string[];
  bindings: SeatBindingView[];
}

export const ASSISTANT_SEATS: readonly SeatView[] = [
${rows.join(",\n")},
];

const INDEX = new Map(ASSISTANT_SEATS.map((s) => [s.id, s]));

export function getSeat(id: string): SeatView | undefined {
  return INDEX.get(id);
}

/** 该席位在指定作用域下要跑的 agent 序列；无绑定返回空数组。 */
export function resolveSeatAgents(id: string, scope?: string | null): string[] {
  const seat = INDEX.get(id);
  if (!seat) return [];
  if (scope) {
    const exact = seat.bindings.find((b) => b.scope === scope);
    if (exact) return [...exact.agentIds];
  }
  const generic = seat.bindings.find((b) => b.scope === null);
  return generic ? [...generic.agentIds] : [];
}

/** 席位的代表步骤：通用绑定的第一步，用于单节点试跑。 */
export function seatPrimaryStep(id: string): string | undefined {
  return resolveSeatAgents(id)[0];
}
`;
}
