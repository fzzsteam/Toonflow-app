# SAE Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Toonflow Express 后端改造为可在阿里云 SAE 上运行的生产级 Web 服务，SQLite 存 NAS，用户媒体文件存阿里云 OSS。

**Architecture:** `getPath.ts` 新增 `DATA_DIR` 环境变量控制用户数据目录（db/assets/skills 指向 NAS）；`oss.ts` 完全重写，当 `OSS_BUCKET` 环境变量存在时使用 ali-oss SDK 存取媒体文件（含签名 URL 鉴权），否则退回本地文件系统（开发模式不变）；`app.ts` 补充 `/api/health` 端点、可配置 CORS、条件挂载 `/oss` 静态路由；Dockerfile 用三阶段多阶段构建（前端 → 后端 → 运行时），用 named build context 引入 Toonflow-web。

**Tech Stack:** Node.js 22, Express, TypeScript (esbuild bundle), ali-oss SDK, better-sqlite3, sharp, Docker BuildKit (buildx), 阿里云 SAE / NAS / OSS

---

## 文件索引

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/getPath.ts` | 修改 | 新增 DATA_DIR 支持，path.resolve 保证绝对路径 |
| `src/app.ts` | 修改 | 添加 /api/health，修复 webDir，条件 /oss，可配置 CORS |
| `src/utils/oss.ts` | 重写 | ali-oss SDK 模式 + 本地 fs 模式双重实现 |
| `Toonflow-web/src/App.vue` | 修改 | getPort() catch 块补充 baseUrl 赋值 |
| `Dockerfile` | 重写 | 三阶段多阶段构建 |
| `Toonflow-web/.dockerignore` | 新建 | 排除 node_modules/dist 避免构建上下文臃肿 |

---

## Task 1: 添加 GET /api/health 端点

**Files:**
- Modify: `src/app.ts`

**背景：** SAE 健康检查要求一个 GET 端点返回 200，且必须绕过 JWT 鉴权。`/api/login/login` 大概率是 POST 接口，用 GET 探测会得到 404，导致实例被反复重启。

- [ ] **Step 1: 找到 `src/app.ts` 中 JWT 中间件注册位置**

打开 `src/app.ts`，定位第 100 行附近的 `app.use(async (req, res, next) => {` 块（JWT 鉴权中间件）。

- [ ] **Step 2: 在 JWT 中间件之前注册 /api/health 路由**

在 `app.ts` 第 100 行（`app.use(async (req, res, next)` 那一行）**之前**插入：

```typescript
// 健康检查（无需鉴权，SAE 探活用）
app.get("/api/health", (_, res) => {
  res.json({ status: "ok" });
});
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn lint
```

期望输出：无错误（或只有已有的既存警告）

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat: add GET /api/health endpoint for SAE health check"
```

---

## Task 2: 使 CORS 可通过环境变量配置

**Files:**
- Modify: `src/app.ts`

**背景：** 当前 `cors({ origin: "*" })` 对 Web 部署不安全，任意第三方站点可发跨域请求。生产环境应限制为实际部署域名。本地开发和 Electron 保持 `*`。

- [ ] **Step 1: 修改 `src/app.ts` 中的 cors 配置**

找到 `src/app.ts` 中以下两处 `origin: "*"` 的代码：

```typescript
// 第 49 行附近（Socket.IO）
const io = new Server(server, { cors: { origin: "*" } });

// 第 57 行附近（Express）
app.use(cors({ origin: "*" }));
```

将这两处改为：

```typescript
// 第 49 行附近（Socket.IO）
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
const io = new Server(server, { cors: { origin: corsOrigin } });

// 第 57 行附近（Express）
app.use(cors({ origin: corsOrigin }));
```

注意：`const corsOrigin` 只声明一次，放在两处引用之前。

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn lint
```

期望：无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: make CORS origin configurable via CORS_ORIGIN env var"
```

---

## Task 3: 修复 `src/utils/getPath.ts` — DATA_DIR 支持

**Files:**
- Modify: `src/utils/getPath.ts`

**背景：** 当前非 Electron 时，所有数据路径都指向 `process.cwd()/data`。改为优先读取 `DATA_DIR` 环境变量，指向 NAS 挂载点。需要 `path.resolve()` 保证 DATA_DIR 是绝对路径（防止攻击者注入相对路径破坏 `isPathInside` 防护）。

- [ ] **Step 1: 读取当前 getPath.ts**

打开 `src/utils/getPath.ts`，找到第 6-9 行：

```typescript
  } else {
    basePath = path.join(process.cwd(), "data");
  }
```

- [ ] **Step 2: 修改非 Electron 分支**

将上述 else 分支改为：

```typescript
  } else {
    basePath = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
  }
```

`path.resolve()` 保证：若 `DATA_DIR` 是绝对路径（如 `/mnt/nas/toonflow`），直接使用；若未设置，则 `path.join(process.cwd(), "data")` 的结果已是绝对路径，`path.resolve` 原样返回。

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn lint
```

期望：无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/utils/getPath.ts
git commit -m "feat: support DATA_DIR env var in getPath, enforce absolute path via resolve"
```

---

## Task 4: 修复 `src/app.ts` — webDir 与 /oss 路由

**Files:**
- Modify: `src/app.ts`

**背景：** 
1. `webDir` 目前用 `u.getPath("web")`，设了 `DATA_DIR` 后会指向 NAS（NAS 上没有前端产物），导致前端白屏。改为硬编码 `process.cwd()/data/web`（镜像内固定路径）。
2. `/oss` 静态路由在 ali-oss 模式下无意义（文件不在本地），应条件挂载，避免徒劳检查空目录。

- [ ] **Step 1: 修复 webDir**

在 `src/app.ts` 找到：

```typescript
  // data/web 静态网站
  const webDir = u.getPath("web");
```

改为：

```typescript
  // data/web 静态网站（编译产物在镜像内，不随 DATA_DIR 变化）
  const webDir = path.join(process.cwd(), "data", "web");
```

- [ ] **Step 2: 条件挂载 /oss 静态路由**

找到：

```typescript
  // oss 静态资源
  const ossDir = u.getPath("oss");
  if (!fs.existsSync(ossDir)) {
    fs.mkdirSync(ossDir, { recursive: true });
  }
  console.log("文件目录:", ossDir);
  app.use("/oss", express.static(ossDir, { acceptRanges: false }));
```

改为：

```typescript
  // oss 静态资源（OSS_BUCKET 已设置时文件存阿里云 OSS，无需本地静态服务）
  if (!process.env.OSS_BUCKET) {
    const ossDir = u.getPath("oss");
    if (!fs.existsSync(ossDir)) {
      fs.mkdirSync(ossDir, { recursive: true });
    }
    console.log("文件目录:", ossDir);
    app.use("/oss", express.static(ossDir, { acceptRanges: false }));
  }
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn lint
```

期望：无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "fix: webDir use fixed image path, conditionally mount /oss static route"
```

---

## Task 5: 安装 ali-oss SDK

**Files:**
- Modify: `package.json`, `yarn.lock`（自动更新）

- [ ] **Step 1: 安装 ali-oss**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn add ali-oss
yarn add -D @types/ali-oss
```

- [ ] **Step 2: 验证安装成功**

```bash
node -e "require('ali-oss'); console.log('ali-oss OK')"
```

期望输出：`ali-oss OK`

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "deps: add ali-oss SDK"
```

---

## Task 6: 重写 `src/utils/oss.ts` — ali-oss 双模式实现

**Files:**
- Rewrite: `src/utils/oss.ts`

**背景：** 当 `OSS_BUCKET` 环境变量存在时，所有文件操作走 ali-oss SDK（生产模式）；否则走本地文件系统（开发/Electron 模式，行为与原代码完全一致）。签名 URL（1小时有效期）用于文件访问鉴权，保持 Bucket 私有。`getImageBase64` 和 `getSmallImageUrl` 也需要走 ali-oss 路径。

- [ ] **Step 1: 完整替换 `src/utils/oss.ts` 内容**

用以下内容完整替换 `src/utils/oss.ts`：

```typescript
import isPathInside from "is-path-inside";
import getPath, { isEletron } from "@/utils/getPath";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import AliOSS from "ali-oss";

function normalizeUserPath(userPath: string): string {
  const trimmedPath = userPath.replace(/^[/\\]+/, "");
  return trimmedPath.split("/").join(path.sep);
}

function resolveSafeLocalPath(userPath: string, rootDir: string): string {
  const safePath = normalizeUserPath(userPath);
  const absPath = path.join(rootDir, safePath);
  if (!isPathInside(absPath, rootDir)) {
    throw new Error(`${userPath} 不在 OSS 根目录内`);
  }
  return absPath;
}

// 将相对路径转换为 OSS object key，例如 "abc/img.jpg" -> "oss/abc/img.jpg"
function toOssKey(relPath: string, prefix = "oss"): string {
  return `${prefix}/${normalizeUserPath(relPath).split(path.sep).join("/")}`;
}

class OSS {
  private useAliOss: boolean;
  private client?: AliOSS;
  private rootDir: string;
  private initPromise: Promise<void>;

  constructor() {
    this.useAliOss = !!process.env.OSS_BUCKET;
    if (this.useAliOss) {
      this.client = new AliOSS({
        region: process.env.OSS_REGION!,
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
        bucket: process.env.OSS_BUCKET!,
      });
      this.rootDir = "";
      this.initPromise = Promise.resolve();
    } else {
      this.rootDir = getPath("oss");
      this.initPromise = fs.mkdir(this.rootDir, { recursive: true }).then(() => {});
    }
  }

  private async ensureInit() {
    await this.initPromise;
  }

  /**
   * 返回文件访问 URL。
   * ali-oss 模式：返回 1 小时有效的签名 URL（Bucket 保持私有）。
   * 本地模式：与原实现相同。
   */
  async getFileUrl(userRelPath: string, prefix?: string): Promise<string> {
    if (!prefix) prefix = "oss";
    if (this.useAliOss) {
      const key = toOssKey(userRelPath, prefix);
      return this.client!.signatureUrl(key, { expires: 3600, method: "GET" });
    }
    await this.ensureInit();
    const safePath = normalizeUserPath(userRelPath);
    let url = `/${prefix}/`;
    if (process.env.ossURL && process.env.ossURL !== "") url = process.env.ossURL + `/${prefix}/`;
    if (process.env.NODE_ENV == "dev") url = `http://localhost:10588/${prefix}/`;
    if (isEletron()) url = `http://localhost:${process.env.PORT}/${prefix}/`;
    return `${url}${safePath.split(path.sep).join("/")}`;
  }

  /**
   * 读取文件内容为 Buffer。
   */
  async getFile(userRelPath: string): Promise<Buffer> {
    if (this.useAliOss) {
      const key = toOssKey(userRelPath);
      const result = await this.client!.get(key);
      return result.content as Buffer;
    }
    await this.ensureInit();
    return fs.readFile(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  /**
   * 读取图片文件并转换为 base64 Data URL。
   */
  async getImageBase64(userRelPath: string): Promise<string> {
    const ext = path.extname(userRelPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
    };
    const mimeType = mimeTypes[ext];
    if (!mimeType) {
      throw new Error(`不支持的图片格式: ${ext}。支持的格式: ${Object.keys(mimeTypes).join(", ")}`);
    }
    const data = await this.getFile(userRelPath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  }

  /**
   * 删除指定路径的文件。
   */
  async deleteFile(userRelPath: string): Promise<void> {
    if (this.useAliOss) {
      await this.client!.delete(toOssKey(userRelPath));
      return;
    }
    await this.ensureInit();
    await fs.unlink(resolveSafeLocalPath(userRelPath, this.rootDir));
  }

  /**
   * 删除指定路径的目录及其所有内容。
   * ali-oss 模式：列出该前缀下所有 object 并批量删除。
   */
  async deleteDirectory(userRelPath: string): Promise<void> {
    if (this.useAliOss) {
      const prefix = toOssKey(userRelPath) + "/";
      let marker: string | undefined;
      do {
        const result = await this.client!.list({ prefix, "max-keys": 1000, marker }, {});
        const objects: AliOSS.ObjectMeta[] = result.objects || [];
        if (objects.length > 0) {
          await this.client!.deleteMulti(objects.map((o) => o.name));
        }
        marker = result.nextMarker;
      } while (marker);
      return;
    }
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) {
      throw new Error(`${userRelPath} 不是文件夹`);
    }
    await fs.rm(absPath, { recursive: true, force: true });
  }

  /**
   * 将数据写入文件（已存在则覆盖）。
   * string 参数视为 base64，自动去除 Data URL 前缀。
   */
  async writeFile(userRelPath: string, data: Buffer | string): Promise<void> {
    const buffer =
      typeof data === "string"
        ? Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64")
        : data;
    if (this.useAliOss) {
      await this.client!.put(toOssKey(userRelPath), buffer);
      return;
    }
    await this.ensureInit();
    const absPath = resolveSafeLocalPath(userRelPath, this.rootDir);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
  }

  /**
   * 检查文件是否存在。
   */
  async fileExists(userRelPath: string): Promise<boolean> {
    if (this.useAliOss) {
      try {
        await this.client!.head(toOssKey(userRelPath));
        return true;
      } catch {
        return false;
      }
    }
    await this.ensureInit();
    try {
      const stat = await fs.stat(resolveSafeLocalPath(userRelPath, this.rootDir));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 获取图片缩略图 URL（最长边不超过 512px）。
   * 缩略图路径：smallImage/{relPath}。
   * ali-oss 模式：从 OSS 拉取原图，sharp 生成缩略图后上传 OSS。
   * 本地模式：与原实现相同，sharp 读写本地文件。
   */
  async getSmallImageUrl(userRelPath: string): Promise<string> {
    const smallImageRelPath = `smallImage/${userRelPath.replace(/^[/\\]+/, "")}`;

    if (await this.fileExists(smallImageRelPath)) {
      return this.getFileUrl(smallImageRelPath);
    }

    const originalUrl = await this.getFileUrl(userRelPath);

    try {
      let srcBuffer: Buffer;
      if (this.useAliOss) {
        const result = await this.client!.get(toOssKey(userRelPath));
        srcBuffer = result.content as Buffer;
      } else {
        await this.ensureInit();
        const srcAbsPath = resolveSafeLocalPath(userRelPath, this.rootDir);
        srcBuffer = await fs.readFile(srcAbsPath);
      }

      const thumbBuffer = await sharp(srcBuffer)
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .toBuffer();

      await this.writeFile(smallImageRelPath, thumbBuffer);
      console.info(`[OSS] 缩略图生成成功: ${smallImageRelPath}`);
      return this.getFileUrl(smallImageRelPath);
    } catch (e) {
      console.warn("[OSS] 生成缩略图失败:", e);
      return originalUrl;
    }
  }
}

export default new OSS();
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
yarn lint
```

期望：无新增错误。若 `@types/ali-oss` 类型有不兼容处，检查 `ali-oss` 版本对应的类型定义，按实际类型调整。

- [ ] **Step 3: Commit**

```bash
git add src/utils/oss.ts
git commit -m "feat: rewrite oss.ts with ali-oss SDK backend + local fs fallback"
```

---

## Task 7: 修复 `Toonflow-web/src/App.vue` — baseUrl 同源回退

**Files:**
- Modify: `Toonflow-web/src/App.vue`

**背景：** 非 Electron 环境中，`fetch("toonflow://getAppUrl")` 会抛出异常，当前 catch 块为空，`baseUrl` 保留 Pinia store 的默认值 `http://localhost:10588/api`（硬编码）。部署到 SAE 后域名变了，API 调用全部失败。

- [ ] **Step 1: 修改 App.vue 的 getPort catch 块**

打开 `Toonflow-web/src/App.vue`，找到第 78 行：

```typescript
  } catch (error) {}
```

改为：

```typescript
  } catch (error) {
    // 非 Electron 环境：使用当前域名作为 API 基础地址
    baseUrl.value = window.location.origin + "/api";
  }
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-web
yarn type-check
```

期望：无新增错误

- [ ] **Step 3: Commit（在 Toonflow-web 目录提交）**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-web
git add src/App.vue
git commit -m "fix: set same-origin baseUrl when not running in Electron"
```

---

## Task 8: 添加 Toonflow-web/.dockerignore

**Files:**
- Create: `Toonflow-web/.dockerignore`

**背景：** Docker BuildKit 的 named build context（`--build-context web=../Toonflow-web`）会将整个 `Toonflow-web/` 目录作为构建上下文传入。若本地存在 `node_modules/`（通常数百 MB），会使构建极慢且浪费传输。`.dockerignore` 放在源目录下，BuildKit 会自动读取。

- [ ] **Step 1: 创建 `Toonflow-web/.dockerignore`**

在 `/Users/yuanjiawei/ai-coding/Toonflow-web/` 下创建 `.dockerignore`，内容：

```
node_modules
dist
.git
```

- [ ] **Step 2: Commit**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-web
git add .dockerignore
git commit -m "build: add .dockerignore to exclude node_modules from Docker context"
```

---

## Task 9: 重写 Dockerfile — 三阶段多阶段构建

**Files:**
- Rewrite: `Dockerfile`

**背景与注意事项：**
- `node:22-bookworm-slim` 不预装 yarn，需手动安装
- `better-sqlite3` 和 `sharp` 是 C++ native 模块，需要 `build-essential` + `python3` 编译（若 npmmirror 有预构建包会跳过编译，但依赖需存在以防万一）
- `sharp@0.34+` 自带预编译 libvips，**不需要**系统 `apt install libvips`
- 前端用 `viteSingleFile` 插件，所有资源内联到 `dist/index.html`，`COPY /web/dist ./data/web` 即可
- `--build-context web=../Toonflow-web` 引入前端源码作为 named context，`COPY --from=web . .` 读取该 context
- builder 阶段删除 electron 相关包后继续用 `--frozen-lockfile`（yarn v1 允许 lockfile 有多余条目，只要 package.json 需要的包都在 lockfile 中即可）

- [ ] **Step 1: 完整替换 `Dockerfile` 内容**

用以下内容完整替换 `/Users/yuanjiawei/ai-coding/Toonflow-app/Dockerfile`：

```dockerfile
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
```

- [ ] **Step 2: 验证 Dockerfile 语法（需要 Docker 已安装）**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
docker buildx build --dry-run \
  --build-context web=../Toonflow-web \
  . 2>&1 | head -20
```

若 `--dry-run` 不支持，跳过此步直接执行 Step 3。

- [ ] **Step 3: Commit**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
git add Dockerfile
git commit -m "build: rewrite Dockerfile with 3-stage multi-stage build for SAE"
```

---

## Task 10: 本地构建镜像并冒烟测试

**背景：** 验证整个构建链路是否正确，包括 native 模块编译、前后端产物拷贝、容器启动。此步骤需要 Docker Desktop 已安装并运行，且 `docker buildx` 支持 `linux/amd64` 平台。

- [ ] **Step 1: 构建镜像（约 5-15 分钟，首次构建较慢）**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
docker buildx build \
  --platform linux/amd64 \
  --build-context web=../Toonflow-web \
  -t toonflow:local \
  --load \
  .
```

期望：最后输出 `=> exporting to docker` 和镜像 ID，无 error 行。

常见失败点及处理：
- `yarn: command not found` → 检查 Stage 1/2 中 `npm install -g yarn@1.22.22` 是否执行
- `gyp ERR!` → native 模块编译失败，检查 `build-essential python3` 是否安装成功
- `COPY --from=web` 找不到文件 → 检查 `--build-context web=` 路径是否正确

- [ ] **Step 2: 启动容器（不挂 NAS，不配置真实 OSS，验证启动流程）**

```bash
docker run --rm -p 10588:10588 \
  -e NODE_ENV=prod \
  -e PORT=10588 \
  toonflow:local
```

期望日志包含：
```
[服务启动成功]: http://localhost:10588
```

若出现 `服务器秘钥未配置` 日志，属预期行为（需要先初始化 DB 设置 tokenKey），不影响健康检查。

- [ ] **Step 3: 验证健康检查端点**

另开终端：

```bash
curl -s http://localhost:10588/api/health
```

期望输出：

```json
{"status":"ok"}
```

- [ ] **Step 4: 验证前端加载**

浏览器访问 `http://localhost:10588`，期望：
- 页面正常加载（不是空白页，不是 404）
- 浏览器控制台无 "Failed to fetch" 类 CORS 错误

- [ ] **Step 5: 停止容器**

```bash
# 在容器运行的终端按 Ctrl+C，或：
docker ps | grep toonflow | awk '{print $1}' | xargs docker stop
```

- [ ] **Step 6: 最终 Commit（如有未提交改动）**

```bash
cd /Users/yuanjiawei/ai-coding/Toonflow-app
git status
# 确认无遗漏的文件改动
```

---

## SAE 配置备忘（不是代码改动，供运维参考）

```
环境变量：
  NODE_ENV=prod
  PORT=10588
  DATA_DIR=/mnt/nas/toonflow          # NAS 挂载后的路径
  OSS_REGION=cn-hangzhou
  OSS_BUCKET=your-bucket-name
  OSS_ACCESS_KEY_ID=xxx               # 建议改用 RAM 角色后删除
  OSS_ACCESS_KEY_SECRET=xxx           # 建议改用 RAM 角色后删除
  CORS_ORIGIN=https://your-domain.com

SAE 配置：
  实例数：1（SQLite 不支持多写）
  NAS 挂载路径：/mnt/nas/toonflow
  健康检查：GET http://localhost:10588/api/health，期望 200
  端口：10588

OSS Bucket 设置：
  访问权限：私有（private）
  文件通过 getFileUrl() 返回的签名 URL 访问，1小时有效
```
