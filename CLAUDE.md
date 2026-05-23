# Toonflow 后端项目说明

## 语言要求

- 全程使用中文回复
- Git 提交信息使用中文
- Agent 对话使用中文

## 项目概述

Toonflow 是一款 AI 短剧漫剧创作工具，后端负责 AI 调度、数据管理、文件服务等。前端项目在 `../Toonflow-web`，通过 Docker multi-stage build 一起打包。

## 技术栈

- **运行时**：Node.js 22 + TypeScript（esbuild 打包）
- **框架**：Express 5
- **数据库**：SQLite（knex + better-sqlite3），文件路径由 `DATA_DIR` 环境变量控制
- **文件存储**：本地文件系统或 SAE OSS 挂载目录（`OSS_MOUNT_DIR` 环境变量）
- **AI**：`@huggingface/transformers`（embedding）+ 多种 LLM vendor（通过 `ai` SDK）
- **部署**：阿里云 SAE + NAS（SQLite）+ OSS POSIX 挂载

## 常用命令

```bash
yarn dev          # 开发模式（nodemon + tsx）
yarn build        # 生产构建（esbuild → data/serve/app.js）
yarn start        # 生产运行
```

## 目录结构

```
src/
  app.ts          # Express 入口，路由挂载，静态服务
  agents/         # AI Agent 实现（scriptAgent、productionAgent 等）
  routes/         # HTTP 路由
  lib/
    initDB.ts     # 数据库表结构 & 种子数据初始化
    fixDB.ts      # 数据库迁移/修复
  utils/
    db.ts         # knex 实例，模块加载时执行 initDB + fixDB
    oss.ts        # 文件读写（本地 or OSS 挂载）
    ossPath.ts    # getOssRootDir()：OSS_MOUNT_DIR 或 data/oss/
    seedDataDir.ts# 首次启动时将镜像内默认数据复制到 DATA_DIR（NAS）
    agent/
      embedding.ts  # @huggingface/transformers + onnxruntime-node
      memory.ts     # Agent 记忆 RAG
      skillsTools.ts# Skill 文件扫描与调用
data/
  skills/         # Skill .md 文件（随镜像发布）
  models/         # ONNX 模型文件（随镜像发布，首次启动种子到 NAS）
  modelPrompt/    # 模型 Prompt 模板
  vendor/         # 供应商配置
  serve/          # esbuild 构建产物（app.js）
  web/            # 前端构建产物（由 Dockerfile web-builder stage 生成）
```

## 部署架构（阿里云 SAE）

- **SQLite 数据库**：挂载 NAS，通过 `DATA_DIR` 环境变量指定路径
- **媒体文件**：挂载 OSS POSIX，通过 `OSS_MOUNT_DIR` 环境变量指定路径
- **首次部署**：`seedDataDir()` 在启动时将镜像内 data/ 目录的默认数据复制到 NAS（只复制不存在的文件）
- **健康检查**：`GET /api/health`，端口 10588

## 构建镜像

参考 `.claude/skills/docker-build-push.md`。

## 注意事项

- `db.ts` 模块加载时同步执行 `seedDataDir()`，NAS 挂载需在容器启动前就绪
- `o_skillList.embedding` 字段当前为空字符串，skill 向量索引尚未实现（不影响现有功能）
- esbuild 构建时 `onnxruntime-node`、`@huggingface/transformers`、`better-sqlite3`、`sharp` 均标记为 external
- Electron 桌面端相关依赖（`electron`、`electron-builder` 等）在 Docker 构建时会被自动剔除
