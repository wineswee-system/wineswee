import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getEmployees } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmployeeDetail from '../../components/EmployeeDetail'

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [employee, setEmployee] = useState(null)
  const [employees, setEmployees] = useState([])
  const [stores, setStores] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const orgId = profile?.organization_id
    Promise.all([
      getEmployees(orgId),
      supabase.from('stores').select('id, name, department_id, is_active').eq('is_active', true),
      supabase.from('departments').select('id, name, manager_id').order('id'),
    ]).then(([eRes, sRes, dRes]) => {
      const emps = eRes.data || []
      setEmployees(emps)
      setStores(sRes.data || [])
      setDepartments(dRes.data || [])
      setEmployee(emps.find(e => String(e.id) === String(id)) || null)
    }).finally(() => setLoading(false))
  }, [id, profile?.organization_id])

  if (loading) return <LoadingSpinner />
  if (!employee) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: 'var(--text-muted)', marginBottom: 12 }}>找不到員工資料</div>
        <button className="btn btn-primary" onClick={() => navigate('/org/employees')}>
          <ArrowLeft size={14} /> 回員工列表
        </button>
      </div>
    )
  }

  return (
    <div className="fade-in">
      {/* Top bar：返回 */}
      <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/org/employees')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} /> 回員工列表
        </button>
      </div>

      <EmployeeDetail
        employee={employee}
        employees={employees}
        stores={stores}
        departments={departments}
        onUpdate={(updated) => {
          setEmployee(updated)
          setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e))
        }}
        onClose={() => navigate('/org/employees')}
      />
    </div>
  )
}
