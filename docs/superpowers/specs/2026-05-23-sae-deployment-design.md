# Toonflow SAE 部署改造设计文档

**日期**：2026-05-23  
**状态**：已确认，待实施

---

## 一、目标与范围

### 目标

将 Toonflow（Electron 桌面应用）改造为可在阿里云 SAE 上运行的 Web 服务，同时保持本地 Electron 开发模式不受影响。

### 不在范围内

- 多实例支持（SAE 只跑单实例，避免 SQLite 并发写冲突）
- 用户认证体系改造（保持现有 JWT 方案）
- GitHub Actions CI 流水线（本期只做本地 `docker buildx` 构建跑通）

---

## 二、架构概览

```
SAE 容器
  ├── Express 服务 (:10588)
  │     ├── GET /        → 返回前端 SPA（镜像内 data/web/）
  │     ├── /api/*       → 后端 API 路由
  │     ├── /skills/*    → skills 静态文件（NAS）
  │     └── /assets/*    → assets 静态文件（NAS）
  │
  ├── 镜像内（只读）
  │     ├── /app/data/serve/app.js   ← 编译后的后端
  │     └── /app/data/web/           ← 前端静态产物
  │
  ├── NAS 挂载（读写，持久化）
  │     /mnt/nas/toonflow/
  │     ├── db2.sqlite
  │     ├── assets/
  │     └── skills/
  │
  └── 阿里云 OSS（读写，持久化）
        Bucket: my-toonflow-bucket
        存储：用户上传的媒体文件（原 data/oss/）
        访问：https://my-toonflow-bucket.oss-cn-hangzhou.aliyuncs.com/oss/...
```

---

## 三、需要购买的阿里云产品

| 产品 | 规格建议 | 用途 |
|------|---------|------|
| **NAS 文件存储** | 通用型 NFS，按量付费 | 挂载容器，存 db2.sqlite / assets / skills |
| **OSS 对象存储** | 标准型，按量付费 | 存用户上传的媒体文件 |
| **容器镜像服务 ACR** | 个人版（免费） | 存放 Docker 镜像 |
| VPC/交换机 | 复用已有 | NAS 与 SAE 必须在同一 VPC + 同一可用区 |

---

## 四、代码改动详情

### 4.1 `src/utils/getPath.ts` — 支持 DATA_DIR 环境变量

**改动**：非 Electron 环境下，basePath 优先使用 `DATA_DIR` 环境变量。

```typescript
// 改前
basePath = path.join(process.cwd(), "data");

// 改后
basePath = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
```

**效果**：
- 本地开发：不设 `DATA_DIR`，行为不变（仍用 `./data`）
- SAE 生产：`DATA_DIR=/mnt/nas/toonflow`，所有用户数据（db、assets、skills）写入 NAS

### 4.2 `src/app.ts` — webDir 使用固定路径

**改动**：webDir（前端产物目录）不随 `DATA_DIR` 变化，始终指向镜像内的位置。

```typescript
// 改前
const webDir = u.getPath("web");

// 改后
const webDir = path.join(process.cwd(), "data", "web");
```

**原因**：`data/web/` 是编译产物，打包进镜像，不应该存在 NAS 上。若 NAS 挂载到 `DATA_DIR`，webDir 就应走镜像内路径。

### 4.3 `src/utils/oss.ts` — 对接 ali-oss SDK

**改动**：`OSS` 类的存储后端从本地文件系统改为阿里云 OSS SDK。

**新增依赖**：`ali-oss`（`yarn add ali-oss @types/ali-oss`）

**改动范围**：

| 方法 | 原实现 | 新实现 |
|------|-------|-------|
| `writeFile()` | `fs.writeFile(absPath, buffer)` | `ossClient.put(ossKey, buffer)` |
| `getFile()` | `fs.readFile(absPath)` | `ossClient.get(ossKey)` → buffer |
| `deleteFile()` | `fs.unlink(absPath)` | `ossClient.delete(ossKey)` |
| `deleteDirectory()` | `fs.rm(absPath, recursive)` | 列出前缀下所有 object 并批量删除 |
| `fileExists()` | `fs.stat(absPath)` | `ossClient.head(ossKey)` |
| `getFileUrl()` | 返回 `${ossURL}/oss/relPath` | 直接返回 `${ossURL}/oss/relPath`（不变） |
| `getSmallImageUrl()` | sharp 生成缩略图写本地 | sharp 生成缩略图后写入 OSS |

**OSS 客户端初始化**（读取环境变量）：
```typescript
import OSS from 'ali-oss';

const client = new OSS({
  region: process.env.OSS_REGION!,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
  bucket: process.env.OSS_BUCKET!,
});
```

**兼容本地开发**：若 `OSS_BUCKET` 未设置，退回到本地文件系统模式（保持现有行为）。

### 4.4 `Toonflow-web/src/App.vue` — 非 Electron 时 baseUrl 使用同源地址

**改动**：`getPort()` 的 `catch` 块中设置 baseUrl。

```typescript
// 改前
} catch (error) {}

// 改后
} catch (error) {
  baseUrl.value = window.location.origin + "/api";
}
```

**效果**：部署到 SAE 后，前端自动使用当前域名作为 API 基础地址，无需硬编码。

---

## 五、Dockerfile 重写（多阶段构建）

**构建命令**（在 `Toonflow-app/` 目录下执行）：
```bash
docker buildx build \
  --platform linux/amd64 \
  --build-context web=../Toonflow-web \
  -t registry.cn-hangzhou.aliyuncs.com/your-namespace/toonflow:latest \
  .
```

**Dockerfile 三阶段设计**：

```dockerfile
# Stage 1: 构建前端
FROM node:22-bookworm-slim AS web-builder
WORKDIR /web
RUN npm config set registry https://registry.npmmirror.com/
COPY --from=web . .
RUN yarn install --frozen-lockfile && yarn build

# Stage 2: 构建后端（含 native 模块编译）
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com/
COPY package.json yarn.lock ./
RUN node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const sec of ['dependencies','devDependencies']) {
    if (!pkg[sec]) continue;
    for (const name of ['custom-electron-titlebar','electron','electron-builder','electron-rebuild','electronmon'])
      delete pkg[sec][name];
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# Stage 3: 运行时
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y libvips && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/data/serve ./data/serve
COPY --from=web-builder /web/dist ./data/web
ENV NODE_ENV=prod
ENV PORT=10588
EXPOSE 10588
CMD ["node", "data/serve/app.js"]
```

**注意事项**：
- `build-essential`（python3/make/g++）只在 builder 阶段，运行时不携带
- `libvips` 是 `sharp` 的运行时依赖，需在 runtime 阶段安装
- `better-sqlite3` 和 `sharp` 是 C++ native 模块，必须在 linux/amd64 下编译（`docker buildx --platform linux/amd64`）

---

## 六、SAE 环境变量配置

| 变量名 | 示例值 | 说明 |
|--------|-------|------|
| `NODE_ENV` | `prod` | 生产环境标志 |
| `PORT` | `10588` | 监听端口 |
| `DATA_DIR` | `/mnt/nas/toonflow` | NAS 挂载点（db/assets/skills） |
| `OSS_REGION` | `cn-hangzhou` | 阿里云 OSS 区域 |
| `OSS_BUCKET` | `my-toonflow-bucket` | OSS Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | `xxx` | 阿里云 AccessKey ID（建议用 RAM 角色代替） |
| `OSS_ACCESS_KEY_SECRET` | `xxx` | 阿里云 AccessKey Secret（建议用 RAM 角色代替） |
| `ossURL` | `https://my-toonflow-bucket.oss-cn-hangzhou.aliyuncs.com` | OSS 文件访问基础 URL |

> **安全建议**：`OSS_ACCESS_KEY_ID/SECRET` 建议改用 SAE 绑定 RAM 实例角色，避免密钥泄漏风险。

---

## 七、SAE 配置要点（不涉及代码）

1. **NAS 挂载**：控制台 → SAE 应用 → 存储 → NAS，挂载路径填 `/mnt/nas/toonflow`
2. **SAE 与 NAS 同 VPC + 同可用区**：否则挂载失败
3. **SAE 实例数**：设为 1（SQLite 不支持多写并发）
4. **健康检查**：HTTP GET `http://localhost:10588/api/login/login`（白名单路径，无需 token）
5. **端口**：10588

---

## 八、本地验证步骤（镜像构建后）

```bash
# 1. 构建镜像
docker buildx build --platform linux/amd64 --build-context web=../Toonflow-web -t toonflow:test .

# 2. 本地运行（不挂 NAS，验证基本启动）
docker run --rm -p 10588:10588 \
  -e NODE_ENV=prod \
  -e PORT=10588 \
  -e OSS_REGION=cn-hangzhou \
  -e OSS_BUCKET=my-bucket \
  -e OSS_ACCESS_KEY_ID=xxx \
  -e OSS_ACCESS_KEY_SECRET=xxx \
  -e ossURL=https://my-bucket.oss-cn-hangzhou.aliyuncs.com \
  toonflow:test

# 3. 访问 http://localhost:10588，验证前端加载
# 4. 登录后测试文件上传，验证 OSS 写入
```
