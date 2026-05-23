# Docker Build & Push — Toonflow

构建 Toonflow 生产镜像并推送到 GHCR，带版本号管理。

## 固定配置

- **Registry**: `ghcr.io/jiawei666/toonflow`
- **平台**: `linux/amd64`
- **前端路径**: `../Toonflow-web`（相对于 Toonflow-app）

## 执行步骤

每次构建时，按以下顺序执行：

### 1. 确认版本号

从 `package.json` 读取当前版本，或询问用户是否要先升版本：

```bash
node -p "require('./package.json').version"
```

如需升版本（patch / minor / major）：
```bash
npm version patch   # 1.0.0 → 1.0.1
# 或
npm version minor   # 1.0.0 → 1.1.0
```

### 2. 构建镜像（两个 tag）

```bash
VERSION=$(node -p "require('./package.json').version")
IMAGE="ghcr.io/jiawei666/toonflow"

docker buildx build \
  --platform linux/amd64 \
  --build-context web=../Toonflow-web \
  -t "$IMAGE:v$VERSION" \
  -t "$IMAGE:latest" \
  --load \
  .
```

期望：最后输出 `writing image sha256:...` 无 error 行。

### 3. 推送两个 tag

```bash
VERSION=$(node -p "require('./package.json').version")
IMAGE="ghcr.io/jiawei666/toonflow"

DOCKER_CONFIG=/tmp/docker-push-config docker push "$IMAGE:v$VERSION"
DOCKER_CONFIG=/tmp/docker-push-config docker push "$IMAGE:latest"
```

> 注意：使用 `/tmp/docker-push-config` 中的 auth config 绕过 Docker Desktop credential store。
> 若 `/tmp/docker-push-config/config.json` 不存在，先运行：
> ```bash
> mkdir -p /tmp/docker-push-config
> echo '{"auths":{"ghcr.io":{"auth":"'$(echo -n "yuanjiawei:TOKEN" | base64)'"}}}' \
>   > /tmp/docker-push-config/config.json
> ```
> 将 `TOKEN` 替换为当前 GitHub PAT。

### 4. 提交版本变更（如升了版本）

```bash
git add package.json
git commit -m "chore: bump version to v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
```

### 5. 确认推送成功

```bash
VERSION=$(node -p "require('./package.json').version")
echo "✅ 推送完成：ghcr.io/jiawei666/toonflow:v$VERSION"
echo "✅ 推送完成：ghcr.io/jiawei666/toonflow:latest"
```

## 常见问题

| 错误 | 原因 | 解决 |
|------|------|------|
| `permission_denied: create_package` | GitHub 用户名写错或 token 权限不足 | 确认 registry 用 `jiawei666`，token 有 `write:packages` |
| `yarn: command not found` | Docker 层缓存失效 | 删除 BuildKit 缓存后重试 |
| Node OOM / exit code 134 | vite build 内存不足 | Dockerfile 已设 `--max-old-space-size=4096`，检查 Docker Desktop 内存 ≥ 6GB |
