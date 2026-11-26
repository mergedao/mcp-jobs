# mcp-jobs

通过 MCP 聚合 BOSS 直聘、猎聘、前程无忧（51job）和智联招聘。支持搜岗、职位详情、原站投递和沟通交接、本地申请台账，以及增量通知。

## 安装

需要 Node.js 22 或以上。源码版本的启动方式如下。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install chromium
```

在 MCP 客户端配置本地 stdio 服务。

```json
{
  "mcpServers": {
    "mcp-jobs": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-jobs/dist/mcp.js"],
      "env": { "MCP_JOBS_PROFILE_DIR": "/absolute/path/to/personal/profile" }
    }
  }
}
```

## 搜索与登录

- `mcp_search_job` 返回职位及每个平台的状态和覆盖范围。一个来源失败时，其他来源已完成的结果仍可用。看到 `partial: true` 时，本次结果只覆盖已完成的页。
- 51job 使用公开页面样本。样本只支持适配器声明的条件，覆盖范围由 `coverage: public_page` 标记。完整职位仍以原站为准。
- `mcp_job_detail` 接受搜索输出的官方链接。遇到登录、访问验证或限流时，查看逐源状态以及返回的原站链接。验证由用户在原站处理。
- `mcp_platform_login` 打开官方登录页或返回其链接，随后交回控制权。登录完成后用 `mcp_profile_status` 查询状态。用户口头确认通过 `mcp_login_confirmed` 记录，当前会话未经验证时显示 `unknown`。

## 投递、沟通和反馈

1. 用 `mcp_prepare_application` 生成沟通草稿，用 `mcp_apply_job` 按 `platform`、`accountId`、`url` 建档。账号代号用 `personal` 这类本地别名。
2. 用户在返回的官方页面核对职位、简历、收件方和文案，亲自提交或发送。`prepared` 仅表示已建档。再次建档返回已有记录。
3. 用户在原站核实结果后，用 `mcp_feedback_import` 回填投递状态，或用会话代号、消息代号和发生时间记录招聘方回复。同一条回复重复导入只记录一次。使用稳定的原站标识或本地代号，避免填入私信正文、手机号或凭证。
4. 用 `mcp_application_list` 查台账，用 `mcp_check_feedback` 读取未确认动态。读取结果包含 `source: user_reported`。登录过期或来源不可用可单独回填，原有申请记录继续保留。

四个平台当前都采用人工回填。原站新消息需要先经过回填才能进入提醒。历史自动操作记录仍可通过 `mcp_actions_log` 查询。简历档案单独通过 `mcp_my_profile` 管理，读取结果会交给调用它的 MCP 客户端。

## WorkBuddy 本地定时任务

前台会话使用普通 MCP 配置。定时任务使用同一台机器和同一数据目录，将任务的 MCP 进程设为监控模式。

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

- 为每个任务固定 `platform`、`accountId` 和 `consumer`。`mcp_check_feedback` 返回 `updates_available`、`more_available`、`no_updates`、`not_synced` 或来源状态。查看 `sync` 的状态和时间以判断记录新鲜度。
- 展示或持久化本页动态后，用 `mcp_feedback_ack` 提交读取结果的 `cursor` 和 `nextCursor`，后者作为 `through`。确认后重启仍会从已保存的进度继续。确认前的重试可用平台、账号和 `notificationId` 去重。存在 `hasMore` 时继续读下一页。
- 新职位监控用 `mcp_watch_check`，按平台建立基线。连续两次成功扫描出现的候选才报告。来源暂不可用时保留未过期候选，成功扫描缺席会淘汰候选。新职位会保留到 `mcp_watch_ack` 使用 `watchId` 和 `nextCursor` 确认交付。`mcp_watch_reset` 的平台列表应和原任务一致。升级后旧版聚合基线会在首次成功检查时按平台重建。
- 本机浏览器和本地台账适用于 WorkBuddy **本地任务**。平台后台自动同步需要单独的授权数据来源。

[连接器文档](https://open.workbuddy.cn/docs/connector) · [定时任务文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide)

## 配置与测试

常用环境变量见 [`.env.example`](.env.example)。`pnpm test` 会构建并运行离线回归，使用临时目录、公开页面样本和 MCP stdio 客户端。

## English

Search BOSS Zhipin, Liepin, 51job, and Zhaopin with per-source status and partial results. Open the original site to submit an application or send a draft. Record verified application status and reply metadata in the local ledger. Scheduled clients can read and acknowledge imported events with a durable cursor. WorkBuddy local tasks can set `MCP_JOBS_MONITOR_ONLY=1`.

## License

[ISC](LICENSE). Based on [diverseforest/mcp-jobs](https://github.com/diverseforest/mcp-jobs).
