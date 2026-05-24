# CI/CD 自动化部署流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 GitHub Actions 自动化流水线，test 分支 push 触发测试环境构建部署，v* tag push 触发生产环境构建部署。

**Architecture:** 两个独立工作流文件，`docker-test.yml`（测试环境）和改造后的 `docker.yml`（生产环境），均通过 `aliyun` CLI 调用 SAE DeployApplication API 触发部署。ACR 和 SAE 分属两个阿里云账号，对应两套 RAM 子账号 AK。

**Tech Stack:** GitHub Actions, Docker Buildx, aliyun CLI, 阿里云 SAE, 阿里云 ACR 个人版, jq

---

## 文件变更清单

| 操作 | 路径 |
|---|---|
| 新建 | `.github/workflows/docker-test.yml` |
| 修改 | `.github/workflows/docker.yml` |

---

## Task 1：前置手动操作（无代码，控制台配置）

**说明：** 以下步骤需在阿里云控制台和 GitHub 手动完成，是后续所有 Task 的前提。

### 1-A：前端仓库创建 test 分支

- [ ] 在 GitHub 前端仓库（Toonflow-web）基于 master 新建 `test` 分支并推送

```bash
# 在 Toonflow-web 仓库本地执行
git checkout -b test
git push -u origin test
```

### 1-B：ACR 账号创建 RAM 子账号

- [ ] 登录 **ACR 所在阿里云账号** → RAM 访问控制 → 用户 → 创建用户（如 `toonflow-ci-acr`）
- [ ] 为该用户创建 AccessKey，记录 AK ID 和 AK Secret
- [ ] 为该用户附加以下**自定义权限策略**（新建策略，粘贴如下 JSON）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cr:GetRepoTags",
        "cr:DeleteRepoTag"
      ],
      "Resource": "*"
    }
  ]
}
```

### 1-C：SAE 账号创建 RAM 子账号

- [ ] 登录 **SAE 所在阿里云账号** → RAM 访问控制 → 用户 → 创建用户（如 `toonflow-ci-sae`）
- [ ] 为该用户创建 AccessKey，记录 AK ID 和 AK Secret
- [ ] 为该用户附加以下**自定义权限策略**：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sae:DeployApplication"
      ],
      "Resource": "*"
    }
  ]
}
```

### 1-D：查询 SAE 测试应用 App ID

- [ ] 登录 SAE 控制台 → 应用列表 → 找到测试应用 → 复制 App ID（格式类似 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）

### 1-E：填入 GitHub Secrets 和 Variables

- [ ] 进入后端仓库（Toonflow-app）→ Settings → Secrets and variables → Actions

**新增 Secrets（机密值）：**

| Secret 名称 | 值来源 |
|---|---|
| `ALIYUN_ACR_AK_ID` | Task 1-B 创建的 AK ID |
| `ALIYUN_ACR_AK_SECRET` | Task 1-B 创建的 AK Secret |
| `ALIYUN_SAE_AK_ID` | Task 1-C 创建的 AK ID |
| `ALIYUN_SAE_AK_SECRET` | Task 1-C 创建的 AK Secret |
| `SAE_TEST_APP_ID` | Task 1-D 查到的 App ID |
| `FRONTEND_GITHUB_TOKEN` | GitHub 个人 PAT（Fine-grained token），需勾选前端仓库的 `Contents: Read-only` 权限（若前端仓库为私有）|

**新增 Variables（非机密配置）：**

| Variable 名称 | 示例值 |
|---|---|
| `SAE_REGION_ID` | `cn-shenzhen` |
| `FRONTEND_GITHUB_REPO` | `your-org/Toonflow-web`（填实际 org/repo 路径）|

> `SAE_PROD_APP_ID` 生产应用建好后再添加为 Secret，现在跳过。

---

## Task 2：新建 docker-test.yml

**Files:**
- Create: `.github/workflows/docker-test.yml`

- [ ] **Step 1：创建文件，写入完整工作流**

```yaml
name: Build and Deploy Test Image

on:
  push:
    branches:
      - test

jobs:
  docker:
    runs-on: ubuntu-latest
    name: 构建并部署测试镜像

    permissions:
      contents: read

    steps:
      - name: 检出后端代码
        uses: actions/checkout@v4

      - name: 检出前端代码（Toonflow-web，test 分支）
        run: |
          REPO_URL="https://x-access-token:${{ secrets.FRONTEND_GITHUB_TOKEN }}@github.com/${{ vars.FRONTEND_GITHUB_REPO }}.git"
          if git ls-remote --heads "$REPO_URL" test | grep -q 'refs/heads/test'; then
            git clone --branch test --depth 1 "$REPO_URL" ../Toonflow-web
          else
            echo "test 分支不存在，fallback 到 master"
            git clone --depth 1 "$REPO_URL" ../Toonflow-web
          fi

      - name: 设置 Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: 登录 ACR（阿里云深圳）
        uses: docker/login-action@v3
        with:
          registry: crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: 构建并推送测试镜像
        uses: docker/build-push-action@v5
        with:
          context: .
          build-contexts: |
            web=../Toonflow-web
          platforms: linux/amd64
          push: true
          tags: crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:test
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: 安装 aliyun CLI
        run: |
          curl -sLo /tmp/aliyun-cli.tgz https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz
          tar -xzf /tmp/aliyun-cli.tgz -C /tmp
          sudo mv /tmp/aliyun /usr/local/bin/aliyun
          aliyun version

      - name: 部署到 SAE 测试应用
        run: |
          aliyun configure set \
            --profile sae \
            --mode AK \
            --region ${{ vars.SAE_REGION_ID }} \
            --access-key-id ${{ secrets.ALIYUN_SAE_AK_ID }} \
            --access-key-secret ${{ secrets.ALIYUN_SAE_AK_SECRET }}

          aliyun --profile sae sae DeployApplication \
            --AppId ${{ secrets.SAE_TEST_APP_ID }} \
            --ImageUrl "crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:test"

          echo "✅ SAE 测试环境部署已触发"
```

- [ ] **Step 2：提交**

```bash
git add .github/workflows/docker-test.yml
git commit -m "feat: 添加测试环境 CI/CD 工作流 docker-test.yml"
```

---

## Task 3：改造 docker.yml

**Files:**
- Modify: `.github/workflows/docker.yml`

现有 `docker.yml` 需做三处改动：① 替换前端 clone（Gitee → GitHub master）；② 新增 ACR 旧 tag 清理；③ 新增 SAE 生产部署。

- [ ] **Step 1：替换前端 clone 步骤**

将现有的：

```yaml
      - name: 检出前端代码（Toonflow-web）
        run: |
          if [ -n "${{ secrets.GITEE_TOKEN }}" ]; then
            git clone https://oauth2:${{ secrets.GITEE_TOKEN }}@gitee.com/shenzhen-fangzhi-zhisheng/Toonflow-web.git ../Toonflow-web
          else
            git clone https://gitee.com/shenzhen-fangzhi-zhisheng/Toonflow-web.git ../Toonflow-web
          fi
```

替换为：

```yaml
      - name: 检出前端代码（Toonflow-web，master 分支）
        run: |
          git clone --branch master --depth 1 \
            "https://x-access-token:${{ secrets.FRONTEND_GITHUB_TOKEN }}@github.com/${{ vars.FRONTEND_GITHUB_REPO }}.git" \
            ../Toonflow-web
```

- [ ] **Step 2：在「构建并推送镜像」步骤之后，「输出结果」步骤之前，插入 aliyun CLI 安装 + ACR 清理 + SAE 部署三个步骤**

删除现有「输出结果」步骤：

```yaml
      - name: 输出结果
        run: |
          echo "✅ 推送完成"
          echo "ACR：crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:${{ steps.version.outputs.tag }}"
```

替换为以下三个步骤：

```yaml
      - name: 安装 aliyun CLI
        run: |
          curl -sLo /tmp/aliyun-cli.tgz https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz
          tar -xzf /tmp/aliyun-cli.tgz -C /tmp
          sudo mv /tmp/aliyun /usr/local/bin/aliyun
          aliyun version

      - name: 清理 ACR 旧版本 tag（保留最新 3 个）
        run: |
          aliyun configure set \
            --profile acr \
            --mode AK \
            --region ${{ vars.SAE_REGION_ID }} \
            --access-key-id ${{ secrets.ALIYUN_ACR_AK_ID }} \
            --access-key-secret ${{ secrets.ALIYUN_ACR_AK_SECRET }}

          TAGS_JSON=$(aliyun --profile acr cr GetRepoTags \
            --RepoNamespace fzzs \
            --RepoName default 2>/dev/null || echo '{"data":{"tags":[]}}')

          TAGS_TO_DELETE=$(echo "$TAGS_JSON" | \
            jq -r '.data.tags[] | select(.tag | test("^v")) | [.imageCreate, .tag] | @tsv' 2>/dev/null | \
            sort -t$'\t' -k1 -rn | \
            awk 'NR>3 {print $2}')

          if [ -z "$TAGS_TO_DELETE" ]; then
            echo "无需清理（v* tag 数量 ≤ 3）"
          else
            for TAG in $TAGS_TO_DELETE; do
              echo "删除旧 tag: $TAG"
              aliyun --profile acr cr DeleteRepoTag \
                --RepoNamespace fzzs \
                --RepoName default \
                --Tag "$TAG" || echo "警告：删除 $TAG 失败，继续"
            done
            echo "✅ 清理完成"
          fi

      - name: 部署到 SAE 生产应用
        run: |
          if [ -z "${{ secrets.SAE_PROD_APP_ID }}" ]; then
            echo "SAE_PROD_APP_ID 未配置，跳过生产部署"
            exit 0
          fi

          aliyun configure set \
            --profile sae \
            --mode AK \
            --region ${{ vars.SAE_REGION_ID }} \
            --access-key-id ${{ secrets.ALIYUN_SAE_AK_ID }} \
            --access-key-secret ${{ secrets.ALIYUN_SAE_AK_SECRET }}

          aliyun --profile sae sae DeployApplication \
            --AppId ${{ secrets.SAE_PROD_APP_ID }} \
            --ImageUrl "crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:${{ steps.version.outputs.tag }}"

          echo "✅ SAE 生产环境部署已触发"
          echo "镜像：crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:${{ steps.version.outputs.tag }}"
```

- [ ] **Step 3：提交**

```bash
git add .github/workflows/docker.yml
git commit -m "feat: 改造 docker.yml，迁移前端 clone 至 GitHub，添加 ACR 清理和 SAE 生产部署"
```

---

## Task 4：推送 test 分支验证测试流水线

**前置条件：** Task 1～3 全部完成，GitHub Secrets/Variables 已填入。

- [ ] **Step 1：在后端仓库创建并推送 test 分支**

```bash
git checkout -b test
git push -u origin test
```

- [ ] **Step 2：观察 GitHub Actions 运行情况**

进入 GitHub 仓库 → Actions → 找到「Build and Deploy Test Image」工作流 → 点开最新运行记录，逐步确认：

```
✅ 检出后端代码       → 成功
✅ 检出前端代码       → 成功（确认是 test 分支或 fallback 到 master）
✅ 构建并推送测试镜像  → 成功，tag: test
✅ 安装 aliyun CLI   → 输出版本号
✅ 部署到 SAE 测试应用 → 输出「SAE 测试环境部署已触发」
```

- [ ] **Step 3：在 SAE 控制台确认测试应用已开始部署**

进入 SAE 控制台 → 应用详情 → 变更记录，确认最新一条变更状态为「运行中」或「成功」。

- [ ] **Step 4：如有报错，排查常见问题**

| 报错 | 原因 | 解决 |
|---|---|---|
| `clone failed` | FRONTEND_GITHUB_TOKEN 权限不足或 FRONTEND_GITHUB_REPO 路径错误 | 检查 Variable 和 Secret 拼写 |
| `aliyun: command not found` | CLI 下载失败（网络问题）| 检查 runner 网络，可换镜像地址 |
| `InvalidAccessKeyId` | SAE AK 填错 | 对照 RAM 控制台重新填入 Secret |
| `AppId not found` | SAE_TEST_APP_ID 填错 | 在 SAE 控制台重新核对 App ID |

---

## Task 5：打 v* tag 验证生产流水线

**前置条件：** Task 4 验证通过。注意：此步骤会触发 SAE 生产部署（若 `SAE_PROD_APP_ID` 已填入），请确认时机合适。

- [ ] **Step 1：切回 master，打测试 tag**

```bash
git checkout master
git tag v0.0.1-ci-test
git push origin v0.0.1-ci-test
```

- [ ] **Step 2：观察 GitHub Actions 运行情况**

进入 Actions → 找到「Build and Push Docker Image」工作流 → 确认：

```
✅ 检出前端代码（master 分支）→ 成功
✅ 构建并推送镜像             → 成功，tag: v0.0.1-ci-test + latest
✅ 安装 aliyun CLI           → 成功
✅ 清理 ACR 旧版本 tag        → 输出「无需清理」或清理条目
✅ 部署到 SAE 生产应用        → 若 SAE_PROD_APP_ID 未填，输出「跳过生产部署」
```

- [ ] **Step 3：确认 ACR 清理行为（当 v* tag 超过 3 个后）**

当 ACR 中 v* tag 累计超过 3 个后，「清理旧版本 tag」步骤日志应输出被删除的 tag 名称。如需提前验证清理逻辑，可本地运行以下命令模拟：

```bash
# 模拟 GetRepoTags 输出（验证 jq 过滤逻辑）
echo '{"data":{"tags":[
  {"tag":"v0.0.4","imageCreate":1716508000000},
  {"tag":"v0.0.3","imageCreate":1716507000000},
  {"tag":"v0.0.2","imageCreate":1716506000000},
  {"tag":"v0.0.1","imageCreate":1716505000000},
  {"tag":"latest","imageCreate":1716508000000},
  {"tag":"test","imageCreate":1716504000000}
]}}' | \
jq -r '.data.tags[] | select(.tag | test("^v")) | [.imageCreate, .tag] | @tsv' | \
sort -rn | \
awk 'NR>3 {print $2}'
# 期望输出：v0.0.1
```

- [ ] **Step 4：填入 SAE_PROD_APP_ID 并验证生产部署（生产应用建好后执行）**

```
GitHub 仓库 → Settings → Secrets → 新增 SAE_PROD_APP_ID = <生产应用 App ID>
```

再次触发 workflow_dispatch（无需打新 tag）：

```
Actions → Build and Push Docker Image → Run workflow → 填入版本号 → Run
```

确认最后一步输出「✅ SAE 生产环境部署已触发」，并在 SAE 控制台变更记录中确认。

---

## 注意事项

- `aliyun cr GetRepoTags` 返回的 JSON 中，`imageCreate` 字段为毫秒时间戳，`sort -rn` 按数字倒序可正确排序。若实际返回字段名不同，先在本地手动运行一次命令确认 JSON 结构，再调整 `jq` 路径。
- `aliyun sae DeployApplication` 为异步操作，命令返回后 SAE 才开始执行滚动部署，控制台变更状态有 1~2 分钟延迟属正常。
- `FRONTEND_GITHUB_TOKEN` 若前端仓库为 **公开仓库**，可用空字符串替代（clone 时去掉认证部分），但建议保持统一用 PAT 避免将来仓库转为私有时改动。
