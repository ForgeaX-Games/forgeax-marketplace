/**
 * run-layout.ts — 多管线产物目录布局（Phase-2 M8）
 *
 * 一条目 = 一组管线。布局取「主管线占位 + 次管线分子目录」：
 *
 *   output/<key>/                          主管线产物 + _entry.json（条目级）
 *   output/<key>/pipelines/<pipelineId>/    其余管线各自产物（独立 manifest / checkpoint）
 *
 * 为什么不把全部管线一律下沉到 pipelines/：`output/<key>/` 会变空，历史列表、
 * 条目载入、fork 复制、stripIncompleteFields 等读侧共 40 余处引用都要跟着改。
 * 主管线占位把改动收在写侧，读侧零改动。
 */

export const PIPELINE_SUBDIR = "pipelines";

const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function isSafeSegment(seg: string): boolean {
  return SEGMENT_RE.test(seg) && seg !== "." && seg !== "..";
}

/** run 目录相对 OUTPUT_DIR 的路径（= 前端拿到的 sourceDir）。 */
export function runDirName(entryKey: string, pipelineId?: string): string {
  return pipelineId ? `${entryKey}/${PIPELINE_SUBDIR}/${pipelineId}` : entryKey;
}

/**
 * 校验 sourceDir：只接受 `<key>` 或 `<key>/pipelines/<pipelineId>` 两种形态，
 * 逐段白名单校验（防目录穿越）。
 */
export function isSafeRunDir(dir: unknown): dir is string {
  if (typeof dir !== "string" || dir.length === 0) return false;
  const segs = dir.split("/");
  if (segs.length === 1) return isSafeSegment(segs[0]!);
  if (segs.length !== 3) return false;
  return (
    isSafeSegment(segs[0]!) && segs[1] === PIPELINE_SUBDIR && isSafeSegment(segs[2]!)
  );
}

/** 解析 sourceDir 回 (entryKey, pipelineId)；非法形态返回 null。 */
export function parseRunDirName(
  dir: string,
): { entryKey: string; pipelineId?: string } | null {
  if (!isSafeRunDir(dir)) return null;
  const segs = dir.split("/");
  if (segs.length === 1) return { entryKey: segs[0]! };
  return { entryKey: segs[0]!, pipelineId: segs[2]! };
}

/** 条目级 key（`_entry.json` 所在目录名）；次管线目录回溯到其条目。 */
export function entryKeyOfRunDir(dir: string): string | null {
  return parseRunDirName(dir)?.entryKey ?? null;
}
