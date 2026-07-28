import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const nodiaDir = join(import.meta.dir, "..", "extensions", "agent-nodia");
const manifest = JSON.parse(
  readFileSync(join(nodiaDir, "forgeax-extension.json"), "utf8"),
) as {
  provides: {
    agent: {
      produces: string[];
      tools: string[];
    };
  };
  description: { zh: string; en: string };
};

const guidanceFiles = [
  "AGENT.md",
  "persona/zh.md",
  "memory/lessons.md",
] as const;
const guidanceByFile = Object.fromEntries(
  guidanceFiles.map((path) => [
    path,
    readFileSync(join(nodiaDir, path), "utf8"),
  ]),
) as Record<(typeof guidanceFiles)[number], string>;
const wbGameVideoTools = [
  "wb-game-video:get-graph",
  "wb-game-video:save-graph",
  "wb-game-video:list-videos",
  "wb-game-video:generate-shot-script",
  "wb-game-video:generate-keyframe",
  "wb-game-video:generate-video",
  "wb-game-video:generate-node-video",
  "wb-game-video:list-assets",
  "wb-game-video:get-asset",
  "wb-game-video:import-character-refs",
  "wb-game-video:import-scene-refs",
];

const toolContractPatterns: Record<string, RegExp> = {
  "wb-game-video:get-graph": /get-graph[^\n]*project:\s*null/,
  "wb-game-video:save-graph":
    /save-graph[^\n]*project[^\n]*versions:\s*\[\]/,
  "wb-game-video:list-videos": /list-videos[^\n]*(?:videos|media\.ref)/,
  "wb-game-video:generate-shot-script":
    /generate-shot-script[^\n]*nodeName[^\n]*storyText[^\n]*shots/,
  "wb-game-video:generate-keyframe":
    /generate-keyframe[^\n]*sceneNodeId[^\n]*nodeName[^\n]*beat[^\n]*\basset\b/,
  "wb-game-video:generate-video":
    /generate-video[^\n]*sceneNodeId[^\n]*nodeName[^\n]*characterRefIds[^\n]*sceneRefIds[^\n]*60\s*秒[^\n]*\basset\b/,
  "wb-game-video:generate-node-video":
    /generate-node-video[^\n]*sceneNodeId[^\n]*nodeName[^\n]*characterRefIds[^\n]*sceneRefIds[^\n]*assets\[\]/,
  "wb-game-video:list-assets":
    /list-assets[^\n]*kind[^\n]*productionType[^\n]*sceneNodeId[^\n]*assets/,
  "wb-game-video:get-asset": /get-asset[^\n]*\bid\b[^\n]*\basset\b/,
  "wb-game-video:import-character-refs":
    /import-character-refs[^\n]*characters[^\n]*refs/,
  "wb-game-video:import-scene-refs":
    /import-scene-refs[^\n]*textures[^\n]*refs/,
};

function toolContractLine(file: (typeof guidanceFiles)[number], tool: string) {
  return guidanceByFile[file]
    .split(/\r?\n/u)
    .find((line) => line.includes(`\`${tool}\``));
}

describe("Nodia wb-game-video runtime contract", () => {
  test("declares and teaches the current 11-tool surface", () => {
    expect(
      manifest.provides.agent.tools.filter((tool) =>
        tool.startsWith("wb-game-video:"),
      ),
    ).toEqual(wbGameVideoTools);

    for (const file of guidanceFiles) {
      for (const tool of wbGameVideoTools) {
        const llmToolName = tool.replace(":", "_");
        expect(
          guidanceByFile[file].includes(tool) ||
            guidanceByFile[file].includes(llmToolName),
          `${file} must teach ${tool}`,
        ).toBeTrue();
      }
    }
  });

  test("teaches each tool's key inputs and returns in every guidance file", () => {
    for (const file of guidanceFiles) {
      expect(guidanceByFile[file]).toContain("@forgeax/wb-game-video");
      for (const [tool, pattern] of Object.entries(toolContractPatterns)) {
        const contract = toolContractLine(file, tool);
        expect(
          contract,
          `${file} must have one contract line for ${tool}`,
        ).toBeDefined();
        expect(contract!, `${file} must state the contract for ${tool}`).toMatch(
          pattern,
        );
      }
    }
  });

  test("generate-video contract rejects duration and return-shape mutations", () => {
    const pattern = toolContractPatterns["wb-game-video:generate-video"];
    for (const file of guidanceFiles) {
      const contract = toolContractLine(
        file,
        "wb-game-video:generate-video",
      );
      expect(
        contract,
        `${file} must have a generate-video contract line`,
      ).toBeDefined();
      const durationMutant = contract!.replace(/60\s*秒/u, "15 秒");
      const returnMutant = contract!.replace(/\basset\b/u, "assets");
      expect(durationMutant).not.toBe(contract);
      expect(returnMutant).not.toBe(contract);
      expect(durationMutant).not.toMatch(pattern);
      expect(returnMutant).not.toMatch(pattern);
    }
  });

  test("declares the current persistence and generation outputs", () => {
    expect(manifest.provides.agent.produces).toContain(
      "<active_game>.dir/blueprint.json",
    );
    expect(manifest.provides.agent.produces).toContain(
      "<active_game>.dir/project.json",
    );
    expect(manifest.provides.agent.produces).toContain(
      "<active_game>.dir/assets/**",
    );
    expect(manifest.description.zh).toContain("@forgeax/wb-game-video");
    expect(manifest.description.zh).toMatch(/生成.*视频|视频.*生成/);
    expect(manifest.description.en).toContain("@forgeax/wb-game-video");
    expect(manifest.description.en).toMatch(/generat/i);
  });

  test("teaches the real graph schema in every guidance file", () => {
    for (const file of guidanceFiles) {
      const guidance = guidanceByFile[file];
      expect(guidance).toContain(
        "CORE_NODE_KINDS = perf / subflow / subflowPack",
      );
      expect(guidance).toContain("GraphCondition = { all: GraphClause[] }");
      expect(guidance).toContain("project.ui.overlays");
      expect(guidance).toContain("node.data.overlayNodes");
      expect(guidance).toContain("node.data.reactions");
      expect(guidance).toMatch(
        /reactions[^\n]*do[^\n]*kind[^\n]*effect[^\n]*effects/,
      );
      expect(guidance).toContain("src/runtime/schema/graph-schema.ts");
      expect(guidance).toContain("src/runtime/nodes/index.ts");
      expect(guidance).not.toContain("wb-game-video/src/");
    }
  });

  test("rejects retired or invented schema semantics in every guidance file", () => {
    const retiredSemantics = [
      /game-video\/scenarios\.graph/,
      /scenarios\.graph\.versions/,
      /scenario\.graph/,
      /save-graph\(\{\s*scenario/,
      /只有三个工具|仅三个/,
      /无盘(?:数据)?回退(?:内置)?\s*demo/,
      /本引擎不生成新视频/,
      /generate-video[\s\S]{0,80}(?:已整体删除|不复存在)/,
      /node\.data\.timeline/,
      /node\.data\.hud/,
      /node\.data\.end/,
      /edge\.data\.effects/,
      /edge\.data\.label/,
      /option\.effects/,
      /\band\/or\/not\b/,
      /project\.rules/,
      /project\.rng/,
      /\.forgeax\/active-game\.json/,
      /起点\/结局标记/,
      /(?:不超过|≤)\s*15\s*秒/,
    ];

    for (const file of guidanceFiles) {
      for (const retired of retiredSemantics) {
        expect(guidanceByFile[file], `${file} contains ${retired}`).not.toMatch(
          retired,
        );
      }
    }
  });
});
