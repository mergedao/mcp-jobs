# skill-jobs

一份可独立使用的求职 Skill。用职位描述比较机会、起草给招聘方的消息，并整理用户核实的投递与回复。接上 mcp-jobs 后，还可以按服务提供的工具查职位、保存跟进记录和接收本机任务提醒。

## 从源码或 tarball 运行

npm 注册表首次发布完成前，可直接使用已下载的 `skill-jobs-0.1.0.tgz`。例如从目标项目目录执行 `npm exec --yes --package=/absolute/path/to/skill-jobs-0.1.0.tgz -- skill-jobs install codex`。


在该仓库的 2.0 开发分支根目录执行 `npm ci --prefix packages/skill-jobs`，然后执行 `node packages/skill-jobs/prepare.cjs`。下文命令也可把 `npx skill-jobs` 换成 `node /absolute/path/to/mcp-jobs/packages/skill-jobs/cli.cjs`。

## 安装到 Codex 或 Claude Code

npm 发布后，从希望启用 Skill 的项目目录运行：

```bash
npx skill-jobs install codex
npx skill-jobs install claude
```

项目安装分别写入 `.agents/skills/mcp-jobs/` 和 `.claude/skills/mcp-jobs/`。加 `--scope user` 可为当前用户安装。重新打开客户端会话后，可以说「用 mcp-jobs 帮我对比这两份职位描述，并起草一段给招聘方的消息」。

## Claude 网页或豆包

使用已安装的命令导出相应版本的 ZIP。npm 发布后也可以直接通过 npx 导出。

```bash
npx skill-jobs export claude
npx skill-jobs export doubao
```

- Claude 网页将 `skill-jobs-claude.zip` 上传到设置中的 Skills。 [Claude Skills 文档](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- `skill-jobs-doubao.zip` 用于豆包开放平台的插件草稿上传，提交和分发按控制台权限及审核流程。普通豆包会话可用 `npx skill-jobs export markdown` 输出说明并粘贴，再提供职位资料。 [豆包技能接入指南](https://open.doubao.com/document/doubao-developer-guide/skill-integration-guide)

## 可选连接 mcp-jobs

支持本地 stdio 的客户端可按 [mcp-jobs 安装文档](https://github.com/mergedao/mcp-jobs#连接-mcp) 配置服务。单独运行 Skill 时可以使用用户提供的资料和客户端可访问的公开来源。用户到原站提交或发消息。招聘平台状态同步和后台提醒取决于已连接工具和客户端调度能力。

Requires Node.js 18+ for installation and ZIP export. License ISC.
