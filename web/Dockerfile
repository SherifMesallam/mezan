# Build stage: compile the Vite app with API URL baked in
FROM node:20-alpine AS builder

WORKDIR /app

# Pass the backend URL at build time (Railway: set as build arg or from env)
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Run stage: serve static files with nginx
FROM nginx:alpine

RUN apk add --no-cache envsubst

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
