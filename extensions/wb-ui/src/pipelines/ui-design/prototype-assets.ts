/** Inline asset URLs for prototype iframe — mirrors workbench injectLiveAssets / CSS vars */

import {
  buttonChromeRuleBlockUrl,
  PROTO_BUTTON_DIALOG_STRIP_NORMAL_SELECTORS,
  PROTO_BUTTON_DIALOG_STRIP_PRIMARY_SELECTORS,
  PROTO_BUTTON_PRIMARY_SELECTORS,
  PROTO_BUTTON_TABS_SECTION_SELECTORS,
  PROTO_BUTTON_WIDE_NORMAL_SELECTORS,
} from './button-chrome-css'
import { BUTTON_CHROME_TIERS, BUTTON_LONG_CHROME_SLICE } from './button-chrome-spec'
import { buildProtoDialogStripHostCss } from './dialog-strip-chrome-css'
import { buildProtoTabsSectionHostCss } from './tabs-section-chrome-css'

export interface PrototypeChromeAssets {
  buttonPrimary?: string
  buttonNormal?: string
  buttonPrimaryLong?: string
  buttonNormalLong?: string
  titleDeco?: string
  panelTexture?: string
  icons?: string[]
}

function escCssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** 原型 iframe 壳层 gate class（不含 gl-proto-genre-shell 基类） */
export function buildProtoGenreShellGateClasses(assets: PrototypeChromeAssets): string {
  const parts: string[] = []
  if (assets.buttonNormal) {
    parts.push('uid-chrome-btn-normal', 'uid-chrome-tabs-section')
  }
  if (assets.buttonPrimary) parts.push('uid-chrome-btn-primary')
  if (assets.buttonNormalLong) {
    parts.push('uid-chrome-btn-normal-long', 'uid-chrome-dialog-strip')
  }
  if (assets.buttonPrimaryLong) parts.push('uid-chrome-btn-primary-long')
  return parts.join(' ')
}

/** 完整 shell class 列表（含 gl-proto-genre-shell） */
export function buildProtoGenreShellChromeClasses(assets: PrototypeChromeAssets): string {
  return ['gl-proto-genre-shell', buildProtoGenreShellGateClasses(assets)].filter(Boolean).join(' ')
}

/**
 * Genre-layout chrome in the prototype iframe (`.gl-proto-genre-shell`).
 * Workbench preview uses CSS variables on `.uid-preview-stage`; the iframe needs explicit rules.
 */
export function buildPrototypeChromeCss(assets: PrototypeChromeAssets): string {
  const btnP = assets.buttonPrimary
  const btnN = assets.buttonNormal
  const btnPL = assets.buttonPrimaryLong
  const btnNL = assets.buttonNormalLong
  const titleD = assets.titleDeco
  const pTex = assets.panelTexture
  const icons = assets.icons ?? []
  const rules: string[] = []
  const mediumBorder = BUTTON_CHROME_TIERS.medium.borderWidth
  const longBorder = BUTTON_CHROME_TIERS.long.borderWidth

  if (btnN) {
    const u = escCssUrl(btnN)
    rules.push(buttonChromeRuleBlockUrl(PROTO_BUTTON_WIDE_NORMAL_SELECTORS, u, true))
    rules.push(`${PROTO_BUTTON_WIDE_NORMAL_SELECTORS} { color: #fff !important; text-shadow: 0 1px 4px rgba(0,0,0,.75); }`)
    rules.push(buttonChromeRuleBlockUrl(PROTO_BUTTON_TABS_SECTION_SELECTORS, u, true, mediumBorder))
    rules.push(`${PROTO_BUTTON_TABS_SECTION_SELECTORS} { color: #fff !important; text-shadow: 0 1px 4px rgba(0,0,0,.75); }`)
    rules.push(buildProtoTabsSectionHostCss())
  }

  if (btnNL) {
    const u = escCssUrl(btnNL)
    rules.push(buttonChromeRuleBlockUrl(PROTO_BUTTON_DIALOG_STRIP_NORMAL_SELECTORS, u, true, longBorder, BUTTON_LONG_CHROME_SLICE))
    rules.push(`${PROTO_BUTTON_DIALOG_STRIP_NORMAL_SELECTORS} { color: #fff !important; text-shadow: 0 1px 3px rgba(0,0,0,.92), 0 0 10px rgba(0,0,0,.55) !important; }`)
    rules.push(buildProtoDialogStripHostCss())
  }

  if (btnP) {
    const u = escCssUrl(btnP)
    rules.push(buttonChromeRuleBlockUrl(PROTO_BUTTON_PRIMARY_SELECTORS, u, true))
    rules.push(`${PROTO_BUTTON_PRIMARY_SELECTORS} { color: #fff !important; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.85); }`)
  }

  if (btnPL) {
    const u = escCssUrl(btnPL)
    rules.push(buttonChromeRuleBlockUrl(PROTO_BUTTON_DIALOG_STRIP_PRIMARY_SELECTORS, u, true, longBorder, BUTTON_LONG_CHROME_SLICE))
    rules.push(`${PROTO_BUTTON_DIALOG_STRIP_PRIMARY_SELECTORS} { color: #fff !important; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.92), 0 0 10px rgba(0,0,0,.55) !important; }`)
    if (!btnNL) rules.push(buildProtoDialogStripHostCss())
  }

  if (titleD) {
    const u = escCssUrl(titleD)
    rules.push(`
.gl-proto-genre-shell .gl-ow-brand,
.gl-proto-genre-shell .upv-start-logo,
.gl-proto-genre-shell .gl-arpg-logo,
.gl-proto-genre-shell .gl-mmo-logo,
.gl-proto-genre-shell .upv-puzzle-home-logo,
.gl-proto-genre-shell .gl-puzzle-title {
  background-image: url('${u}') !important;
  background-size: 100% 100% !important;
  background-repeat: no-repeat !important;
  background-position: left center !important;
  min-height: 64px;
  padding: 8px 24px 8px 0;
  box-sizing: border-box;
  color: #fff !important;
  text-shadow: 0 2px 8px rgba(0,0,0,.85);
}`)
  }

  if (pTex) {
    const u = escCssUrl(pTex)
    rules.push(`
.gl-proto-genre-shell .upv-hud-quest,
.gl-proto-genre-shell .upv-hud-health,
.gl-proto-genre-shell .upv-hud-stamina,
.gl-proto-genre-shell .upv-hud-ammo,
.gl-proto-genre-shell .upv-bag-left,
.gl-proto-genre-shell .upv-dialog-box,
.gl-proto-genre-shell .upv-pause-panel,
.gl-proto-genre-shell .upv-shop-shelf,
.gl-proto-genre-shell .upv-results-main,
.gl-proto-genre-shell .upv-supplemental,
.gl-proto-genre-shell .gl-ow-weapon,
.gl-proto-genre-shell .gl-arpg-news {
  background-image: url('${u}') !important;
  background-size: 100% 100% !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-blend-mode: soft-light;
}`)
  }

  icons.forEach((src, i) => {
    if (!src) return
    const u = escCssUrl(src)
    rules.push(`
.gl-proto-genre-shell .uid-live-icon-${i},
.gl-proto-genre-shell .gl-hotbar-slot.uid-live-icon-${i},
.gl-proto-genre-shell .gl-skill.uid-live-icon-${i},
.gl-proto-genre-shell .upv-puzzle-item.uid-live-icon-${i},
.gl-proto-genre-shell .gl-ow-bag-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-arpg-bag-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-ow-bag-detail-art.uid-live-icon-${i},
.gl-proto-genre-shell .gl-arpg-bag-detail-art.uid-live-icon-${i},
.gl-proto-genre-shell .gl-ow-dialog-portrait.uid-live-icon-${i},
.gl-proto-genre-shell .gl-arpg-dialog-portrait.uid-live-icon-${i},
.gl-proto-genre-shell .gl-fps-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-fps-loadout-card-icon.uid-live-icon-${i} {
  background-image: url('${u}') !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
}
.gl-proto-genre-shell .gl-skill.uid-live-icon-${i} > span,
.gl-proto-genre-shell .upv-puzzle-item.uid-live-icon-${i} .upv-puzzle-item-icon,
.gl-proto-genre-shell .gl-ow-bag-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-arpg-bag-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-ow-bag-detail-art.uid-live-icon-${i} > span,
.gl-proto-genre-shell .gl-arpg-bag-detail-art.uid-live-icon-${i} > span,
.gl-proto-genre-shell .gl-ow-dialog-portrait.uid-live-icon-${i} .gl-ow-dialog-portrait-label,
.gl-proto-genre-shell .gl-fps-slot-icon.uid-live-icon-${i},
.gl-proto-genre-shell .gl-fps-loadout-card-icon.uid-live-icon-${i} {
  opacity: 0;
}`)
  })

  return rules.join('\n')
}
