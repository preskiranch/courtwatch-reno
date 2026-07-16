FROM node:22-alpine AS build

WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
RUN npm run build --workspace @courtwatch/exposure-relay

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/exposure-relay/dist ./dist

USER node
CMD ["node", "dist/index.js"]
