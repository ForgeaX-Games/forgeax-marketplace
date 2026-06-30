import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import tools from "../tool-handlers.js";

/**
 * 批3 平台对接契约校验：forgeax-plugin.json 声明的 tools 与 server/tool-handlers.ts
 * 暴露的 handler 必须一一对应（无孤儿声明、无孤儿 handler），并确认 IP DNA 三工具已暴露。
 */
const PLUGIN_JSON = path.resolve(fileURLToPath(new URL("../../forgeax-plugin.json", import.meta.url)));

const PLUGIN_DIR = path.dirname(PLUGIN_JSON);

interface ManifestTool {
  id: string;
  args?: unknown;
  returns?: unknown;
}

function manifestTools(): ManifestTool[] {
  const raw = JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8")) as {
    provides?: { tools?: ManifestTool[] };
  };
  return raw.provides?.tools ?? [];
}

function manifestToolIds(): string[] {
  return manifestTools().map((t) => t.id);
}

describe("batch3: IP DNA platform tool exposure contract", () => {
  it("declares + handles the three IP DNA tools", () => {
    const declared = new Set(manifestToolIds());
    const handlerKeys = new Set(Object.keys(tools));
    for (const id of ["narrative:ip-dna-start", "narrative:get-ip-dna", "narrative:ip-dna-analyze-impact"]) {
      expect(declared.has(id), `manifest 缺少工具声明 ${id}`).toBe(true);
      expect(handlerKeys.has(id), `tool-handlers 缺少 handler ${id}`).toBe(true);
      expect(typeof (tools as Record<string, unknown>)[id]).toBe("function");
    }
  });

  it("declares + handles the IP 半自动阶段门 tools (WS-D)", () => {
    const declared = new Set(manifestToolIds());
    const handlerKeys = new Set(Object.keys(tools));
    const stageTools = [
      "narrative:ip-dna-ingest",
      "narrative:ip-dna-get-hierarchy",
      "narrative:ip-dna-decompose",
      "narrative:ip-dna-confirm-scope",
      "narrative:ip-dna-confirm-units",
      "narrative:ip-dna-extract",
      "narrative:ip-dna-generate",
      "narrative:ip-dna-get-job",
    ];
    for (const id of stageTools) {
      expect(declared.has(id), `manifest 缺少阶段门工具 ${id}`).toBe(true);
      expect(handlerKeys.has(id), `tool-handlers 缺少阶段门 handler ${id}`).toBe(true);
      expect(typeof (tools as Record<string, unknown>)[id]).toBe("function");
    }
  });

  it("阶段门工具均带可解析的 args+returns schema 文件", () => {
    const stageTools = [
      "narrative:ip-dna-ingest",
      "narrative:ip-dna-get-hierarchy",
      "narrative:ip-dna-decompose",
      "narrative:ip-dna-confirm-scope",
      "narrative:ip-dna-confirm-units",
      "narrative:ip-dna-extract",
      "narrative:ip-dna-generate",
      "narrative:ip-dna-get-job",
    ];
    const byId = new Map(manifestTools().map((t) => [t.id, t]));
    for (const id of stageTools) {
      const tool = byId.get(id);
      expect(tool, `manifest 缺少工具 ${id}`).toBeDefined();
      for (const field of ["args", "returns"] as const) {
        const ref = tool![field];
        expect(typeof ref, `${id}.${field} 应为 schema 文件路径字符串`).toBe("string");
        const schemaPath = path.resolve(PLUGIN_DIR, ref as string);
        expect(fs.existsSync(schemaPath), `${id}.${field} 引用的 schema 文件不存在: ${ref}`).toBe(true);
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as { type?: string };
        expect(schema.type, `${id}.${field} schema 应为 object 顶层`).toBe("object");
      }
    }
  });

  it("manifest tools and handlers are a bijection (no orphans)", () => {
    const declared = manifestToolIds();
    const handlerKeys = Object.keys(tools);
    const missingHandlers = declared.filter((id) => !handlerKeys.includes(id));
    const orphanHandlers = handlerKeys.filter((id) => !declared.includes(id));
    expect(missingHandlers, `声明了但无 handler: ${missingHandlers.join(", ")}`).toEqual([]);
    expect(orphanHandlers, `有 handler 但未声明: ${orphanHandlers.join(", ")}`).toEqual([]);
  });

  it("IP DNA tools carry resolvable args+returns schema file refs (P3 契约)", () => {
    const ipDnaIds = ["narrative:ip-dna-start", "narrative:get-ip-dna", "narrative:ip-dna-analyze-impact"];
    const byId = new Map(manifestTools().map((t) => [t.id, t]));
    for (const id of ipDnaIds) {
      const tool = byId.get(id);
      expect(tool, `manifest 缺少工具 ${id}`).toBeDefined();
      for (const field of ["args", "returns"] as const) {
        const ref = tool![field];
        expect(typeof ref, `${id}.${field} 应为 schema 文件路径字符串`).toBe("string");
        const schemaPath = path.resolve(PLUGIN_DIR, ref as string);
        expect(fs.existsSync(schemaPath), `${id}.${field} 引用的 schema 文件不存在: ${ref}`).toBe(true);
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as { type?: string };
        expect(schema.type, `${id}.${field} schema 应为 object 顶层`).toBe("object");
      }
    }
  });
});
