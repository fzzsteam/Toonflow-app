# CI/CD 自动化部署流水线设计

## 概述

为 Toonflow 项目建立基于 GitHub Actions 的自动化构建与部署流水线，支持测试环境（test 分支）和生产环境（v* tag）的独立部署，目标平台为阿里云 SAE。

---

## 分支与触发策略

| 触发条件 | 目标环境 | 动作 |
|---|---|---|
| push to `test` 分支（后端仓库）| 测试环境 | 构建镜像 → 推送 ACR → 部署 SAE 测试应用 |
| push `v*` tag（后端仓库）| 生产环境 | 构建镜像 → 推送 ACR → 清理旧 tag → 部署 SAE 生产应用 |

**前端代码取用规则：**
- 测试构建：clone 前端仓库 `test` 分支
- 生产构建：clone 前端仓库 `master` 分支
- 仅后端仓库的 push 触发构建，前端单独 push 不触发

**前后端仓库均托管在 GitHub**（已从 Gitee 迁移）。

---

## 镜像 Tag 策略

| 环境 | ACR Tag | 说明 |
|---|---|---|
| 测试 | `:test` | 固定 tag，每次覆盖，不堆积 |
| 生产 | `:v1.2.3` + `:latest` | 按 git tag 版本号，独立保留用于回滚 |

**ACR 仓库地址：** `crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default`

---

## 镜像清理策略

ACR 个人版不支持自动清理，由生产构建流水线末尾执行：

- 列出仓库所有 `v*` 开头的版本 tag（排除 `latest`、`test`）
- 按创建时间倒序，保留最新 **3 个**
- 超出部分调用 `aliyun cr DeleteRepoTag` 逐个删除

测试环境无需清理（固定 `:test` tag）。

---

## SAE 应用组织

使用**同一命名空间下不同应用名称**区分环境（而非不同命名空间）：

| 环境 | SAE 应用 | 镜像 Tag |
|---|---|---|
| 测试 | 现有应用（App ID 已知）| `:test` |
| 生产 | 手动提前在控制台创建，App ID 填入 Secrets | `:v1.2.3` |

**SAE 部署方式：** 调用 `aliyun sae DeployApplication`，传入 `AppId` + `ImageUrl`。  
**ACR 拉取凭证：** 在 SAE 应用配置里手动绑定一次，后续 `DeployApplication` 只传镜像地址，不重复传凭证。  
**生产应用暂缺 App ID 处理：** 部署步骤用 `if: secrets.SAE_PROD_APP_ID != ''` 守护，未填时跳过部署，不影响镜像构建与推送。

---

## 阿里云账号结构

镜像仓库（ACR）与 SAE 部署在**不同阿里云账号**下，需分别创建 RAM 子账号：

### ACR 账号 RAM 子账号权限
- `cr:GetRepoTags` — 列出镜像 tag
- `cr:DeleteRepoTag` — 删除旧 tag

### SAE 账号 RAM 子账号权限
- `sae:DeployApplication` — 部署应用

---

## GitHub Secrets 清单

| Secret 名称 | 用途 | 所属账号 | 状态 |
|---|---|---|---|
| `ACR_USERNAME` | Docker 登录 ACR | ACR 账号 | 已有 |
| `ACR_PASSWORD` | Docker 登录 ACR | ACR 账号 | 已有 |
| `ALIYUN_ACR_AK_ID` | aliyun CLI 操作 ACR tag | ACR 账号 | 待创建 |
| `ALIYUN_ACR_AK_SECRET` | 同上 | ACR 账号 | 待创建 |
| `ALIYUN_SAE_AK_ID` | aliyun CLI 部署 SAE | SAE 账号 | 待创建 |
| `ALIYUN_SAE_AK_SECRET` | 同上 | SAE 账号 | 待创建 |
| `SAE_TEST_APP_ID` | 测试应用 ID | — | 待填入 |
| `SAE_PROD_APP_ID` | 生产应用 ID | — | 后续填入 |
| `SAE_REGION_ID` | SAE 所在 Region（如 `cn-shenzhen`）| — | 待填入 |

---

## 工作流文件结构

### `docker-test.yml`（新建）

```
触发：push to test 分支

步骤：
1. 检出后端代码（test 分支）
2. 检出前端代码（GitHub，test 分支）
3. 设置 Docker Buildx
4. 登录 ACR（ACR_USERNAME / ACR_PASSWORD）
5. 构建并推送镜像 → :test（固定覆盖）
6. 配置 aliyun CLI（SAE 账号 AK）
7. 部署 SAE 测试应用
   aliyun sae DeployApplication
     --AppId $SAE_TEST_APP_ID
     --ImageUrl crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:test
```

### `docker.yml`（现有改造）

```
触发：push v* tag / workflow_dispatch（两者行为完全相同，均构建+推送+部署）

步骤：
1. 检出后端代码
2. 检出前端代码（GitHub，master 分支）
3. 读取版本号（优先 inputs.version，否则读 package.json）
4. 设置 Docker Buildx
5. 登录 ACR
6. 构建并推送镜像 → :v1.2.3 + :latest
7. 配置 aliyun CLI（ACR 账号 AK），清理旧 tag（保留最新 5 个）
8. 配置 aliyun CLI（SAE 账号 AK）
9. 部署 SAE 生产应用（v* tag 和 workflow_dispatch 均执行）
   aliyun sae DeployApplication
     --AppId $SAE_PROD_APP_ID
     --ImageUrl crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:v1.2.3
   （SAE_PROD_APP_ID 为空时跳过）
```

---

## 回滚方式

生产回滚无需重新走流水线，直接用 `aliyun` CLI 指定旧镜像地址：

```bash
aliyun sae DeployApplication \
  --AppId <PROD_APP_ID> \
  --ImageUrl crpi-xxxx.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:v1.1.0
```

或在 SAE 控制台手动指定旧版本镜像重新部署。

---

## 不在本次范围内

- 跨仓库触发（前端 push 自动触发后端构建）
- 部署后健康检查回调（SAE 自身管理滚动部署）
- ACR 企业版迁移
