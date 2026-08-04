/**
 * M8 — 多管线产物目录布局。
 * sourceDir 从「只能是条目名」扩到「条目名 + pipelines/<pipelineId>」，
 * 因此校验必须逐段做，否则 `/resume` 的 dir 参数会成为目录穿越入口。
 */
import { describe, it, expect } from "vitest";
import {
  entryKeyOfRunDir,
  isSafeRunDir,
  parseRunDirName,
  runDirName,
} from "../run-layout.js";

describe("M8 run 目录布局", () => {
  it("主管线不下沉子目录（既有读侧路径不变）", () => {
    expect(runDirName("20260730_1200")).toBe("20260730_1200");
  });

  it("次管线落 pipelines/<pipelineId>/", () => {
    expect(runDirName("20260730_1200", "pipe-abc123")).toBe(
      "20260730_1200/pipelines/pipe-abc123",
    );
  });

  it("两种形态都能解析回条目与管线", () => {
    expect(parseRunDirName("k1")).toEqual({ entryKey: "k1" });
    expect(parseRunDirName("k1/pipelines/p9")).toEqual({
      entryKey: "k1",
      pipelineId: "p9",
    });
    expect(entryKeyOfRunDir("k1/pipelines/p9")).toBe("k1");
  });

  it("拒绝目录穿越与任意嵌套", () => {
    for (const bad of [
      "..",
      "../secret",
      "k1/../../etc",
      "k1/pipelines/../..",
      "k1/other/p9",
      "k1/pipelines/p9/deeper",
      "/abs/path",
      "k1/pipelines/",
      "",
      "k 1",
    ]) {
      expect(isSafeRunDir(bad), `should reject: ${bad}`).toBe(false);
      expect(parseRunDirName(bad)).toBeNull();
    }
  });

  it("接受安全的条目名字符集", () => {
    expect(isSafeRunDir("2026-07-30_12.00_abc")).toBe(true);
    expect(isSafeRunDir("2026-07-30/pipelines/pipe-a_1.2")).toBe(true);
  });
});
