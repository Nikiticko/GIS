FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run api:build
RUN npm prune --omit=dev

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 ATTACHMENTS_DIR=/app/data/attachments
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist-api ./dist-api
COPY --from=build /app/server/migrations ./server/migrations
RUN chmod -R a+rX /app/server/migrations
COPY --from=build /app/server/load-env.mjs ./server/load-env.mjs
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
CMD ["node", "dist-api/index.js"]

FROM caddy:2-alpine AS web
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
