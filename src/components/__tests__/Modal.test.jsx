import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal, { Field } from '../Modal'

describe('Modal', () => {
  const defaultProps = {
    title: '測試對話框',
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  }

  it('SC-01: renders with title and buttons', () => {
    render(<Modal {...defaultProps}><p>Content</p></Modal>)
    expect(screen.getByText('測試對話框')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
    expect(screen.getByText('儲存')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('SC-01: closes on Escape key', () => {
    const onClose = vi.fn()
    render(<Modal {...defaultProps} onClose={onClose}><p>Test</p></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('SC-01: closes on backdrop click', () => {
    const onClose = vi.fn()
    const { container } = render(<Modal {...defaultProps} onClose={onClose}><p>Test</p></Modal>)
    // Modal uses onMouseDown on the overlay, not onClick
    const overlay = container.firstChild
    fireEvent.mouseDown(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on dialog body click', () => {
    const onClose = vi.fn()
    render(<Modal {...defaultProps} onClose={onClose}><p>Inner</p></Modal>)
    fireEvent.click(screen.getByText('Inner'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('SC-03: fires onSubmit callback', () => {
    const onSubmit = vi.fn()
    render(<Modal {...defaultProps} onSubmit={onSubmit}><p>Test</p></Modal>)
    fireEvent.click(screen.getByText('儲存'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('uses custom submit label', () => {
    render(<Modal {...defaultProps} submitLabel="確認送出"><p>Test</p></Modal>)
    expect(screen.getByText('確認送出')).toBeInTheDocument()
  })

  it('has correct ARIA attributes', () => {
    render(<Modal {...defaultProps}><p>Test</p></Modal>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', '測試對話框')
  })

  it('closes via X button', () => {
    const onClose = vi.fn()
    render(<Modal {...defaultProps} onClose={onClose}><p>Test</p></Modal>)
    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Field', () => {
  it('renders label and children', () => {
    render(<Field label="名稱"><input type="text" /></Field>)
    expect(screen.getByText('名稱')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
