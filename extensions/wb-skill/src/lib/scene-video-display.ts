import * as THREE from 'three'
import type { IEngine } from '../core/types'
import { getCharacterRenderPanel, DEFAULT_CHROMA, type ChromaKeyParams } from '../core/CharacterRenderPanel'

/* ── Chroma Key Shader (kept here for video-specific mesh creation) ── */

const chromaKeyVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const chromaKeyFragmentShader = `
uniform sampler2D map;
uniform float greenHue;
uniform float greenRange;
uniform float greenSoft;
uniform float greenMinSat;
uniform float whiteEnabled;
uniform float whiteBright;
uniform float whiteMaxSat;
uniform float whiteSoft;
uniform float spillStrength;
uniform float edgeCrop;
uniform float opacity;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform vec3 tintColor;
uniform float tintStrength;
varying vec2 vUv;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

void main() {
  if (edgeCrop > 0.0) {
    if (vUv.x < edgeCrop || vUv.x > 1.0 - edgeCrop ||
        vUv.y < edgeCrop || vUv.y > 1.0 - edgeCrop) {
      gl_FragColor = vec4(0.0);
      return;
    }
  }

  vec4 texColor = texture2D(map, vUv);
  vec3 hsv = rgb2hsv(texColor.rgb);
  float hue = hsv.x;
  float sat = hsv.y;
  float val = hsv.z;

  float hueDist = abs(hue - greenHue);
  hueDist = min(hueDist, 1.0 - hueDist);
  float greenMask = (1.0 - smoothstep(greenRange - greenSoft, greenRange + greenSoft, hueDist))
                  * smoothstep(greenMinSat - 0.05, greenMinSat + 0.05, sat);
  float alpha = 1.0 - greenMask;

  if (whiteEnabled > 0.5) {
    float whiteMask = smoothstep(whiteBright - whiteSoft, whiteBright + whiteSoft, val)
                    * (1.0 - smoothstep(whiteMaxSat - 0.05, whiteMaxSat + 0.05, sat));
    alpha *= (1.0 - whiteMask);
  }

  vec3 c = texColor.rgb;
  if (spillStrength > 0.0 && alpha > 0.01) {
    float avgRB = (c.r + c.b) * 0.5;
    float spill = c.g - avgRB;
    if (spill > 0.0) {
      c.g -= spill * spillStrength;
    }
  }

  c += brightness;
  c = (c - 0.5) * contrast + 0.5;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, saturation);
  c = mix(c, c * tintColor, tintStrength);
  c = clamp(c, 0.0, 1.0);

  gl_FragColor = vec4(c, texColor.a * alpha * opacity);
}
`

/* ── Types ──────────────────────────────────────────────────────── */

export interface VideoDisplayHandle {
  play(): void
  pause(): void
  remove(): void
  setScale(s: number): void
  setOpacity(o: number): void
  readonly mesh: THREE.Mesh
}

/**
 * Options for {@link CharacterOverlayController.addVideoFullscreen}.
 */
export interface FullscreenVideoOptions {
  /**
   * Clip strategy when video aspect ≠ viewport aspect.
   *  - 'cover'  (default): scale until BOTH dimensions fill the viewport,
   *             cropping on the short side. Chosen for ultimate cinematics so
   *             there are no black bars.
   *  - 'contain': fit the whole video inside the viewport, leaving
   *             green/empty bars on the short side.
   */
  fit?: 'cover' | 'contain'
  /**
   * When true, the video stops at its midpoint (the "前半段" half-trim the
   * user asked for in the ultimate cinematic use case). Implemented via a
   * `timeupdate` listener that pauses once currentTime ≥ duration * 0.5.
   * Non-looping — to play the first half on repeat, flip `loop` to true.
   */
  trimFirstHalf?: boolean
  /** Override the loop behaviour. Defaults to true when `trimFirstHalf` is
   *  false, and false when `trimFirstHalf` is true (so the half doesn't glitch
   *  at the cut boundary). */
  loop?: boolean
  /** Distance from the camera the plane is placed at. Larger = more perspective
   *  precision but needs a larger plane scale. Defaults to 2. */
  distance?: number
}

export interface FullscreenVideoHandle extends VideoDisplayHandle {
  /**
   * Remove the fullscreen overlay; the engine goes back to its usual camera
   * behaviour. The handle becomes inert after this call.
   */
  remove(): void
  /** Underlying video element, for callers who want custom control. */
  readonly video: HTMLVideoElement
}

export interface SpriteDisplayHandle {
  remove(): void
  setScale(s: number): void
  setOpacity(o: number): void
  readonly mesh: THREE.Mesh
}

/* ── CharacterOverlayController ─────────────────────────────────── */

export class CharacterOverlayController {
  private engine: IEngine
  private mesh: THREE.Mesh | null = null
  private material: THREE.ShaderMaterial | THREE.MeshBasicMaterial | null = null
  private geometry: THREE.PlaneGeometry | null = null
  private texture: THREE.Texture | null = null
  private video: HTMLVideoElement | null = null
  private aspect = 1
  /**
   * Cleanup callbacks registered by `addVideoFullscreen`. We keep them on the
   * controller (rather than the handle) so `clear()` / `dispose()` still tear
   * everything down even if the caller forgot to call `handle.remove()`.
   */
  private fullscreenCleanups: Array<() => void> = []

  constructor(engine: IEngine) {
    this.engine = engine
  }

  addVideo(videoUrl: string): VideoDisplayHandle {
    this.clear()

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = videoUrl
    video.loop = true
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    this.video = video

    const texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace
    this.texture = texture

    const chromaDefaults: ChromaKeyParams = { ...DEFAULT_CHROMA }

    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        greenHue: { value: chromaDefaults.greenHue },
        greenRange: { value: chromaDefaults.greenRange },
        greenSoft: { value: chromaDefaults.greenSoft },
        greenMinSat: { value: chromaDefaults.greenMinSat },
        whiteEnabled: { value: chromaDefaults.whiteEnabled },
        whiteBright: { value: chromaDefaults.whiteBright },
        whiteMaxSat: { value: chromaDefaults.whiteMaxSat },
        whiteSoft: { value: chromaDefaults.whiteSoft },
        spillStrength: { value: chromaDefaults.spillStrength },
        edgeCrop: { value: chromaDefaults.edgeCrop },
        opacity: { value: 1 },
        brightness: { value: 0 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        tintColor: { value: new THREE.Color('#ffffff') },
        tintStrength: { value: 0 },
      },
      vertexShader: chromaKeyVertexShader,
      fragmentShader: chromaKeyFragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    })
    this.material = material

    const geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry = geometry

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = '__ce_overlay_char__'
    this.mesh = mesh

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        this.aspect = video.videoWidth / video.videoHeight
        const panel = getCharacterRenderPanel()
        if (panel) {
          panel.detach()
          panel.attach(mesh, {
            chromaKey: chromaDefaults,
            externalMaterial: true,
            aspect: this.aspect,
          })
        }
      }
    })
    video.play().catch(() => {})

    this.engine.overlayScene.add(mesh)

    const panel = getCharacterRenderPanel()
    if (panel) {
      panel.attach(mesh, {
        chromaKey: chromaDefaults,
        externalMaterial: true,
        aspect: this.aspect,
      })
    }

    const self = this
    return {
      play() { video.play().catch(() => {}) },
      pause() { video.pause() },
      remove() { self.clear() },
      setScale(s: number) {
        const rp = getCharacterRenderPanel()
        rp?.updateParam('scale', s)
      },
      setOpacity(o: number) {
        const rp = getCharacterRenderPanel()
        rp?.updateParam('opacity', o)
      },
      get mesh() { return mesh },
    }
  }

  /**
   * Play a video that FILLS the scene viewport, as a camera-attached plane.
   *
   * Unlike `addVideo`, this bypasses `CharacterRenderPanel` — there is no
   * scale/position GUI exposed to the user. The plane is parented to the
   * camera, so any user-driven camera orbit keeps the cinematic centred.
   *
   * This is the path used by the "character ultimate" VFX: the user wants a
   * fullscreen cinematic during the ultimate skill, covering ALL of the 3D
   * scene beneath. Optionally we trim the playback to the first half of the
   * clip (the half-trim described in the spec) so a cinematic that has a
   * long wind-down doesn't overstay its welcome.
   *
   * Lifecycle / ownership:
   *  - This method calls `this.clear()` first, so any existing overlay is
   *    removed.
   *  - The caller should call `handle.remove()` when the ultimate finishes
   *    playing. If they forget, `this.clear()` / `this.dispose()` catches it.
   *  - Window resize is wired automatically — the plane re-covers the
   *    viewport whenever the canvas resizes.
   */
  addVideoFullscreen(videoUrl: string, opts: FullscreenVideoOptions = {}): FullscreenVideoHandle {
    this.clear()

    const fit = opts.fit ?? 'cover'
    const distance = opts.distance ?? 2
    const trimFirstHalf = !!opts.trimFirstHalf
    const loop = opts.loop ?? !trimFirstHalf

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = videoUrl
    video.loop = loop
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    this.video = video

    const texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace
    this.texture = texture

    // 大招演出：直接播放原视频，不做任何抠色/后处理。
    //
    // 以前这里挂的是 chromaKey ShaderMaterial（抠绿+抠白+亮度/对比度/tint），
    // 用户明确要求大招不要再抠图——全屏播放原视频本身就是想要「盖住整个场景」
    // 的观感，抠图反而会把视频中心的人物/闪光变透明、露出后面的 3D 场景，
    // 导致演出质感下降。改用最朴素的 MeshBasicMaterial：
    //   - 不透明（opacity:1、transparent:false）——保证完全盖住场景
    //   - depthTest:false、renderOrder 巨大——保证永远在最上层
    //   - 无 alpha 通道，所以 cover 裁切仍然能完美挡住背景
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      toneMapped: false, // 原视频色彩直出，避免 tone map 变灰
    })
    this.material = material

    const geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry = geometry

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = '__ce_overlay_fullscreen_video__'
    mesh.renderOrder = 9999
    mesh.frustumCulled = false
    this.mesh = mesh

    // Parenting to the camera is how we achieve the "always fills what the
    // user sees" effect: the plane translates + rotates with the camera, so
    // it's locked to the viewport no matter what the camera does.
    // The camera itself must be inside a scene for its local transforms to
    // update — Three.js does this automatically when the camera is used in
    // `renderer.render(scene, camera)`, so no extra scene insertion needed.
    this.engine.camera.add(mesh)
    // The overlayScene rendering path only traverses overlayScene children,
    // so we ALSO need to add the mesh to overlayScene. But the mesh can only
    // have one parent — Three.js moves it when calling add. Workaround:
    // put the camera into overlayScene so overlayScene's renderer.render walk
    // picks up the camera's children. We don't want to duplicate the camera;
    // the cleanest path is to just add the mesh to overlayScene and update
    // its world matrix manually each frame from the camera's. That's finicky.
    //
    // Simpler final approach: drop the overlayScene hook entirely. The main
    // scene render in Engine.ts uses the same camera; a camera-attached
    // mesh is rendered by Engine.render() because camera.children traverse
    // happens implicitly through updateMatrixWorld. But Three.js DOES NOT
    // render camera children unless they're also in a rendered scene.
    // So: add the mesh to overlayScene AND parent to camera simultaneously
    // isn't possible. Workaround: render the mesh in overlayScene and
    // manually sync its world transform to "what it would be if attached to
    // the camera". This is implemented in the rAF tick below.
    this.engine.camera.remove(mesh)
    this.engine.overlayScene.add(mesh)

    // Compute plane scale and position to cover the frustum at `distance`.
    const layout = (): void => {
      const cam = this.engine.camera
      const fov = THREE.MathUtils.degToRad(cam.fov)
      const visibleHeight = 2 * distance * Math.tan(fov / 2)
      const visibleWidth = visibleHeight * cam.aspect

      const vA = this.aspect > 0 ? this.aspect : cam.aspect
      let planeW: number
      let planeH: number
      if (fit === 'cover') {
        if (vA > cam.aspect) {
          planeH = visibleHeight
          planeW = visibleHeight * vA
        } else {
          planeW = visibleWidth
          planeH = visibleWidth / vA
        }
      } else {
        if (vA > cam.aspect) {
          planeW = visibleWidth
          planeH = visibleWidth / vA
        } else {
          planeH = visibleHeight
          planeW = visibleHeight * vA
        }
      }

      mesh.scale.set(planeW, planeH, 1)
    }

    const syncToCamera = (): void => {
      const cam = this.engine.camera
      cam.updateMatrixWorld(true)
      // Place the plane `distance` units in front of the camera, facing it.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      mesh.position.copy(cam.position).add(forward.multiplyScalar(distance))
      mesh.quaternion.copy(cam.quaternion)
    }

    const tick = (): void => {
      syncToCamera()
    }
    this.engine.onUpdate(tick)

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        this.aspect = video.videoWidth / video.videoHeight
      }
      layout()
      syncToCamera()
    })

    // Redo the layout any time the canvas size changes (window resize, panel
    // toggles). The engine's resize flow updates camera.aspect synchronously,
    // so a ResizeObserver on the renderer's DOM element is the right trigger.
    const ro = new ResizeObserver(() => layout())
    ro.observe(this.engine.renderer.domElement)

    // Trim to first half, if requested. We attach a `timeupdate` listener
    // rather than using `endedAt = duration/2` + Media Fragments URI, because
    // MediaFragment support is inconsistent across browsers/blob URLs, and
    // because we want the handle's consumer to be able to flip `trim` off at
    // runtime by calling `handle.pause()` themselves.
    const onTimeUpdate = (): void => {
      if (!video.duration || Number.isNaN(video.duration)) return
      const half = video.duration * 0.5
      if (video.currentTime >= half) {
        if (loop) {
          video.currentTime = 0
        } else {
          video.pause()
          video.currentTime = half
        }
      }
    }
    if (trimFirstHalf) {
      video.addEventListener('timeupdate', onTimeUpdate)
    }

    // Kick playback — some browsers block auto-play for video tags without a
    // user gesture. We swallow the error (rendering black is acceptable) and
    // rely on handle.play() as an escape hatch the caller can wire to a
    // user-driven click if needed.
    video.play().catch(() => {})

    const self = this
    const cleanup = (): void => {
      ro.disconnect()
      if (trimFirstHalf) video.removeEventListener('timeupdate', onTimeUpdate)
      self.engine.removeUpdate(tick)
    }
    this.fullscreenCleanups.push(cleanup)

    return {
      play() { video.play().catch(() => {}) },
      pause() { video.pause() },
      remove() {
        cleanup()
        // The normal clear() will dispose geometry/material/texture and
        // unparent the mesh — but only if the controller still considers this
        // mesh to be the "current" one. If another overlay has taken over,
        // our cleanup above was enough and we avoid yanking an unrelated mesh.
        if (self.mesh === mesh) self.clear()
      },
      setScale(_s: number) {
        // Fullscreen plane ignores scale — it's locked to the viewport.
        // Callers (e.g. ScreenEffectsManager) shouldn't call this but we
        // accept it silently to preserve the VideoDisplayHandle contract.
      },
      setOpacity(o: number) {
        // 非常少用（淡入/淡出时调用），需要在 <1 时切到 transparent，
        // 否则 depthWrite:false + 不透明 MeshBasicMaterial 不会读 opacity。
        material.opacity = o
        material.transparent = o < 1
        material.needsUpdate = true
      },
      get mesh() { return mesh },
      get video() { return video },
    }
  }

  addSprite(spriteDataUrl: string): SpriteDisplayHandle {
    this.clear()

    const loader = new THREE.TextureLoader()
    const texture = loader.load(spriteDataUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    this.texture = texture

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    })
    this.material = material

    const geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry = geometry

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = '__ce_overlay_char__'
    this.mesh = mesh

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      this.aspect = img.width / img.height
    }
    img.src = spriteDataUrl

    this.engine.overlayScene.add(mesh)

    const panel = getCharacterRenderPanel()
    if (panel) {
      panel.attach(mesh)
    }

    const self = this
    return {
      remove() { self.clear() },
      setScale(s: number) {
        const rp = getCharacterRenderPanel()
        rp?.updateParam('scale', s)
      },
      setOpacity(o: number) {
        const rp = getCharacterRenderPanel()
        rp?.updateParam('opacity', o)
      },
      get mesh() { return mesh },
    }
  }

  clear() {
    // Any fullscreen overlays must unhook their per-frame callbacks and
    // ResizeObservers BEFORE we nuke the mesh — otherwise `syncToCamera`
    // keeps pointing at a disposed object, which would throw inside the
    // rAF loop.
    const cleanups = this.fullscreenCleanups.splice(0)
    for (const fn of cleanups) {
      try { fn() } catch { /* best-effort teardown */ }
    }

    const panel = getCharacterRenderPanel()
    panel?.detach()

    if (this.mesh) {
      this.engine.overlayScene.remove(this.mesh)
      this.engine.camera.remove(this.mesh)
      this.mesh = null
    }
    if (this.video) {
      this.video.pause()
      this.video.src = ''
      this.video = null
    }
    this.geometry?.dispose()
    this.geometry = null
    if (this.material instanceof THREE.ShaderMaterial) {
      (this.material.uniforms.map?.value as THREE.Texture)?.dispose()
    }
    this.material?.dispose()
    this.material = null
    this.texture?.dispose()
    this.texture = null
  }

  dispose() {
    this.clear()
  }
}

/* ── Singleton accessor ─────────────────────────────────────────── */

let _controller: CharacterOverlayController | null = null

export function getCharacterOverlay(engine: IEngine): CharacterOverlayController {
  if (!_controller) _controller = new CharacterOverlayController(engine)
  return _controller
}

export function disposeCharacterOverlay(): void {
  _controller?.dispose()
  _controller = null
}

/* ── Legacy-compatible convenience functions ─────────────────────── */

export function displayVideoInScene(engine: IEngine, videoUrl: string, _distance?: number): VideoDisplayHandle {
  const ctrl = getCharacterOverlay(engine)
  return ctrl.addVideo(videoUrl)
}

/**
 * Convenience wrapper for the fullscreen-ultimate use case. Defaults match
 * what the user asked for: cover-fit, first-half-only.
 */
export function displayUltimateInScene(
  engine: IEngine,
  videoUrl: string,
  opts: FullscreenVideoOptions = {},
): FullscreenVideoHandle {
  const ctrl = getCharacterOverlay(engine)
  return ctrl.addVideoFullscreen(videoUrl, {
    fit: 'cover',
    trimFirstHalf: true,
    ...opts,
  })
}

export function displaySpriteInScene(engine: IEngine, spriteDataUrl: string, _distance?: number): SpriteDisplayHandle {
  const ctrl = getCharacterOverlay(engine)
  return ctrl.addSprite(spriteDataUrl)
}

export function clearDisplayPlanes(engine: IEngine): void {
  const ctrl = getCharacterOverlay(engine)
  ctrl.clear()
}
