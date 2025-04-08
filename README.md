# mcp-jobs

基于 MCP(Model-Controller-Provider)架构的多平台职位聚合服务，支持从主流招聘网站(猎聘、BOSS直聘、智联招聘、前程无忧)获取职位信息，为大模型提供结构化的职位数据。

[![NPM Version][npm-image]][npm-url]
[![Node.js Version][node-version-image]][node-version-url]
[![License][license-image]][license-url]

## 功能特性

- 多平台数据聚合：支持从多个主流招聘网站获取职位信息
- 统一数据格式：将不同平台的数据统一为标准格式
- 灵活搜索条件：支持按职位名称、城市、薪资范围等条件筛选
- 实时数据更新：保证职位信息的时效性
- 结构化输出：提供标准化的数据格式，方便大模型处理和分析

## 安装方式

### 通过 npx 临时运行

最简单的方式是使用 npx 临时运行，不需要全局安装：

```bash
# 使用环境变量设置 API KEY
env MCP_JOBS_API_KEY=your-api-key npx -y mcp-jobs
```

### 全局安装

如果您需要频繁使用，建议全局安装：

```bash
# 全局安装
npm install -g mcp-jobs

# 运行服务
export MCP_JOBS_API_KEY=your-api-key
mcp-jobs
```

### 项目内安装

```bash
# 安装到项目依赖中
npm install mcp-jobs
# 或使用 yarn
yarn add mcp-jobs
# 或使用 pnpm
pnpm add mcp-jobs
```

## 在各 AI 客户端中配置

### Cursor 配置

#### Cursor v0.45.6+ 配置方法

1. 打开 Cursor 设置
2. 进入 Features > MCP Servers
3. 点击 "+ Add New MCP Server"
4. 输入以下信息：
   - Name: "mcp-jobs"（或您喜欢的名称）
   - Type: "command"
   - Command: `env MCP_JOBS_API_KEY=your-api-key npx -y mcp-jobs`

#### Cursor v0.48.6+ 配置方法

1. 打开 Cursor 设置
2. 进入 Features > MCP Servers
3. 点击 "+ Add new global MCP server"
4. 输入以下代码：

```json
{
  "mcpServers": {
    "mcp-jobs": {
      "command": "npx",
      "args": ["-y", "mcp-jobs"],
      "env": {
        "MCP_JOBS_API_KEY": "YOUR-API-KEY",
        "MCP_PROVIDER_LIEPIN_ENABLED": "true",
        "MCP_PROVIDER_BOSS_ENABLED": "true",
        "MCP_PROVIDER_ZHILIAN_ENABLED": "true",
        "MCP_PROVIDER_JOB51_ENABLED": "true"
      }
    }
  }
}
```

> 注意：如果您使用 Windows 系统并遇到问题，请尝试： `cmd /c "set MCP_JOBS_API_KEY=your-api-key && npx -y mcp-jobs"`

### Claude Desktop 配置

在 Claude Desktop 中使用时，您需要在应用设置中添加 MCP 服务器配置：

1. 打开 Claude Desktop
2. 点击左下角 Settings 图标
3. 选择 "MCP Servers" 选项
4. 点击 "Add New Server"
5. 输入以下信息：
   - Name: "mcp-jobs"
   - Type: "command"
   - Command: `npx -y mcp-jobs`
   - Environment Variables:
     - `MCP_JOBS_API_KEY`: 您的 API 密钥
     - `MCP_PROVIDER_LIEPIN_ENABLED`: "true"
     - `MCP_PROVIDER_BOSS_ENABLED`: "true"

### Windsurf 配置

将以下配置添加到您的 `./codeium/windsurf/model_config.json` 文件中：

```json
{
  "mcpServers": {
    "mcp-server-jobs": {
      "command": "npx",
      "args": ["-y", "mcp-jobs"],
      "env": {
        "MCP_JOBS_API_KEY": "YOUR_API_KEY",
        "MCP_PROVIDER_LIEPIN_ENABLED": "true",
        "MCP_PROVIDER_BOSS_ENABLED": "true",
        "MCP_PROVIDER_ZHILIAN_ENABLED": "true",
        "MCP_PROVIDER_JOB51_ENABLED": "true"
      }
    }
  }
}
```

### Cline 配置

在 Cline 中使用时，您需要在项目根目录创建 `.cline.yaml` 文件：

```yaml
mcp:
  servers:
    mcp-jobs:
      command: npx
      args: ["-y", "mcp-jobs"]
      env:
        MCP_JOBS_API_KEY: "YOUR_API_KEY"
        MCP_PROVIDER_LIEPIN_ENABLED: "true"
        MCP_PROVIDER_BOSS_ENABLED: "true"
        MCP_PROVIDER_ZHILIAN_ENABLED: "true"
        MCP_PROVIDER_JOB51_ENABLED: "true"
```

## 环境变量配置

以下是支持的所有环境变量：

```bash
# API 密钥
MCP_JOBS_API_KEY=your-api-key

# 启用的数据源
MCP_PROVIDER_LIEPIN_ENABLED=true
MCP_PROVIDER_BOSS_ENABLED=true
MCP_PROVIDER_ZHILIAN_ENABLED=true
MCP_PROVIDER_JOB51_ENABLED=true

# 超时和间隔设置
MCP_PROVIDER_TIMEOUT=10000
MCP_PROVIDER_INTERVAL=1000

# 全局设置
MCP_GLOBAL_MAX_RETRIES=3
MCP_GLOBAL_CACHE_TIME=3600

# 服务器设置
MCP_PORT=8080
MCP_HOST=localhost
```

## 在大模型中使用

当您在支持 MCP 的 AI 客户端中配置好 mcp-jobs 后，您可以通过自然语言向大模型描述您的需求，例如：

- "搜索上海地区的前端开发工程师职位"
- "查找北京的数据分析师岗位，要求 3 年以上经验"
- "找出杭州地区薪资最高的产品经理职位"

大模型会自动调用 mcp-jobs 服务获取相关信息并为您展示结果。

## 注意事项

1. 请遵守各招聘平台的使用协议和规范
2. 建议控制请求频率，避免被封禁
3. 部分平台可能需要登录才能获取完整信息
4. Node.js 版本要求：>=14.0.0
5. 首次使用时，需要获取 API 密钥，可通过官方网站申请

## 开源协议

[MIT License](LICENSE)

## 获取帮助

如果您在使用过程中遇到任何问题，请通过以下方式获取帮助：

- 提交 [GitHub Issue](https://github.com/yourusername/mcp-jobs/issues)
- 发送邮件至：support@example.com

[npm-image]: https://img.shields.io/npm/v/mcp-jobs.svg
[npm-url]: https://npmjs.org/package/mcp-jobs
[node-version-image]: https://img.shields.io/node/v/mcp-jobs.svg
[node-version-url]: https://nodejs.org/download/
[license-image]: https://img.shields.io/npm/l/mcp-jobs.svg
[license-url]: LICENSE
