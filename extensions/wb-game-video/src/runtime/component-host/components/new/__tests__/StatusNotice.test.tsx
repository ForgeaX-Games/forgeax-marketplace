import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusNotice, StatusNoticeManifest } from '../StatusNotice'

afterEach(cleanup)

describe('StatusNotice', () => {
  it('declares a complete notice message and shared appearance inputs', () => {
    expect(StatusNoticeManifest.inputs).toEqual([
      { key: 'text', label: '提示文字', valueType: 'string', default: '获得道具〈xxx〉' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
      { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
      { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1600 },
    ])
    expect(StatusNoticeManifest.events).toEqual([])
  })

  it('renders arbitrary result text using the configured duration', () => {
    render(
      <StatusNotice
        overlay={{ elementId: 'notice', component: 'StatusNotice', inputs: { text: '攻击 +12', color: '#ffd54a', durationMs: 2400 } }}
      />,
    )
    expect(screen.getByText('攻击 +12')).toHaveStyle({ color: '#ffd54a' })
    expect(screen.getByText('攻击 +12').parentElement).toHaveStyle({ '--gv-animation-duration': '2400ms' })
  })
})
