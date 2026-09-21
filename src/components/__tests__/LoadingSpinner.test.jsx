import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoadingSpinner from '../LoadingSpinner'

describe('LoadingSpinner', () => {
  it('SC-08: renders with label text', () => {
    render(<LoadingSpinner message="載入中..." />)
    expect(screen.getByText('載入中...')).toBeInTheDocument()
  })

  it('renders without message', () => {
    const { container } = render(<LoadingSpinner />)
    expect(container.querySelector('[role="status"]')).toBeInTheDocument()
  })

  it('has aria-label for accessibility', () => {
    render(<LoadingSpinner />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading')
  })
})
