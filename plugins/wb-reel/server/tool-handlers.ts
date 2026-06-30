/**
 * wb-reel `entry.backend` for ToolRegistry.
 *
 * Each handler bridges a `reel:*` tool call to one of two backends:
 *   1. The Reel Studio Vite dev server (default :15175) which hosts the
 *      `/__reel__/scenarios/*` and `/__reel__/assets/*` REST endpoints
 *      (see vite.config.ts → reelScenariosPlugin / reelAssetsPlugin).
 *   2. The host forgeax-server litellm video gateway (`/__ce-api__/`, default
 *      :18900) which owns Seedance video task lifecycle via litellm `/v1/videos`.
 *      (2026-06: replaced the retired local Python Flask service.)
 *
 * Pattern mirrors wb-narrative/server/tool-handlers.ts:
 *   ToolRegistry → tools["reel:save-scenario"](args, ctx)
 *                → HTTP fetch to dev server / video gateway
 *                → return structured result
 *
 * Sandbox contract: handlers MUST use ctx.env for secrets / port config and
 * ctx.cwd for project root. Never read process.env directly.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface ToolCtx {
  caller: { kind: string; id?: string };
  toolId: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

const SCENARIO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function getReelDevBase(ctx: ToolCtx): string {
  const port = ctx.env?.PORT_REEL_STUDIO ?? "15175";
  return `http://127.0.0.1:${port}`;
}

/**
 * Resolve the user's currently-active game slug so reel scenarios written by
 * agents (import-from-narrative / save-scenario / forge-script) land in the SAME
 * per-game library the workbench iframe is showing — not the shared global one.
 *
 * `ctx.cwd` is the plugin dir (registry sets cwd = entry.pluginDir), so we walk
 * up to the project root that owns `.forgeax/active-game.json` (the host's SSOT,
 * written on game create / switch) and read its slug. Returns null when no game
 * is active (fresh workspace) → callers fall back to the global library.
 */
function resolveActiveGameSlug(ctx: ToolCtx): string | null {
  let dir = ctx.cwd ?? process.cwd();
  for (let i = 0; i < 8; i++) {
    const file = resolve(dir, ".forgeax", "active-game.json");
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf-8")) as { slug?: unknown };
        const slug = typeof parsed.slug === "string" ? parsed.slug : null;
        return slug && GAME_SLUG_RE.test(slug) ? slug : null;
      } catch {
        return null;
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** `?game=<slug>` query suffix for the dev-server reel endpoints (empty = global). */
function gameQ(ctx: ToolCtx): string {
  const slug = resolveActiveGameSlug(ctx);
  return slug ? `?game=${encodeURIComponent(slug)}` : "";
}

/**
 * 宿主 forgeax-server 的 litellm 兼容 shim 根（`/__ce-api__`）。
 *
 * 2026-06 退役本机 Python Flask 视频后端后，视频任务统一经宿主 litellm 网关
 * （与浏览器 HostGatewayVideoProvider 同一契约：POST /generate-video +
 *  GET /video-status?taskId=）。可用 FORGEAX_SERVER_URL 覆盖完整根，或仅用
 * FORGEAX_SERVER_PORT 覆盖端口（缺省 18900）。
 */
function getCeApiBase(ctx: ToolCtx): string {
  const explicit = ctx.env?.FORGEAX_SERVER_URL;
  if (explicit) return `${explicit.replace(/\/+$/, "")}/__ce-api__`;
  const port = ctx.env?.FORGEAX_SERVER_PORT ?? "18900";
  return `http://127.0.0.1:${port}/__ce-api__`;
}

async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // not JSON; keep raw text
  }
  if (!res.ok) {
    const msg =
      (body as { error?: string })?.error ?? `HTTP ${res.status} on ${url}`;
    throw Object.assign(new Error(msg), {
      code: res.status === 409 ? "conflict" : "api_error",
      httpStatus: res.status,
    });
  }
  return body;
}

function assertScenarioId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !SCENARIO_ID_RE.test(id)) {
    throw Object.assign(new Error(`invalid scenarioId: ${String(id)}`), {
      code: "invalid_argument",
    });
  }
}

/** GET /__reel__/scenarios/ returns `{ db: PersistedDb }` (the dev-server vite
 *  plugin wraps it). Unwrap and normalise to a PersistedDb so callers never
 *  see the envelope. */
async function fetchScenarioDb(base: string, q = ""): Promise<PersistedDb> {
  const resp = (await apiFetch(`${base}/__reel__/scenarios/${q}`)) as {
    db?: PersistedDb;
  } | null;
  const db = resp?.db;
  return db && Array.isArray(db.items)
    ? db
    : { version: 1, activeId: null, items: [] };
}

interface PersistedItem {
  id: string;
  title: string;
  scenario: Record<string, unknown> & { id: string };
  createdAt: number;
  updatedAt: number;
  lastPublishedAt?: number;
}
interface PersistedDb {
  version: number;
  activeId: string | null;
  items: PersistedItem[];
}

interface ListScenariosArgs {
  limit?: number;
  offset?: number;
}
interface GetScenarioArgs {
  scenarioId: string;
}
interface SaveScenarioArgs {
  scenario: Record<string, unknown> & { id: string };
  setActive?: boolean;
}
interface ListAssetsArgs {
  kind?: "image" | "video";
  scenarioId?: string;
  limit?: number;
}
/**
 * 单条「为某场景生成视频」的入队请求。
 *
 * 关键：视频必须**绑定到一个场景**（sceneId）才能在工作台时间轴/预览里出现，
 * 所以 sceneId 必填。prompt 省略时由工作台回退到该场景自己的视频提示词。
 */
interface VideoJob {
  /** 必填：视频要挂到哪一场（scenario.scenes 的 key）。 */
  sceneId: string;
  /** 可选：目标剧本 id；缺省时对工作台当前 active 剧本执行。 */
  scenarioId?: string;
  /** 可选：镜头语言提示词；省略时工作台回退到该场景的视频提示词。 */
  prompt?: string;
  /** 可选：时长（秒）；省略时取该场景时长 / 默认 5s。 */
  durationSec?: number;
  /** 可选：分辨率档位（见 seedanceResolution.VideoSize）。 */
  size?: string;
}

interface GenerateVideoArgs extends Partial<VideoJob> {
  /** 批量：一次入队多场视频。与单条字段二选一（jobs 优先）。 */
  jobs?: VideoJob[];
}
interface GetVideoTaskArgs {
  taskId: string;
}

// ── Script meta (outline / character relations) collaboration helpers ────────
//
// 让智能体能**增量**协作维护「剧本大纲」(scenario.outline) 与「人物关系」
// (scenario.characterRelations),而不是只能整本锻造/覆盖。落盘走与 save-scenario
// 同一通道(PUT {db});前端 scenarioPersistBoot 的轮询按 updatedAt 把改动 reload
// 进工作台,左侧「大纲 / 人物关系」面板随之刷新。

interface GetScriptMetaArgs {
  scenarioId?: string;
}
interface OutlineNodeInput {
  id?: string;
  parentId?: string;
  title: string;
  summary?: string;
  order?: number;
}
interface OutlineNodeOut {
  id: string;
  parentId?: string;
  title: string;
  summary?: string;
  order: number;
}
interface UpdateOutlineArgs {
  scenarioId?: string;
  /** 整体替换大纲树(慎用:会丢掉未列出的节点)。优先用 upsert/removeIds 增量改。 */
  replace?: OutlineNodeInput[];
  /** 增量新增/更新节点(按 id upsert;无 id 则新建)。 */
  upsert?: OutlineNodeInput[];
  /** 按 id 删除节点(连同其后代一并删,避免 parentId 悬挂)。 */
  removeIds?: string[];
  /** 顺带更新一句话剧本简介(scenario.synopsis)。 */
  synopsis?: string;
}
interface RelationInput {
  /** 边 id;省略则新建。同 id = 更新该边。 */
  id?: string;
  /** 关系起点:角色 id、角色名或别名都可(自动解析成 id)。 */
  from: string;
  /** 关系终点:角色 id、角色名或别名都可。 */
  to: string;
  /** 关系描述,如「父亲」「前任」「暗中跟踪」。 */
  label: string;
  note?: string;
  itemHint?: string;
}
interface RelationOut {
  id: string;
  fromCharId: string;
  toCharId: string;
  label: string;
  note?: string;
  itemHint?: string;
}
interface UpdateRelationsArgs {
  scenarioId?: string;
  /** 整体替换关系图(慎用)。优先用 upsert/removeIds 增量改,绝不动作者手改的其它边。 */
  replace?: RelationInput[];
  /** 增量新增/更新关系边(同 id 更新;无 id 时按 from/to/label 去重)。 */
  upsert?: RelationInput[];
  /** 按 id 删除关系边。 */
  removeIds?: string[];
}

function outlineNodeId(): string {
  return `ol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
function relationId(): string {
  return `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeOutlineNode(raw: OutlineNodeInput, fallbackOrder: number): OutlineNodeOut {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    throw Object.assign(new Error("outline node requires a non-empty title (大纲节点需要标题)"), {
      code: "invalid_argument",
    });
  }
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : outlineNodeId(),
    parentId: typeof raw.parentId === "string" && raw.parentId ? raw.parentId : undefined,
    title,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    order: typeof raw.order === "number" ? raw.order : fallbackOrder,
  };
}

/** 同级内按 order(其次按数组序)重排为 0..n,消除重复/空洞,保证 OutlinePanel 渲染稳定。 */
function renumberOutline(nodes: OutlineNodeOut[]): OutlineNodeOut[] {
  const byParent = new Map<string, OutlineNodeOut[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "__root__";
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order).forEach((n, i) => {
      n.order = i;
    });
  }
  return nodes;
}

/** 把「角色 id / 名字 / 别名」统一解析成 character.id。找不到返回 null。 */
function buildCharResolver(
  chars: Record<string, { name?: string; aliases?: string[] }>,
): (ref: string) => string | null {
  const ids = new Set(Object.keys(chars));
  const byName = new Map<string, string>();
  for (const [id, c] of Object.entries(chars)) {
    if (c?.name) byName.set(c.name.trim().toLowerCase(), id);
    for (const a of c?.aliases ?? []) {
      if (a) byName.set(a.trim().toLowerCase(), id);
    }
  }
  return (ref: string): string | null => {
    const r = (ref ?? "").trim();
    if (!r) return null;
    if (ids.has(r)) return r;
    return byName.get(r.toLowerCase()) ?? null;
  };
}

/**
 * 读 → 改 → 写:在持久化库里就地修改一本 scenario(默认 active,或指定 scenarioId)。
 * mutate 收到 scenario 的浅拷贝;返回后 bump updatedAt 并整库 PUT 回去,activeId 不变。
 */
async function mutateScenario(
  ctx: ToolCtx,
  scenarioId: string | undefined,
  mutate: (scenario: Record<string, unknown> & { id: string }) => void,
): Promise<{ id: string; updatedAt: number; activeId: string | null }> {
  const base = getReelDevBase(ctx);
  const q = gameQ(ctx);
  const db = await fetchScenarioDb(base, q);
  const items = [...db.items];
  const wantId = scenarioId ?? db.activeId ?? undefined;
  const idx = wantId ? items.findIndex((it) => it.id === wantId) : -1;
  if (idx < 0) {
    throw Object.assign(
      new Error(
        scenarioId
          ? `scenario not found: ${scenarioId}`
          : "no active scenario to edit — pass scenarioId, or open/forge a scenario first",
      ),
      { code: "not_found", httpStatus: 404 },
    );
  }
  const item = items[idx]!;
  const scenario = { ...item.scenario } as Record<string, unknown> & { id: string };
  mutate(scenario);
  const updatedAt = Date.now();
  items[idx] = {
    ...item,
    scenario,
    title: (scenario as { title?: string }).title ?? item.title,
    updatedAt,
  };
  const nextDb: PersistedDb = { version: 1, activeId: db.activeId ?? null, items };
  await apiFetch(`${base}/__reel__/scenarios/${q}`, {
    method: "PUT",
    body: JSON.stringify({ db: nextDb }),
  });
  return { id: scenario.id, updatedAt, activeId: nextDb.activeId };
}

// ── 时间轴编辑工具的共用助手 ───────────────────────────────────────────────
//
// scenario.scenes 是以 sceneId 为 key 的字典；各类 clip(dialogue / qte.cues /
// audio / textOverlays / shots / markers)是 scene 下的数组/对象。下面 reel:edit-*
// / reel:update-shot 全部走 mutateScenario(定位 scene → 改对应数组/字段 → 落盘)。

type AnyScene = Record<string, any> & { id?: string };

/** 在 scenario.scenes 字典里定位一场;找不到抛 not_found。 */
function locateScene(
  scenario: Record<string, unknown> & { id: string },
  sceneId: string,
): AnyScene {
  const scenes = scenario.scenes as Record<string, AnyScene> | undefined;
  const scene = scenes?.[sceneId];
  if (!scene || typeof scene !== "object") {
    throw Object.assign(new Error(`scene not found: ${sceneId}`), {
      code: "not_found",
      httpStatus: 404,
    });
  }
  return scene;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: "invalid_argument" });
}

function notFound(message: string): never {
  throw Object.assign(new Error(message), { code: "not_found", httpStatus: 404 });
}

/** 把任意值收成 >=0 的整数 ms;非数字时用 fallback(默认 0)。 */
function toMs(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fallback;
}

export const tools: Record<string, (args: any, ctx: ToolCtx) => Promise<unknown>> = {
  /** List scenarios persisted in the .reel-scenarios/scenarios.json index. */
  "reel:list-scenarios": async (args: ListScenariosArgs, ctx: ToolCtx) => {
    const base = getReelDevBase(ctx);
    const db = await fetchScenarioDb(base, gameQ(ctx));
    const all = db.items;
    const offset = Math.max(0, args.offset ?? 0);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const slice = all.slice(offset, offset + limit).map((it) => {
      const scenes = (it.scenario as { scenes?: unknown })?.scenes;
      return {
        id: it.id,
        title: it.title ?? (it.scenario as { title?: string })?.title ?? null,
        sceneCount: Array.isArray(scenes) ? scenes.length : undefined,
        updatedAt: it.updatedAt,
        lastPublishedAt: it.lastPublishedAt ?? null,
      };
    });
    return {
      activeId: db.activeId ?? null,
      scenarios: slice,
      totalCount: all.length,
    };
  },

  "reel:get-scenario": async (args: GetScenarioArgs, ctx: ToolCtx) => {
    assertScenarioId(args.scenarioId);
    const base = getReelDevBase(ctx);
    const db = await fetchScenarioDb(base, gameQ(ctx));
    const found = db.items.find((it) => it.id === args.scenarioId);
    if (!found) {
      throw Object.assign(new Error(`scenario not found: ${args.scenarioId}`), {
        code: "not_found",
        httpStatus: 404,
      });
    }
    return { scenario: found.scenario };
  },

  "reel:save-scenario": async (args: SaveScenarioArgs, ctx: ToolCtx) => {
    if (!args.scenario || typeof args.scenario !== "object") {
      throw Object.assign(new Error("scenario object required"), {
        code: "invalid_argument",
      });
    }
    assertScenarioId(args.scenario.id);
    // LLM sometimes sends scenes as an array; auto-convert to dict keyed by id
    const rawScenes = (args.scenario as Record<string, unknown>).scenes;
    if (Array.isArray(rawScenes)) {
      const dict: Record<string, unknown> = {};
      for (const s of rawScenes as Array<Record<string, unknown>>) {
        if (s && typeof s === "object" && typeof s.id === "string") dict[s.id] = s;
      }
      (args.scenario as Record<string, unknown>).scenes = dict;
    }
    const base = getReelDevBase(ctx);
    const q = gameQ(ctx);
    const db = await fetchScenarioDb(base, q);
    const items = [...db.items];
    const updatedAt = Date.now();
    const idx = items.findIndex((it) => it.id === args.scenario.id);
    const existing = idx >= 0 ? items[idx] : null;
    // 加固止血:整本覆盖时,若调用方**没带**(undefined) 大纲/人物关系/简介,保留旧值,
    // 避免智能体 round-trip(get → 改 → save)时把这几块剧本元信息整块抹掉——作者反馈
    // 「剧本大纲/人物关系丢了、人物都变独立」的最可能路径。注意:显式传 [] / "" 视为
    // 作者主动清空,尊重之、不回填(想增量改大纲/关系请优先用 reel:update-outline /
    // reel:update-relations,它们不会动其它字段)。
    if (existing?.scenario) {
      const incoming = args.scenario as Record<string, unknown>;
      const prev = existing.scenario as Record<string, unknown>;
      for (const k of ["outline", "characterRelations", "synopsis"] as const) {
        if (incoming[k] === undefined && prev[k] !== undefined) {
          incoming[k] = prev[k];
        }
      }
    }
    // PersistedItem wraps the scenario; the frontend reads `item.scenario`.
    // Flattening the scenario into the item (the old shape) made the UI see
    // `item.scenario === undefined` and never render it.
    const item: PersistedItem = {
      id: args.scenario.id,
      title:
        (args.scenario as { title?: string }).title ??
        existing?.title ??
        args.scenario.id,
      scenario: args.scenario,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    };
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    const nextDb: PersistedDb = {
      version: 1,
      activeId: args.setActive !== false ? args.scenario.id : (db.activeId ?? null),
      items,
    };
    // The dev-server vite plugin requires the body to be `{ db }` — PUTting the
    // bare db 400s with "missing `db` field in body".
    await apiFetch(`${base}/__reel__/scenarios/${q}`, {
      method: "PUT",
      body: JSON.stringify({ db: nextDb }),
    });
    return {
      ok: true,
      id: args.scenario.id,
      updatedAt,
      activeId: nextDb.activeId,
    };
  },

  // ── Script-meta collaboration: read/edit outline + character relations ──────
  //
  // 修复作者反馈「剧本大纲/人物关系丢了、人物都变独立、没工具让智能体协作」。
  // get 给智能体看清现状(含角色名↔id 映射,便于按名建关系);update-* 增量改且不
  // 抹掉其它内容。前端轮询会把改动 reload 进工作台对应面板。

  "reel:get-script-meta": async (args: GetScriptMetaArgs, ctx: ToolCtx) => {
    const base = getReelDevBase(ctx);
    const db = await fetchScenarioDb(base, gameQ(ctx));
    const wantId = args.scenarioId ?? db.activeId ?? undefined;
    const item = wantId ? db.items.find((it) => it.id === wantId) : undefined;
    if (!item) {
      throw Object.assign(
        new Error(args.scenarioId ? `scenario not found: ${args.scenarioId}` : "no active scenario"),
        { code: "not_found", httpStatus: 404 },
      );
    }
    const s = item.scenario as Record<string, unknown>;
    const charsRaw = (s.characters ?? {}) as Record<string, { name?: string; aliases?: string[] }>;
    const characters = Object.entries(charsRaw).map(([id, c]) => ({
      id,
      name: c?.name ?? id,
      aliases: Array.isArray(c?.aliases) ? c.aliases : [],
    }));
    const outline = Array.isArray(s.outline) ? (s.outline as unknown[]) : [];
    const characterRelations = Array.isArray(s.characterRelations)
      ? (s.characterRelations as unknown[])
      : [];
    return {
      scenarioId: item.id,
      title: (s.title as string | undefined) ?? item.title ?? null,
      synopsis: (s.synopsis as string | undefined) ?? null,
      characters,
      outline,
      characterRelations,
      counts: {
        characters: characters.length,
        outlineNodes: outline.length,
        relations: characterRelations.length,
      },
    };
  },

  "reel:update-outline": async (args: UpdateOutlineArgs, ctx: ToolCtx) => {
    const hasOp =
      Array.isArray(args.replace) ||
      Array.isArray(args.upsert) ||
      Array.isArray(args.removeIds) ||
      typeof args.synopsis === "string";
    if (!hasOp) {
      throw Object.assign(
        new Error("update-outline needs at least one of: replace / upsert / removeIds / synopsis"),
        { code: "invalid_argument" },
      );
    }
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      if (typeof args.synopsis === "string") scenario.synopsis = args.synopsis;

      let nodes: OutlineNodeOut[] = Array.isArray(scenario.outline)
        ? (scenario.outline as OutlineNodeOut[]).map((n) => ({ ...n }))
        : [];

      if (Array.isArray(args.replace)) {
        nodes = args.replace.map((n, i) => normalizeOutlineNode(n, i));
      }
      if (Array.isArray(args.upsert)) {
        for (const raw of args.upsert) {
          const node = normalizeOutlineNode(raw, nodes.length);
          const at = nodes.findIndex((n) => n.id === node.id);
          if (at >= 0) nodes[at] = { ...nodes[at]!, ...node };
          else nodes.push(node);
        }
      }
      if (Array.isArray(args.removeIds) && args.removeIds.length > 0) {
        // 连同后代一起删,避免 parentId 悬挂(大纲靠 parentId 形成树)。
        const dead = new Set(args.removeIds);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of nodes) {
            if (n.parentId && dead.has(n.parentId) && !dead.has(n.id)) {
              dead.add(n.id);
              grew = true;
            }
          }
        }
        nodes = nodes.filter((n) => !dead.has(n.id));
      }
      scenario.outline = renumberOutline(nodes);
    });
    return { ok: true, ...result };
  },

  "reel:update-relations": async (args: UpdateRelationsArgs, ctx: ToolCtx) => {
    const hasOp =
      Array.isArray(args.replace) || Array.isArray(args.upsert) || Array.isArray(args.removeIds);
    if (!hasOp) {
      throw Object.assign(
        new Error("update-relations needs at least one of: replace / upsert / removeIds"),
        { code: "invalid_argument" },
      );
    }
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const charsRaw = (scenario.characters ?? {}) as Record<
        string,
        { name?: string; aliases?: string[] }
      >;
      const resolve = buildCharResolver(charsRaw);
      const knownNames = Object.entries(charsRaw)
        .map(([id, c]) => c?.name ?? id)
        .join(", ");

      const toEdge = (raw: RelationInput): RelationOut => {
        const from = resolve(String(raw.from ?? ""));
        const to = resolve(String(raw.to ?? ""));
        if (!from || !to) {
          const bad = !from ? raw.from : raw.to;
          throw Object.assign(
            new Error(
              `未找到角色「${String(bad)}」。可用角色:${knownNames || "(本剧暂无角色)"}。` +
                `请先用 reel:get-script-meta 取角色名/ id,或先建好该角色再连关系。`,
            ),
            { code: "invalid_argument" },
          );
        }
        const label = typeof raw.label === "string" ? raw.label.trim() : "";
        if (!label) {
          throw Object.assign(
            new Error("relation requires a non-empty label (关系描述,如「父亲」「前任」)"),
            { code: "invalid_argument" },
          );
        }
        return {
          id: typeof raw.id === "string" && raw.id ? raw.id : relationId(),
          fromCharId: from,
          toCharId: to,
          label,
          note: typeof raw.note === "string" ? raw.note : undefined,
          itemHint: typeof raw.itemHint === "string" ? raw.itemHint : undefined,
        };
      };

      let edges: RelationOut[] = Array.isArray(scenario.characterRelations)
        ? (scenario.characterRelations as RelationOut[]).map((e) => ({ ...e }))
        : [];

      if (Array.isArray(args.replace)) {
        edges = args.replace.map(toEdge);
      }
      if (Array.isArray(args.upsert)) {
        for (const raw of args.upsert) {
          const edge = toEdge(raw);
          // 同 id 更新;无 id 时按(from,to,label)去重,避免重复边。
          const at = raw.id
            ? edges.findIndex((e) => e.id === edge.id)
            : edges.findIndex(
                (e) =>
                  e.fromCharId === edge.fromCharId &&
                  e.toCharId === edge.toCharId &&
                  e.label === edge.label,
              );
          if (at >= 0) {
            const cur = edges[at]!;
            edges[at] = { ...cur, ...edge, id: cur.id };
          } else {
            edges.push(edge);
          }
        }
      }
      if (Array.isArray(args.removeIds) && args.removeIds.length > 0) {
        const dead = new Set(args.removeIds);
        edges = edges.filter((e) => !dead.has(e.id));
      }
      scenario.characterRelations = edges;
    });
    return { ok: true, ...result };
  },

  "reel:list-assets": async (args: ListAssetsArgs, ctx: ToolCtx) => {
    const base = getReelDevBase(ctx);
    const manifest = (await apiFetch(`${base}/__reel__/assets/`)) as {
      version: number;
      assets: Array<{
        id: string;
        kind: "image" | "video";
        filename: string;
        mimeType: string;
        bytes: number;
        createdAt: number;
        meta?: Record<string, unknown>;
      }>;
    };
    let assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
    if (args.kind) assets = assets.filter((a) => a.kind === args.kind);
    if (args.scenarioId) {
      const sid = args.scenarioId;
      assets = assets.filter(
        (a) => (a.meta as { scenarioId?: string } | undefined)?.scenarioId === sid,
      );
    }
    const limit = Math.max(1, Math.min(args.limit ?? 200, 500));
    return { assets: assets.slice(0, limit) };
  },

  /**
   * 为一个或多个场景生成视频。
   *
   * 2026-06 修复（闭环）：本工具**不再**直接 POST 宿主网关 fire-and-forget——那条
   * 路径只在网关建了任务、产物永远落不回剧本，作者什么都看不到。现在改为把
   * 「带 sceneId 的视频任务」投递到 `/__reel__/video-queue`，由工作台轮询消费
   * （pollVideoQueue → triggerVideoFromQueue），走与手动生成完全相同的浏览器内
   * 管线：createTask → videoTaskStore → 轮询 → 落盘 mediaStore → setSceneMediaRef
   * (VIDEO) → 时间轴显示，且刷新/翻页可被 resumeRunningVideoTasks 接盘。
   *
   * 因此 **sceneId 必填**（视频得有归属的场景），且**工作台必须打开**（同
   * reel:generate-visuals）。提交后立即返回，进度在影游工坊的 forge 对话里。
   */
  "reel:generate-video": async (args: GenerateVideoArgs, ctx: ToolCtx) => {
    const rawJobs: VideoJob[] = Array.isArray(args.jobs)
      ? args.jobs
      : args.sceneId
        ? [
            {
              sceneId: args.sceneId,
              scenarioId: args.scenarioId,
              prompt: args.prompt,
              durationSec: args.durationSec,
              size: args.size,
            },
          ]
        : [];
    const jobs = rawJobs.filter(
      (j) => j && typeof j.sceneId === "string" && j.sceneId.trim(),
    );
    if (jobs.length === 0) {
      throw Object.assign(
        new Error(
          "至少需要一个带 sceneId 的视频任务（视频必须绑定到具体场景才能在工作台显示）。" +
            "单条传 sceneId(+可选 prompt)，批量传 jobs:[{sceneId,…}]。",
        ),
        { code: "invalid_argument" },
      );
    }
    const base = getReelDevBase(ctx);
    const res = (await apiFetch(`${base}/__reel__/video-queue${gameQ(ctx)}`, {
      method: "POST",
      body: JSON.stringify({ jobs }),
    })) as { ok?: boolean; queued?: number };
    return {
      ok: true,
      queued: res.queued ?? jobs.length,
      sceneIds: jobs.map((j) => j.sceneId),
      message:
        `已把 ${jobs.length} 个视频任务投递到影游工坊队列。工作台会自动消费、生成并` +
        `把视频绑定到对应场景（时间轴可见）。进度见 forge 对话；该流程在浏览器管线里跑，` +
        `所以工作台必须保持打开。完成后可用 reel:get-scenario 查 scene.media.kind==='VIDEO' 确认。`,
    };
  },

  "reel:get-video-task": async (args: GetVideoTaskArgs, ctx: ToolCtx) => {
    if (!args.taskId) {
      throw Object.assign(new Error("taskId required"), {
        code: "invalid_argument",
      });
    }
    const base = getCeApiBase(ctx);
    const res = (await apiFetch(
      `${base}/video-status?taskId=${encodeURIComponent(args.taskId)}`,
    )) as {
      success?: boolean;
      status?: string;
      videoUrl?: string | null;
      error?: string | null;
    };
    return {
      taskId: args.taskId,
      status: res.status ?? "queued",
      videoUrl: res.videoUrl ?? null,
      error: res.error ?? null,
      createdAt: null,
      completedAt: null,
      durationSec: null,
    };
  },

  // ── 时间轴编辑工具箱 ─────────────────────────────────────────────────────

  "reel:get-scene-timeline": async (args: any, ctx: ToolCtx) => {
    const base = getReelDevBase(ctx);
    const db = await fetchScenarioDb(base, gameQ(ctx));
    const wantId = args.scenarioId ?? db.activeId ?? undefined;
    const item = wantId ? db.items.find((it) => it.id === wantId) : undefined;
    if (!item) {
      notFound(
        args.scenarioId
          ? `scenario not found: ${args.scenarioId}`
          : "no active scenario — pass scenarioId or open/forge one first",
      );
    }
    const scene = locateScene(
      item!.scenario as Record<string, unknown> & { id: string },
      args.sceneId,
    );
    const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
    const shots = arr(scene.shots)
      .map((s: any) => ({
        id: s.id,
        order: s.order,
        startMs: s.startMs,
        endMs: s.endMs,
        speed: s.speed,
        framing: s.framing,
        transitionIn: s.transitionIn ?? null,
        clipAnim: s.clipAnim ?? null,
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
      scenarioId: item!.id,
      sceneId: args.sceneId,
      durationMs: typeof scene.durationMs === "number" ? scene.durationMs : undefined,
      shots,
      dialogue: arr(scene.dialogue).map((d: any) => ({
        id: d.id, role: d.role, speaker: d.speaker, text: d.text, startMs: d.startMs, endMs: d.endMs,
      })),
      qteCues: arr(scene.qte?.cues).map((c: any) => ({
        id: c.id, shape: c.shape, appearAt: c.appearAt, targetAt: c.targetAt, label: c.label,
      })),
      audio: arr(scene.audio).map((a: any) => ({
        id: a.id, role: a.role, ref: a.ref, startMs: a.startMs, durationMs: a.durationMs,
        volume: a.volume, fadeInMs: a.fadeInMs, fadeOutMs: a.fadeOutMs,
      })),
      textOverlays: arr(scene.textOverlays).map((t: any) => ({
        id: t.id, text: t.text, startMs: t.startMs, endMs: t.endMs, x: t.x, y: t.y,
      })),
      markers: arr(scene.markers).map((m: any) => ({ id: m.id, ms: m.ms, label: m.label })),
    };
  },

  "reel:update-shot": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    if (!args.shotId) invalid("shotId required");
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      const shots = Array.isArray(scene.shots) ? scene.shots : [];
      const i = shots.findIndex((s: any) => s?.id === args.shotId);
      if (i < 0) notFound(`shot not found: ${args.shotId}`);
      const shot = { ...shots[i] };
      if (args.speed !== undefined) {
        if (typeof args.speed !== "number" || args.speed < 0 || args.speed > 4) {
          invalid("speed must be a number in [0, 4] (0=freeze, 1=normal)");
        }
        shot.speed = args.speed;
      }
      if (args.startMs !== undefined) shot.startMs = toMs(args.startMs);
      if (args.endMs !== undefined) shot.endMs = toMs(args.endMs);
      if (
        shot.startMs !== undefined &&
        shot.endMs !== undefined &&
        shot.endMs <= shot.startMs
      ) {
        invalid("endMs must be greater than startMs");
      }
      if (args.transitionIn !== undefined) {
        shot.transitionIn = args.transitionIn === null ? undefined : args.transitionIn;
      }
      if (args.clipAnim !== undefined) {
        shot.clipAnim = args.clipAnim === null ? undefined : args.clipAnim;
      }
      shots[i] = shot;
      scene.shots = shots;
    });
    return { ok: true, scenarioId: result.id, sceneId: args.sceneId, shotId: args.shotId, updatedAt: result.updatedAt };
  },

  "reel:edit-dialogue": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    const op = args.op as "add" | "update" | "remove";
    if (!["add", "update", "remove"].includes(op)) invalid("op must be add | update | remove");
    const newId = op === "add" ? genId("dia") : undefined;
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      let list: any[] = Array.isArray(scene.dialogue) ? [...scene.dialogue] : [];
      if (op === "add") {
        if (typeof args.text !== "string" || !args.text.trim()) invalid("text required for add");
        if (typeof args.startMs !== "number") invalid("startMs required for add");
        list.push({
          id: newId,
          role: args.role ?? "character",
          text: args.text,
          startMs: toMs(args.startMs),
          ...(args.speaker ? { speaker: args.speaker } : {}),
          ...(args.endMs !== undefined ? { endMs: toMs(args.endMs) } : {}),
        });
      } else {
        if (!args.id) invalid("id required for update/remove");
        const i = list.findIndex((d) => d?.id === args.id);
        if (i < 0) notFound(`dialogue not found: ${args.id}`);
        if (op === "remove") {
          list.splice(i, 1);
        } else {
          const next = { ...list[i] };
          if (args.role !== undefined) next.role = args.role;
          if (args.speaker !== undefined) next.speaker = args.speaker;
          if (args.text !== undefined) next.text = args.text;
          if (args.startMs !== undefined) next.startMs = toMs(args.startMs);
          if (args.endMs !== undefined) next.endMs = toMs(args.endMs);
          list[i] = next;
        }
      }
      scene.dialogue = list.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    });
    return { ok: true, op, scenarioId: result.id, sceneId: args.sceneId, id: newId ?? args.id, updatedAt: result.updatedAt };
  },

  "reel:edit-qte": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    const op = args.op as "add" | "update" | "remove";
    if (!["add", "update", "remove"].includes(op)) invalid("op must be add | update | remove");
    const newId = op === "add" ? genId("cue") : undefined;
    let cueCount = 0;
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      // 没有 qte 块时按需创建一套合理默认(窗口/分值)。
      if (!scene.qte || typeof scene.qte !== "object") {
        if (op !== "add") notFound("scene has no qte block");
        scene.qte = {
          cues: [],
          window: { perfect: 80, great: 160, good: 280 },
          score: { perfect: 100, great: 60, good: 30, miss: -10 },
        };
      }
      let cues: any[] = Array.isArray(scene.qte.cues) ? [...scene.qte.cues] : [];
      if (op === "add") {
        if (!["tap", "hold", "sweep"].includes(args.shape)) invalid("shape required (tap|hold|sweep) for add");
        if (typeof args.appearAt !== "number") invalid("appearAt required for add");
        if (typeof args.targetAt !== "number") invalid("targetAt required for add");
        if (args.shape === "sweep" && !args.sweepDir) invalid("sweepDir required when shape=sweep");
        cues.push({
          id: newId,
          shape: args.shape,
          x: typeof args.x === "number" ? args.x : 0.5,
          y: typeof args.y === "number" ? args.y : 0.5,
          appearAt: toMs(args.appearAt),
          targetAt: toMs(args.targetAt),
          ...(args.durationMs !== undefined ? { durationMs: toMs(args.durationMs) } : {}),
          ...(args.sweepDir ? { sweepDir: args.sweepDir } : {}),
          ...(args.label ? { label: args.label } : {}),
        });
      } else {
        if (!args.id) invalid("id required for update/remove");
        const i = cues.findIndex((c) => c?.id === args.id);
        if (i < 0) notFound(`qte cue not found: ${args.id}`);
        if (op === "remove") {
          cues.splice(i, 1);
        } else {
          const next = { ...cues[i] };
          for (const k of ["shape", "x", "y", "sweepDir", "label"] as const) {
            if (args[k] !== undefined) next[k] = args[k];
          }
          if (args.appearAt !== undefined) next.appearAt = toMs(args.appearAt);
          if (args.targetAt !== undefined) next.targetAt = toMs(args.targetAt);
          if (args.durationMs !== undefined) next.durationMs = toMs(args.durationMs);
          cues[i] = next;
        }
      }
      cues.sort((a, b) => (a.appearAt ?? 0) - (b.appearAt ?? 0));
      scene.qte.cues = cues;
      cueCount = cues.length;
    });
    return { ok: true, op, scenarioId: result.id, sceneId: args.sceneId, id: newId ?? args.id, cueCount, updatedAt: result.updatedAt };
  },

  "reel:edit-text-overlay": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    const op = args.op as "add" | "update" | "remove";
    if (!["add", "update", "remove"].includes(op)) invalid("op must be add | update | remove");
    const newId = op === "add" ? genId("txt") : undefined;
    const STYLE = ["fontSizePct", "rotation", "fontWeight", "color", "strokeColor", "align"] as const;
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      let list: any[] = Array.isArray(scene.textOverlays) ? [...scene.textOverlays] : [];
      if (op === "add") {
        if (typeof args.text !== "string" || !args.text.trim()) invalid("text required for add");
        if (typeof args.startMs !== "number") invalid("startMs required for add");
        list.push({
          id: newId,
          text: args.text,
          startMs: toMs(args.startMs),
          x: typeof args.x === "number" ? args.x : 0.5,
          y: typeof args.y === "number" ? args.y : 0.5,
          ...(args.endMs !== undefined ? { endMs: toMs(args.endMs) } : {}),
          ...Object.fromEntries(STYLE.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])),
        });
      } else {
        if (!args.id) invalid("id required for update/remove");
        const i = list.findIndex((t) => t?.id === args.id);
        if (i < 0) notFound(`text overlay not found: ${args.id}`);
        if (op === "remove") {
          list.splice(i, 1);
        } else {
          const next = { ...list[i] };
          if (args.text !== undefined) next.text = args.text;
          if (args.startMs !== undefined) next.startMs = toMs(args.startMs);
          if (args.endMs !== undefined) next.endMs = toMs(args.endMs);
          if (args.x !== undefined) next.x = args.x;
          if (args.y !== undefined) next.y = args.y;
          for (const k of STYLE) if (args[k] !== undefined) next[k] = args[k];
          list[i] = next;
        }
      }
      scene.textOverlays = list.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    });
    return { ok: true, op, scenarioId: result.id, sceneId: args.sceneId, id: newId ?? args.id, updatedAt: result.updatedAt };
  },

  "reel:edit-audio": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    const op = args.op as "add" | "update" | "remove";
    if (!["add", "update", "remove"].includes(op)) invalid("op must be add | update | remove");
    const newId = op === "add" ? genId("aud") : undefined;
    const NUM = ["offsetMs", "volume", "fadeInMs", "fadeOutMs"] as const;
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      let list: any[] = Array.isArray(scene.audio) ? [...scene.audio] : [];
      if (op === "add") {
        if (!["bgm", "sfx", "vo"].includes(args.role)) invalid("role required (bgm|sfx|vo) for add");
        if (typeof args.ref !== "string" || !args.ref) invalid("ref (mediaStore audio id) required for add");
        if (typeof args.startMs !== "number") invalid("startMs required for add");
        if (typeof args.durationMs !== "number" || args.durationMs <= 0) invalid("durationMs required (>0) for add");
        list.push({
          id: newId,
          role: args.role,
          ref: args.ref,
          startMs: toMs(args.startMs),
          durationMs: toMs(args.durationMs),
          ...(args.offsetMs !== undefined ? { offsetMs: toMs(args.offsetMs) } : {}),
          ...(args.volume !== undefined ? { volume: args.volume } : {}),
          ...(args.fadeInMs !== undefined ? { fadeInMs: toMs(args.fadeInMs) } : {}),
          ...(args.fadeOutMs !== undefined ? { fadeOutMs: toMs(args.fadeOutMs) } : {}),
          ...(args.label ? { label: args.label } : {}),
        });
      } else {
        if (!args.id) invalid("id required for update/remove");
        const i = list.findIndex((a) => a?.id === args.id);
        if (i < 0) notFound(`audio clip not found: ${args.id}`);
        if (op === "remove") {
          list.splice(i, 1);
        } else {
          const next = { ...list[i] };
          if (args.role !== undefined) next.role = args.role;
          if (args.ref !== undefined) next.ref = args.ref;
          if (args.startMs !== undefined) next.startMs = toMs(args.startMs);
          if (args.durationMs !== undefined) next.durationMs = toMs(args.durationMs);
          if (args.label !== undefined) next.label = args.label;
          for (const k of NUM) {
            if (args[k] !== undefined) next[k] = k === "volume" ? args[k] : toMs(args[k]);
          }
          list[i] = next;
        }
      }
      scene.audio = list.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    });
    return { ok: true, op, scenarioId: result.id, sceneId: args.sceneId, id: newId ?? args.id, updatedAt: result.updatedAt };
  },

  "reel:edit-marker": async (args: any, ctx: ToolCtx) => {
    if (!args.sceneId) invalid("sceneId required");
    const op = args.op as "add" | "rename" | "remove";
    if (!["add", "rename", "remove"].includes(op)) invalid("op must be add | rename | remove");
    let outId: string | undefined = op === "add" ? undefined : args.id;
    let markerCount = 0;
    const result = await mutateScenario(ctx, args.scenarioId, (scenario) => {
      const scene = locateScene(scenario, args.sceneId);
      let list: any[] = Array.isArray(scene.markers) ? [...scene.markers] : [];
      if (op === "add") {
        if (typeof args.ms !== "number") invalid("ms required for add");
        const ms = toMs(args.ms);
        const dup = list.find((m) => Math.abs((m.ms ?? -1) - ms) <= 1);
        if (dup) {
          outId = dup.id;
        } else {
          outId = genId("mk");
          list.push({ id: outId, ms, ...(args.label ? { label: args.label } : {}) });
        }
      } else {
        if (!args.id) invalid("id required for rename/remove");
        const i = list.findIndex((m) => m?.id === args.id);
        if (i < 0) notFound(`marker not found: ${args.id}`);
        if (op === "remove") {
          list.splice(i, 1);
        } else {
          if (typeof args.label !== "string") invalid("label required for rename");
          list[i] = { ...list[i], label: args.label };
        }
      }
      scene.markers = list.sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
      markerCount = list.length;
    });
    return { ok: true, op, scenarioId: result.id, sceneId: args.sceneId, id: outId, markerCount, updatedAt: result.updatedAt };
  },
};

// ── Import from Narrative Pipeline ──────────────────────────────────────────

interface ImportFromNarrativeArgs {
  runId: string;
  title?: string;
  setActive?: boolean;
  /**
   * Milestone-incremental import (reel⇄narrative staged collaboration). Pull a
   * single milestone's output and merge it into the same scenario:
   *   - "outline_acts" (M2): three-act outline + character bios + key items
   *     → scenario.synopsis / scenario.outline[] / scenario.characters{}
   *       (panel-facing top-level fields; raw payload also kept under meta.*)
   *   - "branched_beats" (M3): branch tree → scene skeletons (id/title/branches,
   *     no media/dialogue yet)
   *   - "screenplay" (M4): screenplay + storyboard → full scenes (dialogue, QTE,
   *     media prompts, durations)
   * Omit to auto-detect the latest available milestone (screenplay >
   * branched_beats > outline_acts) — preserves the legacy "one-shot end import".
   */
  milestone?: "outline_acts" | "branched_beats" | "screenplay";
}

interface NarrativeBeat {
  beat_id: string;
  scene_id?: string;
  prev_nodes?: string[];
  next_nodes?: Array<{ to: string; kind: string; label?: string }>;
  is_ending?: boolean;
  ending_label?: string;
}
interface NarrativeScreenplayBeat {
  beat_id: string;
  description?: string;
  dialogue?: Array<{ kind: string; speaker?: string; text: string }>;
  options?: Array<{ label: string; text: string; leads_to_beat: string }>;
  branch_qte?: {
    visual_action?: string;
    duration_ms?: number;
    pass_leads_to_beat?: string;
    fail_leads_to_beat?: string;
  };
}
interface NarrativeStoryboardBeat {
  beat_id: string;
  shots?: Array<{
    visual_content?: string;
    visual_prompt?: { zh?: string; en?: string };
    duration_sec?: number;
  }>;
}
interface NarrativeOutlineActs {
  title?: string;
  central_theme?: string;
  acts?: Array<{ act_id?: string; act_name?: string; content?: string }>;
}
interface NarrativeCharacterBio {
  name?: string;
  role?: string;
  identity?: string;
  external_motivation?: string;
  internal_motivation?: string;
  arc?: string;
  voice?: string;
  visual?: string;
}
interface NarrativeCharacterBios {
  characters?: NarrativeCharacterBio[];
}
interface NarrativeKeyItem {
  name?: string;
  category?: string;
  description?: string;
  narrative_function?: string;
  bound_character?: string;
}
interface NarrativeKeyItems {
  items?: NarrativeKeyItem[];
}

/**
 * Convert wb-narrative `vn_outline_acts` into the flat OutlineNode[] tree that
 * ForgeStudio's OutlinePanel reads from `scenario.outline` (top-level, NOT meta).
 * Each act becomes a top-level node; its `content` lands in `summary`.
 */
function outlineActsToNodes(raw: NarrativeOutlineActs | null): Array<{
  id: string;
  title: string;
  summary: string;
  order: number;
}> {
  const acts = raw?.acts ?? [];
  return acts.map((a, i) => ({
    id: `act-${a.act_id ?? i + 1}`,
    title: a.act_name ? `第${a.act_id ?? i + 1}幕 · ${a.act_name}` : `第${a.act_id ?? i + 1}幕`,
    summary: a.content ?? "",
    order: i,
  }));
}

/**
 * Convert wb-narrative `vn_character_bios` into the `Record<id, Character>`
 * shape that CharactersTextPanel reads from `scenario.characters`. The bio's
 * structured fields are folded into a single `prompt` (外观气质) string since
 * the panel only renders name + prompt.
 */
function characterBiosToScenario(raw: NarrativeCharacterBios | null): Record<
  string,
  { id: string; name: string; prompt: string }
> {
  const out: Record<string, { id: string; name: string; prompt: string }> = {};
  const list = raw?.characters ?? [];
  list.forEach((c, i) => {
    const name = (c.name ?? `角色${i + 1}`).trim();
    const id = `char-${slugify(name) || `n${i}`}`;
    const lines: string[] = [];
    if (c.role) lines.push(`【定位】${c.role}`);
    if (c.identity) lines.push(`【身份】${c.identity}`);
    if (c.visual) lines.push(`【外观】${c.visual}`);
    if (c.voice) lines.push(`【声线】${c.voice}`);
    if (c.external_motivation) lines.push(`【外驱】${c.external_motivation}`);
    if (c.internal_motivation) lines.push(`【内驱】${c.internal_motivation}`);
    if (c.arc) lines.push(`【弧光】${c.arc}`);
    out[id] = { id, name, prompt: lines.join("\n") };
  });
  return out;
}

/**
 * vn_key_items → scenario.props（道具锚点）。
 *
 * 背景：叙事管线把"信物 / 武器 / 关键文件"等关键道具放在 vn_key_items 里，但
 * import-from-narrative 以前只把它塞进 meta.keyItems + 派生关系，从不落进
 * scenario.props —— 于是导入的剧本"道具也没有"，generate-visuals 也无道具可出图。
 * 这里把每个 key item 映射成一个 Prop：name + 由 description/narrative_function/
 * category 折叠出的外观/识别提示词，供后续道具基准图生成使用。
 */
function keyItemsToProps(raw: NarrativeKeyItems | null): Record<
  string,
  { id: string; name: string; prompt: string }
> {
  const out: Record<string, { id: string; name: string; prompt: string }> = {};
  const list = raw?.items ?? [];
  list.forEach((it, i) => {
    const name = (it.name ?? "").trim();
    if (!name) return;
    let id = `prop-${slugify(name) || `n${i}`}`;
    while (out[id]) id = `${id}-${i}`;
    const lines: string[] = [];
    if (it.category) lines.push(`【类别】${it.category}`);
    if (it.description) lines.push(`【外观】${it.description}`);
    if (it.narrative_function) lines.push(`【叙事作用】${it.narrative_function}`);
    if (it.bound_character) lines.push(`【关联角色】${it.bound_character}`);
    out[id] = { id, name, prompt: lines.join("\n") || name };
  });
  return out;
}

/**
 * Derive a character-relations graph for ForgeStudio's RelationsPanel
 * (`scenario.characterRelations`). wb-narrative does NOT emit an explicit
 * relation graph, but the bios' `role` + key_items' `bound_character` encode
 * enough to seed one:
 *   - Star topology around the 主角/protagonist: every other character gets an
 *     edge protagonist → them, labelled by their narrative role (对立/关键关系人…).
 *   - Each key item with a `bound_character` adds an edge protagonist → that
 *     character labelled "关联道具：<item>" (so the prop binding is visible).
 * The author can freely edit/extend these in the panel afterwards.
 *
 * charIds MUST match characterBiosToScenario's scheme (`char-<slug|nI>`).
 */
function deriveCharacterRelations(
  biosRaw: NarrativeCharacterBios | null,
  itemsRaw: NarrativeKeyItems | null,
): Array<{ id: string; fromCharId: string; toCharId: string; label: string; note?: string }> {
  const bios = biosRaw?.characters ?? [];
  if (bios.length < 2) return [];

  // Resolve each bio to its stable id + remember name→id for item binding.
  const idByName = new Map<string, string>();
  const entries = bios.map((c, i) => {
    const name = (c.name ?? `角色${i + 1}`).trim();
    const id = `char-${slugify(name) || `n${i}`}`;
    idByName.set(name, id);
    return { id, name, bio: c };
  });

  const isProtagonist = (role?: string) =>
    !!role && /主角|主人公|protagonist|玩家|你/i.test(role);
  const hub = entries.find((e) => isProtagonist(e.bio.role)) ?? entries[0];

  const relations: Array<{ id: string; fromCharId: string; toCharId: string; label: string; note?: string }> = [];
  let counter = 0;
  for (const e of entries) {
    if (e.id === hub.id) continue;
    counter++;
    const label = (e.bio.role ?? "相关角色").trim();
    const note = [e.bio.identity, e.bio.internal_motivation]
      .filter(Boolean)
      .join("；")
      .slice(0, 200) || undefined;
    relations.push({ id: `rel-${counter}`, fromCharId: hub.id, toCharId: e.id, label, note });
  }

  // Key-item bindings → supplementary "关联道具" edges from the hub.
  const items = itemsRaw?.items ?? [];
  for (const it of items) {
    const bound = it.bound_character?.trim();
    if (!bound) continue;
    const toId = idByName.get(bound);
    if (!toId || toId === hub.id) continue;
    counter++;
    relations.push({
      id: `rel-${counter}`,
      fromCharId: hub.id,
      toCharId: toId,
      label: `关联道具：${it.name ?? "道具"}`,
      note: it.narrative_function?.slice(0, 200) || undefined,
    });
  }

  return relations;
}

function getNarrativeApiBase(ctx: ToolCtx): string {
  const port = ctx.env?.NARRATIVE_PORT ?? "8900";
  return `http://localhost:${port}/api/narrative`;
}

/**
 * wb-narrative's `/files/:k` and `/file/:k/*` endpoints key off the run's
 * on-disk DIRECTORY name (e.g. "2026-06-12_07-44-59-343"), NOT the logical
 * runId (e.g. "regen_1781250299343_8htygb") that agents pass around. Calling
 * them with the runId returns "Run not found", which is exactly why a staged
 * import silently produced an empty scenario.
 *
 * This resolves whatever identifier the caller has (runId OR directory key)
 * into the canonical directory key via /history. If the input already lists
 * files directly, or no match is found, it's returned unchanged so legacy
 * runs / direct-key callers keep working.
 */
async function resolveNarrativeRunKey(base: string, runId: string): Promise<string> {
  // Fast path: the id already works as a files key.
  try {
    const direct = (await apiFetch(`${base}/files/${encodeURIComponent(runId)}`)) as {
      files?: unknown[];
      error?: string;
    };
    if (Array.isArray(direct?.files)) return runId;
  } catch {
    // fall through to history lookup
  }
  try {
    const hist = (await apiFetch(`${base}/history`)) as Array<{
      key?: string;
      id?: string;
    }>;
    const list = Array.isArray(hist) ? hist : [];
    const hit = list.find((r) => r.id === runId || r.key === runId);
    if (hit?.key) return hit.key;
  } catch {
    // history unavailable; return as-is
  }
  return runId;
}

/**
 * Narrative steps land on disk as `<index>_<中文名>.<ext>` (see wb-narrative
 * STEP_FILE_MAP), NOT as `<stepId>.json`. To stay robust against the localized
 * filename we resolve by the stable numeric/letter index prefix via the
 * /files/:runId listing, then read the matched file.
 */
const NARRATIVE_STEP_INDEX: Record<string, string> = {
  vn_logline: "V0",
  vn_outline_acts: "V1",
  vn_character_bios: "V1a",
  vn_key_items: "V1b",
  vn_scenes: "V2",
  vn_beats: "V3",
  vn_branched_beats: "V6",
  vn_state_ledger: "V6a",
  vn_screenplay: "V7",
  vn_storyboard: "V8",
};

async function listNarrativeFiles(base: string, runId: string): Promise<string[]> {
  try {
    const resp = (await apiFetch(`${base}/files/${encodeURIComponent(runId)}`)) as {
      files?: Array<string | { path?: string; name?: string }>;
    };
    const files = resp?.files ?? [];
    return files
      .map((f) => (typeof f === "string" ? f : (f.path ?? f.name ?? "")))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchNarrativeFileRaw(base: string, runId: string, filePath: string): Promise<unknown | null> {
  const segs = filePath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = `${base}/file/${encodeURIComponent(runId)}/${segs}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) return await res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Read a narrative step output by stepId. Resolves the real (localized)
 * filename via its index prefix, with a couple of legacy-name fallbacks so we
 * keep working whether the run was produced incrementally or exported.
 */
async function fetchNarrativeStep(
  base: string,
  runId: string,
  stepId: string,
  fileList?: string[],
): Promise<unknown | null> {
  const index = NARRATIVE_STEP_INDEX[stepId];
  const files = fileList ?? (await listNarrativeFiles(base, runId));
  if (index) {
    const match = files.find((f) => {
      const name = f.split("/").pop() ?? f;
      return name.startsWith(`${index}_`) && name.endsWith(".json");
    });
    if (match) {
      const hit = await fetchNarrativeFileRaw(base, runId, match);
      if (hit != null) return hit;
    }
  }
  // Fallbacks: legacy direct names some runs/exports use.
  for (const candidate of [`${stepId}.json`, `${index}_${stepId}.json`]) {
    const hit = await fetchNarrativeFileRaw(base, runId, candidate);
    if (hit != null) return hit;
  }
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Stable scenario id derived from the narrative runId so repeated milestone
 *  imports merge into the SAME scenario instead of spawning new ones. */
function deriveScenarioId(runId: string): string {
  return `narr-${slugify(runId)}`.slice(0, 64) || `narr-${runId.slice(0, 8)}`;
}

/** Auto-detect the furthest milestone available on disk for a run. */
async function detectLatestMilestone(
  base: string,
  runId: string,
  files: string[],
): Promise<"outline_acts" | "branched_beats" | "screenplay" | null> {
  const has = async (stepId: string) => (await fetchNarrativeStep(base, runId, stepId, files)) != null;
  if (await has("vn_screenplay")) return "screenplay";
  if (await has("vn_branched_beats")) return "branched_beats";
  if (await has("vn_outline_acts")) return "outline_acts";
  return null;
}

/** Convert branched beats → full scenes (screenplay + storyboard enriched). */
function beatsToScenes(
  beats: NarrativeBeat[],
  spMap: Map<string, NarrativeScreenplayBeat>,
  sbMap: Map<string, NarrativeStoryboardBeat>,
  skeletonOnly: boolean,
): { scenes: Record<string, unknown>; rootSceneId: string } {
  const scenes: Record<string, unknown> = {};
  let dialogueCounter = 0;

  for (const beat of beats) {
    const sp = spMap.get(beat.beat_id);
    const sb = sbMap.get(beat.beat_id);

    let mediaPrompt = "";
    if (sb?.shots?.length) {
      mediaPrompt = sb.shots[0].visual_prompt?.en ?? sb.shots[0].visual_content ?? "";
    }
    if (!mediaPrompt && sp?.description) mediaPrompt = sp.description;

    let durationMs = 6000;
    if (sb?.shots?.length) {
      const totalSec = sb.shots.reduce((sum, s) => sum + (s.duration_sec ?? 2), 0);
      durationMs = Math.round(totalSec * 1000);
    }

    const dialogue: Array<Record<string, unknown>> = [];
    if (!skeletonOnly && sp?.dialogue) {
      let startMs = 0;
      const charMs = 50;
      for (const line of sp.dialogue) {
        dialogueCounter++;
        const role =
          line.kind === "dialogue" ? "character" :
          line.kind === "sfx" ? "system" : "narration";
        const dlg: Record<string, unknown> = { id: `d${dialogueCounter}`, role, text: line.text, startMs };
        if (line.speaker) dlg.speaker = line.speaker;
        dialogue.push(dlg);
        startMs += Math.max(1000, line.text.length * charMs);
      }
    }

    const branches: Array<Record<string, unknown>> = [];
    let branchCounter = 0;
    if (sp?.options?.length) {
      for (const opt of sp.options) {
        branchCounter++;
        branches.push({ id: `b${beat.beat_id}-${branchCounter}`, kind: "choice", label: opt.text, targetSceneId: opt.leads_to_beat });
      }
    } else if (sp?.branch_qte) {
      const qte = sp.branch_qte;
      if (qte.pass_leads_to_beat) {
        branchCounter++;
        branches.push({ id: `b${beat.beat_id}-${branchCounter}`, kind: "qte_pass", targetSceneId: qte.pass_leads_to_beat });
      }
      if (qte.fail_leads_to_beat) {
        branchCounter++;
        branches.push({ id: `b${beat.beat_id}-${branchCounter}`, kind: "qte_fail", targetSceneId: qte.fail_leads_to_beat });
      }
    } else if (beat.next_nodes?.length && !beat.is_ending) {
      for (const edge of beat.next_nodes) {
        branchCounter++;
        if (edge.kind === "choice") {
          branches.push({ id: `b${beat.beat_id}-${branchCounter}`, kind: "choice", label: edge.label ?? `选项${branchCounter}`, targetSceneId: edge.to });
        } else {
          branches.push({ id: `b${beat.beat_id}-${branchCounter}`, kind: "auto", targetSceneId: edge.to });
        }
      }
    }

    let qte: Record<string, unknown> | undefined;
    if (!skeletonOnly && sp?.branch_qte) {
      qte = {
        cues: [{ id: `q-${beat.beat_id}`, shape: "tap", x: 0.5, y: 0.5, appearAt: Math.max(0, durationMs - 3000), targetAt: Math.max(500, durationMs - 2000) }],
        window: { perfect: 80, great: 160, good: 280 },
        score: { perfect: 100, great: 70, good: 40, miss: -10 },
      };
    }

    scenes[beat.beat_id] = {
      id: beat.beat_id,
      title: sp?.description?.slice(0, 30) ?? `Scene ${beat.beat_id}`,
      media: { kind: "IMAGE_PROMPT", prompt: skeletonOnly ? "" : (mediaPrompt || "placeholder scene") },
      durationMs,
      dialogue,
      branches,
      ...(qte ? { qte } : {}),
    };
  }

  const rootBeat = beats.find((b) => !b.prev_nodes || b.prev_nodes.length === 0);
  const rootSceneId = rootBeat?.beat_id ?? beats[0]?.beat_id ?? "s1";
  return { scenes, rootSceneId };
}

tools["reel:import-from-narrative"] = async (args: ImportFromNarrativeArgs, ctx: ToolCtx) => {
  if (!args.runId || !args.runId.trim()) {
    throw Object.assign(new Error("runId required"), { code: "invalid_argument" });
  }
  const narrativeBase = getNarrativeApiBase(ctx);
  const reelBase = getReelDevBase(ctx);
  const warnings: string[] = [];

  // The agent may pass a logical runId OR a directory key; the narrative file
  // endpoints only accept the directory key. Resolve once up front and use the
  // key for every file read below. (deriveScenarioId still uses the raw runId
  // so the scenario id stays stable across staged milestone imports.)
  const runKey = await resolveNarrativeRunKey(narrativeBase, args.runId);
  const files = await listNarrativeFiles(narrativeBase, runKey);
  const milestone = args.milestone ?? (await detectLatestMilestone(narrativeBase, runKey, files));
  if (!milestone) {
    throw Object.assign(
      new Error(`Run '${args.runId}' has no importable narrative milestone yet (need at least vn_outline_acts). Start/resume the pipeline first.`),
      { code: "not_found" },
    );
  }

  // Merge into the SAME scenario across milestones (stable id from runId).
  const scenarioId = deriveScenarioId(args.runId);
  const db = await fetchScenarioDb(reelBase, gameQ(ctx));
  const existing = db.items.find((it) => it.id === scenarioId)?.scenario as
    | (Record<string, unknown> & { id: string })
    | undefined;

  const scenario: Record<string, unknown> & { id: string } = existing
    ? { ...existing }
    : {
        id: scenarioId,
        title: args.title ?? `Imported: ${args.runId}`,
        rootSceneId: "s1",
        defaultCharMs: 50,
        schemaVersion: 1,
        scenes: {},
      };
  if (args.title) scenario.title = args.title;
  const meta = (scenario.meta as Record<string, unknown> | undefined) ?? {};
  meta.narrativeRunId = args.runId;
  if (runKey !== args.runId) meta.narrativeRunKey = runKey;
  meta.lastMilestone = milestone;

  if (milestone === "outline_acts") {
    // M2: three-act outline + character bios + key items.
    // Write to the TOP-LEVEL scenario fields the ForgeStudio panels actually
    // read (scenario.outline / scenario.characters / scenario.synopsis), and
    // ALSO keep the raw narrative payload under meta.* for downstream tools.
    const outline = await fetchNarrativeStep(narrativeBase, runKey, "vn_outline_acts", files);
    const bios = await fetchNarrativeStep(narrativeBase, runKey, "vn_character_bios", files);
    const items = await fetchNarrativeStep(narrativeBase, runKey, "vn_key_items", files);
    const logline = await fetchNarrativeStep(narrativeBase, runKey, "vn_logline", files);
    if (!outline) {
      throw Object.assign(new Error(`Milestone outline_acts not found for run '${args.runId}'.`), { code: "not_found" });
    }
    // Raw payloads → meta (unchanged, for other consumers).
    meta.outline = outline;
    if (bios) meta.characters = bios;
    if (items) meta.keyItems = items;

    // Panel-facing top-level fields.
    const outlineRaw = outline as NarrativeOutlineActs;
    const outlineNodes = outlineActsToNodes(outlineRaw);
    if (outlineNodes.length > 0) {
      scenario.outline = outlineNodes;
    } else {
      warnings.push("vn_outline_acts had no acts; outline panel will stay empty");
    }
    if (bios) {
      const chars = characterBiosToScenario(bios as NarrativeCharacterBios);
      const charCount = Object.keys(chars).length;
      if (charCount > 0) {
        // Merge so a re-import doesn't blow away author edits / image refs.
        scenario.characters = {
          ...((scenario.characters as Record<string, unknown>) ?? {}),
          ...chars,
        };
      } else {
        warnings.push("vn_character_bios had no characters; characters panel will stay empty");
      }
    } else {
      warnings.push("vn_character_bios not found; characters panel will be empty");
    }

    // Key items → props（道具锚点）。Merge 而非覆盖，re-import 不抹掉作者编辑/参考图。
    if (items) {
      const props = keyItemsToProps(items as NarrativeKeyItems);
      const propCount = Object.keys(props).length;
      if (propCount > 0) {
        scenario.props = {
          ...((scenario.props as Record<string, unknown>) ?? {}),
          ...props,
        };
      }
    }

    // Synopsis: prefer logline, fall back to outline's central_theme/title.
    const loglineText =
      (logline as { logline?: string; synopsis?: string } | null)?.logline ??
      (logline as { synopsis?: string } | null)?.synopsis ??
      outlineRaw.central_theme;
    if (loglineText && !scenario.synopsis) scenario.synopsis = loglineText;

    // Character relations: wb-narrative emits no explicit graph, so derive a
    // seed one from bios.role + key_items.bound_character. Only seed when the
    // scenario has none yet — never clobber author-edited relations on re-import.
    const existingRels = (scenario.characterRelations as unknown[] | undefined) ?? [];
    if (existingRels.length === 0) {
      const rels = deriveCharacterRelations(
        bios as NarrativeCharacterBios | null,
        items as NarrativeKeyItems | null,
      );
      if (rels.length > 0) scenario.characterRelations = rels;
    }

    // outline[] / characters{} / characterRelations[] are v5 scenario features.
    scenario.schemaVersion = 5;
    scenario.meta = meta;
  } else if (milestone === "branched_beats") {
    // M3: branch tree → scene skeletons (ids/titles/branches, no media/dialogue).
    const branchedRaw = await fetchNarrativeStep(narrativeBase, runKey, "vn_branched_beats", files);
    if (!branchedRaw) {
      throw Object.assign(new Error(`Milestone branched_beats not found for run '${args.runId}'.`), { code: "not_found" });
    }
    const beats = (branchedRaw as { beats?: NarrativeBeat[] }).beats ?? [];
    if (beats.length === 0) {
      throw Object.assign(new Error("No beats in vn_branched_beats"), { code: "invalid_argument" });
    }
    const { scenes, rootSceneId } = beatsToScenes(beats, new Map(), new Map(), true);
    scenario.scenes = scenes;
    scenario.rootSceneId = rootSceneId;
    scenario.meta = meta;
    warnings.push("scene skeletons imported (M3); run screenplay milestone for dialogue / QTE / media prompts");
  } else {
    // M4 (screenplay): full scenes from branched + screenplay + storyboard.
    const branchedRaw = await fetchNarrativeStep(narrativeBase, runKey, "vn_branched_beats", files);
    const screenplayRaw = await fetchNarrativeStep(narrativeBase, runKey, "vn_screenplay", files);
    const storyboardRaw = await fetchNarrativeStep(narrativeBase, runKey, "vn_storyboard", files);
    if (!branchedRaw || !screenplayRaw) {
      throw Object.assign(
        new Error(`Run '${args.runId}' missing required VN outputs (vn_branched_beats / vn_screenplay) for screenplay milestone.`),
        { code: "not_found" },
      );
    }
    const beats = (branchedRaw as { beats?: NarrativeBeat[] }).beats ?? [];
    const spBeats = (screenplayRaw as { beats?: NarrativeScreenplayBeat[] }).beats ?? [];
    const sbBeats = (storyboardRaw as { storyboards?: NarrativeStoryboardBeat[] } | null)?.storyboards ?? [];
    if (beats.length === 0) {
      throw Object.assign(new Error("No beats found in vn_branched_beats"), { code: "invalid_argument" });
    }
    const spMap = new Map(spBeats.map((b) => [b.beat_id, b]));
    const sbMap = new Map(sbBeats.map((b) => [b.beat_id, b]));
    const { scenes, rootSceneId } = beatsToScenes(beats, spMap, sbMap, false);
    scenario.scenes = scenes;
    scenario.rootSceneId = rootSceneId;
    scenario.meta = meta;
    if (!storyboardRaw) {
      warnings.push("vn_storyboard not found; media prompts derived from screenplay descriptions only");
    }

    // 道具锚点：M4-only 导入（跳过 M2）时 scenario.props 仍为空 —— 这里补抓一次
    // vn_key_items 映射进 props（merge，不抹作者编辑/参考图）。M2 已导过则 props
    // 已随 existing 带入，重复 merge 同 id 也安全。
    if (Object.keys((scenario.props as Record<string, unknown>) ?? {}).length === 0) {
      const keyItems = await fetchNarrativeStep(narrativeBase, runKey, "vn_key_items", files);
      if (keyItems) {
        const props = keyItemsToProps(keyItems as NarrativeKeyItems);
        if (Object.keys(props).length > 0) {
          scenario.props = {
            ...((scenario.props as Record<string, unknown>) ?? {}),
            ...props,
          };
        }
      }
    }
  }

  // The reel scenario library is now per-game (scenarios + activeId are scoped
  // to the active game's `.forgeax/games/<slug>/reel/` via the `?game=` query),
  // so activating an import only changes THAT game's current reel — it no longer
  // hijacks other games. We still default to setActive=false (legacy callers /
  // intermediate drafts), but Reia opts in with setActive:true at each milestone
  // so the author sees progress land in the workbench live.
  const saveResult = await tools["reel:save-scenario"](
    { scenario: scenario as any, setActive: args.setActive === true },
    ctx,
  );

  const sceneCount = Object.keys((scenario.scenes as Record<string, unknown>) ?? {}).length;
  return {
    ok: true,
    scenarioId,
    title: scenario.title,
    milestone,
    sceneCount,
    activeId: (saveResult as { activeId?: string }).activeId ?? null,
    warnings,
  };
};

// ── Forge Script (submit to workbench pipeline) ──────────────────────────────

interface ForgeScriptArgs {
  text: string;
  mode?: "idea" | "script";
  title?: string;
}

tools["reel:forge-script"] = async (args: ForgeScriptArgs, ctx: ToolCtx) => {
  if (!args.text || !args.text.trim()) {
    throw Object.assign(new Error("text required (script content or idea)"), {
      code: "invalid_argument",
    });
  }
  const mode = args.mode ?? (args.text.length > 200 ? "script" : "idea");
  const base = getReelDevBase(ctx);
  const res = (await apiFetch(`${base}/__reel__/forge-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({ mode, text: args.text, title: args.title }),
  })) as { ok?: boolean; item?: unknown };
  return {
    ok: true,
    mode,
    message: `Submitted ${mode} to workbench forge pipeline. The workbench will process it through its internal workflow (synopsis → characters → outline → story tree).`,
  };
};

// ── Generate Visuals (extract anchors + generate reference images) ───────────
//
// Non-destructive visual step for an EXISTING scenario: the workbench will, on
// the active scenario, (1) extract location/prop anchors if missing, then
// (2) generate character turnaround sheets + location base images (multi-angle)
// + key prop reference images. It never re-creates the scenario and never
// generates shot keyframes (those stay in the story-tree flow).

interface GenerateVisualsArgs {
  scope?: "anchors";
  scenarioId?: string;
  force?: boolean;
}

// ── Generate Storyboard (split scene into shots → timeline placeholders) ─────
//
// 把节点拆成多个镜头（含 framing / durationSec / continuityGroupId），写回
// scene.shots[] 并在时间轴铺成站位（关键帧未生成时显示占位条）。这是「逐节点
// 分镜化生产」的第一步：必须先有 shots，后续逐镜关键帧 / 逐镜视频才有归属。
//
// 走工坊队列（pollStoryboardQueue → triggerStoryboardFromQueue），复用已测试的
// 批量分镜引擎 runActBatchUpgradeOnScenario。工作台必须打开（浏览器管线消费）。
//   - 单节点：传 sceneId（聚焦、省钱）。
//   - 整本铺底：scope='all'（享受跨场一致性回流）。
// 不改剧情结构（scenes/branches/characters 保留），只升级 prompts/shots。

interface GenerateStoryboardArgs {
  scope?: "scene" | "all";
  sceneId?: string;
  scenarioId?: string;
  force?: boolean;
}

tools["reel:generate-storyboard"] = async (
  args: GenerateStoryboardArgs,
  ctx: ToolCtx,
) => {
  const scope = args.scope === "all" ? "all" : "scene";
  if (scope === "scene" && (!args.sceneId || !args.sceneId.trim())) {
    throw Object.assign(
      new Error(
        "拆单个节点的分镜需要 sceneId（scope='scene'）。要给整本铺底请传 scope='all'。",
      ),
      { code: "invalid_argument" },
    );
  }
  const force = args.force === true;
  const base = getReelDevBase(ctx);
  await apiFetch(`${base}/__reel__/storyboard-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({
      scope,
      sceneId: args.sceneId,
      scenarioId: args.scenarioId,
      force,
    }),
  });
  return {
    ok: true,
    scope,
    sceneId: args.sceneId,
    force,
    message:
      (scope === "all"
        ? "已把「整本拆分镜」投递到影游工坊队列。"
        : `已把节点 ${args.sceneId} 的「拆分镜」投递到影游工坊队列。`) +
      (force
        ? "（force=重拆并清理旧分镜：会用新分镜替换时间轴上的旧镜头，旧视频/关键帧归档进素材库不删除；工作台会先让用户确认。）"
        : "") +
      "工作台会用导演分镜引擎把节点拆成多镜、写回 scene.shots[] 并在时间轴铺成可预览站位。" +
      "进度见 forge 对话；该流程在浏览器管线里跑，工作台必须保持打开。" +
      "完成后可用 reel:get-scenario 查 scene.shots 的镜头数确认，再逐镜 reel:generate-keyframes。",
  };
};

// ── Generate Keyframes (per-shot keyframe images for one scene) ──────────────
//
// 节点拆完分镜后，给该节点**逐镜**各出一张关键帧（写 shot.keyframeMediaRef，
// keyShot 同步 scene.media）。区别于 generate-visuals（只生成人/景/物锚点、不碰
// 分镜关键帧）：本工具专门铺满某个节点的所有镜头缩略图，是「逐节点出片」的中间步。
//
// 走工坊队列（pollKeyframeQueue → triggerKeyframeFromQueue），复用与作者在剧情树
// 手动「生成本镜」完全相同的纯函数。工作台必须打开。幂等：已有关键帧的镜默认跳过
// （force=true 才重生）。

interface GenerateKeyframesArgs {
  sceneId?: string;
  scenarioId?: string;
  force?: boolean;
}

tools["reel:generate-keyframes"] = async (
  args: GenerateKeyframesArgs,
  ctx: ToolCtx,
) => {
  if (!args.sceneId || !args.sceneId.trim()) {
    throw Object.assign(
      new Error(
        "sceneId required（关键帧必须绑定到具体节点的镜头；先 reel:generate-storyboard 拆镜）。",
      ),
      { code: "invalid_argument" },
    );
  }
  const base = getReelDevBase(ctx);
  await apiFetch(`${base}/__reel__/keyframe-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({
      sceneId: args.sceneId,
      scenarioId: args.scenarioId,
      force: args.force === true,
    }),
  });
  return {
    ok: true,
    sceneId: args.sceneId,
    message:
      `已把节点 ${args.sceneId} 的「逐镜关键帧」投递到影游工坊队列。工作台会对该节点的每个镜头` +
      `各出一张关键帧、写回 shot.keyframeMediaRef 并在时间轴每个分镜站位显示缩略图。` +
      `进度见 forge 对话；该流程在浏览器管线里跑，工作台必须保持打开。` +
      `完成后可用 reel:get-scenario 查各 shot.keyframeMediaRef 确认，再逐节点出片。`,
  };
};

// ── Produce Node (one-click: storyboard → keyframes → video) ─────────────────
//
// 一键把单个节点跑完整条生产线：拆分镜 → 逐镜关键帧 → 逐镜出片。幂等（默认跳过
// 已完成的阶段/镜）、可 stages 指定只跑某几个阶段、force 强制重跑。逐节点推进可见
// （对话里给节点级树状进度）。是 REIA「逐节点产出」的总指挥入口；想精细控制时
// 也可单独调 reel:generate-storyboard / reel:generate-keyframes / reel:generate-video。

interface ProduceNodeArgs {
  sceneId?: string;
  sceneIds?: string[];
  scope?: "node" | "firstN" | "all";
  count?: number;
  scenarioId?: string;
  stages?: Array<"storyboard" | "keyframes" | "video">;
  force?: boolean;
}

tools["reel:produce-node"] = async (args: ProduceNodeArgs, ctx: ToolCtx) => {
  const hasSceneIds = Array.isArray(args.sceneIds) && args.sceneIds.length > 0;
  const hasScope = args.scope === "all" || args.scope === "firstN";
  const hasSceneId = !!args.sceneId && !!args.sceneId.trim();
  if (!hasSceneIds && !hasScope && !hasSceneId) {
    throw Object.assign(
      new Error(
        "必须指定要生产的节点：sceneId（单个）/ sceneIds（列表）/ scope（'all' 全部、'firstN' 前 count 个）三选一。" +
          "把用户的话直接映射：『只生成第一个』→ scope=firstN count=1；『前三个』→ scope=firstN count=3；『全部』→ scope=all。",
      ),
      { code: "invalid_argument" },
    );
  }
  const VALID = ["storyboard", "keyframes", "video"] as const;
  const stages = Array.isArray(args.stages)
    ? args.stages.filter((s) => (VALID as readonly string[]).includes(s))
    : undefined;
  const count =
    args.scope === "firstN"
      ? Math.max(1, Math.floor(args.count ?? 1))
      : undefined;
  const base = getReelDevBase(ctx);
  await apiFetch(`${base}/__reel__/produce-node-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({
      sceneId: args.sceneId,
      sceneIds: hasSceneIds ? args.sceneIds : undefined,
      scope: hasScope ? args.scope : undefined,
      count,
      scenarioId: args.scenarioId,
      stages: stages && stages.length > 0 ? stages : undefined,
      force: args.force === true,
    }),
  });
  const target = hasSceneIds
    ? `${args.sceneIds!.length} 个节点`
    : args.scope === "all"
      ? "全部主线节点"
      : args.scope === "firstN"
        ? `主线前 ${count} 个节点`
        : `节点 ${args.sceneId}`;
  return {
    ok: true,
    sceneId: args.sceneId,
    sceneIds: hasSceneIds ? args.sceneIds : undefined,
    scope: hasScope ? args.scope : undefined,
    count,
    stages: stages && stages.length > 0 ? stages : ["storyboard", "keyframes", "video"],
    message:
      `已把「${target}」的一键产出投递到影游工坊队列。工作台会按` +
      `拆分镜 → 逐镜关键帧 → 逐镜出片的顺序逐节点跑完整条生产线（多节点沿主线顺序推进以保证跨节点一致性；` +
      `幂等，已完成的阶段/镜自动跳过；force=true 强制重跑）。视频逐镜在后台并发出片、不挡剪辑。` +
      `进度见 forge 对话的节点级树状进度；该流程在浏览器管线里跑，工作台必须保持打开。` +
      `完成后可用 reel:get-scenario 查 shots 的关键帧/视频确认。`,
  };
};

tools["reel:generate-visuals"] = async (args: GenerateVisualsArgs, ctx: ToolCtx) => {
  const base = getReelDevBase(ctx);
  await apiFetch(`${base}/__reel__/visual-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({
      scope: args.scope ?? "anchors",
      scenarioId: args.scenarioId,
      force: args.force === true,
    }),
  });
  return {
    ok: true,
    scope: args.scope ?? "anchors",
    message:
      "Queued visual anchor generation. The workbench will extract location/prop anchors (if missing) and generate character/location/prop reference images for the active scenario. Progress shows in the forge chat; this runs in the browser pipeline, so the workbench must be open.",
  };
};

// ── Generate Auditions (per-character audition video + voice sample) ─────────
//
// 角色定妆照生成之后的「试镜 + 音色」步骤：以每个角色的定妆照（turnaround）为参考，
// 用 Seedance 2.0 图生视频生成一段 ~10s / 3:4 的单人胸像「试镜视频」（角色本人念白），
// 并把整段音轨抽成 MP3 作为该角色的「音色样本」。该音色样本会在后续生成该角色镜头
// 视频时自动作 Seedance reference_audio 喂入，保证整部剧角色嗓音一致。
//
// 走工坊队列（pollAuditionQueue → triggerAuditionFromQueue），在浏览器管线里跑
// （Seedance 凭据 + mediaStore + AudioContext 抽音轨都在前端），工作台必须打开。
//   - scope='all'（默认）：给全部已有定妆照的角色生成（缺失才生成，幂等省钱）。
//   - scope='characters' + characterIds=[...]：只给指定角色生成。
//   - force=true：即使已有试镜视频也覆盖重生。
// 前置：角色必须先有定妆照（reel:generate-visuals）。无定妆照的角色会被跳过并提示。

interface GenerateAuditionsArgs {
  scope?: "all" | "characters";
  characterIds?: string[];
  scenarioId?: string;
  force?: boolean;
}

tools["reel:generate-auditions"] = async (
  args: GenerateAuditionsArgs,
  ctx: ToolCtx,
) => {
  const scope = args.scope === "characters" ? "characters" : "all";
  if (
    scope === "characters" &&
    (!Array.isArray(args.characterIds) || args.characterIds.length === 0)
  ) {
    throw Object.assign(
      new Error(
        "scope='characters' 需要非空的 characterIds（要给全部角色做请用 scope='all'）。",
      ),
      { code: "invalid_argument" },
    );
  }
  const base = getReelDevBase(ctx);
  await apiFetch(`${base}/__reel__/audition-queue${gameQ(ctx)}`, {
    method: "POST",
    body: JSON.stringify({
      scope,
      characterIds: scope === "characters" ? args.characterIds : undefined,
      scenarioId: args.scenarioId,
      force: args.force === true,
    }),
  });
  return {
    ok: true,
    scope,
    message:
      (scope === "all"
        ? "已把「给全部已有定妆照的角色生成试镜视频与音色」投递到影游工坊队列。"
        : `已把「给指定角色（${(args.characterIds ?? []).join("、")}）生成试镜视频与音色」投递到影游工坊队列。`) +
      "工作台会以每个角色的定妆照为参考生成 ~10s/3:4 单人胸像试镜视频，并把整段音轨抽成 MP3 绑为该角色音色；" +
      "后续该角色镜头视频会自动用这段音色作 reference_audio。" +
      "进度见 forge 对话；该流程在浏览器管线里跑，工作台必须保持打开。" +
      "前置：角色需先有定妆照（reel:generate-visuals），无定妆照的角色会被跳过。",
  };
};

export default tools;
