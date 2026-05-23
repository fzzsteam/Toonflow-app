# Docker Build & Push — Toonflow

构建 Toonflow 生产镜像并推送到 ACR（阿里云深圳个人版），带版本号管理。

## 固定配置

- **ACR**: `crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default`
- **平台**: `linux/amd64`
- **前端路径**: `../Toonflow-web`（相对于 Toonflow-app）

## 执行步骤

### 1. 确认版本号

```bash
node -p "require('./package.json').version"
```

如需升版本：
```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
```

### 2. 构建镜像

```bash
VERSION=$(node -p "require('./package.json').version")
ACR="crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default"

docker buildx build \
  --platform linux/amd64 \
  --build-context web=../Toonflow-web \
  -t "$ACR:v$VERSION" \
  -t "$ACR:latest" \
  --load \
  .
```

### 3. 推送到 ACR

```bash
VERSION=$(node -p "require('./package.json').version")
ACR="crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default"

# 初始化认证（每次新 terminal session 需要执行一次）
mkdir -p /tmp/docker-acr-config
echo '{"auths":{"crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com":{"auth":"'$(echo -n "$ACR_USERNAME:$ACR_PASSWORD" | base64)'"}}}' \
  > /tmp/docker-acr-config/config.json

DOCKER_CONFIG=/tmp/docker-acr-config docker push "$ACR:v$VERSION"
DOCKER_CONFIG=/tmp/docker-acr-config docker push "$ACR:latest"
```

### 4. 提交版本变更（如升了版本）

```bash
git add package.json
git commit -m "chore: bump version to v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
```

### 5. 确认推送成功

```bash
VERSION=$(node -p "require('./package.json').version")
echo "✅ ACR 推送完成：crpi-7ajeyduewy90avu4.cn-shenzhen.personal.cr.aliyuncs.com/fzzs/default:v$VERSION"
```

## 常见问题

| 错误 | 原因 | 解决 |
|------|------|------|
| `denied: requested access to the resource is denied` | ACR 认证未初始化或 env 变量未加载 | 按步骤 3 重新生成 `/tmp/docker-acr-config/config.json` |
| `yarn: command not found` | Docker 层缓存失效 | 删除 BuildKit 缓存后重试 |
| Node OOM / exit code 134 | vite build 内存不足 | Dockerfile 已设 `--max-old-space-size=4096`，检查 Docker Desktop 内存 ≥ 6GB |
