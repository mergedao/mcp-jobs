---
name: mcp-jobs
description: 四平台职位聚合工具（BOSS/猎聘/51job/智联）的 agent 操作指南：搜索、登录、profile 感知、职位增量监控与定时任务配置。用户要搜职位、盯新职位、排查某平台数据没出来时使用。
owner-contact-email: OWNER_EMAIL_PLACEHOLDER
---

<!-- OWNER-CONTACT-EMAIL: 发布前用 inject-owner-email.py 幂等重放填充真实邮箱 -->

# mcp-jobs Agent 操作指南

四平台职位聚合 MCP（BOSS 直聘 / 猎聘 / 前程无忧 / 智联），每平台一条最优取数通道，
公开数据免登录，登录类平台（BOSS/智联）走统一 profile 人工登录一次永久有效。

## 工具清单

| 工具 | 用途 | 什么时候用 |
|---|---|---|
| `mcp_search_job` | 多平台并发搜索，带归一化筛选与多页翻页，逐源状态 | 用户要找职位 |
| `mcp_job_detail` | 单职位详情 | 用户点了某个职位想看 JD |
| `mcp_prepare_application` | 投递草稿 + 官方投递入口 | 用户想投某个职位 |
| `mcp_platform_login` | 打开登录页（自动置前）并等人工完成 | 搜索返回 `login_required` |
| `mcp_login_confirmed` | 人工确认登录记录 | 用户说「xx 登录好了」（无可靠 cookie 特征的平台） |
| `mcp_profile_status` | 各平台登录态感知（含 cookie 过期时间） | 搜不到数据先查这个；定时巡检 |
| `mcp_apply_job` | 投递/打招呼第一阶段：生成确认单（不执行） | 用户确认要投某个职位 |
| `mcp_apply_confirm` | 第二阶段：执行模拟点击 | 用户对确认单说「确认」后 |
| `mcp_check_feedback` | 投递/沟通反馈被动捕获（只读） | 用户问「有没有回复」 |
| `mcp_actions_log` | 写操作审计日志 | 排查投递历史 |
| `mcp_my_profile` | 本地主简历档案（get/set） | 生成定制简历前 |
| `mcp_watch_check` | 职位增量监控（二次确认去噪） | agent 定时任务播报新机会 |
| `mcp_watch_reset` | 清空监控基线 | 用户想重新全量收一遍 |

## 三大核心流程

### ① 查职位
`mcp_search_job`（keyword + city + salary/workYear/education/jobType + maxPages）→
逐源 status/coverage 透明上报 → 结果里 `coverage=search_api` 是全量数据层。
筛选语义是区间交集；搜不到先 `mcp_profile_status` 再按下面的排查顺序走。

### ② 投递职位（半自动两阶段，BOSS/智联模拟点击）
1. `mcp_apply_job`（platform/url/title/message）→ 返回确认单（**不执行**）
2. 把确认单预览给用户看 → 用户明确说「确认」
3. `mcp_apply_confirm`（actionId）→ 真实 Chrome 模拟点击执行 → 结果与审计记录
- BOSS：点「立即沟通」即自动发默认语（按钮翻转为「继续沟通」= 成功判据）；
  自定义招呼语作为后续聊天消息补发（textarea.input-area → 严格匹配「发送」）
- 可能遇到隐私/设置类弹窗 → 如实上报，请用户在窗口里处理后重试
- 51job/猎聘：台账模式（prepareTrackedApplication 记录，用户在官方页面手动投递）

### ③ 沟通/投递反馈
- BOSS：`mcp_check_feedback {platform:'zhipin'}` 打开聊天页被动捕获会话列表（谁回复了）
- 智联：`mcp_check_feedback {platform:'zhaopin'}` 读投递状态标记
- 51job/猎聘：`mcp_application_list` 看台账；`mcp_feedback_import` 导入用户报告的状态；
  通知用户后用 `mcp_feedback_ack` 消费游标

## 关键交互约定

### 搜不到数据时，按这个顺序排查
1. `mcp_profile_status` 看是哪个平台、什么状态
2. `login_required` → 告诉用户「需要扫码」并调 `mcp_platform_login`（窗口会自动定位到登录页，**不要让用户自己找**）
3. `access_restricted` / `rate_limited` → 不要立刻重试，等 10 分钟以上；连续失败说明该平台风控已标记，当天换时段
4. `unrecognized_page` → 站点改版了，如实告诉用户并降级到其他平台结果

### 节奏红线（防风控封号，必须遵守）
- BOSS：页间 12–22s 随机、单次会话 ≤10 页、单日预算 ~500 请求；遇 code 31/37 **立即停**，当天不要再碰
- 智联：60–90s+ 抖动、日请求 ≤150
- 监控类定时任务间隔 ≥1 小时；多关键词串行跑，不要并发轰炸
- `MCP_JOBS_TIMEOUT_MS` 不要超过 45000

### 登录体验（已内建，agent 只需触发）
- 需要登录时调 `mcp_platform_login`，工具会：拉起专用 Chrome（若未运行）→ 打开登录页 → **置前**（唯一允许抢焦点的时刻）→ 纯 cookie 静默轮询 → 登录成功自动返回
- 等待期零页面操作，不会打扰用户；返回 `waiting` 时告诉用户「扫完直接重试搜索即可」
- 登录态存在统一 profile（`~/.mcp-jobs/profile`），一次登录永久有效（多账号才需要第二套 `MCP_JOBS_PROFILE_DIR`+`MCP_JOBS_CDP_PORT`）

### 定时监控新职位（agent 定时任务配方）
1. 用调度器（如 DSH `schedule_create`）建周期任务，间隔建议 1–2 小时
2. 任务 prompt：调用 `mcp_watch_check`（keyword/city 从用户需求来），`baseline:true` 表示首次建基线（不播报）
3. `newCount > 0` 时才打扰用户：汇总职位（标题/公司/薪资/链接），否则静默结束
4. 想重新全量收一遍：先 `mcp_watch_reset` 再 `mcp_watch_check`

## 数据层级说明

- 每个平台有 S1（API/被动捕获，数据最全）和 S2（公开页 DOM，兜底）两层
- 返回里 `coverage=search_api` = 全量数据层；`coverage=public_page` = 兜底层
- 职位对象带平台原始字段（标签/HR 在线/公司规模等），不要假设字段固定——以返回为准

## 归一化筛选与翻页

`mcp_search_job` 的筛选条件是跨平台归一化的：

| 参数 | 值域 | BOSS | 猎聘 | 51job | 智联 |
|---|---|---|---|---|---|
| `salary` | `10-15K` / `10-15万` / `15K以上` | ✅ 原生码 | ✅ 原生码 | ⬜ 客户端 | ⬜ 客户端 |
| `workYear` | `应届生`/`1年以内`/`1-3年`/`3-5年`/`5-10年`/`10年以上` | ✅ 原生码 | ✅ 原生码 | ⬜ 客户端 | ⬜ 客户端 |
| `education` | `大专`/`本科`/`硕士`/`博士`/`高中` | ⬜ 客户端 | ⬜ 客户端 | ⬜ 客户端 | ⬜ 客户端 |
| `jobType` | `全职`/`兼职`/`实习` | ⬜ 客户端 | ⬜ 客户端 | ⬜ 客户端 | ⬜ 客户端 |
| `maxPages` | 1–10，每平台串行翻页聚合去重 | ✅ | ✅ | ✅ | ⬜（SSR 只出首屏，第 2 页起落回 S2） |

- 语义：薪资/年限按**区间交集**匹配（9-13K 会通过 10-20K 的筛选，因为区间有重叠）
- 翻页节奏内建：BOSS 页间 12–22s 人类节奏（红线），其他平台 1.4–2.8s；总耗时受 45s 预算封顶，
  大规模翻页（>3 页）建议 agent 分次调用（每次 maxPages=2，中间由 agent 控制节奏）
- 筛选太严时先去掉 salary 看原始量，再逐步收紧

## 定制简历（本地生成，跨平台零依赖）

平台简历同步不可行（各家格式/字段完全不同），正确解法是**本地按职位生成**：
1. `mcp_my_profile {action:'set', profile:{name, contact, summary, skills[], experiences[], education[], projects[]}}` —— 一次性存入用户完整经历（本地 JSON，永不上传）
2. `mcp_job_detail` 拿目标职位 JD（或从搜索结果的 `jobDescription`/`jobSkillTags` 直接取）
3. **agent 生成**：以主档案为素材库，按目标 JD 的关键词重排重点（技能顺序、项目亮点对齐 JD 要求），写成 markdown/docx 落盘给用户
4. 用户自己上传到平台（简历上传是平台强风控面，自动化上传不做）

## 51job 与猎聘投递和反馈

- 用 `mcp_apply_job` 准备本地申请，指定平台、官方职位 URL 和账号代号。收到 `already_tracked` 时，展示已有状态。
- 用户在原站登录、核对并提交后，用 `mcp_feedback_import` 录入已观察到的投递状态或回复元数据。用户没能确认结果时记录 `unknown`；回复用稳定的会话 ID 和消息 ID 去重。
- 用 `mcp_application_list` 查看台账。提醒任务用 `mcp_check_feedback` 读取本地增量。通知成功后，用同一账号和消费者调用 `mcp_feedback_ack`，将读取时的 `cursor` 和 `nextCursor` 分别作为 `cursor` 与 `through`。
- 会话过期或同步失败可以单独上报 `session_expired` 或 `unavailable`，历史仍然保留。提交和发送在招聘原站完成。

## 环境变量（都可选）

```bash
# 统一 profile（一个 Chrome 窗口管所有平台登录态）
# MCP_JOBS_PROFILE_DIR=~/.mcp-jobs/profile
# MCP_JOBS_CDP_PORT=9223
# MCP_JOBS_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# BOSS 用户自管 Chrome（可选，优先于托管）
# BOSS_CDP_URL=http://127.0.0.1:9222

# profile 被动巡检周期（毫秒，默认 600000=10 分钟，0=关闭）
# MCP_JOBS_PROFILE_POLL_MS=600000

# 只用公开页层（禁 API 层，纯公开模式/测试）
# MCP_JOBS_DISABLE_PLATFORM_APIS=1

# 整次搜索超时（默认 25000，硬上限 45000）
# MCP_JOBS_TIMEOUT_MS=25000
```

## 合规底线

只抓公开职位字段与用户本人授权的登录态；不碰简历/联系方式等个人信息；
遇到验证码/登录墙/风控码一律停手交人工，不做任何绕过验证码的自动化。
