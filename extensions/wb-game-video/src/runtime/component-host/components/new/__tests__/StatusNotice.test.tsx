// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createCoreSkinRegistry } from '../../index'
import { StatusNotice, StatusNoticeManifest } from '../StatusNotice'

afterEach(cleanup)

describe('StatusNotice', () => {
  it('declares fixed text, a dynamic parameter, and shared appearance inputs', () => {
    expect(StatusNoticeManifest.inputs).toEqual([
      { key: 'fixedText', label: '固定文本', valueType: 'string', default: '获得道具' },
      { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr', default: '〈xxx〉' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
      { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1600 },
    ])
    expect(StatusNoticeManifest.events).toEqual([])
  })

  it('Host resolves numeric parameter; leaf concatenates with duration', () => {
    const skins = createCoreSkinRegistry()
    render(
      <>
        {skins.renderOverlay(
          {
            elementId: 'notice',
            component: 'StatusNotice',
            inputs: { fixedText: '攻击 ', parameter: 12, color: '#ffd54a', durationMs: 2400 },
          },
        )}
      </>,
    )
    expect(screen.getByText('攻击 12')).toHaveStyle({ color: '#ffd54a' })
    expect(screen.getByText('攻击 12').parentElement).toHaveStyle({ '--gv-animation-duration': '2400ms' })
  })

  it('leaf renders already-resolved flat props', () => {
    render(<StatusNotice fixedText="攻击 " parameter="+12" color="#ffd54a" durationMs={2400} />)
    expect(screen.getByText('攻击 +12')).toBeTruthy()
  })
})
