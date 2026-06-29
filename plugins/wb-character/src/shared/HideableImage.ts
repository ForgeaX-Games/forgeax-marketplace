/**
 * Hideable generated images.
 *
 * The user records screencaps of the editor but wants a CLEAN canvas during
 * recording — no spoilers from old generated assets bleeding into the frame.
 * At the same time they want the in-memory history and auto-load behaviour
 * to stay intact, so anything destructive (delete / clear cache) is off the
 * table.
 *
 * Solution: each matching <img> stays IN PLACE and inherits its original
 * layout role (flex-item / grid cell / inline block / whatever). Two siblings
 * are added next to it inside the same parent:
 *
 *   <parent style="position:relative">            ← auto-promoted if static
 *     <img data-hideable-id="ID">                 ← original, untouched
 *     <button.ce-img-close data-hideable-hide=ID> ← absolute-positioned ✕
 *     <div.ce-hideable-placeholder                ← hidden-state replacement
 *          data-hideable-show=ID>
 *   </parent>
 *
 * The original <img> keeps every bit of CSS that governed its size
 * (`flex: 1`, `max-width: 100%`, `object-fit: contain`, grid-item defaults,
 * etc). No wrapper is injected — earlier attempts at wrapping in an
 * `inline-block` container broke `.cd-preview`'s flex layout and the
 * `.px-grid-cell` grid-item sizing, which is how the "关闭后下面的东西下拉
 * 不下去" bug crept in: the wrapper had intrinsic-width collapse behaviour
 * that made parent containers incorrectly compute their scroll heights.
 *
 * Visibility state (which IDs are hidden) is in-memory only: reload resets
 * it, which matches "keep the data, just hide the pixels for this take".
 *
 * Contract:
 *  - `applyHideableTo(root, selector, opts)` — post-process pass that walks
 *    `root` and installs the ✕ / placeholder siblings for each matching <img>.
 *    Safe to call repeatedly after re-renders: already-installed imgs are
 *    detected via `data-hideable-installed` and skipped.
 *  - `bindHideableEvents()` — ONCE per app, sets up delegated click routing
 *    for the ✕ / show buttons. Call from `main.ts`.
 *  - `ensureHideableStyles()` — injects global CSS. Call from `main.ts`.
 */

const hiddenIds = new Set<string>()
let wired = false

interface HideableOptions {
  /** Derive a stable visibility key for an image. Defaults to its src. */
  idFrom?: (img: HTMLImageElement) => string
  /** Tooltip on the close button. */
  title?: string
  /** Placeholder text shown in the collapsed box. */
  hiddenLabel?: string
}

/**
 * Install the ✕ close button and "click-to-show" placeholder as siblings of
 * every <img> matching `selector` inside `root`. Idempotent across re-renders.
 */
export function applyHideableTo(
  root: ParentNode,
  selector: string,
  opts: HideableOptions = {},
): void {
  const imgs = root.querySelectorAll<HTMLImageElement>(selector)
  imgs.forEach(img => {
    installOnImage(img, opts)
  })
}

function installOnImage(img: HTMLImageElement, opts: HideableOptions): void {
  if (img.dataset.hideableInstalled === '1') return

  const id = (opts.idFrom ?? defaultIdFrom)(img)
  const parent = img.parentElement
  if (!parent) return

  // The ✕ and placeholder are positioned with `position:absolute` relative
  // to the immediate parent. If the parent is still `static` we promote it
  // to `relative`; `static` is almost never meaningful on a generation card
  // so this is safe.
  const cs = getComputedStyle(parent)
  // happy-dom / SSR snapshots sometimes report '' for an unset position.
  // Both '' and 'static' mean "no containing block for absolute descendants",
  // so we must promote in either case.
  if (cs.position === '' || cs.position === 'static') {
    parent.style.position = 'relative'
  }

  img.dataset.hideableInstalled = '1'
  img.dataset.hideableId = id

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ce-img-close'
  close.textContent = '×'
  close.title = opts.title ?? '隐藏图片（不会删除，刷新恢复）'
  close.setAttribute('aria-label', '隐藏图片')
  close.dataset.hideableHide = id

  const show = document.createElement('div')
  show.className = 'ce-hideable-placeholder'
  show.textContent = opts.hiddenLabel ?? '👁  已隐藏 · 点击显示'
  show.title = '恢复显示'
  show.dataset.hideableShow = id
  show.setAttribute('role', 'button')
  show.setAttribute('tabindex', '0')

  // Sync current hidden state if this id was already dismissed earlier.
  applyHiddenStateToTriplet(img, close, show, hiddenIds.has(id))

  // Insert siblings right after the img so tab order stays sensible.
  img.insertAdjacentElement('afterend', close)
  close.insertAdjacentElement('afterend', show)
}

/**
 * Install a single delegated click handler for hide / show buttons. Idempotent —
 * calling twice is safe. Also handles keyboard activation (Enter / Space) on
 * the placeholder so the re-show affordance is accessible.
 */
export function bindHideableEvents(): void {
  if (wired) return
  wired = true
  document.addEventListener('click', ev => {
    const target = ev.target as HTMLElement | null
    if (!target) return

    const hideBtn = target.closest<HTMLElement>('[data-hideable-hide]')
    if (hideBtn) {
      ev.preventDefault()
      ev.stopPropagation()
      const id = hideBtn.dataset.hideableHide!
      hiddenIds.add(id)
      syncAllById(id, true)
      return
    }

    const showBtn = target.closest<HTMLElement>('[data-hideable-show]')
    if (showBtn) {
      ev.preventDefault()
      ev.stopPropagation()
      const id = showBtn.dataset.hideableShow!
      hiddenIds.delete(id)
      syncAllById(id, false)
    }
  }, true) // capture phase so parent click handlers don't swallow it

  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    const target = ev.target as HTMLElement | null
    if (!target) return
    const showBtn = target.closest<HTMLElement>('[data-hideable-show]')
    if (!showBtn) return
    ev.preventDefault()
    const id = showBtn.dataset.hideableShow!
    hiddenIds.delete(id)
    syncAllById(id, false)
  }, true)
}

function syncAllById(id: string, hidden: boolean): void {
  const escId = cssEscape(id)
  // The img is the source of truth for "where" this ID lives in the DOM;
  // its ✕ button and placeholder are always siblings inside the same parent.
  const imgs = document.querySelectorAll<HTMLImageElement>(
    `img[data-hideable-id="${escId}"]`,
  )
  imgs.forEach(img => {
    const parent = img.parentElement
    if (!parent) return
    const close = parent.querySelector<HTMLButtonElement>(
      `button[data-hideable-hide="${escId}"]`,
    )
    const show = parent.querySelector<HTMLElement>(
      `[data-hideable-show="${escId}"]`,
    )
    applyHiddenStateToTriplet(img, close, show, hidden)
  })
}

function applyHiddenStateToTriplet(
  img: HTMLImageElement,
  close: HTMLElement | null,
  show: HTMLElement | null,
  hidden: boolean,
): void {
  if (hidden) {
    img.style.display = 'none'
    if (close) close.style.display = 'none'
    // Use `flex` explicitly — a bare <div> defaults to `block`, which would
    // wreck the centred-placeholder layout. The class `.ce-hideable-placeholder`
    // still sets display:none by default so an un-touched placeholder is hidden.
    if (show) show.style.display = 'flex'
  } else {
    img.style.display = ''
    if (close) close.style.display = ''
    if (show) show.style.display = 'none'
  }
}

function defaultIdFrom(img: HTMLImageElement): string {
  // Data URLs are huge; use a short prefix so the same image wrapped in two
  // DOM locations shares visibility state, but different images don't
  // collide. For non-data URLs the full href is a good natural key.
  const src = img.getAttribute('src') ?? ''
  if (src.startsWith('data:')) return `data:${src.length}:${src.slice(-48)}`
  return src
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/["\\]/g, '\\$&')
}

/**
 * Global CSS installed ONCE. Imported once from `main.ts` via
 * `ensureHideableStyles()`. All selectors are namespaced with `ce-` so no
 * existing pipeline CSS can clash.
 */
const CSS_TEXT = `
.ce-img-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 1;
  font-size: 17px;
  font-weight: 700;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--prim-color-neutral-1000) 60%, transparent);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity .15s ease, background .15s ease, transform .15s ease;
  z-index: 10;
  pointer-events: auto;
}
/* Reveal the close button on hover: fallback via adjacent sibling +
   an @supports block using :has() for the more reliable "hover anywhere
   on the image region" behaviour. */
img[data-hideable-installed="1"]:hover + .ce-img-close,
.ce-img-close:hover {
  opacity: 1;
}
@supports selector(:has(*)) {
  *:has(> img[data-hideable-installed="1"]):hover > .ce-img-close {
    opacity: 1;
  }
}
.ce-img-close:focus-visible {
  opacity: 1;
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ce-img-close:hover {
  background: color-mix(in srgb, var(--danger) 85%, transparent);
  transform: scale(1.08);
}

.ce-hideable-placeholder {
  /* Default hidden; JS flips inline display between 'flex' (when hidden) and
     'none' (when visible). We keep CSS at 'none' as a sane fallback if JS
     hasn't run yet. */
  display: none;
  align-items: center;
  justify-content: center;
  padding: 14px 22px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  background: color-mix(in srgb, var(--text-primary) 3%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  min-height: 60px;
  min-width: 120px;
  user-select: none;
  transition: background .15s ease, color .15s ease;
}
.ce-hideable-placeholder:hover {
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  color: var(--text-primary);
}
.ce-hideable-placeholder:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
`

let stylesInstalled = false
export function ensureHideableStyles(): void {
  if (stylesInstalled) return
  stylesInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-ce', 'hideable-image')
  style.textContent = CSS_TEXT
  document.head.appendChild(style)
}

/** Exported for tests. */
export function __resetHideableForTests(): void {
  hiddenIds.clear()
  wired = false
  stylesInstalled = false
  document.querySelectorAll('style[data-ce="hideable-image"]').forEach(n => n.remove())
}
