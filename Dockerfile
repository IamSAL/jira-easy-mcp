FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# keytar (OS keychain) is optional and a container has no keychain to read
RUN pnpm install --prod --frozen-lockfile --no-optional --ignore-scripts && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
