const colorMap = {
  cyan:   'badge-ui-cyan',
  blue:   'badge-ui-blue',
  green:  'badge-ui-green',
  red:    'badge-ui-red',
  orange: 'badge-ui-orange',
  purple: 'badge-ui-purple',
  pink:   'badge-ui-pink',
  yellow: 'badge-ui-yellow',
  gray:   'badge-ui-gray',
}

const statusMap = {
  success: 'green',
  warning: 'orange',
  error: 'red',
  info: 'blue',
}

export default function Badge({ children, color = 'cyan', status, dot, size = 'md', className = '' }) {
  const resolvedColor = status ? statusMap[status] : color
  const sizeClass = size === 'sm' ? 'badge-ui-sm' : size === 'lg' ? 'badge-ui-lg' : ''

  return (
    <span className={`badge-ui ${colorMap[resolvedColor] || colorMap.cyan} ${sizeClass} ${className}`}>
      {dot && <span className="badge-ui-dot" />}
      {children}
    </span>
  )
}
