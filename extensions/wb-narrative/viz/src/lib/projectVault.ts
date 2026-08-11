/**
 * 项目库——用户自建的资产库。
 *
 * 与「任务」正交：任务是一次对话开启的生成，产物按内容类别自动归类，用户不能改；
 * 项目是用户自己攒的柜子，类别由用户新建，条目由用户从**任意任务**的资源里挑进来。
 * 一个项目的资产可以横跨多个任务——这正是资源库与资产库解耦的意思。
 *
 * 存储走 localCollection 这层端口，眼下落浏览器本地。后端补上 projects 接口后
 * 只换端口实现，本文件的函数签名不变。
 */
import { createLocalCollection, newId, nowIso, type Collection } from "./localCollection";

export interface ProjectAsset {
  id: string;
  /** 来源任务的条目键。跨任务收集时全靠它回溯出处。 */
  taskKey: string;
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  name: string;
  /** 来源任务里的内容类别，仅作展示线索；项目内的归类以 categoryId 为准。 */
  contentType: string | null;
  /** 用户自建类别；null = 未归类，直挂项目下。 */
  categoryId: string | null;
  addedAt: string;
}

/**
 * 项目里的中间层。
 *
 * 全是用户自己开的——新建时会拿单品助手花名册当选项递给用户，但选中之后落下来的
 * 也只是一个普普通通的自建类别（照样能改名、能删）。不预置、不铺满：项目是用户的柜子，
 * 柜子里有几个格子该由攒东西的人说，系统替他摆满二十个空格只是把噪声塞进他的空间。
 */
export interface ProjectCategory {
  id: string;
  name: string;
}

export interface NarrativeProject {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  categories: ProjectCategory[];
  assets: ProjectAsset[];
}

const STORAGE_KEY = "forgeax.narrative.projects.v1";

const store: Collection<NarrativeProject> = createLocalCollection<NarrativeProject>(STORAGE_KEY);

export const listProjects = (): Promise<NarrativeProject[]> => store.list();
export const getProject = (id: string): Promise<NarrativeProject | null> => store.get(id);
export const subscribeProjects = (listener: (items: NarrativeProject[]) => void): (() => void) =>
  store.subscribe(listener);

export async function createProject(title: string, tags: readonly string[] = []): Promise<NarrativeProject> {
  const ts = nowIso();
  const project: NarrativeProject = {
    id: newId("prj"),
    title: title.trim(),
    tags: [...tags],
    createdAt: ts,
    updatedAt: ts,
    categories: [],
    assets: [],
  };
  return store.put(project);
}

export const deleteProject = (id: string): Promise<void> => store.remove(id);

/** 所有写操作的公共出口：取出、改、盖回，顺带刷新 updatedAt。 */
async function mutate(
  projectId: string,
  fn: (project: NarrativeProject) => NarrativeProject,
): Promise<NarrativeProject | null> {
  const current = await store.get(projectId);
  if (!current) return null;
  return store.put({ ...fn(current), updatedAt: nowIso() });
}

export function updateProject(
  id: string,
  patch: { title?: string; tags?: readonly string[] },
): Promise<NarrativeProject | null> {
  return mutate(id, (p) => ({
    ...p,
    title: patch.title?.trim() ?? p.title,
    tags: patch.tags ? [...patch.tags] : p.tags,
  }));
}

export function addCategory(projectId: string, name: string): Promise<NarrativeProject | null> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve(null);
  return mutate(projectId, (p) =>
    p.categories.some((c) => c.name === trimmed)
      ? p
      : { ...p, categories: [...p.categories, { id: newId("cat"), name: trimmed }] },
  );
}

export function renameCategory(
  projectId: string,
  categoryId: string,
  name: string,
): Promise<NarrativeProject | null> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve(null);
  return mutate(projectId, (p) => ({
    ...p,
    categories: p.categories.map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c)),
  }));
}

/** 删类别不删资产：里面的东西退回「未归类」，避免用户一次误删丢掉收集成果。 */
export function deleteCategory(projectId: string, categoryId: string): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({
    ...p,
    categories: p.categories.filter((c) => c.id !== categoryId),
    assets: p.assets.map((a) => (a.categoryId === categoryId ? { ...a, categoryId: null } : a)),
  }));
}

export interface AssetRef {
  taskKey: string;
  path: string;
  name: string;
  contentType?: string | null;
}

/** 同一任务的同一份文件在一个项目里只留一条；重复收集只改归类。 */
export function collectAsset(
  projectId: string,
  ref: AssetRef,
  categoryId: string | null = null,
): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => {
    const at = p.assets.findIndex((a) => a.taskKey === ref.taskKey && a.path === ref.path);
    if (at >= 0) {
      const assets = [...p.assets];
      assets[at] = { ...assets[at]!, categoryId };
      return { ...p, assets };
    }
    return {
      ...p,
      assets: [
        ...p.assets,
        {
          id: newId("ast"),
          taskKey: ref.taskKey,
          path: ref.path,
          name: ref.name,
          contentType: ref.contentType ?? null,
          categoryId,
          addedAt: nowIso(),
        },
      ],
    };
  });
}

export function removeAsset(projectId: string, assetId: string): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({ ...p, assets: p.assets.filter((a) => a.id !== assetId) }));
}

export function moveAsset(
  projectId: string,
  assetId: string,
  categoryId: string | null,
): Promise<NarrativeProject | null> {
  return mutate(projectId, (p) => ({
    ...p,
    assets: p.assets.map((a) => (a.id === assetId ? { ...a, categoryId } : a)),
  }));
}

/** 某份任务产物已被收进哪些项目——任务侧据此把已收集的文件标出来。 */
export function projectsHolding(
  projects: readonly NarrativeProject[],
  taskKey: string,
  path: string,
): NarrativeProject[] {
  return projects.filter((p) => p.assets.some((a) => a.taskKey === taskKey && a.path === path));
}
