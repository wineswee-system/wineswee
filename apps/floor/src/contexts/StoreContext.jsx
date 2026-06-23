import { createContext, useContext, useEffect, useState } from 'react'
import { getStores } from '../lib/db'

const StoreCtx = createContext(null)

export function StoreProvider({ children }) {
  const [stores, setStores] = useState([])
  const [storeId, setStoreIdState] = useState(
    () => localStorage.getItem('floor_store_id') || ''
  )

  useEffect(() => {
    getStores().then(({ data }) => {
      if (!data?.length) return
      setStores(data)
      if (!storeId || !data.find(s => s.id === storeId)) {
        setStoreIdState(data[0].id)
        localStorage.setItem('floor_store_id', data[0].id)
      }
    })
  }, [])

  function setStoreId(id) {
    localStorage.setItem('floor_store_id', id)
    setStoreIdState(id)
  }

  return (
    <StoreCtx.Provider value={{ stores, storeId, setStoreId }}>
      {children}
    </StoreCtx.Provider>
  )
}

export const useStore = () => useContext(StoreCtx)
