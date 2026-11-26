<div align="center">

# mcp-jobs

**四平台职位聚合 MCP · All-in-One Job Search MCP**

一个 MCP Server，聚合 **BOSS直聘 / 猎聘 / 前程无忧(51job) / 智联招聘** 四大招聘平台——
归一化搜索筛选、多页翻页、登录态感知、半自动投递、职位增量监控、本地定制简历。

[中文](#-特性) · [English](#english)

</div>

---

## ✨ 特性

### 🔍 归一化搜索
- **四平台并发搜索**：一次调用聚合全部平台结果，逐源报告状态与覆盖率
- **归一化筛选**：薪资 / 工作年限 / 学历 / 职位类型，统一语义——有原生筛选码的平台走原生筛选（BOSS `experience`/`salary`、猎聘 `salaryCode`/`workYearCode`），其余平台客户端过滤保证语义一致
- **多页翻页**：`maxPages` 串行翻页聚合去重，页间内置人类节奏噪声（BOSS 12–22s 红线）

### 🧬 反检测取数（每平台一条最优解）
| 平台 | S1 通道 | 说明 |
|---|---|---|
| BOSS直聘 | 裸 CDP 被动旁听 `joblist.json` | 薪资明文；`__zp_stoken__` 由真实浏览器现场换发，不逆向 |
| 猎聘 | SPA 被动旁听 `pc-search-job` | 让页面自己发请求（自带全套风控头/token） |
| 51job | HMAC-SHA256 签名直连 + WAF 求解 | 免登录；新版 VM WAF 由真 Chrome 现场过 |
| 智联 | SSR 文档捕获 | 职位列表内嵌于 `__INITIAL_STATE__`，零 JS 执行 |

核心原则：**真实 Chrome + 最小 CDP 域（Network/Page/Storage，绝不启用 Runtime）+ 被动旁听**——
不注入、不调用私有接口、无自动化特征可探测。S1 失败自动落回 S2 公开页/DOM，永不静默失败。

### 🪪 统一登录与状态感知
- **单 profile 单窗口**：一个 Chrome 管全部平台登录态，每平台至多一个标签，多账号才启用多 profile
- **登录直达**：需要登录时自动打开登录页并置前（唯一抢焦点的时刻），cookie 静默轮询检测，登录后自动继续
- **状态感知**：被动自检落盘，`mcp_profile_status` 随时读取登录态与 cookie 过期时间；持久化 cookie 基线让检测跨时间可靠

### 📬 半自动投递与反馈
- **两阶段确认**：`mcp_apply_job` 生成动作确认单 → 用户确认 → `mcp_apply_confirm` 执行
- **纯模拟点击**：真实 Chrome 里 DOM 搜索定位（按文字，不用 Runtime）→ `Input` 域受信任鼠标/键盘事件，全程人类节奏噪声；**不碰任何接口**
- **反馈被动捕获**：BOSS 聊天会话 / 智联投递状态，只听网络响应零页面操作
- **动作留痕**：全部写操作有审计日志；本地计数仅审计，平台服务端配额以页面真实反馈为准

### 📡 职位增量监控
- `mcp_watch_check`：二次确认去噪（新职位需连续两次检查都在场才报告），稳定主键 diff（URL 去追踪参数）
- 配合 agent 定时任务（1–2 小时一次）主动播报新机会

### 📄 本地定制简历
- `mcp_my_profile` 本地主档案（永不上传）+ 目标职位 JD → agent 本地生成定制简历文件
- 跨平台简历同步的解法：不让平台替你存，本地按职位生成

## 🚀 快速开始

### 安装运行

```bash
git clone https://github.com/mergedao/mcp-jobs.git
cd mcp-jobs
pnpm install && pnpm build
npx playwright install chromium   # 浏览器内核（推荐同时安装本机 Chrome）
```

### MCP 客户端配置

```json
{
  "mcpServers": {
    "mcp-jobs": {
      "command": "node",
      "args": ["/path/to/mcp-jobs/dist/mcp.js"]
    }
  }
}
```

### 首次登录（BOSS / 智联需要）

搜索返回 `login_required` 时，调用 `mcp_platform_login`：工具会自动拉起统一 Chrome、
打开登录页并置前，你扫码/验证码登录后 cookie 静默检测自动确认，一次登录长期有效。

## 🛠️ 工具列表（16 个）

| 工具 | 说明 |
|---|---|
| `mcp_search_job` | 四平台搜索：关键词+城市+归一化筛选+多页翻页，逐源状态上报 |
| `mcp_job_detail` | 单职位详情 |
| `mcp_platform_login` | 打开登录页（自动置前）并等待人工完成 |
| `mcp_login_confirmed` | 人工确认登录记录（无可靠 cookie 特征的平台） |
| `mcp_profile_status` | 各平台登录态 / cookie 过期时间感知 |
| `mcp_apply_job` | 投递/打招呼第一阶段：生成确认单（不执行） |
| `mcp_apply_confirm` | 第二阶段：用户确认后执行模拟点击 |
| `mcp_check_feedback` | 投递/沟通反馈（被动捕获，只读） |
| `mcp_actions_log` | 写操作审计日志 |
| `mcp_prepare_application` | 沟通草稿 + 官方投递入口 |
| `mcp_my_profile` | 本地主简历档案（get/set） |
| `mcp_watch_check` | 职位增量监控（二次确认去噪） |
| `mcp_watch_reset` | 重置监控基线 |

## ⚙️ 配置（全部可选）

```bash
# MCP_JOBS_PROFILE_DIR=~/.mcp-jobs/profile   # 统一 profile 目录
# MCP_JOBS_CDP_PORT=9223                     # 托管 Chrome 调试端口
# MCP_JOBS_CHROME_PATH=...                   # Chrome 路径
# MCP_JOBS_PROFILE_POLL_MS=600000            # 状态感知自检周期
# MCP_JOBS_TIMEOUT_MS=25000                  # 搜索超时（硬上限 45000）
# MCP_JOBS_DISABLE_PLATFORM_APIS=1           # 纯公开模式（禁 API 层）
# BOSS_CDP_URL=http://127.0.0.1:9222         # 用户自管 Chrome（可选）
```

## 🏗️ 架构

```
src/
├── core/                  # 核心设施
│   ├── cdp.ts             # 裸 CDP 会话（Network/Page/Storage/DOM/Input 最小域）
│   ├── browser.ts         # 托管 Chrome（单 profile 单端口）
│   ├── login.ts           # 四平台登录流（登录页置前 + cookie 静默检测）
│   ├── profileState.ts    # 登录态感知 + 持久化基线
│   ├── watch.ts           # 增量监控（二次确认去噪）
│   ├── actionsLog.ts      # 写操作审计
│   ├── pendingActions.ts  # 两阶段确认闸门
│   └── feedback.ts        # 反馈被动捕获
├── platforms/             # 每平台一个文件：搜索 S1 + 写操作
│   ├── zhipin.ts / zhipinActions.ts
│   ├── zhaopin.ts / zhaopinActions.ts
│   ├── liepin.ts / job51.ts
│   ├── harvest.ts         # 防御式字段收割
│   ├── filters.ts         # 归一化筛选（原生码映射 + 客户端过滤）
│   └── registry.ts        # 策略注册表
├── config/                # 站点配置 / 城市码 / 链接白名单
├── services/              # 公开页抓取 / 投递草稿 / 存储 / 请求预算
└── mcp.ts                 # MCP 工具层（16 工具）
skill/SKILL.md             # agent 操作指南
test/                      # 单元 + stdio e2e
```

新增平台 = 新增一个 `platforms/xxx.ts` + 注册表加一行。

## 📋 使用须知

- 本项目只抓取**公开职位字段**；登录态仅用于用户本人账号的搜索增强
- 遇验证码 / 登录墙 / 风控码一律**停手交人工**，不做任何绕过验证码的自动化
- 不采集简历、联系方式等个人隐私数据；投递/打招呼需用户逐次确认
- 请遵守目标平台用户协议与当地法律法规，控制频率，商业使用自行评估合规风险

## License

[ISC](LICENSE) —— 基于 [diverseforest/mcp-jobs](https://github.com/diverseforest/mcp-jobs) 的 fork 深度改造。

## Acknowledgments

- 四平台反爬机制与路线依据：本仓库 `job-crawler-research/` 调研（BOSS-Claw / boss-zhipin-scraper / trawl / job51-cli 等开源实证）
- [Model Context Protocol](https://modelcontextprotocol.io)

---

<div align="center">

# English

**All-in-one job search MCP for BOSS Zhipin / Liepin / 51job / Zhaopin (China's four major hiring platforms).**

One MCP server that aggregates all four platforms with **normalized search filters, multi-page
pagination, login-state awareness, semi-automatic apply (two-phase confirmation + simulated
clicks on a real Chrome), incremental job monitoring, and locally-generated tailored resumes.**

## Why

China's job platforms have strong anti-bot stacks (Alibaba WAF, RiverSecurity, per-visit
security tokens, font obfuscation). Raw API calls get flagged within minutes. This project
converges on what active open-source projects have proven: **drive a real Chrome with the
real user fingerprint, listen passively over minimal CDP domains (never enable Runtime),
let the site's own security JS issue credentials, and never touch private endpoints.**

## Highlights

- **Normalized search** — salary / experience / education / job type mapped to native filter
  codes where proven (BOSS, Liepin), client-side filtering everywhere else; `maxPages`
  pagination with humanlike inter-page jitter (BOSS 12–22s red line)
- **Per-platform optimal channel** — raw-CDP passive capture (BOSS), SPA passive capture
  (Liepin), HMAC-signed direct API + WAF solving (51job), SSR document extraction (Zhaopin);
  automatic fallback to public-page/DOM layer
- **One unified profile** — a single managed Chrome window holds all platform login states;
  login pages auto-open and focus only when needed; silent cookie polling confirms completion
- **Semi-automatic apply** — two-phase confirmation, trusted input events via raw CDP
  `Input` domain, human-ratio noise, full audit log; feedback read passively (never write)
- **Profile awareness** — passive self-check persisted to disk; `mcp_profile_status` reports
  per-platform login state and cookie expiry
- **Job monitoring** — `mcp_watch_check` with two-strike confirmation to filter result-page churn

## Quick Start

```bash
git clone https://github.com/mergedao/mcp-jobs.git && cd mcp-jobs
pnpm install && pnpm build
npx playwright install chromium
```

```json
{
  "mcpServers": {
    "mcp-jobs": { "command": "node", "args": ["/path/to/mcp-jobs/dist/mcp.js"] }
  }
}
```

See the Chinese section above for the full tool list, configuration, architecture,
usage policy and the agent skill guide (`skill/SKILL.md`).

## License

[ISC](LICENSE) — forked and heavily extended from
[diverseforest/mcp-jobs](https://github.com/diverseforest/mcp-jobs).

</div>
