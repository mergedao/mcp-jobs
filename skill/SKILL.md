---
name: mcp-jobs
description: 搜索 BOSS 直聘、猎聘、51job、智联职位，准备原站投递和沟通，记录申请状态与招聘方回复，并设置本地提醒。
---

# MCP Jobs

## 搜索与登录

- 用 `mcp_search_job` 搜索。逐源检查 `status`、`coverage` 和 `partial`，把可用结果交给用户。公开页样本的覆盖范围只包括该页面。
- 用 `mcp_job_detail` 打开搜索结果的官方链接。访问验证交给用户在原站完成。限流时停止本轮该来源。
- `mcp_platform_login` 返回官方登录入口，或打开页面后立即交回控制权。需要核对时调用 `mcp_profile_status`。用户主动确认后才调用 `mcp_login_confirmed`，该记录表示用户报告的时间。BOSS 和猎聘的本地凭证线索及时间可以辅助判断，当前平台会话仍需单独核对。

## 投递和沟通

- 用 `mcp_prepare_application` 起草沟通文案，用 `mcp_apply_job` 按平台、账号代号和官方职位链接保存待提交记录。
- 把官方链接、职位和草稿交给用户，在原站核实后由用户提交或发送。`prepared` 表示待用户操作，`already_tracked` 表示投递追踪已有该职位。
- 用户从原站核实投递状态或招聘方回复后，用 `mcp_feedback_import` 人工回填已核实的动态。该工具名沿用现有接口。回复字段用稳定的会话代号、消息代号和带时区的时间。无需传递私信正文或登录凭证。

## 回复提醒和职位监控

- 四个平台的 `mcp_check_feedback` 读取本地回填记录。对结果同时检查 `events`、`source`、`status` 和 `sync`。没有同步记录、会话过期或来源不可用时，向用户说明实际状态。
- WorkBuddy 本地定时任务使用 `MCP_JOBS_MONITOR_ONLY=1`。每个任务固定 `platform`、`accountId` 和 `consumer`。通知交付或结果持久化后，用读取时的 `cursor` 和 `nextCursor` 调用 `mcp_feedback_ack`，后者传为 `through`。重试按平台、账号、`notificationId` 去重。
- `mcp_watch_check` 监控新职位，基线按平台建立。某平台失败时继续使用之前的基线。通知交付后用 `mcp_watch_ack` 确认 `watchId` 和 `nextCursor`。重置时用与任务一致的关键词、城市和平台列表。
