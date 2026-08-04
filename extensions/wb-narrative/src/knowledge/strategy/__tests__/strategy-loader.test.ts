import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getStrategyRoot,
  getStrategyCard,
  getStrategyCards,
  listStrategyCards,
  getStrategyStats,
  resetStrategyCache,
} from "../strategy-loader.js";
import { GENRE_TAXONOMY } from "../../genre-taxonomy.js";
import {
  STORY_TYPE_CODES,
  STORY_THEME_CODES,
  STORY_STRUCTURE_CODES,
} from "../../narrative-axes/index.js";

beforeEach(() => resetStrategyCache());

describe("约定式策略库", () => {
  it("能解析到库根目录", () => {
    const root = getStrategyRoot();
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, "genre"))).toBe(true);
  });

  it("放进目录的 md 无需注册即被加载", () => {
    const card = getStrategyCard("genre", "rpg-jrpg");
    expect(card).not.toBeNull();
    expect(card!.name).toBe("JRPG");
    expect(card!.body).toContain("队伍即叙事单位");
    expect(card!.body.startsWith("---")).toBe(false);
  });

  it("frontmatter 缺省时 name 取文件名、四个环节全生效", () => {
    const root = getStrategyRoot()!;
    const tmp = path.join(root, "structure", "loop.md");
    fs.writeFileSync(tmp, "循环结构：首尾闭环，结尾必须能重新接回开头。\n", "utf-8");
    try {
      resetStrategyCache();
      const card = getStrategyCard("structure", "loop")!;
      expect(card.name).toBe("loop");
      expect(card.stages).toEqual(["demand", "design", "outline", "structure"]);
    } finally {
      fs.rmSync(tmp);
      resetStrategyCache();
    }
  });

  it("stages 能限定生效环节", () => {
    const root = getStrategyRoot()!;
    const tmp = path.join(root, "type", "comedy.md");
    fs.writeFileSync(tmp, "---\nname: 喜剧\nstages: [outline]\n---\n笑点即情节节点。\n", "utf-8");
    try {
      resetStrategyCache();
      expect(getStrategyCards({ type: "comedy" }, "outline").type?.name).toBe("喜剧");
      expect(getStrategyCards({ type: "comedy" }, "demand").type).toBeNull();
    } finally {
      fs.rmSync(tmp);
      resetStrategyCache();
    }
  });

  it("四轴齐备时一次取全，缺卡的轴返回 null 而不是抛错", () => {
    const cards = getStrategyCards(
      { genre: "rpg-jrpg", type: "drama", theme: "workplace", structure: "linear" },
      "design",
    );
    expect(cards.genre?.code).toBe("rpg-jrpg");
    expect(cards.type?.code).toBe("drama");
    expect(cards.theme?.code).toBe("workplace");
    expect(cards.structure?.code).toBe("linear");

    const sparse = getStrategyCards({ genre: "rpg-jrpg", theme: "nonexistent" }, "design");
    expect(sparse.genre).not.toBeNull();
    expect(sparse.theme).toBeNull();
    expect(sparse.type).toBeNull();
  });

  it("下划线开头的草稿文件被跳过", () => {
    const root = getStrategyRoot()!;
    const tmp = path.join(root, "genre", "_draft.md");
    fs.writeFileSync(tmp, "草稿内容，不该被加载。\n", "utf-8");
    try {
      resetStrategyCache();
      expect(listStrategyCards("genre").some((c) => c.code === "_draft")).toBe(false);
    } finally {
      fs.rmSync(tmp);
      resetStrategyCache();
    }
  });

  it("已入库的文件名全部命中词表（拼错就等于静默失效）", () => {
    const valid: Record<string, Set<string>> = {
      genre: new Set(GENRE_TAXONOMY.map((g) => g.code)),
      type: new Set<string>(STORY_TYPE_CODES),
      theme: new Set<string>(STORY_THEME_CODES),
      structure: new Set<string>(STORY_STRUCTURE_CODES),
    };
    for (const axis of ["genre", "type", "theme", "structure"] as const) {
      for (const card of listStrategyCards(axis)) {
        expect(valid[axis].has(card.code), `${axis}/${card.code}.md`).toBe(true);
      }
    }
    expect(getStrategyStats().emptyFiles).toEqual([]);
  });
});
