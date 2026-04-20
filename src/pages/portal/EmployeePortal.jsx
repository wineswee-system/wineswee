export default function EmployeePortal() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      <iframe
        src="/employee-portal/index.html"
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="員工入口"
      />
    </div>
  )
}
