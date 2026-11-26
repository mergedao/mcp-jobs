---
name: mcp-jobs
description: 使用 mcp-jobs 搜索四家招聘平台，准备原站投递或沟通，记录用户核实的反馈，或运行本地职位与回复提醒。
---

# MCP Jobs

先确认已连接的服务暴露了任务所需工具。npm 1.4.0 提供搜索与详情，投递追踪和提醒需要 2.0 开发版。平台参数使用 `zhipin`、`liepin`、`51job`、`zhaopin`。

## 搜职位

1. 用 `mcp_search_job` 传关键词和用户要求的城市或筛选。使用 2.0 时，按来源检查 `status`、`coverage` 和 `partial`。公开样本以页面覆盖为准，部分结果要标明。
2. 返回可用的职位和原站链接。用户要看详情时，把该职位的官方 URL 传给 `mcp_job_detail`。
3. 来源提示登录时引导用户到官方页面。交互会话可调用 `mcp_platform_login`，它会等待用户操作，必要时用 `waitSeconds` 缩短等待，最小为 30 秒。需要核对本地会话线索时用 `mcp_profile_status`。用户主动确认后才调用 `mcp_login_confirmed`。本地会话线索与用户确认分别记录。
4. 对 `rate_limited`、`access_restricted`、`timeout` 和来源不可用，分别报告原因和其他可用来源。只有检查完成且返回 `empty` 的来源可以表示在本次范围内无匹配。`partial: true` 时说明覆盖不完整。

## 投递、沟通和人工回填

1. 用 `mcp_prepare_application` 生成待核对的草稿。用 `mcp_apply_job` 传 `platform`、`accountId` 和官方 `url` 建档。账号代号用 `personal` 这样的本地别名。
2. 把草稿和返回的 `browserUrl` 交给用户。用户在原站核对后提交或发送。`prepared` 是待提交，`already_tracked` 是已有本地记录。
3. 用户在原站核实结果后，用 `mcp_feedback_import` 回填到同一平台和账号。投递事件需要 `type: application`、`url`、`status`、`observedAt`。招聘方回复需要 `type: reply`、稳定的 `conversationId`、`messageId` 和 `occurredAt`。时间带时区。代号可用脱敏本地别名，省略私信正文、凭证和联系方式。
4. 需要查历史时，用 `mcp_application_list`，有 `nextOffset` 时传给下一页的 `offset`。

## 本地定时任务

使用同一数据目录，并在定时任务进程设置 `MCP_JOBS_MONITOR_ONLY=1`。登录、提交、沟通和人工回填留在前台流程。

- **回复或投递动态**。固定 `platform`、`accountId` 和 `consumer`，再调用 `mcp_check_feedback`。结果来自人工回填。一起检查 `events`、`status` 和 `sync`。未同步、会话过期或来源不可用时报告实际状态。通知成功交付或结果持久化后，用原 `cursor` 和 `nextCursor` 调用 `mcp_feedback_ack`，其中 `nextCursor` 传为 `through`。重试用平台、账号和 `notificationId` 去重。存在 `hasMore` 时继续读取后续页。
- **新职位**。按用户设定的关键词、城市和平台调用 `mcp_watch_check`。首次成功扫描建立基线，来源失败时保留原基线。报告 `newJobs` 后调用 `mcp_watch_ack`，传 `watchId` 和作为 `through` 的 `nextCursor`。重试用 `watchId` 和 `notificationId` 去重。用户明确要重建基线时，在前台用原关键词、城市和平台调用 `mcp_watch_reset`。
