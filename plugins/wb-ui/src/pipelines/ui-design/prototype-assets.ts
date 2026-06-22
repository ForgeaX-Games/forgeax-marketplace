/** Inline asset URLs for prototype iframe — mirrors workbench injectLiveAssets / CSS vars */

export interface PrototypeChromeAssets {
  buttonPrimary?: string
  buttonNormal?: string
  titleDeco?: string
  panelTexture?: string
  icons?: string[]
}

function escCssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Genre-layout chrome in the prototype iframe (`.gl-proto-genre-shell`).
 * Workbench preview uses CSS variables on `.uid-preview-stage`; the iframe needs explicit rules.
 */
export function buildPrototypeChromeCss(assets: PrototypeChromeAssets): string {
  const btnP = assets.buttonPrimary
  const btnN = assets.buttonNormal
  const titleD = assets.titleDeco
  const pTex = assets.panelTexture
  const icons = assets.icons ?? []
  const rules: string[] = []

  if (btnN) {
    const u = escCssUrl(btnN)
    rules.push(`
.gl-proto-genre-shell .upv-start-item:not(.primary),
.gl-proto-genre-shell .upv-pause-item:not(.primary),
.gl-proto-genre-shell .upv-results-btn:not(.primary),
.gl-proto-genre-shell .upv-bag-tab,
.gl-proto-genre-shell .upv-shop-tabs button,
.gl-proto-genre-shell .upv-dialog-opt:not(.primary),
.gl-proto-genre-shell .gl-fps-topnav button,
.gl-proto-genre-shell .gl-fps-loadout-tabs button,
.gl-proto-genre-shell .gl-surv-topnav button,
.gl-proto-genre-shell .gl-arpg-tabs button,
.gl-proto-genre-shell .gl-race-track-topnav button,
.gl-proto-genre-shell .gl-mmo-slot,
.gl-proto-genre-shell .upv-puzzle-dock-item,
.gl-proto-genre-shell .upv-puzzle-event {
  background-image: url('${u}') !important;
  background-size: 100% 100% !important;
  background-color: transparent !important;
  border-color: transparent !important;
  color: #fff !important;
  text-shadow: 0 1px 4px rgba(0,0,0,.75);
}`)
  }

  if (btnP) {
    const u = escCssUrl(btnP)
    rules.push(`
.gl-proto-genre-shell .upv-start-item.primary,
.gl-proto-genre-shell .upv-pause-item.primary,
.gl-proto-genre-shell .upv-results-btn.primary,
.gl-proto-genre-shell .upv-shop-buy,
.gl-proto-genre-shell .upv-puzzle-play,
.gl-proto-genre-shell .gl-puzzle-cta.primary,
.gl-proto-genre-shell .gl-fps-match-btn,
.gl-proto-genre-shell .gl-fps-loadout-confirm,
.gl-proto-genre-shell .gl-mmo-enter,
.gl-proto-genre-shell .gl-arpg-enter,
.gl-proto-genre-shell .upv-dialog-opt.primary,
.gl-proto-genre-shell .gl-ow-bag-action {
  background-image: url('${u}') !important;
  background-size: 100% 100% !important;
  background-color: transparent !important;
  border-color: transparent !important;
  color: #fff !important;
  font-weight: 700;
  text-shadow: 0 1px 4px rgba(0,0,0,.85);
}`)
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
