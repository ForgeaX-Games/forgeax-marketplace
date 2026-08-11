/**
 * 自定义专属团队——用户投喂作者作品后蒸馏出来的私有助手。
 *
 * 两种形态，差别在投喂的粒度与产出的角色：
 *  - 单本蒸馏（book_template）：喂一本书，得到《书名》创作模板创作助手，
 *    照这本书的骨架与笔法写；
 *  - 全维度蒸馏（author_advisor）：喂同一作者的多份材料，得到创作顾问，
 *    抽的是作者跨作品的稳定风格，而非某一本的结构。
 *
 * 蒸馏本身在后端，眼下后端没有这条链路，所以这里只记录「用户想要什么、喂了哪些材料」，
 * 状态停在 draft。等后端补上蒸馏接口，把 distill() 接上即可，记录结构不用变。
 */
import { createLocalCollection, newId, nowIso, type Collection } from "./localCollection";

export type CustomTeamKind = "book_template" | "author_advisor";

/** draft = 材料已备、尚未蒸馏；ready = 后端已产出可调用的助手。 */
export type CustomTeamStatus = "draft" | "ready";

export interface CustomTeam {
  id: string;
  kind: CustomTeamKind;
  /** 单本蒸馏填书名，全维度蒸馏填作者名。 */
  source: string;
  /** 投喂的材料文件名，仅作清单展示——文件本体由后端蒸馏时再收。 */
  materials: string[];
  status: CustomTeamStatus;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "forgeax.narrative.custom-teams.v1";

const store: Collection<CustomTeam> = createLocalCollection<CustomTeam>(STORAGE_KEY);

export const listCustomTeams = (): Promise<CustomTeam[]> => store.list();
export const subscribeCustomTeams = (listener: (items: CustomTeam[]) => void): (() => void) =>
  store.subscribe(listener);
export const deleteCustomTeam = (id: string): Promise<void> => store.remove(id);

export async function createCustomTeam(
  kind: CustomTeamKind,
  source: string,
  materials: readonly string[] = [],
): Promise<CustomTeam> {
  const ts = nowIso();
  return store.put({
    id: newId("team"),
    kind,
    source: source.trim(),
    materials: [...materials],
    status: "draft",
    createdAt: ts,
    updatedAt: ts,
  });
}

export async function addMaterials(id: string, names: readonly string[]): Promise<CustomTeam | null> {
  const team = await store.get(id);
  if (!team) return null;
  const merged = [...new Set([...team.materials, ...names])];
  return store.put({ ...team, materials: merged, updatedAt: nowIso() });
}

/** 团队在界面上的显示名：形态决定叫法，用户不用自己起名。 */
export function customTeamLabel(
  team: CustomTeam,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return team.kind === "book_template"
    ? t("team.label.bookTemplate", { name: team.source })
    : t("team.label.authorAdvisor", { name: team.source });
}
