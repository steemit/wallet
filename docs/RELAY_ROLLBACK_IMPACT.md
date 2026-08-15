# 中继验证层回退 — 影响面清单

> 决策背景：服务端定位为**纯中继**，唯一使命是流量管控（保护 api.steemit.com）。
> 交易有效性验证是链的职责。此前在广播路由加的服务端验证层（op-type 白名单、权限映射、
> 真实验签）确认为过度设计：造成 2 倍上游 RPC 放大（与流控目标矛盾），且自身成为
> 新漏洞面（F5/F8/F10/F11/F12/S4 全部存在于验证层）。详见 AGENTS.md
> 「中继架构与安全边界」。
>
> 本文档为回退实施前的完整影响面盘点。

---

## 一、要回退的（验证层代码）

| 文件 | 回退内容 | 说明 |
|------|---------|------|
| `src/lib/steem/validate-signed-tx-op.ts` | **整文件删除** | `validateRelayTransaction`（15 路由调用）、`assertSignedTxOpType`、`getRequiredAuthority`、`OP_AUTHORITY` 映射表、`RequiredAuthority` 类型全部不再需要 |
| 15 个广播路由 | 移除 `validateRelayTransaction(...)` 调用 | transfer / vote / convert / custom-json / delegate / power-down / limit-order-{create,cancel} / proposal-{create,remove,vote} / set-withdraw-vesting-route / witness-{vote,proxy} / account-create。保留 `verifyCSRF` → `rateLimit` → shape 校验 → 广播 |
| `src/app/api/broadcast/account-update/route.ts:53` | 移除 `verifyTransactionForUsername(signedTx, username, 'owner')` 调用 | 保留其专属的 `validateAccountUpdateSignedTx` shape 校验（防明显垃圾，不发往链） |
| `src/lib/steem/server.ts` | 删除 `verifyTransactionForAccount`、`verifyTransactionForUsername`、`collectAuthorityKeys` | 服务端验签逻辑整体移除。`validateTransactionShape` 保留（shape 校验属于垃圾过滤）。`verifyChallengeSignature` 保留（登录挑战，见保留清单） |
| `src/app/api/broadcast/custom-json/route.ts` | 删除 `ALLOWED_CUSTOM_JSON_IDS`、`CUSTOM_JSON_ID_RE`、id/格式/payload 校验块 | 五.2 决策：中继不审查 custom_json 内容，无体积兜底 |
| 15 个广播路由 | 限流统一为 10/min（vote 30→10、limit-order 20→10、5 的提至 10） | 五.1 决策：统一额度；`recover-account` 保持 3/min 不变 |

### 已决策（2026-08-15）：不做 shape 兜底上限

复审裁决：中继层的目的就是**中转和控流**，不做交易体积/操作数/签名数的额外上限——
框架 body 限制与链自身约束已足够，任何"再多检查一下"都是内容检查的回流。

## 二、要保留的（与中继哲学不冲突）

### 2.1 基础设施与流控（核心目标所在）

| 内容 | PR | 保留理由 |
|------|-----|---------|
| rate limit（全路由）+ TRUST_PROXY_COUNT/x-real-ip 三层 IP 解析 | #305/#308 | **中继层的核心使命**。#308 修复了限流桶坍缩 |
| Redis fail-closed（login 挑战、recover-account DB 门控） | #305 | 有状态流程的正确降级行为 |
| Redis 重连冷却 | #310 | 防惊群 |
| `hashedCacheKey`（查询路由缓存键哈希） | #310 | 防 Redis 键注入/碰撞，缓存基础设施 |
| `setCacheInvalidateHeader`（header 清理） | #305 | 防 header 注入 |
| CSRF（HMAC token + fail-closed） | #305 | 防外站滥用中继通道，属流控配套 |

### 2.2 recovery 全链路（服务端业务，非中继）

| 内容 | PR | 保留理由 |
|------|-----|---------|
| `recovery/confirm` CAS + 失败回滚 | #305/#306 | 服务端真实状态机，账号接管路径 |
| `recovery/confirm` conveyor preflight + 503 | #305 | 同上 |
| `recover-account` DB 门控（status='closed' + key 匹配 + fail-closed 503） | #305 | 同上 |
| `recover-account` owner-history 签名核验 + normalize 前置 | #307/#312 | 账号接管路径的纵深防御，服务端有真实责任 |
| `validateConveyorConfig`（CONVEYOR WIF 校验） | #305 | 高价值机密的服务端管理 |
| 登录挑战验签（`verifyChallengeSignature`）+ fail-closed | #305 | 服务端有状态流程，验签是业务必需 |

### 2.3 查询路由与客户端（与中继无关）

| 内容 | PR | 保留理由 |
|------|-----|---------|
| 查询路由 NaN 修复、错误详情清理、缓存键哈希、proposals private 缓存 | #310 | 查询面修复，不涉及中继 |
| `client-fetch` 只缓存 2xx、`client-cache` 前缀匹配 | #310 | 客户端缓存正确性 |
| analytics PII 脱敏 | #310 | 隐私 |
| change-password 熵 fail-closed | #310 | 客户端密钥质量 |
| CSP + SRI（script-src 'self'） | #311 | 客户端 XSS 纵深防御，与 localStorage posting key 配套 |
| Next.js 16.2.11 升级 | #313 | 框架 CVE |
| console 门控、死代码清理 | #312 | 代码卫生 |
| `recovery/verify` 限流收紧 | #305 | 枚举面收敛 |

## 三、随回退自动消失的审计项（无需再修）

| 审计项 | 原严重度 | 消失原因 |
|--------|---------|---------|
| F5/F8/F10/F11（operations 只查 [0]，多操作绕过） | MEDIUM ×4 | 攻击面就是验证层自身；验证层删除后无 op-type 白名单可绕过 |
| F12（签名数组无上限 → 服务端 ECDSA DoS） | MEDIUM | 服务端不再遍历签名做 secp256k1 恢复（改由 shape 上限兜底，见一） |
| S4（验签忽略 weight_threshold/account_auths） | LOW | 服务端不再验签，多签权重由链判定 |
| ~~F5 关联~~：custom_json id 白名单绕过 | — | id 白名单随验证层删除（白名单本身也在回退范围） |

## 四、回退后仍待修的（与验证层无关）

| 审计项 | 严重度 | 内容 |
|--------|--------|------|
| F6/S2 | MEDIUM | `/api/auth/challenge` 无限流——可覆盖任意用户挑战造成登录 DoS + Redis 写放大。加 `rateLimit`（登录链路是服务端业务，必修） |
| S3 | MEDIUM | recovery/confirm 的 `new_owner_authority` 未校验——服务端用 CONVEYOR 密钥签名上链的字段必须白名单校验（禁 account_auths、单 key、weight=1、与 new_owner_key 一致） |
| F15 | MEDIUM | recover-account 的 `findFirst` 无 status 过滤 + 无 orderBy——预插行可阻断受害者恢复。加 `status='closed'` + `orderBy(desc(id))` |
| F7 | MEDIUM | `hashedCacheKey` passthrough 分支碰撞——16-hex 哈希结果落在直通字符集内。移除 passthrough 或加域前缀 |
| F14 | MEDIUM | 限流 key 含攻击者可控路径段（recovery verify 的 code 段）——routeScope 用路由模式替代原始 pathname |
| S6 | LOW | recovery request 取证 IP 用 XFF 首段——复用 `getClientIP()` |
| S7 | LOW | analytics event 无上限写日志——加长度/白名单 |
| S5 | LOW | elliptic@6.6.1 无修复版本——跟踪，中期迁 @noble/secp256k1（上游 steem-js fork） |

## 五、设计项决策（已定，2026-08-15）

### 5.1 广播路由限流额度 → **已决策：A 统一额度**

服务端不关注用户构造什么 op type，只关注到达 api.steemit.com 的流量高峰期可控。
普通 15 个广播路由统一 **10/min/IP**；`recover-account` 保持 3/min（recovery 业务例外）。
不按操作类型差异化——差异化额度的前提是路由↔操作绑定，而中继层不做这种绑定。

### 5.2 custom_json id 白名单 → **已决策：A 一并移除，无体积兜底**

`ALLOWED_CUSTOM_JSON_IDS` / `CUSTOM_JSON_ID_RE` / id 校验 / payload 8192 限制全部移除。
中继层不审查 custom_json 内容；垃圾数据成本（手续费）由签名者承担，链容量由链治理。
不做体积兜底替代——目的就是中转和控流（此原则已在 AGENTS.md 强调）。

### 5.3 `verifyTransactionForUsername` 删除后 `getAccounts` 的其他调用方

`getAccounts` 同时服务查询路由（有缓存包装），删除验签调用后其调用频次下降，
无其他影响。仅确认无残留引用。

## 六、测试影响

| 测试文件 | 处理 |
|---------|------|
| `tests/unit/validate-signed-tx-op.test.ts` | 删除（被测对象移除） |
| `tests/unit/verify-transaction.test.ts` | 删除（被测对象移除） |
| `tests/unit/proposals-broadcast-routes.test.ts` | 更新 mock（去掉 `validateTransactionShape`/`verifyTransactionForUsername` 相关断言，保留 shape/广播断言） |
| `tests/unit/broadcast-recover-account-route.test.ts` | **不动**（recovery 链路保留） |
| 15 个路由如有其他单测 | 随路由改动同步更新 |

## 七、实施顺序建议

1. 服务端回退（一）+ shape 兜底上限 + 测试更新 → 验证 `pnpm verify`
2. 五.1/五.2 决策落地
3. 继续 四 的待修项（F6/S2、S3、F15 为 P1）
