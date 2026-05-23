# syntax=docker/dockerfile:1

# ── Stage 1: 构建前端 ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web-builder
WORKDIR /web
RUN npm install -g yarn@1.22.22 && \
    npm config set registry https://registry.npmmirror.com/ && \
    yarn config set registry https://registry.npmmirror.com/
# 从 named build context "web" 复制前端源码（见 docker buildx --build-context）
COPY --from=web . .
RUN yarn install --frozen-lockfile && \
    yarn build && \
    yarn cache clean

# ── Stage 2: 构建后端 ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# build-essential + python3 供 better-sqlite3/sharp native 模块编译
RUN apt-get update && \
    apt-get install -y build-essential python3 && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g yarn@1.22.22 && \
    npm config set registry https://registry.npmmirror.com/ && \
    yarn config set registry https://registry.npmmirror.com/
# 先复制依赖文件，利用 Docker 层缓存
COPY package.json yarn.lock ./
# 删除 Electron 专属包，避免下载桌面端二进制
RUN node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const remove = ['custom-electron-titlebar','electron','electron-builder','electron-rebuild','electronmon'];
  for (const section of ['dependencies','devDependencies']) {
    if (!pkg[section]) continue;
    for (const name of remove) delete pkg[section][name];
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
RUN yarn install --frozen-lockfile && yarn cache clean
# 复制源码并构建（esbuild 打包 src/app.ts -> data/serve/app.js）
COPY . .
RUN yarn build

# ── Stage 3: 运行时 ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# 从 builder 复制 node_modules（含 better-sqlite3/sharp native 二进制）和编译产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/data/serve ./data/serve
# 从 web-builder 复制前端产物（viteSingleFile 输出为单个 index.html）
COPY --from=web-builder /web/dist ./data/web
ENV NODE_ENV=prod
ENV PORT=10588
EXPOSE 10588
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10588/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "data/serve/app.js"]