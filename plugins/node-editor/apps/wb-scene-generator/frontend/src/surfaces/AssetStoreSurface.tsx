import { useCallback, useEffect, useRef, useState } from 'react'
import type { HttpApiClient } from '../api/HttpApiClient.js'
import { libraryApi, type AssetRecord, type FacetItem, type FacetScheme } from './library/libraryApi.js'
import { writePaintAsset, aliasItemName } from './library/paintAssetBus.js'
import { readSelectedLayer, subscribeSelectedLayer } from './library/selectedLayerBus.js'
import { useAssetStoreStore, type AssetViewMode, RULES_ZONE } from './library/assetStoreStore.js'
import { readControl, subscribeControl, subscribeRefresh, subscribeReveal, writeSelection } from './library/assetControlBus.js'
import type { RuleListItem } from './library/rulesApi.js'
import { pageItems } from './library/pagination.js'
import { useWorkbenchChild } from '../workbench/useWorkbenchChild.js'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronRightSmall,
  Folder,
  LayoutGrid,
  LayoutList,
  List,
  MapPin,
  Maximize2,
  Minimize2,
  Package,
  Palette,
  Ruler,
  Shapes,
  Tags,
} from './library/icons.js'
import './AssetStoreSurface.css'

// Folder taxonomies offered in the titlebar. `null` = flat continuous scroll
// (legacy). Labels match the alias fields the backend buckets on.
const TAXONOMY_OPTIONS: { value: FacetScheme | null; label: string; icon: JSX.Element }[] = [
  { value: null, label: 'All', icon: <LayoutList size={14} /> },
  { value: 'type', label: 'By Type', icon: <Shapes size={14} /> },
  { value: 'place', label: 'By Place', icon: <MapPin size={14} /> },
  { value: 'style', label: 'By Style', icon: <Palette size={14} /> },
  { value: 'size', label: 'By Size', icon: <Ruler size={14} /> },
  { value: 'scene', label: 'By Scene', icon: <Tags size={14} /> },
]

function taxonomyLabel(t: FacetScheme | null): string {
  return TAXONOMY_OPTIONS.find((o) => o.value === t)?.label ?? 'All'
}

function taxonomyIcon(t: FacetScheme | null): JSX.Element {
  return TAXONOMY_OPTIONS.find((o) => o.value === t)?.icon ?? <LayoutList size={14} />
}

function leafDepth(t: FacetScheme): number {
  return t === 'place' ? 2 : 1
}

// Faithful asset-library pane, aligned to the legacy AssetStore chrome:
//   titlebar = gradient "Asset Store" wordmark + zone dropdown (short, zone-tinted)
//   + icon-only view dropdown + (right) fullscreen toggle.
//
// Pagination model (legacy): the whole zone is loaded at once and the grid is a
// single CONTINUOUS scroll area over every asset. The wheel scrolls through all
// of them; the page indicator is derived from scroll position, and clicking a
// page number smooth-scrolls to that page's first card. There is no per-page
// batch swap. Wired onto the read-only /api/v1/library routes; live-refreshes on
// the runtime `asset` channel AND backend `library:changed` broadcasts (import,
// publish-external, game-sandbox watcher) so external ingestion shows up without
// a reload.

type ZoneClass = 'raw' | 'staging' | 'trash' | 'rules' | 'custom'

function zoneClass(zone: string): ZoneClass {
  if (zone === 'raw') return 'raw'
  if (zone === 'staging') return 'staging'
  if (zone === 'trash') return 'trash'
  if (zone === RULES_ZONE) return 'rules'
  return 'custom'
}

// Compact trigger label, e.g. raw→"Ra", staging→"St" (matches legacy short tag).
function zoneShortLabel(zone: string): string {
  if (zone === RULES_ZONE) return 'Ru'
  if (zone.length >= 2) return zone[0].toUpperCase() + zone[1].toLowerCase()
  return zone.toUpperCase()
}

// Full dropdown-item label: the Rules pseudo-zone and trash get friendly names.
function zoneLabel(zone: string): string {
  if (zone === RULES_ZONE) return 'Rules'
  if (zone === 'trash') return '🗑 trash'
  return zone
}

const VIEW_OPTIONS: { mode: AssetViewMode; label: string; icon: JSX.Element }[] = [
  { mode: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
  { mode: 'list', label: 'List', icon: <List size={13} /> },
]

type OpenMenu = 'zone' | 'view' | 'taxonomy' | null

// ===== Continuous-scroll helpers (operate on the scroll container) =====

// How many cards fill one screenful, measured from the live layout: columns =
// cards sharing the first row's offsetTop; visible rows = clientHeight / rowH.
function measurePageSize(container: HTMLElement, fallback: number): number {
  const cards = container.querySelectorAll<HTMLElement>('.asset-card')
  if (cards.length === 0) return fallback
  const firstTop = cards[0].offsetTop
  let columns = 0
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === firstTop) columns += 1
    else break
  }
  columns = Math.max(1, columns)
  let rowHeight = cards[0].offsetHeight
  for (let i = columns; i < cards.length; i++) {
    if (cards[i].offsetTop > firstTop) {
      rowHeight = cards[i].offsetTop - firstTop
      break
    }
  }
  rowHeight = Math.max(1, rowHeight)
  const visibleRows = Math.max(1, Math.floor(container.clientHeight / rowHeight))
  return Math.max(1, columns * visibleRows)
}

// Which viewport "page" the first visible card belongs to (1-based).
function pageFromScrollTop(container: HTMLElement, pageSize: number): number {
  if (pageSize <= 0) return 1
  const cards = container.querySelectorAll<HTMLElement>('.asset-card')
  if (cards.length === 0) return 1
  const scrollTop = container.scrollTop
  let firstVisible = 0
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop + cards[i].offsetHeight > scrollTop + 4) {
      firstVisible = i
      break
    }
    firstVisible = i
  }
  return Math.floor(firstVisible / pageSize) + 1
}

// Smooth-scroll the container so a given page's first card sits at the top.
function scrollToPage(
  container: HTMLElement,
  page: number,
  pageSize: number,
  behavior: ScrollBehavior,
): void {
  if (pageSize <= 0 || page < 1) return
  const cards = container.querySelectorAll<HTMLElement>('.asset-card')
  if (cards.length === 0) return
  const index = (page - 1) * pageSize
  const card = cards[Math.min(index, cards.length - 1)]
  if (!card) return
  container.scrollTo({ top: Math.max(0, card.offsetTop - 10), behavior })
}

export function AssetStoreSurface({ client }: { client: HttpApiClient }): JSX.Element {
  const {
    zones,
    activeZone,
    viewMode,
    assets,
    total,
    page,
    pageSize,
    pendingScrollToPage,
    loading,
    selected,
    rules,
    selectedRule,
    taxonomy,
    folderPath,
    folders,
    loadingFolders,
    batchMode,
    selectedIds,
    init,
    setZone,
    setViewMode,
    setTaxonomy,
    openFolder,
    goToCrumb,
    setPageSize,
    setPageFromScroll,
    goToPage,
    clearPendingScroll,
    setSelected,
    setSelectedRule,
    revealAlias,
    setSearch,
    setFieldFilters,
    setBatchMode,
    toggleSelectId,
    clearSelection,
    fetchAssets,
  } = useAssetStoreStore()
  const isRules = activeZone === RULES_ZONE
  // Folder view: a taxonomy is active and we haven't drilled to a leaf yet.
  const showFolders = !isRules && taxonomy != null && folderPath.length < leafDepth(taxonomy)
  const { isFocused, requestFocus, reportStatus } = useWorkbenchChild('assetstore')

  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const titlebarRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  // Held while we programmatically scroll, so the scroll handler doesn't fight
  // the pager click (it would otherwise snap the indicator back mid-animation).
  const scrollLock = useRef(false)
  const [selectedLayerAssetName, setSelectedLayerAssetName] = useState<string | null>(() => {
    const info = readSelectedLayer()
    return info?.kind === 'baked' && info.assetName ? info.assetName : null
  })

  useEffect(() => {
    void init()
  }, [init])

  // Apply the left pane's control state (search / 13-field filters / batch mode)
  // on mount, then live as it changes (cross-iframe via the localStorage bus).
  useEffect(() => {
    const apply = (c: ReturnType<typeof readControl>) => {
      setSearch(c.search)
      setFieldFilters(c.fieldFilters)
      setBatchMode(c.batchMode)
    }
    apply(readControl())
    return subscribeControl(apply)
  }, [setSearch, setFieldFilters, setBatchMode])

  // The left pane bumps the refresh bus after a write (import/repair/batch op);
  // re-list and optionally drop the batch selection.
  useEffect(() => {
    return subscribeRefresh((r) => {
      if (r.clearSelection) clearSelection()
      void fetchAssets()
    })
  }, [fetchAssets, clearSelection])

  // The left-pane search dropdown reveals a candidate: select it in the grid and
  // scroll to its page. Mirrors the click-to-select paint-asset publish so the
  // renderer's current paint asset stays in sync, but does NOT change search/
  // filters — the rest of the grid is untouched.
  useEffect(() => {
    return subscribeReveal((r) => {
      revealAlias(r.alias)
      writePaintAsset({ alias: r.alias, name: aliasItemName(r.alias) })
    })
  }, [revealAlias])

  // Mirror the grid's selection (single asset + batch set) to the left pane so
  // its preview / library-info / batch-action menus can reflect it.
  useEffect(() => {
    writeSelection({ asset: selected, selectedIds: [...selectedIds], batchMode, zone: activeZone })
  }, [selected, selectedIds, batchMode, activeZone])

  useEffect(() => {
    return subscribeSelectedLayer((info) => {
      setSelectedLayerAssetName(info?.kind === 'baked' && info.assetName ? info.assetName : null)
    })
  }, [])

  // Live refresh: re-list when the runtime asset channel reports a change.
  useEffect(() => {
    const unsub = client.subscribe('asset', () => void fetchAssets())
    return () => unsub()
  }, [client, fetchAssets])

  // Close any open titlebar menu on an outside click.
  useEffect(() => {
    if (openMenu === null) return
    const handler = (e: MouseEvent) => {
      if (titlebarRef.current && !titlebarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  // Recompute the viewport page size from the live layout.
  const recomputePageSize = useCallback(() => {
    const el = mainRef.current
    if (!el) return
    setPageSize(measurePageSize(el, pageSize))
  }, [setPageSize, pageSize])

  // Measure on layout/content changes (ResizeObserver where available, else a
  // window resize fallback), plus once after each asset batch renders.
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const raf = requestAnimationFrame(recomputePageSize)
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', recomputePageSize)
      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', recomputePageSize)
      }
    }
    const ro = new ResizeObserver(() => recomputePageSize())
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, assets.length])

  // Keep the page indicator in sync with the wheel/scroll position.
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (scrollLock.current) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const ps = useAssetStoreStore.getState().pageSize
        if (ps <= 0) return
        setPageFromScroll(pageFromScrollTop(el, ps))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [viewMode, setPageFromScroll])

  // Pager click / zone-switch: scroll the continuous list to the target page.
  useEffect(() => {
    if (pendingScrollToPage == null || loading || assets.length === 0) return
    const el = mainRef.current
    if (!el) return
    const target = pendingScrollToPage
    const id = requestAnimationFrame(() => {
      scrollLock.current = true
      scrollToPage(el, target, useAssetStoreStore.getState().pageSize, target === 1 ? 'auto' : 'smooth')
      clearPendingScroll()
      window.setTimeout(() => {
        scrollLock.current = false
      }, target === 1 ? 0 : 400)
    })
    return () => cancelAnimationFrame(id)
  }, [pendingScrollToPage, loading, assets.length, clearPendingScroll])

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  useEffect(() => {
    reportStatus({ activeLibrary: activeZone, total, loading })
  }, [activeZone, total, loading, reportStatus])

  const copyAlias = (alias: string) => {
    void navigator.clipboard?.writeText(alias)
    setSelected(assets.find((a) => a.alias === alias) ?? null)
  }

  // Selecting an asset also publishes it on the cross-pane bus as the renderer's
  // current "paint asset" (edit mode binds painted baked layers to it). We don't
  // tag a type here — the AssetStore has no rule metadata; the renderer decides
  // tile-vs-object from the alias's `tileType` in aliasMetas at paint time.
  const selectAsset = (a: AssetRecord) => {
    setSelected(a)
    // name = item-name field so the renderer's matchAssetEntry (fuzzy=false)
    // resolves it; alias = the exact tile for the ghost preview image.
    writePaintAsset({ alias: a.alias, name: aliasItemName(a.alias) })
  }

  // In batch mode a click toggles selection (private assets only — the base
  // library is read-only and cannot be batch-operated); otherwise it selects.
  const handleCardClick = (a: AssetRecord) => {
    if (batchMode) {
      if (a.private) toggleSelectId(a.id)
      return
    }
    selectAsset(a)
  }

  const currentView = VIEW_OPTIONS.find((v) => v.mode === viewMode) ?? VIEW_OPTIONS[0]

  return (
    <div className="assetstore-surface">
      <div className="assetstore-titlebar" ref={titlebarRef}>
        <div className="assetstore-logo">
          <span className="assetstore-title">Asset Store</span>
        </div>

        {/* Zone selector: compact, zone-tinted dropdown (legacy render-mode style). */}
        <div className="assetstore-dd">
          <button
            type="button"
            className={`assetstore-zone-trigger assetstore-zone-trigger--${zoneClass(activeZone)}${openMenu === 'zone' ? ' is-open' : ''}`}
            title={`Zone: ${activeZone}`}
            aria-haspopup="listbox"
            aria-expanded={openMenu === 'zone'}
            onClick={() => setOpenMenu((m) => (m === 'zone' ? null : 'zone'))}
          >
            <span className="assetstore-zone-label">{zoneShortLabel(activeZone)}</span>
            <ChevronDown size={13} />
          </button>
          {openMenu === 'zone' && (
            <div className="assetstore-dd-menu" role="listbox">
              <div className="assetstore-dd-header">Library</div>
              {(zones.length ? zones : [activeZone]).map((z) => (
                <button
                  key={z}
                  type="button"
                  role="option"
                  aria-selected={activeZone === z}
                  className={`assetstore-dd-item assetstore-dd-item--${zoneClass(z)}${activeZone === z ? ' is-active' : ''}`}
                  onClick={() => {
                    setZone(z)
                    setOpenMenu(null)
                  }}
                >
                  {zoneLabel(z)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Taxonomy selector: how the zone is foldered (or flat). Hidden in the
            Rules pseudo-zone, which has no image-alias fields to bucket on. */}
        {!isRules && (
          <div className="assetstore-dd">
            <button
              type="button"
              className={`assetstore-taxo-trigger${taxonomy ? ' is-on' : ''}${openMenu === 'taxonomy' ? ' is-open' : ''}`}
              title={`Sort: ${taxonomyLabel(taxonomy)}`}
              aria-haspopup="listbox"
              aria-expanded={openMenu === 'taxonomy'}
              onClick={() => setOpenMenu((m) => (m === 'taxonomy' ? null : 'taxonomy'))}
            >
              {taxonomyIcon(taxonomy)}
              <ChevronDown size={13} />
            </button>
            {openMenu === 'taxonomy' && (
              <div className="assetstore-dd-menu assetstore-dd-menu--taxo" role="listbox">
                <div className="assetstore-dd-header">Sort By</div>
                {TAXONOMY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value ?? '__flat__'}
                    type="button"
                    role="option"
                    aria-selected={taxonomy === opt.value}
                    className={`assetstore-dd-item assetstore-taxo-item${taxonomy === opt.value ? ' is-active' : ''}`}
                    onClick={() => {
                      setTaxonomy(opt.value)
                      setOpenMenu(null)
                    }}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View mode: icon-only dropdown (legacy view trigger). */}
        <div className="assetstore-dd">
          <button
            type="button"
            className={`assetstore-view-trigger${openMenu === 'view' ? ' is-open' : ''}`}
            title={`View: ${currentView.label}`}
            aria-haspopup="listbox"
            aria-expanded={openMenu === 'view'}
            onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))}
          >
            <span className="assetstore-view-icon">{currentView.icon}</span>
            <ChevronDown size={13} />
          </button>
          {openMenu === 'view' && (
            <div className="assetstore-dd-menu" role="listbox">
              <div className="assetstore-dd-header">View</div>
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  role="option"
                  aria-selected={viewMode === opt.mode}
                  className={`assetstore-dd-item${viewMode === opt.mode ? ' is-active' : ''}`}
                  onClick={() => {
                    setViewMode(opt.mode)
                    setOpenMenu(null)
                  }}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right cluster: fullscreen. */}
        <div className="assetstore-titlebar-right">
          <button
            type="button"
            className={`assetstore-ctrl-btn${isFocused ? ' is-active' : ''}`}
            title={isFocused ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={requestFocus}
          >
            {isFocused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Breadcrumb: shown whenever a taxonomy is active, so the user can climb
          back out of a folder (or jump straight to the taxonomy root). */}
      {!isRules && taxonomy != null && (
        <nav className="assetstore-crumbs" aria-label="Folder path">
          <button type="button" className="assetstore-crumb" onClick={() => goToCrumb(0)}>
            <Folder size={12} />
            <span>{taxonomyLabel(taxonomy)}</span>
          </button>
          {folderPath.map((c, i) => (
            <span key={`${c.value}-${i}`} className="assetstore-crumb-seg">
              <ChevronRightSmall size={11} />
              <button
                type="button"
                className={`assetstore-crumb${i === folderPath.length - 1 ? ' is-current' : ''}`}
                onClick={() => goToCrumb(i + 1)}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className={`assetstore-main assetstore-main--${isRules ? 'grid' : viewMode}`} ref={mainRef}>
        {(showFolders ? loadingFolders && folders.length === 0 : loading && (isRules ? rules.length : assets.length) === 0) ? (
          <div className="asset-empty">Loading…</div>
        ) : showFolders ? (
          folders.length === 0 ? (
            <div className="asset-empty">
              <Folder size={32} />
              <p>该分类下没有资产。</p>
            </div>
          ) : viewMode === 'list' ? (
            <ul className="asset-grid asset-grid--folder-list">
              {folders.map((f) => (
                <FolderRow key={f.value} folder={f} onOpen={() => openFolder(f)} />
              ))}
            </ul>
          ) : (
            <ul className="asset-grid asset-grid--folders">
              {folders.map((f) => (
                <FolderCard key={f.value} folder={f} onOpen={() => openFolder(f)} />
              ))}
            </ul>
          )
        ) : isRules ? (
          rules.length === 0 ? (
            <div className="asset-empty">
              <Package size={32} />
              <p>No tilemap rules found.</p>
            </div>
          ) : (
            <ul className="asset-grid asset-grid--grid asset-grid--rules">
              {rules.map((r) => (
                <RuleCard
                  key={r.alias}
                  rule={r}
                  selected={selectedRule?.alias === r.alias}
                  onSelect={() => setSelectedRule(r)}
                />
              ))}
            </ul>
          )
        ) : assets.length === 0 ? (
          <div className="asset-empty">
            <Package size={32} />
            <p>No assets in “{activeZone}”.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <ul className="asset-grid asset-grid--grid">
            {assets.map((a) => (
              <li
                key={a.id}
                className={`asset-card${selected?.id === a.id ? ' selected' : ''}${batchMode && selectedIds.has(a.id) ? ' batch-selected' : ''}${batchMode && !a.private ? ' batch-locked' : ''}${selectedLayerAssetName && aliasItemName(a.alias) === selectedLayerAssetName ? ' is-layer-asset' : ''}`}
                onClick={() => handleCardClick(a)}
                onDoubleClick={() => copyAlias(a.alias)}
                title={a.alias}
              >
                <div className="asset-card-thumb">
                  {a.private && <span className="asset-card-private" title="项目私有资产">私</span>}
                  {batchMode && a.private && (
                    <span className={`asset-card-check${selectedIds.has(a.id) ? ' is-on' : ''}`} aria-hidden="true" />
                  )}
                  <img
                    className="asset-card-img"
                    src={libraryApi.serveUrl(a.alias)}
                    alt={a.alias}
                    loading="lazy"
                  />
                </div>
                <div className="asset-card-name">{a.alias}</div>
                <div className="asset-card-size">{formatBytes(a.sizeBytes)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="asset-grid asset-grid--list">
            {assets.map((a) => (
              <li
                key={a.id}
                className={`asset-card${selected?.id === a.id ? ' selected' : ''}${batchMode && selectedIds.has(a.id) ? ' batch-selected' : ''}${batchMode && !a.private ? ' batch-locked' : ''}${selectedLayerAssetName && aliasItemName(a.alias) === selectedLayerAssetName ? ' is-layer-asset' : ''}`}
                onClick={() => handleCardClick(a)}
                onDoubleClick={() => copyAlias(a.alias)}
                title={a.alias}
              >
                <div className="asset-card-thumb">
                  {a.private && <span className="asset-card-private" title="项目私有资产">私</span>}
                  {batchMode && a.private && (
                    <span className={`asset-card-check${selectedIds.has(a.id) ? ' is-on' : ''}`} aria-hidden="true" />
                  )}
                  <img
                    className="asset-card-img"
                    src={libraryApi.serveUrl(a.alias)}
                    alt={a.alias}
                    loading="lazy"
                  />
                </div>
                <div className="asset-card-name">{a.alias}</div>
                <div className="asset-card-dims">
                  {a.widthPx && a.heightPx ? `${a.widthPx}×${a.heightPx}` : '—'}
                </div>
                <div className="asset-card-size">{formatBytes(a.sizeBytes)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!showFolders && totalPages > 1 && (
        <div className="assetstore-statusbar assetstore-statusbar--pagination-only">
          <Pagination page={page} totalPages={totalPages} onGo={goToPage} />
        </div>
      )}
    </div>
  )
}

// A folder card in the taxonomy view: a Windows-explorer-style folder whose lid
// peeks at up to 4 sample thumbnails inside, plus the folder name + asset count.
function FolderCard({ folder, onOpen }: { folder: FacetItem; onOpen: () => void }): JSX.Element {
  const samples = folder.samples.slice(0, 4)
  return (
    <li className="folder-card" onClick={onOpen} title={`${folder.label} · ${folder.count}`}>
      <div className="folder-card-visual">
        <div className="folder-card-tab" />
        <div className="folder-card-body">
          <div className={`folder-card-peek folder-card-peek--${samples.length || 0}`}>
            {samples.length === 0 ? (
              <Folder size={26} />
            ) : (
              samples.map((alias) => (
                <span key={alias} className="folder-card-peek-cell">
                  <img
                    className="folder-card-peek-img"
                    src={libraryApi.serveUrl(alias)}
                    alt=""
                    loading="lazy"
                  />
                </span>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="folder-card-name">{folder.label}</div>
      <div className="folder-card-count">{folder.count}</div>
    </li>
  )
}

// List-mode counterpart of FolderCard: a wide row with a left cover thumbnail,
// the folder name + asset count up top, and a sampled list of contents below.
function FolderRow({ folder, onOpen }: { folder: FacetItem; onOpen: () => void }): JSX.Element {
  const samples = folder.samples.slice(0, 4)
  const preview = samples.map((alias) => aliasItemName(alias)).join(' · ')
  return (
    <li className="folder-row" onClick={onOpen} title={`${folder.label} · ${folder.count}`}>
      <div className="folder-row-icon">
        {samples.length === 0 ? (
          <Folder size={22} />
        ) : (
          <img
            className="folder-row-icon-img"
            src={libraryApi.serveUrl(samples[0])}
            alt=""
            loading="lazy"
          />
        )}
      </div>
      <div className="folder-row-info">
        <div className="folder-row-head">
          <span className="folder-row-name">{folder.label}</span>
          <span className="folder-card-count">{folder.count}</span>
        </div>
        <div className="folder-row-items">{preview || 'Empty folder'}</div>
      </div>
    </li>
  )
}

function Pagination({
  page,
  totalPages,
  onGo,
}: {
  page: number
  totalPages: number
  onGo: (p: number) => void
}): JSX.Element {
  const items = pageItems(page, totalPages)
  return (
    <div className="asset-pagination">
      <button
        type="button"
        className="ap-btn ap-arrow"
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={13} />
      </button>

      {items.map((it, i) =>
        it === '…' ? (
          <span key={`gap-${i}`} className="ap-ellipsis">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            className={`ap-btn ap-page${it === 1 || it === totalPages ? ' ap-edge' : ''}${it === page ? ' active' : ''}`}
            aria-current={it === page ? 'page' : undefined}
            onClick={() => onGo(it)}
          >
            {it}
          </button>
        ),
      )}

      <button
        type="button"
        className="ap-btn ap-arrow"
        disabled={page >= totalPages}
        onClick={() => onGo(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={13} />
      </button>
    </div>
  )
}

// Metadata card for one tilemap rule (no atlas thumbnail — the atlas is a
// separate tile image linked via its `tileType`). Reuses `.asset-card` so the
// continuous-scroll measurement/pagination treats it like any other card.
function RuleCard({
  rule,
  selected,
  onSelect,
}: {
  rule: RuleListItem
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  const faces = (['top', 'front'] as const).filter((f) => rule.faces[f])
  return (
    <li
      className={`asset-card asset-rule-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
      title={rule.description ?? rule.alias}
    >
      <div className="asset-rule-card__head">
        <span className="asset-rule-card__name">{rule.name ?? rule.alias}</span>
        <span className="asset-rule-card__schema">v{rule.schemaVersion}</span>
      </div>
      <div className="asset-rule-card__meta">
        <span>{rule.ppu}ppu</span>
        <span>{rule.spriteCount} sprites</span>
      </div>
      <div className="asset-rule-card__faces">
        {faces.length === 0 ? (
          <span className="asset-rule-card__face asset-rule-card__face--none">no faces</span>
        ) : (
          faces.map((f) => (
            <span key={f} className="asset-rule-card__face">
              {f}
            </span>
          ))
        )}
      </div>
    </li>
  )
}

// Matches the legacy AssetStore byte formatting: compact, no space (e.g. "6KB").
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
