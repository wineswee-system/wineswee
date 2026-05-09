// 內嵌型小 spinner，給 button / inline 用
// 想用全頁版的，請用 LoadingSpinner.jsx
export default function Spinner({ size = 14, color = 'currentColor' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `${Math.max(2, Math.round(size / 8))}px solid transparent`,
        borderTopColor: color,
        borderRightColor: color,
        borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
        verticalAlign: 'middle',
      }}
    />
  )
}
