/**
 * @forgeax-plugin/tool-balance-resim — in-process resim worker.
 *
 * Exposes `balance:resim` (modules/02 §201-§214). Pure-tool plugin: no UI,
 * no agent state. Algorithm is intentionally simple (mulberry32 RNG + flat
 * unit-stat trade — atk vs def + hp), so that:
 *   - it runs sync within the bus call without subprocess plumbing;
 *   - results are reproducible given `seed`;
 *   - cc-coder / wb-balance can tune the formula by reading/writing this
 *     file (it's the plugin's `code:write` scope root).
 *
 * The schemas in ./schemas/*.json govern args/returns/event payloads; ajv
 * validation lives in the bus host (modules/02 §530), not here.
 */

interface ResimArgs {
  scenario: string;
  N: number;
  seed?: number;
  teamA?: string[];
  teamB?: string[];
}

interface UnitStat {
  hp: number;
  atk: number;
  def: number;
}

interface ResimReturns {
  winRate: number;
  samples: number;
  elapsedMs: number;
  ci95: [number, number];
  byScenarioStep?: { step: number; winRate: number }[];
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_STAT: UnitStat = { hp: 100, atk: 12, def: 5 };

function statFor(_id: string, rand: () => number): UnitStat {
  // Until cc-coder/wb-balance writes a real registry, every unit gets
  // DEFAULT_STAT ± a small jitter — keeps the resim non-degenerate.
  return {
    hp: Math.max(1, Math.round(DEFAULT_STAT.hp * (0.9 + rand() * 0.2))),
    atk: Math.max(1, Math.round(DEFAULT_STAT.atk * (0.9 + rand() * 0.2))),
    def: Math.max(0, Math.round(DEFAULT_STAT.def * (0.9 + rand() * 0.2))),
  };
}

function fightOnce(teamA: string[], teamB: string[], rand: () => number): 'A' | 'B' | 'tie' {
  const a = teamA.map((id) => statFor(id, rand));
  const b = teamB.map((id) => statFor(id, rand));
  let aliveA = a.length;
  let aliveB = b.length;
  let turn = 0;
  while (aliveA > 0 && aliveB > 0 && turn < 200) {
    const attacker = turn % 2 === 0 ? a : b;
    const defender = turn % 2 === 0 ? b : a;
    const attackerIdx = pickAlive(attacker, rand);
    const defenderIdx = pickAlive(defender, rand);
    if (attackerIdx < 0 || defenderIdx < 0) break;
    const dmg = Math.max(1, attacker[attackerIdx]!.atk - defender[defenderIdx]!.def);
    defender[defenderIdx]!.hp -= dmg;
    if (defender[defenderIdx]!.hp <= 0) {
      if (turn % 2 === 0) aliveB--; else aliveA--;
    }
    turn++;
  }
  if (aliveA > 0 && aliveB === 0) return 'A';
  if (aliveB > 0 && aliveA === 0) return 'B';
  return 'tie';
}

function pickAlive(team: UnitStat[], rand: () => number): number {
  const alive = team.map((u, i) => (u.hp > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 0) return -1;
  return alive[Math.floor(rand() * alive.length)]!;
}

export function resim(args: ResimArgs): ResimReturns {
  const t0 = Date.now();
  const rand = mulberry32(args.seed ?? Math.floor(Math.random() * 0x7fffffff));
  const teamA = args.teamA && args.teamA.length > 0 ? args.teamA : ['hero'];
  const teamB = args.teamB && args.teamB.length > 0 ? args.teamB : ['enemy'];
  let wins = 0;
  let ties = 0;
  for (let i = 0; i < args.N; i++) {
    const r = fightOnce(teamA, teamB, rand);
    if (r === 'A') wins++;
    else if (r === 'tie') ties++;
  }
  const samples = args.N;
  const winRate = samples > 0 ? wins / samples : 0;
  const se = Math.sqrt(Math.max(1e-9, (winRate * (1 - winRate)) / Math.max(1, samples)));
  const lo = Math.max(0, winRate - 1.96 * se);
  const hi = Math.min(1, winRate + 1.96 * se);
  return {
    winRate,
    samples,
    elapsedMs: Date.now() - t0,
    ci95: [lo, hi],
  };
}

export interface ToolPluginHandle {
  deactivate(): void;
}

export function activate(ctx: {
  registerTool: (id: string, fn: (args: ResimArgs) => ResimReturns) => void;
  emit?: (event: string, payload: unknown) => void;
  pluginId?: string;
}): ToolPluginHandle {
  ctx.registerTool('balance:resim', (args) => {
    const out = resim(args);
    ctx.emit?.('balance.resim.completed', {
      scenario: args.scenario,
      winRate: out.winRate,
      samples: out.samples,
      elapsedMs: out.elapsedMs,
      requestedBy: ctx.pluginId ?? '',
    });
    return out;
  });
  return {
    deactivate() {
      // tool-only plugin: no resource to release; host clears registry.
    },
  };
}
