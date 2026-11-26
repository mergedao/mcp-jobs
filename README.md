<h1 align="center">mcp-jobs</h1>

<p align="center"><strong>在 MCP 客户端查职位，把投递和跟进放进同一个流程。</strong></p>

<p align="center">BOSS 直聘 · 猎聘 · 前程无忧（51job）· 智联招聘</p>

<p align="center">
  <a href="https://github.com/mergedao/mcp-jobs/stargazers"><img src="https://img.shields.io/github/stars/mergedao/mcp-jobs?style=flat-square&amp;logo=github&amp;label=Stars" alt="GitHub Stars"></a>
  <a href="https://www.npmjs.com/package/mcp-jobs"><img src="https://img.shields.io/npm/v/mcp-jobs?style=flat-square&amp;logo=npm&amp;label=npm" alt="当前 npm 版本"></a>
  <a href="https://www.npmjs.com/package/mcp-jobs"><img src="https://img.shields.io/npm/dm/mcp-jobs?style=flat-square&amp;label=Downloads%20%2F%20month" alt="npm 近 30 天下载量"></a>
  <a href="https://github.com/mergedao/mcp-jobs/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-ISC-475569?style=flat-square" alt="ISC License"></a>
</p>

<p align="center">
  <a href="#安装-skill">安装 Skill</a> ·
  <a href="#连接-mcp">连接 MCP</a> ·
  <a href="#投递与回复跟进">投递与回复跟进</a> ·
  <a href="#workbuddy-本地定时任务">WorkBuddy</a> ·
  <a href="#english">English</a>
</p>

## 安装 Skill

**单装 Skill 就能用。** 把职位描述、截图、原站链接或已有跟进表交给客户端，可以比较岗位、起草沟通和整理已核实的进度。MCP 适合需要直接搜索、持久记录或运行定时任务的用户。

| 客户端 | 安装入口 | 可用模式 |
| --- | --- | --- |
| Codex | `.agents/skills/mcp-jobs/` | 独立 Skill、可选本地 MCP |
| Claude Code | `.claude/skills/mcp-jobs/` | 独立 Skill、可选本地 MCP |
| Claude 网页 | 上传 Skill ZIP | 独立 Skill |
| 豆包 | 开放平台导入插件 ZIP，或把 Skill 文本粘贴到会话 | 独立 Skill |

从 GitHub 直接安装时，把整份 `SKILL.md` 保存到表中的目录。下载包和其他安装方式见 [skill-jobs 安装说明](https://github.com/mergedao/mcp-jobs/tree/fix/mcp-search-stability/packages/skill-jobs#readme)，或直接查看 [SKILL.md](https://github.com/mergedao/mcp-jobs/blob/fix/mcp-search-stability/skill/SKILL.md)。豆包与 Claude 网页的 ZIP 是不同格式。豆包公开分发需要通过开放平台审核。

安装后可以试试「用 mcp-jobs 对比这两份职位描述，根据我的经历起草一段沟通消息，再生成一份跟进表」。

## 连接 MCP

### npm 已发布版

当前 `npm latest` 是 **1.4.0**，用于搜职位和获取详情。在支持 stdio MCP 的客户端中添加以下配置。

```json
{
  "mcpServers": {
    "mcp-jobs": {
      "command": "npx",
      "args": ["-y", "mcp-jobs@1.4.0"]
    }
  }
}
```

连接后可以试试这个搜索。

> 搜北京的前端工程师职位，按平台列出职位名称、公司、薪资和原站链接，并说明哪些平台没有返回可用结果。

### 试用 2.0 开发版

想用**原站投递交接、投递追踪和 WorkBuddy 本地提醒**，请从开发分支构建。开发版需要 **Node.js 22+** 和 pnpm。

```bash
git clone --branch fix/mcp-search-stability https://github.com/mergedao/mcp-jobs.git
cd mcp-jobs
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install chromium
```

让客户端运行构建后的 MCP 服务。把示例里的两个路径换成你的绝对路径。

```json
{
  "mcpServers": {
    "mcp-jobs": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-jobs/dist/mcp.js"],
      "env": {
        "MCP_JOBS_PROFILE_DIR": "/absolute/path/to/personal/profile"
      }
    }
  }
}
```

### 如何读懂搜索结果

- **可以用的结果先返回。** 开发版会逐源报告状态与覆盖范围。`partial: true` 表示只拿到了已经完成的页。
- **公开列表有范围。** `coverage: public_page` 表示结果来自单个公开页面样本。部分平台或页面不支持全部筛选条件。
- **需要登录时回到平台。** 查看来源返回的原站链接。遇到登录或验证，由用户在官方页面处理。限流、访问限制和确认无匹配是不同结果。

## 投递与回复跟进

以下流程适用于 **2.0 开发版**，四个平台使用相同的操作方式。

| 你想做什么 | 用哪个工具 | 会得到什么 |
| --- | --- | --- |
| 看职位详情 | `mcp_job_detail` | 读取搜索结果中的官方职位链接 |
| 起草沟通、保存待投递职位 | `mcp_prepare_application` / `mcp_apply_job` | 沟通草稿、官方链接和待提交记录 |
| 记录投递结果或招聘方回复 | `mcp_feedback_import` | 保存用户在原站核实的动态 |
| 查进度、处理提醒 | `mcp_application_list` / `mcp_check_feedback` | 分账号列出投递记录和未确认动态 |

用户在官方页面核对职位、简历、收件方和文案，再亲自提交或发送。`prepared` 表示待操作。原站动态经用户回填后才进入通知。检查不到数据时，客户端需要展示来源状态。

## WorkBuddy 本地定时任务

在同一台机器上使用前台 MCP 和监控 MCP，并让两个进程读取同一个 `MCP_JOBS_PROFILE_DIR`。监控进程使用以下本地 stdio 配置。

```json
{
  "mcpServers": {
    "mcp-jobs-monitor": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-jobs/dist/mcp.js"],
      "env": {
        "MCP_JOBS_PROFILE_DIR": "/absolute/path/to/personal/profile",
        "MCP_JOBS_MONITOR_ONLY": "1",
        "MCP_JOBS_PROFILE_POLL_MS": "0"
      }
    }
  }
}
```

- **回复与投递状态**。固定 `platform`、`accountId` 和 `consumer`，用 `mcp_check_feedback` 读取回填动态。展示或持久化成功后，用 `mcp_feedback_ack` 确认进度。
- **新职位**。用 `mcp_watch_check` 按关键词、城市和平台巡检。首次成功扫描建立基线。通知成功后用 `mcp_watch_ack` 确认，进程重启后可续读未确认通知。

完整参数和失败处理见 [mcp-jobs Skill](https://github.com/mergedao/mcp-jobs/blob/fix/mcp-search-stability/skill/SKILL.md)。客户端配置见 [WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)。

## 开发与反馈

- 开发分支执行 `pnpm test`，运行临时目录和模拟招聘页面的离线回归。
- 反馈问题时，可以附上平台、安装版本、MCP 客户端、来源 `status` 和脱敏职位链接。 [提交 Issue](https://github.com/mergedao/mcp-jobs/issues/new)

## English

**mcp-jobs** is an MCP server for job search across BOSS Zhipin, Liepin, 51job, and Zhaopin. The standalone Skill compares job descriptions, drafts recruiter messages, and maintains a progress table from user-provided updates. The published mcp-jobs npm release provides job search and details. The 2.0 development branch adds original-site application handoff, local tracking, and resumable notifications for clients such as WorkBuddy. Recruiter replies enter the tracker through user-reported updates.

## License

ISC. Based on [diverseforest/mcp-jobs](https://github.com/diverseforest/mcp-jobs).
