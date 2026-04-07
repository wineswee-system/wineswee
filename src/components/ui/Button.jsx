import { forwardRef } from 'react'

const variants = {
  primary: 'btn-ui btn-ui-primary',
  secondary: 'btn-ui btn-ui-secondary',
  ghost: 'btn-ui btn-ui-ghost',
  danger: 'btn-ui btn-ui-danger',
  success: 'btn-ui btn-ui-success',
}

const sizes = {
  xs: 'btn-ui-xs',
  sm: 'btn-ui-sm',
  md: 'btn-ui-md',
  lg: 'btn-ui-lg',
}

const Button = forwardRef(({ children, variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading, disabled, className = '', ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={`${variants[variant]} ${sizes[size]} ${loading ? 'btn-ui-loading' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="btn-ui-spinner" />}
      {!loading && Icon && <Icon size={size === 'xs' ? 12 : size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
      {!loading && IconRight && <IconRight size={size === 'xs' ? 12 : size === 'sm' ? 14 : 16} />}
    </button>
  )
})

Button.displayName = 'Button'
export default Button
