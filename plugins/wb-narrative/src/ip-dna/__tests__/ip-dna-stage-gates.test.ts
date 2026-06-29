import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  runIngest,
  runExtractAndGenerate,
  loadExtractSource,
  loadExtractSourceByRun,
  type ExtractSource,
} from "../orchestrator.js";
import { runIpDnaPipeline } from "../orchestrator.js";
import { filterNoiseNodes, isNonContentTitle, isSpecialChapter } from "../noise-filter.js";
import { buildLightHierarchy } from "../phase1-understanding.js";
import { loadHierarchyIndex } from "../filesystem.js";

const NOVEL = [
  "# 序言",
  "这是作者的碎碎念，不属于正文。",
  "# 第一章 起",
  "张三登场，世界观铺开。".repeat(20),
  "# 第二章 承",
  "李四加入，冲突升级。".repeat(20),
  "# 后记",
  "感谢读者，番外彩蛋。",
  "# 求月票",
  "求大家投月票支持。",
].join("\n");

describe("WS-B 干扰项过滤", () => {
  it("非正文前缀判定 + 特殊章节豁免", () => {
    expect(isNonContentTitle("序言")).toBe(true);
    expect(isNonContentTitle("求月票")).toBe(true);
    expect(isNonContentTitle("作者的话")).toBe(true);
    expect(isNonContentTitle("第一章 起")).toBe(false);
    expect(isSpecialChapter("后记")).toBe(true);
    expect(isSpecialChapter("番外·夏日")).toBe(true);
    // 后记不应被当作干扰过滤（属于正文内容）。
    expect(isNonContentTitle("后记")).toBe(false);
  });

  it("filterNoiseNodes 剔除干扰节点、保留正文与特殊章节", () => {
    const dna = buildLightHierarchy({ story_timestamp: "20260101_0000", title: "测试", media_type: "book", text: NOVEL });
    const before = Object.values(dna.nodes).map((n) => n.title);
    expect(before.some((t) => t.includes("序言"))).toBe(true);
    const result = filterNoiseNodes(dna);
    const titles = Object.values(dna.nodes).map((n) => n.title);
    // 序言/求月票被剔除。
    expect(titles.some((t) => t.includes("序言"))).toBe(false);
    expect(titles.some((t) => t.includes("求月票"))).toBe(false);
    // 正文章节 + 后记保留。
    expect(titles.some((t) => t.includes("第一章"))).toBe(true);
    expect(titles.some((t) => t.includes("后记"))).toBe(true);
    expect(result.filtered.length).toBeGreaterThan(0);
  });
});

describe("WS-A 阶段门：runIngest → confirm → runExtractAndGenerate", () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ipdna-stage-"));
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("runIngest 落盘骨架层级树，过滤干扰项，返回默认改编指令", async () => {
    const ingest = await runIngest({
      files: [{ fileName: "n.md", data: NOVEL, fileType: "text/markdown" }],
      title: "阶段门",
      cwd: TMP,
    });
    expect(ingest.hydrated).toBe(false);
    expect(ingest.noise.filtered.length).toBeGreaterThan(0);
    expect(ingest.defaultDirective.adaptation_scope.full).toBe(true);
    // 骨架层级树已落盘（仅索引，无三件套）。
    const idx = loadHierarchyIndex(ingest.story_timestamp, "阶段门", { cwd: TMP });
    expect(idx).toBeDefined();
    expect(Object.keys(idx!.nodes).length).toBe(Object.keys(ingest.dna.nodes).length);
  });

  it("loadExtractSourceByRun 复读后 runExtractAndGenerate 串跑提取+落盘", async () => {
    const ingest = await runIngest({
      files: [{ fileName: "n.md", data: NOVEL, fileType: "text/markdown" }],
      title: "阶段门2",
      cwd: TMP,
    });
    const runId = `${ingest.story_timestamp}_阶段门2`;
    const source = loadExtractSourceByRun(runId, TMP) as ExtractSource;
    expect(source).toBeDefined();
    expect(source.hydrated).toBe(false);
    const result = await runExtractAndGenerate(
      { story_timestamp: ingest.story_timestamp, title: "阶段门2", cwd: TMP, runGeneration: false, scope: { full: true } },
      source,
    );
    // 提取后最小单元应有三件套。
    const leaves = Object.values(result.dna.nodes).filter((n) => n.children.length === 0);
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((n) => !!n.template)).toBe(true);
  });

  it("全自动 runIpDnaPipeline 仍等价（向后兼容）", async () => {
    const result = await runIpDnaPipeline({
      files: [{ fileName: "n.md", data: NOVEL, fileType: "text/markdown" }],
      title: "全自动",
      cwd: TMP,
      runGeneration: false,
    });
    expect(result.directive.adaptation_scope.full).toBe(true);
    const leaves = Object.values(result.dna.nodes).filter((n) => n.children.length === 0);
    expect(leaves.every((n) => !!n.template)).toBe(true);
  });
});
