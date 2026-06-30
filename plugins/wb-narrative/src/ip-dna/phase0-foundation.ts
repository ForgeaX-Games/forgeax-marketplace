/**
 * Phase 0 · 输入地基（仅后端）—— 蓝图 §6.1 / §6.2。
 *
 * 职责：
 *   ① 接收多模态 / 压缩包 / 不限量上传的文件描述，按完整故事时间戳归档到 input/.../_original/；
 *   ② 生成结构化《用户资产参考清单》(UserAssetManifest)，作为后续 Phase 处理的驱动数据。
 *
 * HTTP 层的 multipart 解析 / 解压由 api/server.ts 负责（已存在 mammoth 等）；
 * 本模块只接 "已落地的文件描述 + 字节" 这一确定性边界，便于单测与复用。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  UserAssetManifest,
  IpMediaType,
  IpSide,
  StoryTimestamp,
} from "../types/narrative-ip-dna.js";
import { originalDir, modalOriginalDir, safeName, loadManifest, saveManifest, type InputModality } from "./filesystem.js";
import { formatTimestamp } from "./io-flow.js";

/** 入站文件描述（来自 HTTP 层解析后的中性表示）。 */
export interface IncomingFile {
  /** 原始文件名。 */
  fileName: string;
  /** 文件字节（或 utf-8 文本）。 */
  data: Buffer | string;
  /** MIME / 扩展名推断的类型。 */
  fileType: string;
  /** 角色标注（正文/设定/参考图/分镜…），可选。 */
  role?: string;
}

/** 扩展名 → 模态映射（粗判，Phase1 细化）。 */
export function modalityOf(fileType: string, fileName: string): "text" | "image" | "video" {
  const ft = (fileType || "").toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  if (ft.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if (ft.startsWith("video/") || [".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video";
  return "text";
}

/** 由模态集合判定媒体类型（§3.1：混合模态归为 mixed）。 */
export function mediaTypeFromModalities(mods: Set<string>): IpMediaType {
  if (mods.size > 1) return "mixed";
  if (mods.has("image")) return "picture";
  if (mods.has("video")) return "video";
  return "book";
}

/** 由文件集合粗判媒体类型（§3.1：混合模态归为 mixed）。 */
export function inferMediaType(files: IncomingFile[]): IpMediaType {
  return mediaTypeFromModalities(new Set(files.map((f) => modalityOf(f.fileType, f.fileName))));
}

export interface Phase0Input {
  files: IncomingFile[];
  /** 已确定的完整故事时间戳；缺省则由当前时间生成（§6.0）。 */
  story_timestamp?: StoryTimestamp;
  /** 标题（来自策划 D0 或用户输入；缺省由首文件名兜底，§6.5）。 */
  title?: string;
  side?: IpSide;
  /** 进程根（测试用）。 */
  cwd?: string;
}

export interface Phase0Result {
  story_timestamp: StoryTimestamp;
  title: string;
  manifest: UserAssetManifest;
  /** 归档目录绝对路径。 */
  originalDir: string;
}

/**
 * 归档文件并生成资产清单（§2/§6.1/§6.2）。纯确定性：相同输入产出相同结构。
 *
 * 模态分目录（§2）：每个文件按 modalityOf 归入 _original/<book|picture|video>/。
 * 会话级幂等追加（§2）：当 story_timestamp 指向已有运行（已落盘 manifest）时，本次文件**追加**到
 * 同一运行——按 path 去重合并 source_files、并集模态、按全集重算 media_type，created_at 保持首次值。
 * 这支撑"一次会话只确认一次时间戳、后续文件复用同一 ts 幂等 append"的产品语义。
 */
export function archiveAndBuildManifest(input: Phase0Input): Phase0Result {
  const timestamp = input.story_timestamp ?? formatTimestamp(new Date().toISOString());
  const title = (input.title ?? deriveTitleFromFiles(input.files)).trim() || "untitled";
  const side: IpSide = input.side ?? "story";

  const baseDir = originalDir(timestamp, title, { cwd: input.cwd });
  fs.mkdirSync(baseDir, { recursive: true });

  // 本批：按模态分目录落盘。
  const batchSources: UserAssetManifest["source_files"] = [];
  for (const f of input.files) {
    const modality = modalityOf(f.fileType, f.fileName) as InputModality;
    const modalDir = modalOriginalDir(timestamp, title, modality, { cwd: input.cwd });
    fs.mkdirSync(modalDir, { recursive: true });
    const safe = safeName(f.fileName);
    fs.writeFileSync(path.join(modalDir, safe), typeof f.data === "string" ? f.data : f.data);
    const size = typeof f.data === "string" ? Buffer.byteLength(f.data, "utf-8") : f.data.length;
    batchSources.push({
      path: path.join("_original", { text: "book", image: "picture", video: "video" }[modality], safe),
      file_type: f.fileType,
      size,
      role: f.role,
    });
  }

  // 会话级幂等追加：与已有 manifest 合并（按 path 去重）。
  const prev = input.story_timestamp ? loadManifest(timestamp, title, { cwd: input.cwd }) : undefined;
  const byPath = new Map<string, UserAssetManifest["source_files"][number]>();
  for (const s of prev?.source_files ?? []) byPath.set(s.path, s);
  for (const s of batchSources) byPath.set(s.path, s);
  const source_files = [...byPath.values()];

  // 模态/媒体类型按全集（历史 + 本批）重算。
  const modalitySet = new Set<string>([
    ...(prev?.modality ?? []),
    ...input.files.map((f) => modalityOf(f.fileType, f.fileName)),
  ]);
  const media_type = mediaTypeFromModalities(modalitySet);

  const isMultipart = source_files.length > 1;
  const totalText = source_files
    .filter((s) => s.path.includes(`${path.sep}book${path.sep}`) || s.path.includes("/book/"))
    .reduce((acc, s) => acc + (s.size ?? 0), 0);

  const manifest: UserAssetManifest = {
    story_id: timestamp,
    title,
    media_type,
    modality: [...modalitySet] as UserAssetManifest["modality"],
    side: prev?.side ?? side,
    source_files,
    preliminary_structure: {
      guessed_levels: prev?.preliminary_structure?.guessed_levels ?? [],
      is_multipart: isMultipart,
      is_short: totalText > 0 && totalText < SHORT_TEXT_THRESHOLD,
    },
    processing_status: "archived",
    created_at: prev?.created_at ?? new Date().toISOString(),
  };

  // 立即落盘，使同会话后续 append 能读到累积清单（幂等合并的依据）。
  try { saveManifest(manifest, { cwd: input.cwd }); } catch { /* 落盘失败不阻断主链 */ }

  return { story_timestamp: timestamp, title, manifest, originalDir: baseDir };
}

/** 短文阈值（字符数）；< 此值视为短篇（无需拆解，§7.1 体量判断）。 */
export const SHORT_TEXT_THRESHOLD = 25_000;

function deriveTitleFromFiles(files: IncomingFile[]): string {
  const first = files[0]?.fileName ?? "untitled";
  return path.basename(first, path.extname(first));
}
