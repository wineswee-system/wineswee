# Stage 1: Build the React application
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Copy application source
COPY . .

# Set build-time env vars (Vite inlines VITE_* at build time)
ENV VITE_SUPABASE_URL=https://mvkvnuxeamahhfahclmi.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo
ENV VITE_LIFF_ID=2009642363-lqpzLwFk
ENV VITE_GEMINI_API_KEY=AIzaSyCdrim5xpvSVrhGVCwGbRoEbdOHk016P-k

# Build the application
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine
# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Copy static assets from builder stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port (Cloud Run expects 8080 by default)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
