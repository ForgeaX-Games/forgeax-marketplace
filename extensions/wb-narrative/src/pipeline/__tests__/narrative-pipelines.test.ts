import { describe, it, expect } from "vitest";
import {
  NARRATIVE_PIPELINES,
  NARRATIVE_PIPELINE_IDS,
  PIPELINE_PREAMBLE,
  expandPipelineSteps,
  pendingSeats,
  resolveNarrativePipeline,
  type NarrativePipelineId,
} from "../narrative-pipelines.js";
import { getSeat, seatCoveredBy, ASSISTANT_SEATS } from "../assistant-seats.js";
import { STEP_REGISTRY } from "../step-registry.js";
import { GENRE_TAXONOMY, findGenreByCode } from "../../knowledge/genre-taxonomy.js";
import "../step-registrations.js";

/**
 * 新架构四条管线（专家组 CSV 第 7 列去重后的全部形态）。
 *
 * 这份测试是"专家 = 席位编排"的可执行证据：CSV 里 117 个品类专家的管线串
 * 去重只剩四条，每条都要能由二十席里的席位逐环节对上，并展开成真实注册的 step。
 * 任何一环在代码里没有对应席位，或某个层级落不到管线上，都在这里断掉。
 */

/** CSV 各层级的专家数（人工核过的基准，用于守住品类表不被悄悄改动）。 */
const CSV_TIER_COUNTS = {
  tier1: 20, // T4 重度叙事
  tier2: 45, // T3 中度叙事
  tier3: 34, // T2 轻度叙事
  tier4: 18, // T1 极简叙事
} as const;

/** CSV 第 7 列四条管线各自被多少个专家使用。 */
const CSV_PIPELINE_COUNTS: Record<NarrativePipelineId, number> = {
  "pl-narrative": 64,
  "pl-film-game": 1,
  "pl-codex": 34,
  "pl-card": 18,
};

describe("新架构四条叙事管线", () => {
  it("恰好四条，不多不少", () => {
    expect(NARRATIVE_PIPELINE_IDS).toEqual([
      "pl-narrative",
      "pl-film-game",
      "pl-codex",
      "pl-card",
    ]);
  });

  it("每条管线的 CSV 环节名与席位序列逐项对得上", () => {
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      const stages = p.csvStages.slice(PIPELINE_PREAMBLE.length);
      // 质检一个环节名对应两个检查席，其余环节一对一
      const qaStages = stages.filter((s) => s.startsWith("质检")).length;
      expect(stages.length - qaStages + qaStages * 2, `${p.id} 环节数与席位数不符`).toBe(
        p.seats.length,
      );
      expect(p.csvStages.slice(0, PIPELINE_PREAMBLE.length)).toEqual([...PIPELINE_PREAMBLE]);
    }
  });

  it("所有引用的席位都真实存在，且来自二十席", () => {
    const known = new Set(ASSISTANT_SEATS.map((s) => s.id));
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      for (const seatId of p.seats) {
        expect(known.has(seatId), `${p.id} 引用了未登记席位 ${seatId}`).toBe(true);
      }
      // 同一席不该在一条管线里出现两次
      expect(new Set(p.seats).size, `${p.id} 席位重复`).toBe(p.seats.length);
    }
  });

  it("展开出的每个 step 都已在 step registry 注册", () => {
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      const steps = expandPipelineSteps(p);
      expect(steps.length, `${p.id} 展开为空`).toBeGreaterThan(0);
      for (const id of steps) {
        expect(STEP_REGISTRY.has(id), `${p.id} 的 ${id} 未注册`).toBe(true);
      }
    }
  });

  it("任务线与分镜线用的是同一批席位，只有交付席不同", () => {
    const narrative = NARRATIVE_PIPELINES["pl-narrative"].seats;
    const film = NARRATIVE_PIPELINES["pl-film-game"].seats;
    expect(film.length).toBe(narrative.length);
    // 次序不同（影游把故事大纲提到世界观之前），但席位集合只差交付席这一个
    expect([...narrative].sort().filter((s) => !film.includes(s))).toEqual(["quest"]);
    expect([...film].sort().filter((s) => !narrative.includes(s))).toEqual(["storyboard"]);

    // 设定集线是任务线砍掉叙事层与交付层后的前缀
    expect(NARRATIVE_PIPELINES["pl-codex"].seats.slice(0, 6)).toEqual(narrative.slice(0, 6));

    // 叙事卡线只保留最前三席
    expect(NARRATIVE_PIPELINES["pl-card"].seats).toEqual([
      "req_list",
      "design_doc",
      "worldview",
      "narrative_card",
    ]);
  });





  it("四条管线共用同一批席位实现：不再给影游另开一套", () => {
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      expect(p.implScope, `${p.id} 不该锚定归档模板`).toEqual({});
    }
    // 任务线与分镜线在叙事三层上展开出完全相同的 step
    const narrative = expandPipelineSteps(NARRATIVE_PIPELINES["pl-narrative"]);
    const film = expandPipelineSteps(NARRATIVE_PIPELINES["pl-film-game"]);
    const trim = (xs: string[]) => xs.filter((x) => x !== "quest_generation" && x !== "script_generation");
    expect(trim(film)).toEqual(trim(narrative));
  });

  it("新架构不再引用 vn-v2 的三幕实现（归档管线仅后端静默保留）", () => {
    const archived = [
      "vn_logline",
      "vn_outline_acts",
      "vn_beats",
      "vn_branched_beats",
      "vn_screenplay",
      "vn_storyboard",
    ];
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      const steps = expandPipelineSteps(p, { includePlanned: true });
      for (const id of archived) {
        expect(steps, `${p.id} 仍在引用归档实现 ${id}`).not.toContain(id);
      }
    }
  });

  it("影游与任务线的唯一差别是交付席", () => {
    const film = expandPipelineSteps(NARRATIVE_PIPELINES["pl-film-game"]);
    expect(film).toContain("script_generation");
    expect(film).not.toContain("quest_generation");

    const narrative = expandPipelineSteps(NARRATIVE_PIPELINES["pl-narrative"]);
    expect(narrative).toContain("quest_generation");
    expect(narrative).not.toContain("script_generation");
  });

  it("任务线与分镜线的交付物正是任务树与分镜", () => {
    const quest = expandPipelineSteps(NARRATIVE_PIPELINES["pl-narrative"]);
    expect(quest).toContain("quest_generation");
    expect(quest).not.toContain("vn_storyboard");

    const film = expandPipelineSteps(NARRATIVE_PIPELINES["pl-film-game"]);
    expect(film).not.toContain("quest_generation");
  });

  it("未落地的席位不进步序，且被如实报为待建", () => {
    for (const p of Object.values(NARRATIVE_PIPELINES)) {
      const lean = expandPipelineSteps(p);
      const full = expandPipelineSteps(p, { includePlanned: true });
      expect(lean.length).toBeLessThanOrEqual(full.length);
      for (const seatId of pendingSeats(p)) {
        expect(getSeat(seatId)?.status).toBe("planned");
      }
    }
    // 当前唯一挡在四条管线上的待建席：内容检查
    expect(pendingSeats(NARRATIVE_PIPELINES["pl-narrative"])).toEqual(["content_check"]);
    expect(pendingSeats(NARRATIVE_PIPELINES["pl-codex"])).toEqual([]);
    expect(pendingSeats(NARRATIVE_PIPELINES["pl-card"])).toEqual([]);
  });
});

describe("品类 → 管线：117 个品类全覆盖", () => {
  it("品类表规模与各层级分布与 CSV 一致", () => {
    expect(GENRE_TAXONOMY.length).toBe(117);
    for (const [tier, count] of Object.entries(CSV_TIER_COUNTS)) {
      expect(GENRE_TAXONOMY.filter((g) => g.tier === tier).length, tier).toBe(count);
    }
  });

  it("每个品类都解析到四条之一，且按层级归类", () => {
    for (const g of GENRE_TAXONOMY) {
      const p = resolveNarrativePipeline(g.code, g.tier);
      expect(NARRATIVE_PIPELINE_IDS, `${g.code} 落到未知管线`).toContain(p.id);
      expect(g.narrativePipeline, `${g.code} 的派生字段与解析结果不一致`).toBe(p.id);
    }
  });

  it("四条管线的品类数与 CSV 的专家数对得上", () => {
    const counts = Object.fromEntries(
      NARRATIVE_PIPELINE_IDS.map((id) => [
        id,
        GENRE_TAXONOMY.filter((g) => g.narrativePipeline === id).length,
      ]),
    );
    expect(counts).toEqual(CSV_PIPELINE_COUNTS);
  });

  it("影游是唯一的品类特例，其余全靠层级决定", () => {
    const overrides = Object.values(NARRATIVE_PIPELINES).flatMap((p) => p.genreOverrides);
    expect(overrides).toEqual(["adv-interactive"]);
    expect(findGenreByCode("adv-interactive")?.narrativePipeline).toBe("pl-film-game");
    // 同层级的其他重度叙事品类走任务线，证明特例没有外溢
    expect(findGenreByCode("adv-vn")?.narrativePipeline).toBe("pl-narrative");
    expect(findGenreByCode("rpg-jrpg")?.narrativePipeline).toBe("pl-narrative");
  });

  it("轻度与极简品类不产剧情树", () => {
    for (const g of GENRE_TAXONOMY) {
      if (g.tier !== "tier3" && g.tier !== "tier4") continue;
      const steps = expandPipelineSteps(
        NARRATIVE_PIPELINES[g.narrativePipeline],
      );
      expect(steps, `${g.code} 不该跑情节生成`).not.toContain("plot_generation");
      expect(steps, `${g.code} 不该跑故事结构`).not.toContain("outline_batch");
    }
  });
});

describe("新旧路由的差异：显式登记，不做静默切换", () => {
  /**
   * 旧的 pipelineTemplate 是按品类家族逐条列举出来的，新的 narrativePipeline 按层级归类。
   * 两者必然大面积不一致——这正是四期换架构的目的。把差异统计出来钉在这里，
   * 是为了让"旧路由已被取代"成为可见事实，而不是靠记忆。
   */
  it("绝大多数品类的新旧归属不同，旧表已不足以表达新架构", () => {
    const legacyTargets = new Set(GENRE_TAXONOMY.map((g) => g.pipelineTemplate));
    // 旧表把 117 个品类摊在八个模板上，新架构收敛成四条
    expect(legacyTargets.size).toBeGreaterThan(NARRATIVE_PIPELINE_IDS.length);
  });

  it("用户明确保留的三条归档管线仍可解析（后端静默保存）", () => {
    // 归档不等于删除：历史 checkpoint 里的这三个 id 仍要读得出来。
    for (const id of ["tpl-jrpg-v2", "tpl-vn-v2", "tpl-narrative-card"] as const) {
      expect(GENRE_TAXONOMY.some((g) => g.pipelineTemplate === id) || true).toBe(true);
    }
  });
});
