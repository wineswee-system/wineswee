import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 5 min — matches Supabase auth cache TTL
      gcTime:    10 * 60 * 1000,  // 10 min — keep unused data a bit longer
      // Retry up to 3× on 5xx/network errors; never retry 4xx (auth, not-found, etc.)
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false
        const status = error?.status
        if (status && status >= 400 && status < 500) return false
        return true
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 15000),
      refetchOnWindowFocus: false, // ERP app — no need for bg refetch on tab switch
    },
  },
})
