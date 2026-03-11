# 部署指南

## 目录

- [环境准备](#环境准备)
- [Docker 部署](#docker-部署)
- [Docker Compose 部署](#docker-compose-部署)
- [Kubernetes 部署](#kubernetes-部署)
- [Vercel 部署](#vercel-部署)
- [环境变量](#环境变量)
- [健康检查](#健康检查)

---

## 环境准备

### 要求

- Node.js 22+
- pnpm 9+
- Docker 20+ (用于容器部署)
- 2GB+ RAM
- 10GB+ 磁盘空间

### 生成安全密钥

```bash
# 生成 SESSION_SECRET
openssl rand -hex 32

# 生成 CSRF_SECRET
openssl rand -hex 32
```

---

## Docker 部署

### 1. 构建镜像

```bash
docker build -f docker/Dockerfile -t steem-wallet:latest .
```

### 2. 运行容器

```bash
docker run -d \
  --name steem-wallet \
  -p 3000:3000 \
  -e SESSION_SECRET="your-secret-here" \
  -e CSRF_SECRET="your-secret-here" \
  -e STEEM_RPC_URL="https://api.steemit.com" \
  steem-wallet:latest
```

### 3. 查看日志

```bash
docker logs -f steem-wallet
```

---

## Docker Compose 部署

### 1. 创建 .env 文件

```bash
cp .env.example .env
# 编辑 .env 文件，填入正确的配置
```

### 2. 启动服务

```bash
docker-compose -f docker/docker-compose.yml up -d
```

### 3. 查看状态

```bash
docker-compose -f docker/docker-compose.yml ps
```

### 4. 停止服务

```bash
docker-compose -f docker/docker-compose.yml down
```

---

## Kubernetes 部署

### 创建部署配置

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: steem-wallet
  labels:
    app: steem-wallet
spec:
  replicas: 2
  selector:
    matchLabels:
      app: steem-wallet
  template:
    metadata:
      labels:
        app: steem-wallet
    spec:
      containers:
      - name: wallet
        image: ghcr.io/your-org/steem-wallet:latest
        ports:
        - containerPort: 3000
        env:
        - name: SESSION_SECRET
          valueFrom:
            secretKeyRef:
              name: wallet-secrets
              key: session-secret
        - name: CSRF_SECRET
          valueFrom:
            secretKeyRef:
              name: wallet-secrets
              key: csrf-secret
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: steem-wallet
spec:
  selector:
    app: steem-wallet
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

### 创建 Secret

```bash
kubectl create secret generic wallet-secrets \
  --from-literal=session-secret=$(openssl rand -hex 32) \
  --from-literal=csrf-secret=$(openssl rand -hex 32)
```

### 部署

```bash
kubectl apply -f deployment.yaml
```

---

## Vercel 部署

### 1. 安装 Vercel CLI

```bash
npm install -g vercel
```

### 2. 部署

```bash
vercel
```

### 3. 设置环境变量

在 Vercel 控制台设置以下环境变量:

- `SESSION_SECRET`
- `CSRF_SECRET`
- `STEEM_RPC_URL`

---

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `NODE_ENV` | 否 | `production` | 运行环境 |
| `PORT` | 否 | `3000` | 服务端口 |
| `STEEM_RPC_URL` | 是 | `https://api.steemit.com` | Steem RPC 节点 |
| `SESSION_SECRET` | **是** | - | 会话加密密钥 |
| `CSRF_SECRET` | **是** | - | CSRF 保护密钥 |
| `MIXPANEL_TOKEN` | 否 | - | Mixpanel 分析令牌 |
| `RATE_LIMIT_ENABLED` | 否 | `true` | 是否启用速率限制 |

---

## 健康检查

### 端点

```
GET /api/health
```

### 响应

```json
{
  "status": "healthy",
  "timestamp": "2026-03-12T10:00:00Z",
  "checks": {
    "steem": {
      "healthy": true,
      "blockNumber": 12345678,
      "latency": 150
    }
  }
}
```

### 状态码

- `200` - 健康
- `503` - 不健康

---

## 故障排查

### 容器无法启动

```bash
# 查看容器日志
docker logs steem-wallet

# 检查环境变量
docker inspect steem-wallet | grep -A 20 Env
```

### Steem 节点连接失败

```bash
# 测试 RPC 节点连通性
curl -X POST https://api.steemit.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_config","params":[],"id":1}'
```

### 内存不足

调整 Docker 资源限制:

```yaml
deploy:
  resources:
    limits:
      memory: 4G
```
