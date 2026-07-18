/** observatory-actions —— wb-observatory 对宿主 / 模型暴露的内部操作声明。
 *
 *  只放**本插件专属的 action 声明**;通用 host↔plugin 通道 plumbing 在
 *  `./host-sdk-bridge`(vendored host-sdk surface client,与 wb-character/anim/skill
 *  同一形态)。每条带 `capability` 的 action 经 `surface.expose` 被 host 注册进
 *  ActionRegistry(ui_snapshot / ui_invoke / 命令面板 / 右键唤 AI 自动覆盖)。
 *
 *  典型工作流(static 回放):list_sessions → select_session → select_turn。
 */
import { forgeaxHost, type ExposeAction, type SurfaceActionCapability } from './host-sdk-bridge';
import { useObservatoryStore } from '../store/observatoryStore';

type Args = Record<string, unknown>;
const st = () => useObservatoryStore.getState();

interface ObservatoryAction {
  id: string;
  title: string;
  description?: string;
  capability: SurfaceActionCapability;
  inputSchema?: Record<string, unknown>;
  /** 执行体;返回值作为 surface.ack.result 回给宿主(act→observe 合并)。 */
  run: (args: Args) => unknown | Promise<unknown>;
}

const SURFACE_ID = 'observatory';

const ACTIONS: ObservatoryAction[] = [
  {
    id: 'observatory.set_mode',
    title: '切换观察模式',
    description:
      "Switch the observatory between 'static' (replay a saved agent session — you MUST then observatory.select_session, otherwise the graph stays empty) and 'live' (follow the most-recent running agent).",
    capability: 'write',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['static', 'live'] } }, required: ['mode'] },
    run: (a: Args) => {
      st().setSessionMode(a.mode === 'live' ? 'live' : 'static');
      return { sessionMode: st().sessionMode, sessionPath: st().sessionPath };
    },
  },
  {
    id: 'observatory.list_sessions',
    title: '列出可回放会话',
    description:
      'List saved agent sessions available for replay (id/name/game/updated). Use this to discover a valid session id before observatory.select_session. Returns { count, sessions:[{id,name,game,updated}] }.',
    capability: 'read',
    run: async () => {
      const res = await fetch('/api/observatory/sessions');
      const j: unknown = res.ok ? await res.json() : [];
      const arr = Array.isArray(j) ? j : Array.isArray((j as { sessions?: unknown }).sessions) ? (j as { sessions: unknown[] }).sessions : [];
      const sessions = (arr as Array<Record<string, unknown>>).slice(0, 50).map((s) => ({
        id: String(s.id ?? ''),
        name: typeof s.displayName === 'string' ? s.displayName : '',
        game: typeof s.defaultDir === 'string' ? s.defaultDir : '',
        updated: typeof s.updated === 'number' ? s.updated : null,
      }));
      return { count: sessions.length, sessions };
    },
  },
  {
    id: 'observatory.select_session',
    title: '选择会话',
    description:
      'Load a saved session into the observatory (the required first step for static replay). Pass its sid — discover ids via observatory.list_sessions. Pass empty string to clear.',
    capability: 'write',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
    run: (a: Args) => {
      st().setSessionPath(typeof a.sessionId === 'string' && a.sessionId ? a.sessionId : null);
      return { sessionPath: st().sessionPath };
    },
  },
  {
    id: 'observatory.select_turn',
    title: '选中回合',
    description:
      'Select a conversation turn by 0-based index to inspect its context and trace in the detail sidebar. Requires a session to be loaded first (observatory.select_session in static mode, or live mode).',
    capability: 'write',
    inputSchema: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
    run: (a: Args) => {
      st().setSelectedTurn(Number(a.index) || 0);
      return { selectedTurnIndex: st().selectedTurnIndex };
    },
  },
  {
    id: 'observatory.search',
    title: '搜索节点',
    description: 'Set the search query to filter / highlight nodes in the trajectory graph. Empty string clears it.',
    capability: 'write',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: (a: Args) => {
      st().setSearchQuery(typeof a.query === 'string' ? a.query : '');
      return { searchQuery: st().searchQuery };
    },
  },
  {
    id: 'observatory.close_sidebar',
    title: '关闭详情侧栏',
    description: 'Close the detail sidebar panel.',
    capability: 'write',
    run: () => {
      st().closeSidebar();
      return { closed: true };
    },
  },
];

let installed = false;

/** main.tsx 调用一次(幂等):经 host-sdk surface 暴露 action + 接住 dispatch。 */
export function installObservatoryActions(): void {
  if (installed || !forgeaxHost.available) return;
  installed = true;

  const byId = new Map(ACTIONS.map((a) => [a.id, a]));

  forgeaxHost.onSurfaceDispatch(async ({ actionId, args }) => {
    const act = byId.get(actionId);
    if (!act) throw new Error(`unknown action "${actionId}"`);
    return act.run((args && typeof args === 'object' ? args : {}) as Args);
  });

  const exposeActions: ExposeAction[] = ACTIONS.map((a) => ({
    id: a.id,
    label: a.title,
    description: a.description,
    inputSchema: a.inputSchema,
    capability: a.capability,
    enabled: true,
  }));
  const expose = (): void => forgeaxHost.surface.expose(SURFACE_ID, { actions: exposeActions });
  expose();
  // Re-expose once shortly after boot to defeat the host-listener-readiness race
  // (mirrors the retired VAG helper's proven retry); whole-table replace host-side
  // makes this idempotent.
  setTimeout(expose, 800);
}
