# MCP Wechaty Service

A Wechaty bot service built with Model Context Protocol that supports both WeChat and Feishu clients.

## Features

- Support for both WeChat and Feishu messaging platforms
- MCP tools integration:
  - Get contacts
  - Get chat history
  - Send messages
  - Auto-receive messages
- Easy to configure and extend

## Prerequisites

- Node.js >= 16.0.0
- WeChat account
- Feishu developer account
- MCP API key

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your MCP API key
   - Add your Feishu App ID and App Secret
   - Configure WeChat puppet settings

## Configuration

### WeChat Setup
1. Install the WeChat puppet:
```bash
npm install wechaty-puppet-wechat
```

2. When you first run the bot, it will generate a QR code that you need to scan with your WeChat mobile app to log in.

### Feishu Setup
1. Create a Feishu developer account at https://open.feishu.cn/
2. Create a new app and get your App ID and App Secret
3. Add the following permissions to your app:
   - Contact: Read
   - Message: Send and receive
   - User: Read

## Usage

Start the service:
```bash
npm run dev
```

The service will:
1. Initialize the WeChat bot and show a QR code for login
2. Connect to the Feishu API
3. Register MCP tools
4. Start listening for messages on both platforms

## MCP Tools

The service provides the following MCP tools:

1. `getContacts(platform: 'wechat' | 'feishu')`: Get all contacts from the specified platform
2. `getChatHistory(platform: 'wechat' | 'feishu', userId: string)`: Get chat history with a specific user
3. `sendMessage(platform: 'wechat' | 'feishu', userId: string, message: string)`: Send a message to a user
4. Auto-receive messages: All incoming messages are automatically processed through MCP

## Development

To modify or extend the service:

1. Update the MCP tools in `src/index.ts`
2. Add new platform support by implementing the required interfaces
3. Update the environment variables as needed

## License

ISC
