import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEntry, writeEntry, isSafeKey, entryPath } from "../entry-store.js";

describe("entry-store: output/<key>/_entry.json 持久化", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-store-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("isSafeKey 拦截目录穿越/非法名", () => {
    expect(isSafeKey("2026-07-02_10-00-00-000")).toBe(true);
    expect(isSafeKey("a_b-c.d")).toBe(true);
    expect(isSafeKey("../evil")).toBe(false);
    expect(isSafeKey("a/b")).toBe(false);
    expect(isSafeKey("")).toBe(false);
    expect(isSafeKey(undefined)).toBe(false);
  });

  it("writeEntry 首次写入创建目录并落 _entry.json", () => {
    const key = "2026-07-02_10-00-00-000";
    const cfg = writeEntry(tmp, key, { inputType: "text", userInput: "hello", routeGroup: "planning" });
    expect(cfg.key).toBe(key);
    expect(cfg.userInput).toBe("hello");
    expect(cfg.createdAt).toBeTruthy();
    expect(cfg.updatedAt).toBeTruthy();
    expect(fs.existsSync(entryPath(tmp, key))).toBe(true);
  });

  it("loadEntry 读回一致；不存在返回 null", () => {
    const key = "2026-07-02_11-00-00-000";
    expect(loadEntry(tmp, key)).toBeNull();
    writeEntry(tmp, key, { userInput: "abc" });
    expect(loadEntry(tmp, key)?.userInput).toBe("abc");
  });

  it("writeEntry upsert 合并：保留 createdAt，undefined 不覆盖，新字段合并", () => {
    const key = "2026-07-02_12-00-00-000";
    const first = writeEntry(tmp, key, { userInput: "v1", routeGroup: "planning", tier: "tier1" });
    const createdAt = first.createdAt;
    const second = writeEntry(tmp, key, { routeGroup: "narrative", ipRunKey: "2026-07-02_12-00-00-000_书名" });
    expect(second.createdAt).toBe(createdAt); // 保留创建时间
    expect(second.userInput).toBe("v1"); // undefined 字段不覆盖
    expect(second.tier).toBe("tier1"); // 旧字段保留
    expect(second.routeGroup).toBe("narrative"); // 显式字段覆盖
    expect(second.ipRunKey).toBe("2026-07-02_12-00-00-000_书名"); // 新字段合并
  });

  it("writeEntry 拒绝非法 key", () => {
    expect(() => writeEntry(tmp, "../evil", { userInput: "x" })).toThrow();
  });
});
