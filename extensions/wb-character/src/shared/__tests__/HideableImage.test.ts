// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetHideableForTests,
  applyHideableTo,
  bindHideableEvents,
  ensureHideableStyles,
} from '../HideableImage'

function makeImg(src: string, parent: HTMLElement): HTMLImageElement {
  const img = document.createElement('img')
  img.src = src
  img.className = 'cd-preview-img'
  parent.appendChild(img)
  return img
}

function closeBtn(parent: HTMLElement): HTMLButtonElement {
  return parent.querySelector('.ce-img-close') as HTMLButtonElement
}

function placeholderEl(parent: HTMLElement): HTMLElement {
  return parent.querySelector('.ce-hideable-placeholder') as HTMLElement
}

function hiddenImg(parent: HTMLElement): HTMLImageElement {
  return parent.querySelector('img[data-hideable-installed]') as HTMLImageElement
}

describe('applyHideableTo (sibling-structure)', () => {
  let root: HTMLElement

  beforeEach(() => {
    __resetHideableForTests()
    document.body.innerHTML = ''
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    __resetHideableForTests()
  })

  it('installs the close button and placeholder as siblings of the img (no wrapper)', () => {
    makeImg('data:image/png;base64,AAA', root)
    applyHideableTo(root, '.cd-preview-img')

    // No wrapper element is created — this is the whole point of the
    // sibling-structure refactor, because wrappers broke flex/grid sizing.
    expect(root.querySelectorAll('.ce-hideable').length).toBe(0)

    const img = hiddenImg(root)
    expect(img).not.toBeNull()
    expect(img.parentElement).toBe(root)

    const close = closeBtn(root)
    const show = placeholderEl(root)
    expect(close).not.toBeNull()
    expect(show).not.toBeNull()

    // Tab order: img → close → placeholder.
    expect(img.nextElementSibling).toBe(close)
    expect(close.nextElementSibling).toBe(show)
  })

  it('preserves the original image classes, attributes, and layout role', () => {
    const parent = document.createElement('div')
    parent.style.display = 'flex'
    parent.style.alignItems = 'center'
    root.appendChild(parent)
    const img = makeImg('data:image/png;base64,AAA', parent)
    img.style.flex = '1'
    img.style.maxWidth = '100%'

    applyHideableTo(root, '.cd-preview-img')

    // Original sizing rules must survive — the earlier wrapper-based impl
    // collapsed the flex-item contract, which is how "下面的东西下拉不下去"
    // appeared. Sibling mode cannot affect these.
    // `flex` is a shorthand — happy-dom expands it to `1 1 0%`. Just check
    // that the grow factor survived (which is what matters for "stays a
    // flex-item in its original container").
    expect(img.style.flex).toMatch(/^1\b/)
    expect(img.style.maxWidth).toBe('100%')
    expect(img.classList.contains('cd-preview-img')).toBe(true)
  })

  it('promotes a static-position parent to relative so the ✕ can anchor top-right', () => {
    const parent = document.createElement('div')
    root.appendChild(parent)
    makeImg('data:image/png;base64,AAA', parent)

    // happy-dom returns '' for unset computed position rather than the
    // browser's 'static'. The implementation treats both as "needs
    // promotion"; verify via the mutation instead.
    const before = parent.style.position
    expect(before === '' || before === 'static').toBe(true)
    applyHideableTo(root, '.cd-preview-img')
    expect(parent.style.position).toBe('relative')
  })

  it('leaves an already-positioned parent unchanged', () => {
    const parent = document.createElement('div')
    parent.style.position = 'absolute'
    root.appendChild(parent)
    makeImg('data:image/png;base64,AAA', parent)

    applyHideableTo(root, '.cd-preview-img')
    expect(parent.style.position).toBe('absolute')
  })

  it('is idempotent — re-running never double-installs', () => {
    makeImg('data:image/png;base64,AAA', root)
    applyHideableTo(root, '.cd-preview-img')
    applyHideableTo(root, '.cd-preview-img')
    applyHideableTo(root, '.cd-preview-img')

    expect(root.querySelectorAll('.ce-img-close').length).toBe(1)
    expect(root.querySelectorAll('.ce-hideable-placeholder').length).toBe(1)
    expect(root.querySelectorAll('img[data-hideable-installed]').length).toBe(1)
  })

  it('uses the custom idFrom to derive a stable visibility key', () => {
    makeImg('data:image/png;base64,XYZ', root)
    applyHideableTo(root, '.cd-preview-img', {
      idFrom: () => 'character-design:final',
    })
    expect(hiddenImg(root).dataset.hideableId).toBe('character-design:final')
    expect(closeBtn(root).dataset.hideableHide).toBe('character-design:final')
    expect(placeholderEl(root).dataset.hideableShow).toBe('character-design:final')
  })

  it('distinguishes http src from data URL src for the default id', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    root.appendChild(a)
    root.appendChild(b)
    makeImg('https://cdn.example.com/char.png', a)
    makeImg('data:image/png;base64,ZZZZZZZZ', b)

    applyHideableTo(root, '.cd-preview-img')

    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-hideable-installed]'))
    expect(imgs.length).toBe(2)
    expect(imgs[0].dataset.hideableId).not.toBe(imgs[1].dataset.hideableId)
  })
})

describe('bindHideableEvents', () => {
  beforeEach(() => {
    __resetHideableForTests()
    document.body.innerHTML = ''
    ensureHideableStyles()
    bindHideableEvents()
  })

  afterEach(() => {
    __resetHideableForTests()
  })

  it('clicking close hides img, close btn, and shows the placeholder', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    makeImg('https://example.com/a.png', root)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'cd:final' })

    const img = hiddenImg(root)
    const close = closeBtn(root)
    const show = placeholderEl(root)

    expect(img.style.display).not.toBe('none')
    expect(show.style.display).toBe('none')

    close.click()

    expect(img.style.display).toBe('none')
    expect(close.style.display).toBe('none')
    expect(show.style.display).toBe('flex')
  })

  it('clicking the placeholder restores visibility', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    makeImg('https://example.com/a.png', root)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'cd:final' })

    closeBtn(root).click()
    expect(hiddenImg(root).style.display).toBe('none')

    placeholderEl(root).click()
    expect(hiddenImg(root).style.display).toBe('')
    expect(placeholderEl(root).style.display).toBe('none')
  })

  it('hiding persists across re-renders sharing the same id', () => {
    // First render.
    const root = document.createElement('div')
    document.body.appendChild(root)
    makeImg('https://example.com/a.png', root)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'cd:final' })
    closeBtn(root).click()

    // Simulate a re-render — the pipeline wipes the container and draws the
    // same logical image again with the same `idFrom` key.
    root.innerHTML = ''
    makeImg('https://example.com/a.png', root)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'cd:final' })

    expect(hiddenImg(root).style.display).toBe('none')
    expect(placeholderEl(root).style.display).toBe('flex')
  })

  it('hides every instance sharing the same id simultaneously', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const a = document.createElement('div')
    const b = document.createElement('div')
    root.appendChild(a); root.appendChild(b)
    makeImg('https://example.com/sheet.png', a)
    makeImg('https://example.com/sheet.png', b)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'pixel:idle' })

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.ce-img-close'))
    expect(buttons.length).toBe(2)

    buttons[0].click()

    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-hideable-installed]'))
    expect(imgs.map(i => i.style.display)).toEqual(['none', 'none'])
  })

  it('is idempotent — calling bindHideableEvents twice does not double-fire', () => {
    bindHideableEvents()
    bindHideableEvents()

    const root = document.createElement('div')
    document.body.appendChild(root)
    makeImg('https://example.com/a.png', root)
    applyHideableTo(root, '.cd-preview-img', { idFrom: () => 'cd:final' })

    closeBtn(root).click()
    expect(hiddenImg(root).style.display).toBe('none')

    // If both listeners fired, we would hide → show → hide in a single tick
    // and end up hidden. With one listener we end up shown.
    placeholderEl(root).click()
    expect(hiddenImg(root).style.display).toBe('')
  })
})
