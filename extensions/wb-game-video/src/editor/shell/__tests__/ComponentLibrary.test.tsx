// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ComponentLibrary } from '../ComponentLibrary'

afterEach(cleanup)

describe('ComponentLibrary', () => {
  it('renders only the ten new-spec components', () => {
    render(<ComponentLibrary />)

    expect(screen.getByText('组件库（10）')).toBeTruthy()
    expect(screen.getAllByTitle(/^拖到画布添加：/)).toHaveLength(10)
    expect(screen.queryByText('转场')).toBeNull()
    expect(screen.queryByText('水墨血条')).toBeNull()
  })
})
