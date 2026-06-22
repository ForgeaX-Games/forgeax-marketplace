// @source wb-character/src/lib/scene-video-display.ts
// wb-anim stub: scene-video-display requires Three.js which wb-anim does not
// bundle. All exported functions are no-ops that satisfy the type contract so
// the video pipeline compiles. The "show in 3D scene" feature simply has no
// effect in a Three.js-free context; the rest of the video pipeline (generate,
// query, extract, zip-export) works normally.

import type { IEngine } from '../core/types'

export interface VideoDisplayHandle {
  play(): void
  pause(): void
  remove(): void
  setScale(s: number): void
  setOpacity(o: number): void
  readonly mesh: unknown
}

export interface FullscreenVideoOptions {
  fit?: 'cover' | 'contain'
  trimFirstHalf?: boolean
  loop?: boolean
  distance?: number
}

export interface FullscreenVideoHandle extends VideoDisplayHandle {
  remove(): void
  readonly video: HTMLVideoElement
}

export interface SpriteDisplayHandle {
  remove(): void
  setScale(s: number): void
  setOpacity(o: number): void
  readonly mesh: unknown
}

const NOP_HANDLE: VideoDisplayHandle = {
  play() {},
  pause() {},
  remove() {},
  setScale(_s: number) {},
  setOpacity(_o: number) {},
  get mesh(): unknown { return null },
}

const NOP_FULLSCREEN_HANDLE: FullscreenVideoHandle = {
  play() {},
  pause() {},
  remove() {},
  setScale(_s: number) {},
  setOpacity(_o: number) {},
  get mesh(): unknown { return null },
  get video(): HTMLVideoElement { return document.createElement('video') },
}

export function displayVideoInScene(
  _engine: IEngine,
  _videoUrl: string,
  _distance?: number,
): VideoDisplayHandle {
  return NOP_HANDLE
}

export function displayUltimateInScene(
  _engine: IEngine,
  _videoUrl: string,
  _opts: FullscreenVideoOptions = {},
): FullscreenVideoHandle {
  return NOP_FULLSCREEN_HANDLE
}

export function displaySpriteInScene(
  _engine: IEngine,
  _spriteDataUrl: string,
  _distance?: number,
): SpriteDisplayHandle {
  return NOP_HANDLE
}

export function clearDisplayPlanes(_engine: IEngine): void {}
