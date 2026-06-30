/**
 * scene_merge_subtrees — 把多个 scene（每个在不同 focus 下展开了子树）合并成一个 master scene。
 *
 * 输入：scenes (access:list) — 一组 ScenePortValue，每个的 focus 子树是该 branch 独立展开的结果
 * 输出：scene (access:item) — 把每个 scene 在自己 focus 路径下的子树深合并进 master，输出 focus 固定为根节点 "/"
 *
 * 算法（递归深合并 + 保序 graft，复刻 add_child 的 z-order 语义）：
 *   1) 取第一个 scene 的 tree 作为 master 基底（它至少含有合并点以上的共用结构）
 *   2) 维护一个全局单调递增的 version 计数器（从 master.version + 1 起）
 *   3) 依次处理每个 scene（含 focus="/"）：把 scene.focus 子树 **递归深合并** 进 master 的同名路径：
 *      - master 缺失该 focus 路径时，先落 focus 节点壳（不含 children，保留 schema/transform/...）。
 *      - 逐个子节点按 version 升序还原加入顺序：
 *          · master 对应路径不存在 → 整棵 graftAt（分配全局递增 version 保 z-order）。
 *          · master 对应路径已存在 → **不跳过**，递归下钻继续逐层深合并；
 *            若 source 节点携带 cells/schema/transform/attributes/bounds 而 master 同名节点缺失，
 *            则补全（不覆盖 master 已有内容，避免破坏先到者）。
 *   4) 输出 focus 固定为根节点 "/"
 *
 * 为什么逐子节点 graft 而非整棵 upsertSubtree：projection 按 node.version 升序决定 z-order，
 * upsertSubtree → recloneSubtree 把整棵子树打成同一个 version，兄弟节点 version 全相等 →
 * 排序失去区分度退回 children 字典序，z-order 被打乱。逐个子节点各自递增 version 才能保序。
 *
 * 为什么要递归深合并（这是修复点）：多个 branch 由 scene_focus_children fanout 而来，
 * 共享同一棵 base，各自只在自己的子树里加内容。收束时它们都带着对方的「旧版同名子节点」。
 * 若按「同名整棵子树保留先到者」去重，后到 branch 在该子树内的新增后代会被整棵丢弃
 * （例：两个 scene 都在 /building 下、一个改 rest 一个改 architecture_*，旧实现会丢掉第二个的修改）。
 * 递归下钻到叶子逐层合并，才能把各 branch 各自的后代修改都保留下来。
 *
 * 同名叶子冲突（两个 branch 都新建了同名最终节点）：保留先到者，跳过后到者（避免 graftAt 抛错）。
 *
 * 已知局限：按 child.version 升序还原"加入顺序"依赖 version 单调反映加入次序。若 merge 前
 * 改过老子节点属性导致其 version 反超（last-touched），还原顺序会失真。根治需内核提供
 * creationVersion —— 这是既有局限，非本电池引入。
 */

import {
  graftAt,
  parseScenePort,
  readNode,
  setAttribute,
  setTransform,
  upsertCells,
  upsertSubtree,
  type ScenePortValue,
  type SceneNodeSnapshot,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  scene?: ScenePortValue;
  mergedCount?: number;
  error?: string;
}

interface MergeCtx {
  nextVersion: number;
}

const DBG = process.env.MERGE_SUBTREES_DEBUG === '1';
const dbg = (...a: unknown[]) => { if (DBG) console.log('[merge_subtrees]', ...a); };

/** 拼子路径："/" + name 或 parent + "/" + name。 */
function childPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

/**
 * 把 source 节点（已存在于 master 的 destPath 处）携带的标量属性补全进 master。
 * 仅在 master 同名节点 *缺失* 该属性时补，绝不覆盖 master 已有内容（保护先到者）。
 * 返回更新后的 master。
 */
function fillScalarProps(
  master: SceneNodeSnapshot,
  destPath: string,
  source: SceneNodeSnapshot,
  ctx: MergeCtx,
): SceneNodeSnapshot {
  const existing = readNode(master, destPath);
  if (existing === null) return master; // 调用方保证存在
  let out = master;

  // cells / schema：master 没 cells 但 source 有 → 补（upsertCells 会保留 children/transform/attributes）。
  if ((!existing.cells || existing.cells.length === 0) && source.cells && source.cells.length > 0) {
    out = upsertCells(
      out,
      destPath,
      {
        schema: source.schema ?? existing.schema ?? '',
        cells: source.cells,
        ...(source.bounds !== undefined ? { bounds: source.bounds } : {}),
      },
      ctx.nextVersion++,
    );
    dbg(`    fill cells@${destPath} (${source.cells.length})`);
  }

  // transform：master 无 transform 而 source 有 → 补。
  const afterCells = readNode(out, destPath)!;
  if (afterCells.transform === undefined && source.transform !== undefined) {
    out = setTransform(out, destPath, source.transform, ctx.nextVersion++);
  }

  // attributes：逐 key 补 master 缺失的键。
  if (source.attributes) {
    for (const [k, val] of Object.entries(source.attributes)) {
      const cur = readNode(out, destPath)!;
      if (!cur.attributes || !Object.prototype.hasOwnProperty.call(cur.attributes, k)) {
        out = setAttribute(out, destPath, k, val, ctx.nextVersion++);
      }
    }
  }

  return out;
}

/**
 * 把 source 子树递归深合并进 master 的 destPath 处。destPath 必须已存在于 master。
 * 逐个 source 子节点（按 version 升序还原加入顺序）：
 *   - master 缺该子路径 → 整棵 graftAt（递增 version 保 z-order）
 *   - master 已有该子路径 → 先补全标量属性，再递归下钻深合并其 children
 */
function deepMergeChildren(
  master: SceneNodeSnapshot,
  destPath: string,
  source: SceneNodeSnapshot,
  ctx: MergeCtx,
): SceneNodeSnapshot {
  let out = master;
  const ordered = [...source.children].sort((a, b) => a.version - b.version);
  for (const child of ordered) {
    const childDest = childPath(destPath, child.name);
    if (readNode(out, childDest) === null) {
      out = graftAt(out, childDest, child, ctx.nextVersion++);
      dbg(`    graft ${childDest}`);
    } else {
      out = fillScalarProps(out, childDest, child, ctx);
      out = deepMergeChildren(out, childDest, child, ctx);
    }
  }
  return out;
}

export function sceneMergeSubtrees(input: Record<string, unknown>): Result {
  const raw = input.scenes;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'scenes is required and must be a non-empty list' };
  }
  const scenes: ScenePortValue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const port = parseScenePort(raw[i]);
    if (!port) return { error: `scenes[${i}] is not a valid ScenePortValue` };
    scenes.push(port);
  }

  let master = scenes[0]!.tree;
  let mergedCount = 0;
  const ctx: MergeCtx = { nextVersion: master.version + 1 };

  dbg(`== invoke == scenes.length=${scenes.length}`);

  for (const scene of scenes) {
    const focusNode: SceneNodeSnapshot | null = readNode(scene.tree, scene.focus);
    if (focusNode === null) {
      dbg(`  focus "${scene.focus}" missing in its own tree → skip`);
      continue;
    }

    // focus 节点壳落位（仅首次）：保留 focus 自身属性但不带 children；
    // focus="/" 时根恒存在，跳过落壳。
    if (scene.focus !== '/' && readNode(master, scene.focus) === null) {
      const focusShell: SceneNodeSnapshot = { ...focusNode, children: [] };
      master = upsertSubtree(master, scene.focus, focusShell, ctx.nextVersion++);
      dbg(`  focus shell placed at "${scene.focus}"`);
    }

    // 把 focus 子树递归深合并进 master（含 focus="/" 的根级合并）。
    master = deepMergeChildren(master, scene.focus, focusNode, ctx);
    mergedCount++;
  }

  dbg(`== result == mergedCount=${mergedCount}`);
  return { scene: { tree: master, focus: '/' }, mergedCount };
}
