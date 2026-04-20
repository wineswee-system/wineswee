import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Serve public/employee-portal/index.html for /employee-portal/ before SPA fallback
function employeePortalPlugin() {
  return {
    name: 'employee-portal-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/employee-portal' || req.url === '/employee-portal/') {
          const filePath = path.resolve('public/employee-portal/index.html')
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'text/html')
            fs.createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [employeePortalPlugin(), react(), tailwindcss()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks — shared libraries split by usage pattern
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['chart.js', 'react-chartjs-2'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-supabase': ['@supabase/supabase-js'],
          // Icon library — used across all modules, loaded once
          'vendor-icons': ['lucide-react'],
        }
      }
    },
    sourcemap: false,
  }
})
