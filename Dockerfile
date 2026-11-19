# ---------- Etapa 1: compilar ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- Etapa 2: imagen final liviana ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Solo lo necesario para correr: sin código fuente ni herramientas de desarrollo
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# No correr como root dentro del contenedor
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
