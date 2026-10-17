import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageSurface } from './ImageSurface'
import { Editor } from './Editor'
import type { Asset, Rect } from '../domain'

const asset: Asset = { hash: 'image', blob: new Blob(['x']), width: 1000, height: 600, mimeType: 'image/webp' }
const regions: Rect[] = [
  { id: 'target', x: .1, y: .2, width: .2, height: .1 },
  { id: 'other', x: .4, y: .5, width: .2, height: .2 },
]
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

describe('review occlusion semantics', () => {
  it('shows only the current mask question and treats label content as plain text', () => {
    const question = '<b>Welche Struktur?</b>'
    const labelled = regions.map((r, i) => ({ ...r, label: i === 0 ? question : 'Andere Frage' }))
    const { rerender } = render(<ImageSurface asset={asset} regions={labelled} targetId="target" />)
    expect(screen.getByTestId('target-mask')).toHaveTextContent(question)
    expect(screen.getByTestId('target-mask').querySelector('b')).toBeNull()
    expect(screen.queryByText('Andere Frage')).not.toBeInTheDocument()
    rerender(<ImageSurface asset={asset} regions={labelled} targetId="target" revealed />)
    expect(screen.queryByText(question)).not.toBeInTheDocument()
    expect(screen.queryByText('Andere Frage')).not.toBeInTheDocument()
  })
  it('hides all targets initially and uncovers only the requested answer', () => {
    const { rerender } = render(<ImageSurface asset={asset} regions={regions} targetId="target" />)
    expect(screen.getByTestId('target-mask')).toHaveStyle({ left: '10%', top: '20%', width: '20%', height: '10%' })
    expect(screen.getAllByTestId('occlusion-mask')).toHaveLength(1)
    rerender(<ImageSurface asset={asset} regions={regions} targetId="target" revealed />)
    expect(screen.queryByTestId('target-mask')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('occlusion-mask')).toHaveLength(1)
  })
})
describe('editor interaction', () => {
  it('removes a mask and allows undo before saving', async () => {
    const user = userEvent.setup()
    render(<Editor draft={{ asset, regions, deckId: 'd' }} decks={[{ id: 'd', parentId: null, name: 'Studium', createdAt: 0, updatedAt: 0 }]} onClose={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: '2 Karten speichern' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Maske 1 löschen' }))
    expect(screen.getByRole('button', { name: '1 Karte speichern' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(screen.getByRole('button', { name: '2 Karten speichern' })).toBeEnabled()
    expect(screen.getAllByTestId('occlusion-mask')).toHaveLength(2)
  })
})
