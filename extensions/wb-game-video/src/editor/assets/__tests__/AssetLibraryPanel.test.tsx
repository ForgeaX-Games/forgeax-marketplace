import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetLibraryPanel } from '../AssetLibraryPanel'
import type { AssetLibraryController } from '../assetLibraryClient'

function controller(overrides: Partial<AssetLibraryController> = {}): AssetLibraryController {
  return {
    available: true,
    loading: false,
    error: null,
    uploading: null,
    mutating: false,
    items: [
      { id: 'image-1', kind: 'image', name: '封面', mime: 'image/png' },
      { id: 'bgm-1', kind: 'audio', name: '主题曲', mime: 'audio/mpeg' },
    ],
    refresh: vi.fn(async () => {}),
    upload: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('AssetLibraryPanel', () => {
  it('keeps asset kinds in the left tabs and active resources on the right', () => {
    render(<AssetLibraryPanel controller={controller()} />)
    expect(screen.getByRole('navigation', { name: '资产类型' })).toHaveTextContent('图片')
    expect(screen.getByRole('navigation', { name: '资产类型' })).toHaveTextContent('音频')
    expect(screen.getByLabelText('图片资源列表')).toHaveTextContent('封面')
    expect(screen.getByLabelText('上传图片')).toHaveAttribute('accept', '.png,.jpg,.jpeg,.webp,.gif')
    expect(screen.queryByRole('dialog', { name: '资产预览' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /音频 1/ }))
    expect(screen.getByLabelText('BGM资源列表')).toHaveTextContent('主题曲')
    expect(screen.getByLabelText('上传 BGM')).toHaveAttribute('accept', '.mp3,.wav,.ogg,.m4a,.aac')
  })

  it('opens asset details in a dialog from its list thumbnail', () => {
    render(<AssetLibraryPanel controller={controller()} />)

    fireEvent.click(screen.getByRole('button', { name: '查看 封面' }))
    expect(screen.getByRole('dialog', { name: '资产预览' })).toHaveTextContent('封面')

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(screen.queryByRole('dialog', { name: '资产预览' })).toBeNull()
  })

  it('shows the API-unavailable state without claiming the library is empty', () => {
    render(<AssetLibraryPanel controller={controller({ available: false, items: [], error: '图片与 BGM 资源 API 尚未启用' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('尚未启用')
    expect(screen.queryByText(/暂无资产/)).toBeNull()
  })

  it('renames and deletes selected assets through the controller', async () => {
    const api = controller()
    render(<AssetLibraryPanel controller={api} />)
    fireEvent.click(screen.getByRole('button', { name: '重命名 封面' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新封面' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith('image-1', '新封面'))

    fireEvent.click(screen.getByRole('button', { name: /音频 1/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除 主题曲' }))
    expect(screen.getByRole('dialog', { name: '删除资产' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('bgm-1'))
  })
})
