import { useEffect, useMemo, useState } from 'react'
import {
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  useAssetLibrary,
} from './assetLibraryClient'
import { assetEntries, type AssetListEntry, type BrowserAsset } from './asset-entries'
import { useAssetDirectory } from './asset-directory'
import { loadProjectComponentAssets, type ProjectComponentAsset } from './project-component-assets'
import { fetchRegistryAssets } from './registry-assets'

const kinoAssetLibraryClient = createKinoAssetLibraryClient()

export function useAssetBrowser(gameId: string, client: AssetLibraryClient = kinoAssetLibraryClient): {
  entries: AssetListEntry[]
  controller: ReturnType<typeof useAssetLibrary>
  directory: ReturnType<typeof useAssetDirectory>
  videoAssets: BrowserAsset[]
  projectComponents: ProjectComponentAsset[]
} {
  const controller = useAssetLibrary(gameId, client)
  const directory = useAssetDirectory(gameId)
  const [videoAssets, setVideoAssets] = useState<BrowserAsset[]>([])
  const [projectComponents, setProjectComponents] = useState<ProjectComponentAsset[]>([])

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const loadVideos = async (): Promise<void> => {
      try {
        const assets = await fetchRegistryAssets(gameId, 'video')
        if (!active) return
        setVideoAssets(assets.map((asset) => ({
          id: asset.id,
          kind: 'video',
          name: asset.label ?? asset.id,
          url: asset.url,
          mime: asset.mime,
          bytes: asset.bytes,
          readOnly: true,
        })))
      } catch {
        // 左 pane 在 Workbench 握手前挂载时 extension.fetch 会暂不可用；不要把
        // 已显示的列表清空，等宿主上下文就绪后再试。
        if (active && attempts++ < 15) retryTimer = setTimeout(() => void loadVideos(), 300)
      }
    }
    void loadVideos()
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [gameId])

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const loadComponents = async (): Promise<void> => {
      const components = await loadProjectComponentAssets()
      if (!active) return
      setProjectComponents(components)
      // importProjectComponentModule 在握手前会降级为 []；有限重试覆盖左右
      // iframe 的不同挂载时序，同时不会持续轮询一个确实没有项目控件的游戏。
      if (components.length === 0 && attempts++ < 15) {
        retryTimer = setTimeout(() => void loadComponents(), 300)
      }
    }
    void loadComponents()
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [gameId])

  return {
    entries: useMemo(
      () => assetEntries(controller.items, videoAssets, projectComponents),
      [controller.items, projectComponents, videoAssets],
    ),
    controller,
    directory,
    videoAssets,
    projectComponents,
  }
}
