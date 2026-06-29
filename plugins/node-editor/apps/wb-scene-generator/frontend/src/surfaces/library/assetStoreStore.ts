import { create } from 'zustand'
import { libraryApi, type AssetRecord, type FacetItem, type FacetScheme, type FieldFilter } from './libraryApi.js'
import { rulesApi, writeSelectedRule, type RuleListItem } from './rulesApi.js'

export type AssetViewMode = 'grid' | 'list'

// One step of the folder breadcrumb (the field value the user drilled into).
export interface FolderCrumb {
  value: string
  label: string
}

// `place` is the only two-level taxonomy (室内/室外 → 房间); everything else is
// flat folders. A "leaf" path (assets shown instead of folders) is reached at
// depth 2 for place, depth 1 for the rest.
function leafDepth(taxonomy: FacetScheme): number {
  return taxonomy === 'place' ? 2 : 1
}

function isLeaf(taxonomy: FacetScheme | null, path: FolderCrumb[]): boolean {
  return taxonomy != null && path.length >= leafDepth(taxonomy)
}

// Pseudo-zone sentinel for the dropdown's "Rules" entry. Distinct from any real
// DB zone name; selecting it switches the grid to tilemap-rule cards instead of
// image-blob cards.
export const RULES_ZONE = '__rules__'

const LS_ZONE = 'wb-scene-generator.assetstore.zone'
const LS_VIEW = 'wb-scene-generator.assetstore.view'
const LS_TAXONOMY = 'wb-scene-generator.assetstore.taxonomy'
// Per-request cap of the read-only /library/list route (backend clamps to 500);
// fetchAssets loops over batches so the grid holds the WHOLE zone at once.
const FETCH_BATCH = 500
// Viewport page size before the grid has been measured (one screenful of cards).
const DEFAULT_PAGE_SIZE = 60

function readLs(key: string, fallback: string): string {
  if (typeof localStorage === 'undefined') return fallback
  return localStorage.getItem(key) ?? fallback
}

function writeLs(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
}

interface AssetStoreState {
  zones: string[]
  activeZone: string
  search: string
  // 13-field name filters (CategoryNav), pushed in from the left pane control bus.
  fieldFilters: FieldFilter[]
  // Multi-select batch mode + the set of selected asset ids (clicking toggles).
  batchMode: boolean
  selectedIds: Set<string>
  viewMode: AssetViewMode
  // Folder taxonomy: null = flat continuous scroll (legacy). When set, the zone
  // is browsed as folders (`folders`) until the breadcrumb (`folderPath`) reaches
  // a leaf, where the filtered asset list shows.
  taxonomy: FacetScheme | null
  folderPath: FolderCrumb[]
  folders: FacetItem[]
  loadingFolders: boolean
  // The full asset list for the active zone — the grid is one continuous scroll
  // area over all of these (legacy AssetStore model, no per-page batching).
  assets: AssetRecord[]
  total: number
  // Viewport-derived: how many cards fill one screenful. Pure view state, used
  // only to map scroll position ⇄ page indicator (never sent to the API).
  pageSize: number
  // Current "page" as derived from scroll position (or a pager click).
  page: number
  // When set, the surface smooth-scrolls to that page's first card, then clears.
  pendingScrollToPage: number | null
  loading: boolean
  selected: AssetRecord | null
  // Rules pseudo-zone state: the tilemap-rule cards + the currently-selected rule
  // (also mirrored to the cross-pane localStorage bus for the left-pane detail).
  rules: RuleListItem[]
  selectedRule: RuleListItem | null

  init: () => Promise<void>
  setZone: (zone: string) => void
  setSearch: (q: string) => void
  setFieldFilters: (f: FieldFilter[]) => void
  setBatchMode: (on: boolean) => void
  toggleSelectId: (id: string) => void
  clearSelection: () => void
  selectAllOnPage: () => void
  setViewMode: (m: AssetViewMode) => void
  setTaxonomy: (t: FacetScheme | null) => void
  openFolder: (item: FacetItem) => void
  goToCrumb: (level: number) => void
  loadView: () => Promise<void>
  fetchFolders: () => Promise<void>
  setPageSize: (n: number) => void
  setPageFromScroll: (p: number) => void
  goToPage: (p: number) => void
  clearPendingScroll: () => void
  setSelected: (a: AssetRecord | null) => void
  setSelectedRule: (r: RuleListItem | null) => void
  revealAlias: (alias: string) => void
  fetchAssets: () => Promise<void>
}

function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

const TAXONOMIES: FacetScheme[] = ['type', 'place', 'style', 'size', 'scene']

function readTaxonomyLs(): FacetScheme | null {
  const v = readLs(LS_TAXONOMY, '')
  return (TAXONOMIES as string[]).includes(v) ? (v as FacetScheme) : null
}

// Translate the current breadcrumb into the list-route's facet filter args.
// place uses (parent = level-1 value, value = level-2 value); others just value.
function facetArgs(
  taxonomy: FacetScheme | null,
  folderPath: FolderCrumb[],
): { by?: FacetScheme; value?: string; parent?: string } {
  if (!taxonomy || !isLeaf(taxonomy, folderPath)) return {}
  if (taxonomy === 'place') {
    return { by: 'place', parent: folderPath[0].value, value: folderPath[1].value }
  }
  return { by: taxonomy, value: folderPath[0].value }
}

export const useAssetStoreStore = create<AssetStoreState>((set, get) => ({
  zones: [],
  activeZone: readLs(LS_ZONE, 'raw'),
  search: '',
  fieldFilters: [],
  batchMode: false,
  selectedIds: new Set<string>(),
  viewMode: (readLs(LS_VIEW, 'grid') as AssetViewMode) === 'list' ? 'list' : 'grid',
  assets: [],
  total: 0,
  pageSize: DEFAULT_PAGE_SIZE,
  page: 1,
  pendingScrollToPage: null,
  loading: false,
  selected: null,
  rules: [],
  selectedRule: null,
  taxonomy: readTaxonomyLs(),
  folderPath: [],
  folders: [],
  loadingFolders: false,

  init: async () => {
    try {
      const zones = await libraryApi.zones()
      // Append the synthetic Rules pseudo-zone so it shows in the dropdown.
      const withRules = [...zones, RULES_ZONE]
      const active = withRules.includes(get().activeZone) ? get().activeZone : zones[0] ?? 'raw'
      set({ zones: withRules, activeZone: active })
    } catch {
      set({ zones: ['raw', RULES_ZONE] })
    }
    await get().loadView()
  },

  // Route to the right loader for the current zone/taxonomy/breadcrumb: rule
  // summaries (Rules zone), folder cards (taxonomy mid-level), or the filtered
  // asset list (flat, or a taxonomy leaf).
  loadView: async () => {
    const { activeZone, taxonomy, folderPath } = get()
    if (activeZone !== RULES_ZONE && taxonomy && !isLeaf(taxonomy, folderPath)) {
      await get().fetchFolders()
    } else {
      await get().fetchAssets()
    }
  },

  setZone: (zone) => {
    writeLs(LS_ZONE, zone)
    // New zone ⇒ reset to the top, drop any open folder. Leaving the Rules zone
    // clears the selected rule (and its cross-pane bus entry) — it only has
    // meaning while browsing rules.
    if (zone !== RULES_ZONE && get().selectedRule) {
      set({ selectedRule: null })
      writeSelectedRule(null)
    }
    set({ activeZone: zone, page: 1, pendingScrollToPage: 1, selected: null, folderPath: [], folders: [] })
    void get().loadView()
  },

  setSearch: (q) => {
    set({ search: q, page: 1, pendingScrollToPage: 1 })
    void get().loadView()
  },

  setFieldFilters: (f) => {
    set({ fieldFilters: f, page: 1, pendingScrollToPage: 1, selectedIds: new Set() })
    void get().loadView()
  },

  setBatchMode: (on) => {
    set(on ? { batchMode: true } : { batchMode: false, selectedIds: new Set() })
  },

  toggleSelectId: (id) => {
    const next = new Set(get().selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ selectedIds: next })
  },

  clearSelection: () => set({ selectedIds: new Set() }),

  selectAllOnPage: () => {
    const next = new Set(get().selectedIds)
    for (const a of get().assets) if (a.private) next.add(a.id)
    set({ selectedIds: next })
  },

  setViewMode: (m) => {
    writeLs(LS_VIEW, m)
    set({ viewMode: m })
  },

  // Switch the folder scheme (or back to flat). Always resets to the top level.
  setTaxonomy: (t) => {
    writeLs(LS_TAXONOMY, t ?? '')
    set({ taxonomy: t, folderPath: [], folders: [], selected: null, page: 1, pendingScrollToPage: 1 })
    void get().loadView()
  },

  // Drill into a folder card: push the crumb, then show its sub-folders (place
  // level 1 → rooms) or, at a leaf, its filtered assets.
  openFolder: (item) => {
    const { taxonomy, folderPath } = get()
    if (!taxonomy) return
    const next = [...folderPath, { value: item.value, label: item.label }]
    set({ folderPath: next, selected: null, page: 1, pendingScrollToPage: 1 })
    void get().loadView()
  },

  // Breadcrumb jump: keep `level` crumbs (0 = taxonomy root folder grid).
  goToCrumb: (level) => {
    const next = get().folderPath.slice(0, Math.max(0, level))
    set({ folderPath: next, selected: null, page: 1, pendingScrollToPage: 1 })
    void get().loadView()
  },

  fetchFolders: async () => {
    const { activeZone, taxonomy, folderPath } = get()
    if (!taxonomy) return
    set({ loadingFolders: true })
    try {
      // place level-1 drills into rooms scoped to the chosen 室内/室外 value.
      const parent = taxonomy === 'place' && folderPath.length === 1 ? folderPath[0].value : undefined
      const folders = await libraryApi.facets(activeZone, taxonomy, parent)
      set({ folders, total: folders.length })
    } catch {
      set({ folders: [], total: 0 })
    } finally {
      set({ loadingFolders: false })
    }
  },

  // Layout measurement reports how many cards fit one screen; keep `page` valid.
  setPageSize: (n) => {
    const pageSize = Math.max(1, Math.floor(n))
    const totalPages = totalPagesOf(get().total, pageSize)
    set({ pageSize, page: Math.min(get().page, totalPages) })
  },

  // Scroll handler reports the viewport page — view state only, never re-fetches.
  setPageFromScroll: (p) => {
    const totalPages = totalPagesOf(get().total, get().pageSize)
    const page = Math.max(1, Math.min(p, totalPages))
    if (page !== get().page) set({ page })
  },

  // Pager click: jump the indicator and ask the surface to scroll there.
  goToPage: (p) => {
    const totalPages = totalPagesOf(get().total, get().pageSize)
    const page = Math.max(1, Math.min(p, totalPages))
    set({ page, pendingScrollToPage: page })
  },

  clearPendingScroll: () => set({ pendingScrollToPage: null }),

  setSelected: (a) => set({ selected: a }),

  // Select an asset by alias in the already-loaded list and scroll the
  // continuous grid to the page that holds it. Used by the left-pane search
  // candidate dropdown (reveal command). No-op if the alias isn't in `assets`
  // (e.g. wrong zone / filtered out) — the dropdown only offers current-zone
  // candidates, so a miss just leaves the grid untouched.
  revealAlias: (alias) => {
    const { assets, pageSize } = get()
    const index = assets.findIndex((a) => a.alias === alias)
    if (index < 0) return
    const page = Math.floor(index / Math.max(1, pageSize)) + 1
    set({ selected: assets[index], page, pendingScrollToPage: page })
  },

  // Select a rule card and publish it to the cross-pane bus so the left pane can
  // render its detail. Toggle off on re-click of the already-selected rule.
  setSelectedRule: (r) => {
    const next = r && get().selectedRule?.alias === r.alias ? null : r
    set({ selectedRule: next })
    writeSelectedRule(next)
  },

  // Load the ENTIRE zone (looping the page-based route) into one list so the
  // grid can scroll continuously through everything. The Rules pseudo-zone loads
  // the vendored rule summaries instead of image blobs.
  fetchAssets: async () => {
    const { activeZone, search, taxonomy, folderPath, fieldFilters } = get()
    if (activeZone === RULES_ZONE) {
      set({ loading: true })
      try {
        const rules = await rulesApi.list()
        set({ rules, total: rules.length })
      } catch {
        set({ rules: [], total: 0 })
      } finally {
        set({ loading: false })
      }
      return
    }
    set({ loading: true })
    try {
      const facet = facetArgs(taxonomy, folderPath)
      const all: AssetRecord[] = []
      let total = 0
      let pageNum = 1
      for (;;) {
        const res = await libraryApi.list({
          zone: activeZone,
          search: search || undefined,
          page: pageNum,
          pageSize: FETCH_BATCH,
          ...(fieldFilters.length ? { fieldFilters } : {}),
          ...facet,
        })
        all.push(...res.items)
        total = res.total
        if (res.items.length === 0 || all.length >= total) break
        pageNum += 1
        if (pageNum > 1000) break // safety valve against a misbehaving backend
      }
      set({ assets: all, total })
    } catch {
      set({ assets: [], total: 0 })
    } finally {
      set({ loading: false })
    }
  },
}))
