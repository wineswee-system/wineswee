import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getEmployeeById, getEmployeesList } from '../../lib/db'
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
      getEmployeeById(id, orgId),     // 只撈這一個人(完整)
      getEmployeesList(orgId),        // 輕量名單(給主管下拉等用)
      supabase.from('stores').select('id, name, department_id, is_active').eq('is_active', true),
      supabase.from('departments').select('id, name, manager_id').order('id'),
    ]).then(([oneRes, listRes, sRes, dRes]) => {
      setEmployee(oneRes.data || null)
      setEmployees(listRes.data || [])
      setStores(sRes.data || [])
      setDepartments(dRes.data || [])
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
