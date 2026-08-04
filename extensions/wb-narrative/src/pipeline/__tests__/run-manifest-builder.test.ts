import { describe, it, expect } from "vitest";
import { buildRunManifest, buildEntryManifests } from "../run-manifest-builder.js";
import { splitCompositionByStartNodes } from "../../types/run-manifest.js";

describe("buildRunManifest", () => {
  it("plans jrpg preset into ordered agents with pending lifecycle", () => {
    const m = buildRunManifest({
      entryKey: "test-jrpg",
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "planning",
      },
    });
    expect(m.status).toBe("planned");
    expect(m.complete).toBe(true);
    expect(m.agents.length).toBeGreaterThan(3);
    expect(m.agents.every((a) => a.lifecycle.status === "pending")).toBe(true);
    expect(m.agents[0]!.agentId).toBeTruthy();
    expect(m.promptLibrary).toBe("v1"); // rpg-jrpg → tpl-jrpg → V1 槽位库
  });

  it("honors requestedSteps over preset (free composition wins)", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg" },
      requestedSteps: ["worldview", "character_enrichment"],
    });
    expect(m.agents.map((a) => a.agentId)).toEqual([
      "worldview",
      "character_enrichment",
    ]);
  });

  // Phase-2 M9：/plan 必须自己走 mode 路由，前端不再补 D0-D4 前缀或维护路由步序镜像。
  it("planning route prefixes the D0-D4 design chain (design_auto default)", () => {
    const m = buildRunManifest({
      config: { genreCode: "rpg-jrpg", tier: "tier1", routeGroup: "planning" },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids.slice(0, 5)).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
    ]);
    expect(ids).toContain("preference_summary");
    expect(ids).toContain("worldview");
  });

  // 选了层级但没选品类时，预览不能假装是 jrpg（tier4 真跑只有一步叙事卡）。
  it("tier-only planning preview uses the tier-exclusive template", () => {
    const t4 = buildRunManifest({
      config: { tier: "tier4", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    expect(t4).toEqual([
      "core_concept",
      "system_architecture",
      "system_detail",
      "value_framework",
      "design_doc",
      "narrative_card",
    ]);

    const t3 = buildRunManifest({
      config: { tier: "tier3", genreCode: null, routeGroup: "planning" },
    }).agents.map((a) => a.agentId);
    expect(t3).not.toContain("quest_generation");
    expect(t3).toContain("worldview");
  });

  it("static narrative mode uses modeConfig.steps verbatim (no design prefix)", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "worldview",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[ids.length - 1]).toBe("worldview");
  });

  it("vn v2 E2 bypass swaps outline/beats for normalize+confirm when a script is uploaded", () => {
    const cfg = {
      genreCode: "rpg-jrpg",
      tier: "tier1" as const,
      routeGroup: "narrative" as const,
      mode: "vn_script" as const,
    };
    const e1 = buildRunManifest({ config: cfg }).agents.map((a) => a.agentId);
    const e2 = buildRunManifest({ config: cfg, hasUploadedScript: true }).agents.map(
      (a) => a.agentId,
    );
    expect(e1).toContain("vn_outline_acts");
    expect(e2).not.toContain("vn_outline_acts");
    expect(e2).not.toContain("vn_beats");
    expect(e2).toContain("vn_script_normalize");
    expect(e2).toContain("vn_segment_confirm");
  });

  it("narrative_auto stays planner-driven (no mode step list to mirror)", () => {
    const m = buildRunManifest({
      config: {
        genreCode: "rpg-jrpg",
        tier: "tier1",
        routeGroup: "narrative",
        mode: "narrative_auto",
      },
    });
    const ids = m.agents.map((a) => a.agentId);
    expect(ids).not.toContain("core_concept");
    expect(ids[0]).toBe("preference_summary");
  });

  it("builds multi-pipeline entry from canvas starts", () => {
    const graphs = splitCompositionByStartNodes(
      [
        { id: "in1", catalogId: "input.text", category: "input", config: {} },
        { id: "in2", catalogId: "input.tags", category: "input", config: {} },
        { id: "ex", catalogId: "expert.jrpg", category: "expert", config: {} },
      ],
      [{ id: "e", source: "in1", target: "ex" }],
    );
    const manifests = buildEntryManifests("entry-multi", graphs, {
      genreCode: "rpg-jrpg",
    });
    expect(manifests).toHaveLength(2);
    expect(manifests.every((m) => m.entryKey === "entry-multi")).toBe(true);
    const complete = manifests.find((m) => m.compositionGraph?.startNodeId === "in1");
    const incomplete = manifests.find((m) => m.compositionGraph?.startNodeId === "in2");
    expect(complete?.complete).toBe(true);
    expect(incomplete?.complete).toBe(false);
  });
});
