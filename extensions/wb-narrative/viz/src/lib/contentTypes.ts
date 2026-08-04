/**
 * 落盘文件 → 内容类别的映射。
 *
 * 类别就是「叙事单品助手」花名册：二十席各占一类，两库固定有这么多条子条目，
 * 一条也不因为这一跑没产就消失 —— 库里的类别表与顶栏「叙事工具 → 叙事单品助手」
 * 是同一张表，用户据此知道还有哪些东西没生成。
 *
 * 整张表由后端席位注册表投影而来（seats.generated.ts），文件名前缀是后端
 * 从 STEP_FILE_MAP 按席位拥有的 step 算出来的。上一版这里手抄前缀，结果
 * 07 故事大纲被归到大纲席（它其实是结构席的第一步），派生一次就不会再错。
 *
 * 归不到任何席位的（路由与校验中间件、老管线产物）不硬塞类别，
 * 直接挂在资源库 / 资产库下 —— 对它们而言层级从三级退成两级。
 */
import { ASSISTANT_SEATS } from "../composer/seats.generated";

export type ContentTypeId = string;

export interface ContentTypeDef {
  id: ContentTypeId;
  /** i18n 键。 */
  labelKey: string;
  /**
   * 归属的叙事单品助手（composerCatalog 的 engineer item id）。
   * 有归属的类别，标题旁的 @ 送的就是这位助手；用户上传那一类没有归属，故无 @。
   */
  assistantId?: string;
  /** 该类成员的文件名前缀（不含分组段）。 */
  prefixes: readonly string[];
  /** 该类成员的分组段（`<group>/…` 的 group）。 */
  groups?: readonly string[];
}

/** 用户上传的原料不属于任何助手，作为第一类单列。 */
const UPLOAD_TYPE: ContentTypeDef = {
  id: "upload",
  labelKey: "lib.type.upload",
  prefixes: ["standardized"],
  groups: ["original", "package"],
};

/** 顺序即席位花名册顺序，用户上传排在最前。 */
export const CONTENT_TYPES: readonly ContentTypeDef[] = [
  UPLOAD_TYPE,
  ...ASSISTANT_SEATS.filter((s) => s.contentType).map((s) => ({
    id: s.contentType!,
    labelKey: `lib.type.${s.contentType}`,
    assistantId: `engineer.${s.id}`,
    prefixes: s.filePrefixes,
  })),
];

/** 归不到任何助手时返回 null —— 调用方据此把文件直挂库下。 */
export function classifyContent(groupedPath: string): ContentTypeId | null {
  const slash = groupedPath.indexOf("/");
  const group = slash >= 0 ? groupedPath.slice(0, slash) : "";
  const rel = slash >= 0 ? groupedPath.slice(slash + 1) : groupedPath;
  // 只看最后一段的前缀，中间目录（分批子目录等）不参与判定。
  const base = rel.split("/").pop() ?? rel;

  for (const def of CONTENT_TYPES) {
    if (def.groups?.includes(group)) return def.id;
    if (def.prefixes.some((p) => base.startsWith(p))) return def.id;
  }
  return null;
}

/**
 * 运行簿记文件：断点、清单、条目配置、全量结果转储。
 * 它们是"这一跑怎么跑的"而非内容产物，混进两库只会稀释信噪比，故分桶前先滤掉。
 */
const INTERNAL_BASENAMES = new Set([
  "manifest.json",
  "_checkpoint.json",
  "_run_manifest.json",
  "_entry.json",
  "full_result.json",
]);

export function isInternalFile(groupedPath: string): boolean {
  const base = groupedPath.split("/").pop() ?? groupedPath;
  return INTERNAL_BASENAMES.has(base);
}

export interface LibraryFile {
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  /** 展示名（去掉目录段）。 */
  name: string;
  group: string;
  /** 归属类别；null = 无类别，直挂库下。 */
  type: ContentTypeId | null;
}

export interface ContentBucket {
  def: ContentTypeDef;
  files: LibraryFile[];
}

export interface LibraryContents {
  /** 固定的全套类别条目，没有产物的也在，files 为空。 */
  buckets: ContentBucket[];
  /** 归不到类别的文件，直挂库下。 */
  loose: LibraryFile[];
}

function toLibraryFile(p: string): LibraryFile {
  const slash = p.indexOf("/");
  const group = slash >= 0 ? p.slice(0, slash) : "";
  const rel = slash >= 0 ? p.slice(slash + 1) : p;
  return { path: p, name: rel.split("/").pop() ?? rel, group, type: classifyContent(p) };
}

/** 把扁平文件清单铺进固定类别表；类别恒在，无归属的进 loose。 */
export function buildLibraryContents(paths: readonly string[]): LibraryContents {
  const byType = new Map<ContentTypeId, LibraryFile[]>();
  const loose: LibraryFile[] = [];

  for (const p of paths) {
    if (isInternalFile(p)) continue;
    const file = toLibraryFile(p);
    if (file.type === null) {
      loose.push(file);
      continue;
    }
    const arr = byType.get(file.type);
    if (arr) arr.push(file);
    else byType.set(file.type, [file]);
  }

  return {
    buckets: CONTENT_TYPES.map((def) => ({ def, files: byType.get(def.id) ?? [] })),
    loose,
  };
}
