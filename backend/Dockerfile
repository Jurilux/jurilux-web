# LexKYC API — image de production (monolithe modulaire, § D.6)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --include-workspace-root
COPY backend backend
RUN npm run prisma:generate -w backend && npm run build -w backend

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace backend --include-workspace-root --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/generated backend/generated
COPY backend/prisma backend/prisma
COPY backend/config backend/config
# prisma CLI nécessaire pour `migrate deploy` au démarrage
RUN npm install --no-save prisma@6 --workspace backend || npm install --no-save prisma@6
USER node
WORKDIR /app/backend
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
