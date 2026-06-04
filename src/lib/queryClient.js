import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 5 min — matches Supabase auth cache TTL
      gcTime:    10 * 60 * 1000,  // 10 min — keep unused data a bit longer
      retry: 1,
      refetchOnWindowFocus: false, // ERP app — no need for bg refetch on tab switch
    },
  },
})
