#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { searchJobList, crawlJobDetail, SearchParams } from './index';


dotenv.config();

// 职位搜索工具定义
const SEARCH_JOB_TOOL: Tool = {
  name: 'mcp_search_job',
  description: '搜索职位信息，包括职位名称、公司名称、薪资范围、工作地点、发布时间等。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '搜索关键词',
      },
      city: {
        type: 'string',
        description: '城市名称',
      },
      salary: {
        type: 'string',
        description: '薪资范围',
      },
      workYear: {
        type: 'string',
        description: '工作经验',
      },
      page: {
        type: 'number',
        description: '页码',
      }
    },
    required: ['keyword'],
  },
};

// 职位详情工具定义
const JOB_DETAIL_TOOL: Tool = {
  name: 'mcp_job_detail',
  description: '获取职位详情信息，包括职位名称、公司名称、薪资范围、工作地点、发布时间等。',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '职位详情页URL',
      },
    },
    required: ['url'],
  },
};

// 职位搜索参数接口定义
type SearchJobParams = SearchParams & {
  keyword: string; // 使其成为必需参数
};

// 职位详情参数接口定义
interface JobDetailParams {
  url: string;
}

// 参数验证函数 - 职位搜索
function isValidSearchJobParams(args: unknown): args is SearchJobParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'keyword' in args &&
    typeof (args as { keyword: unknown }).keyword === 'string' &&
    (('city' in args && typeof (args as { city: unknown }).city === 'string') || !('city' in args)) &&
    (('page' in args && typeof (args as { page: unknown }).page === 'number') || !('page' in args))
  );
}

// 参数验证函数 - 职位详情
function isValidJobDetailParams(args: unknown): args is JobDetailParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'url' in args &&
    typeof (args as { url: unknown }).url === 'string'
  );
}


// 初始化服务器实例
const server = new Server(
  {
    name: 'mcp-jobs',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);


// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [SEARCH_JOB_TOOL, JOB_DETAIL_TOOL],
}));

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  try {
    const { name, arguments: args } = request.params;

    // 记录请求日志
    server.sendLoggingMessage({
      level: 'info',
      data: `[${new Date().toISOString()}] 收到工具调用请求: ${name}`,
    });

    if (!args) {
      throw new Error('未提供调用参数');
    }

    switch (name) {
      case 'mcp_search_job': {
        if (!isValidSearchJobParams(args)) {
          throw new Error('搜索职位的参数格式无效，请检查输入参数');
        }
        
        const { keyword, city, page, salary, workYear } = args;
        
        server.sendLoggingMessage({
          level: 'info',
          data: `开始搜索职位，关键词: ${keyword}, 城市: ${city || '全国'}, 页码: ${page || 1}`,
        });

        try {
          const results = await searchJobList({ keyword, city, page, salary, workYear });

          server.sendLoggingMessage({
            level: 'info',
            data: `搜索完成，找到 ${results.length} 个职位`,
          });

          // Add metadata about authentication status
          const responseData = {
            jobs: results,
            metadata: {
              totalResults: results.length,
              searchParams: { keyword, city, page, salary, workYear },
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData) }],
            isError: false,
          };
        } catch (error) {
          server.sendLoggingMessage({
            level: 'error',
            data: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
          });

          // Provide fallback response even when search fails
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                jobs: [],
                metadata: {
                  totalResults: 0,
                  searchParams: { keyword, city, page, salary, workYear },
                  error: '搜索服务暂时不可用，请稍后重试',
                }
              })
            }],
            isError: false,
          };
        }
      }
      
      case 'mcp_job_detail': {
        if (!isValidJobDetailParams(args)) {
          throw new Error('获取职位详情的参数格式无效，请检查输入参数');
        }
        
        const { url } = args;
        
        server.sendLoggingMessage({
          level: 'info',
          data: `开始获取职位详情，URL: ${url}`,
        });

        try {
          const detail = await crawlJobDetail(url);

          if (!detail) {
            const responseData = {
              jobDetail: null,
              metadata: {
                url: url,
                error: '未找到职位详情',
              }
            };

            return {
              content: [{ type: 'text', text: JSON.stringify(responseData) }],
              isError: false,
            };
          }

          server.sendLoggingMessage({
            level: 'info',
            data: `职位详情获取成功: ${detail.title || '未知职位'}`,
          });

          const responseData = {
            jobDetail: detail,
            metadata: {
              url: url,
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData) }],
            isError: false,
          };
        } catch (error) {
          server.sendLoggingMessage({
            level: 'error',
            data: `获取职位详情失败: ${error instanceof Error ? error.message : String(error)}`,
          });

          const responseData = {
            jobDetail: null,
            metadata: {
              url: url,
              error: '职位详情获取失败，请检查URL或稍后重试',
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData) }],
            isError: false,
          };
        }
      }
    
      default:
        return {
          content: [{ type: 'text', text: `未知工具: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    // 记录错误日志
    server.sendLoggingMessage({
      level: 'error',
      data: {
        message: `请求失败: ${error instanceof Error ? error.message : String(error)}`,
        tool: request.params.name,
        arguments: request.params.arguments,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      },
    });
    return {
      content: [
        {
          type: 'text',
          text: `错误: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  } finally {
    // 记录请求完成日志
    server.sendLoggingMessage({
      level: 'info',
      data: `请求处理完成，耗时 ${Date.now() - startTime}ms`,
    });
  }
});

// 启动服务器
async function runServer() {
  try {
    console.error('正在初始化职位搜索服务...');

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // 发送服务器启动成功日志
    server.sendLoggingMessage({
      level: 'info',
      data: '职位搜索服务初始化成功',
    });

    console.error('职位搜索服务已启动，正在运行中...');
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

runServer().catch((error: any) => {
  console.error('服务器运行出错:', error);
  process.exit(1);
});