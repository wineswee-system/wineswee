import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatCard from '../ui/StatCard'
import { Users } from 'lucide-react'

describe('StatCard', () => {
  it('SC-13: renders icon, value, and label', () => {
    render(<StatCard icon={Users} label="員工數" value="42" color="cyan" />)
    expect(screen.getByText('員工數')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders trend badge when provided', () => {
    render(<StatCard icon={Users} label="營收" value="$100K" trend="up" trendValue="12%" />)
    expect(screen.getByText(/12%/)).toBeInTheDocument()
    expect(screen.getByText(/↑/)).toBeInTheDocument()
  })

  it('renders down trend', () => {
    render(<StatCard icon={Users} label="支出" value="$50K" trend="down" trendValue="5%" />)
    expect(screen.getByText(/↓/)).toBeInTheDocument()
  })

  it('renders without icon', () => {
    render(<StatCard label="Test" value="123" />)
    expect(screen.getByText('123')).toBeInTheDocument()
  })

  it('defaults to cyan color', () => {
    const { container } = render(<StatCard label="Test" value="1" />)
    expect(container.querySelector('.text-cyan-500')).toBeInTheDocument()
  })
})
