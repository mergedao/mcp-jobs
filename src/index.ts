import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs } from './config/crawlerConfig';
import { jobSearchUrls } from './config/urlConfig';
import { CrawlerData } from './crawler/webCrawler';
import { Wechaty, Contact } from 'wechaty';
import { Client } from '@larksuite/oapi-sdk-nodejs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as dotenv from 'dotenv';
import * as qrcode from 'qrcode-terminal';

dotenv.config();

// Initialize WeChat bot
const wechatBot = new Wechaty({
  name: 'mcp-wechat-bot',
  puppet: 'wechaty-puppet-wechat',
});

// Initialize Feishu client
const feishuClient = new Client({
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
});

// Initialize MCP server
const mcpServer = new Server({
  name: 'mcp-wechaty-bot',
  version: '1.0.0',
  transport: new StdioServerTransport(),
  tools: {
    getContacts: async (platform: 'wechat' | 'feishu') => {
      if (platform === 'wechat') {
        const contacts = await wechatBot.Contact.findAll();
        return contacts.map((contact: Contact) => ({
          id: contact.id,
          name: contact.name(),
          type: contact.type(),
        }));
      } else {
        const response = await feishuClient.contact.v3.users.list();
        return response.data.items.map((user: any) => ({
          id: user.user_id,
          name: user.name,
          type: 'user',
        }));
      }
    },
    getChatHistory: async (platform: 'wechat' | 'feishu', userId: string) => {
      if (platform === 'wechat') {
        const contact = await wechatBot.Contact.find({ id: userId });
        if (contact) {
          return [];
        }
        return [];
      } else {
        const response = await feishuClient.im.v1.messages.list({
          params: {
            user_id: userId,
          },
        });
        return response.data.items;
      }
    },
    sendMessage: async (platform: 'wechat' | 'feishu', userId: string, message: string) => {
      if (platform === 'wechat') {
        const contact = await wechatBot.Contact.find({ id: userId });
        if (contact) {
          await contact.say(message);
        }
      } else {
        await feishuClient.im.v1.messages.create({
          data: {
            receive_id: userId,
            msg_type: 'text',
            content: JSON.stringify({ text: message }),
          },
        });
      }
    },
  },
});

// WeChat event handlers
wechatBot
  .on('scan', (qrcode: string, status: number) => {
    console.log(`Scan QR Code to login: ${status}\nhttps://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`);
    qrcode.generate(qrcode, { small: true });
  })
  .on('login', (user: Contact) => {
    console.log(`User ${user} logged in`);
  });

// Start the service
async function start() {
  try {
    await mcpServer.start();
    console.log('MCP server started');
    
    await wechatBot.start();
    console.log('WeChat bot started');
    
    await feishuClient.ready();
    console.log('Feishu client initialized');
    
    console.log('Service is running...');
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();

// 定义搜索参数接口
export interface SearchParams {
  keyword?: string;
  city?: string;
  page?: number;
  salary?: string;
  workYear?: string;
}

async function crawlByUrl(url: string, params: SearchParams): Promise<CrawlerData[] | null> {
  const crawlerService = new CrawlerService();
  const storageService = new StorageService();

  // 根据 URL 匹配对应的配置
  const matchedConfig = crawlerConfigs.find(config => {
    if (config.url === url) return true;
    if (config.urlPattern && new RegExp(config.urlPattern).test(url)) return true;
    return false;
  });

  if (!matchedConfig) {
    console.error('No matching configuration found for URL:', url);
    return null;
  }

  try {
    // console.log(`Starting crawl for URL: ${url}`);
    const { keyword, city, page, salary, workYear } = params;
    // 创建一个新的配置，使用匹配到的规则但替换URL
    const customConfig = {
      ...matchedConfig,
      url: matchedConfig.urlBuilder(url, params, matchedConfig?.config || {})
    };
    
    const result = await crawlerService.startCrawling(customConfig);
    
    // 获取爬取的数据
    const dataset = result || [];
    
    // 保存爬取结果
    await storageService.saveData(customConfig.name, {
      config: customConfig,
      items: dataset,
      timestamp: Date.now()
    });

    // console.log(`Crawling completed for URL: ${url}`);
    return dataset;
  } catch (error) {
    // console.error(`Error crawling URL ${url}:`, error);
    return null;
  }
}

export async function searchJobList(params: SearchParams = {}) {
  const { keyword, city, page = 1, salary, workYear } = params;
  const result = [];
  for (const config of jobSearchUrls) {
    const dataset = await crawlByUrl(config.url, {
      keyword: keyword + ' ' + city,
      city,
      page,
      salary,
      workYear
    });
    if (dataset) {
      const jobItems = dataset.filter(item => item.data?.jobInfo);
      result.push(...jobItems);
    }
  }
  return result;
}

async function main() {
  const result = await searchJobList({ keyword: '前端开发', city: '北京', page: 1, salary: '10-15万', workYear: '1-3年' });
  // const result = await crawlJobDetail('https://m.zhipin.com/job_detail/7d5caa6504e27b8b1HF839S1FVtU.html');
  // console.log(result);
}

export async function crawlJobDetail(url: string) {
  const result = await crawlByUrl(url, {});
  // console.log(result);
  if (!result || result.length === 0) {
    return null;
  }
  return result[0]?.data?.job || null;
}

// 导出函数供外部使用
export {
  crawlByUrl,
  jobSearchUrls
 };

// 如果直接运行此文件，则执行 main 函数
if (require.main === module) {
  main();
}