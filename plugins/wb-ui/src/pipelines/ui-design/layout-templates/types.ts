export interface LayoutPreviewScreenContext {
  spec: import('../layout-specs/types').GenreScreenLayoutSpec
  hasModule: (id: string) => boolean
  esc: (value: string) => string
  genreLabel: string
  playerFantasy: string
  blueprint: {
    stage: {
      label: string
      playerGoal: string
      cta: string
    }
  }
  renderModuleFeedback: (renderedIds: string[]) => string
}

export interface LayoutPrototypeScreenContext {
  spec: import('../layout-specs/types').GenreScreenLayoutSpec
  hasModule: (id: string) => boolean
  panelClass: (base: string) => string
  skillSlot: (key: string, index: number) => string
  styleSceneBtn: string
  styleBtnPri: string
  styleBtnNorm: string
  genreLabel: string
  screenLabel: string
  playerFantasy: string
  blueprint: {
    stage: {
      label: string
      playerGoal: string
      cta: string
    }
  }
  nextScreen: { kind: string; label: string } | undefined
}
