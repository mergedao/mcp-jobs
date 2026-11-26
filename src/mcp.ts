#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { searchJobSources, readJobDetail, SearchParams } from './index';
import { prepareApplication } from './services/application';
import { startPlatformLogin, confirmLogin } from './core/login';
import { snapshotProfile, startProfilePoller } from './core/profileState';
import { acknowledgeWatch, watchCheck, resetWatch } from './core/watch';
import { getMyProfile, setMyProfile } from './core/myProfile';
import {
  acknowledgeFeedback, APPLICATION_STATUSES, checkTrackedFeedback, importFeedback,
  listApplications, prepareTrackedApplication, SYNC_STATUSES, TRACKED_PLATFORMS
} from './core/applicationTracker';
import { recentActions } from './core/actionsLog';

const ALL_PLATFORMS = TRACKED_PLATFORMS;



// 职位搜索工具定义
const SEARCH_JOB_TOOL: Tool = {
  name: 'mcp_search_job',
  description: '查询 BOSS 直聘、猎聘、前程无忧、智联的职位。筛选条件自动归一化：支持原生筛选码的平台原生筛选，其余平台客户端过滤保证语义一致。maxPages 支持多页翻页聚合。每个来源都返回可用性和覆盖范围。',
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
        description: '薪资范围，如 10-15K / 10-15万 / 15K以上（BOSS/猎聘原生筛选，其余客户端过滤）',
      },
      workYear: {
        type: 'string',
        enum: ['应届生', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'],
        description: '工作经验（BOSS/猎聘原生筛选，其余客户端过滤）',
      },
      education: {
        type: 'string',
        enum: ['大专', '本科', '硕士', '博士', '高中', '初中及以下'],
        description: '学历要求（客户端过滤）',
      },
      jobType: {
        type: 'string',
        enum: ['全职', '兼职', '实习'],
        description: '职位类型（客户端过滤）',
      },
      maxPages: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: '每个平台尝试的页数（默认 1）。超时可能返回已完成的页',
      },
      page: {
        type: 'integer',
        minimum: 1,
        description: '起始页码（与 maxPages 配合从第 N 页开始翻）',
      },
      publicPages: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
        description: '可选。提供一个或多个 BOSS 直聘、猎聘、前程无忧、智联的官方公开列表链接，在这些页面中筛选职位。'
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

const PREPARE_APPLICATION_TOOL: Tool = {
  name: 'mcp_prepare_application',
  description: '把用户在官方招聘页面选中的职位带回求职流程，准备待核对的沟通草稿和官方投递入口。',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '官方职位链接' },
      title: { type: 'string', description: '职位名称' },
      company: { type: 'string', description: '公司名称' },
      jobDescription: { type: 'string', description: '用户主动提供的职位说明' },
      candidateSummary: { type: 'string', description: '用户确认可用于沟通的相关经历摘要' }
    },
    required: ['url', 'title']
  }
};

// 平台登录工具定义
const PLATFORM_LOGIN_TOOL: Tool = {
  name: 'mcp_platform_login',
  description: '在前台打开官方登录页并等待用户完成操作。返回的是本地观察结果，任务结束后可用 mcp_profile_status 核对。',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['zhipin', 'zhaopin', 'liepin', '51job'],
        description: '要登录的平台'
      },
      waitSeconds: {
        type: 'integer',
        minimum: 30,
        maximum: 600,
        description: '等待用户登录的时间上限，默认 240 秒。仅在前台任务使用'
      }
    },
    required: ['platform']
  }
};

// profile 状态感知工具
const PROFILE_STATUS_TOOL: Tool = {
  name: 'mcp_profile_status',
  description: '检查本地浏览器会话线索和用户确认时间。凭证线索不代表平台已认可当前会话。',
  inputSchema: { type: 'object', properties: {} }
};

// 职位监控工具（agent 定时任务用）
const WATCH_CHECK_TOOL: Tool = {
  name: 'mcp_watch_check',
  description: '职位增量监控：按关键词/城市跑一次搜索，用「二次确认」机制过滤结果页轮动噪声——新职位需在连续两次检查中都出现才报告。首次调用建立基线（newCount=0），适合 agent 定时任务（每 1-2 小时一次）主动播报新机会。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '监控关键词' },
      city: { type: 'string', description: '可选城市' },
      platforms: {
        type: 'array',
        items: { type: 'string', enum: ['zhipin', 'liepin', '51job', 'zhaopin'] },
        description: '可选，默认全部平台'
      }
    },
    required: ['keyword']
  }
};

const WATCH_ACK_TOOL: Tool = {
  name: 'mcp_watch_ack',
  description: '新职位通知已交付后，确认 mcp_watch_check 返回的 watchId 和 nextCursor。',
  inputSchema: {
    type: 'object',
    properties: { watchId: { type: 'string' }, through: { type: 'integer', minimum: 1 } },
    required: ['watchId', 'through']
  }
};

const WATCH_RESET_TOOL: Tool = {
  name: 'mcp_watch_reset',
  description: '清空监控记录。下次成功检查将重新建立基线。platforms 需与创建监控时一致。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string' },
      city: { type: 'string' },
      platforms: {
        type: 'array',
        items: { type: 'string', enum: ['zhipin', 'liepin', '51job', 'zhaopin'] }
      }
    },
    required: ['keyword']
  }
};

const ACCOUNT_ID = { type: 'string', description: '本机同一平台下的账号代号，例如 personal。请勿填写手机号或密码。' };
const TRACKED_SCOPE = {
  platform: { type: 'string', enum: [...TRACKED_PLATFORMS] },
  accountId: ACCOUNT_ID
};
const CONSUMER = { type: 'string', description: '同一个提醒任务在重启后也使用相同代号，默认 workbuddy。' };

const APPLY_JOB_TOOL: Tool = {
  name: 'mcp_apply_job',
  description: '保存本地待提交记录，返回由用户自行提交或发送消息的官方职位链接。',
  inputSchema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: [...ALL_PLATFORMS] },
      url: { type: 'string', description: '官方职位详情链接' },
      title: { type: 'string' },
      company: { type: 'string' },
      accountId: ACCOUNT_ID,
      resumeVersion: { type: 'string', description: '用于该职位的本地简历版本代号' }
    },
    required: ['platform', 'accountId', 'url']
  }
};

const APPLICATION_LIST_TOOL: Tool = {
  name: 'mcp_application_list',
  description: '查看一个平台本地账号的投递追踪记录与最近一次同步状态。',
  inputSchema: {
    type: 'object',
    properties: {
      ...TRACKED_SCOPE,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['platform', 'accountId']
  }
};

const FEEDBACK_IMPORT_TOOL: Tool = {
  name: 'mcp_feedback_import',
  description: '导入用户在原站核实的投递状态和招聘方回复元数据。',
  inputSchema: {
    type: 'object',
    properties: {
      ...TRACKED_SCOPE,
      syncStatus: { type: 'string', enum: [...SYNC_STATUSES] },
      events: {
        type: 'array',
        maxItems: 25,
        items: {
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { const: 'application' },
                url: { type: 'string' }, title: { type: 'string' }, company: { type: 'string' },
                status: { type: 'string', enum: [...APPLICATION_STATUSES] },
                observedAt: { type: 'string', description: '在原站观察到状态的时间，带时区 ISO 时间' },
                resumeVersion: { type: 'string' },
                receiptReference: { type: 'string', description: '可选的原站回执编号或可核对代号' }
              },
              required: ['type', 'url', 'status', 'observedAt']
            },
            {
              type: 'object',
              properties: {
                type: { const: 'reply' },
                conversationId: { type: 'string', description: '同一原站会话使用稳定代号' },
                messageId: { type: 'string', description: '同一条回复使用稳定代号' },
                occurredAt: { type: 'string', description: '回复时间，带时区 ISO 时间' },
                company: { type: 'string' }, url: { type: 'string' }
              },
              required: ['type', 'conversationId', 'messageId', 'occurredAt']
            }
          ]
        }
      }
    },
    required: ['platform', 'accountId']
  }
};

const CHECK_FEEDBACK_TOOL: Tool = {
  name: 'mcp_check_feedback',
  description: '读取已回填的投递动态和招聘方回复。通知交付后用 mcp_feedback_ack 保存进度。',
  inputSchema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: [...ALL_PLATFORMS] },
      accountId: ACCOUNT_ID,
      consumer: CONSUMER
    },
    required: ['platform', 'accountId']
  }
};

const FEEDBACK_ACK_TOOL: Tool = {
  name: 'mcp_feedback_ack',
  description: '确认已处理的一页反馈。处理完成后传入读取结果的 cursor 和 nextCursor。',
  inputSchema: {
    type: 'object',
    properties: {
      ...TRACKED_SCOPE,
      consumer: CONSUMER,
      cursor: { type: 'integer', minimum: 0 },
      through: { type: 'integer', minimum: 0, description: '读取结果中的 nextCursor' }
    },
    required: ['platform', 'accountId', 'cursor', 'through']
  }
};

const ACTIONS_LOG_TOOL: Tool = {
  name: 'mcp_actions_log',
  description: '查看旧版本记录的投递和沟通动作。',
  inputSchema: { type: 'object', properties: {} }
};

// 用户主简历档案工具
const MY_PROFILE_TOOL: Tool = {
  name: 'mcp_my_profile',
  description: '管理存储在本地的简历档案。get 会把档案返回给调用的 MCP 客户端。',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set'] },
      profile: {
        type: 'object',
        description: 'action=set 时提供完整档案：{ name, contact, summary, skills[], experiences[{company,title,period,highlights[]}], education[], projects[] }',
      }
    },
    required: ['action']
  }
};

// 人工确认登录工具（没有可靠登录 cookie 特征的平台用）
const LOGIN_CONFIRMED_TOOL: Tool = {
  name: 'mcp_login_confirmed',
  description: '记录用户主动确认登录的时间。可用 mcp_profile_status 另行查看本地会话线索。',
  inputSchema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['zhipin', 'zhaopin', 'liepin', '51job'] }
    },
    required: ['platform']
  }
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
  if (!args || typeof args !== 'object') return false;
  const fields = args as Record<string, unknown>;
  return typeof fields.keyword === 'string' &&
    (fields.publicPages !== undefined || fields.keyword.trim().length > 0) &&
    [fields.city, fields.salary, fields.workYear, fields.education, fields.jobType].every(value => value === undefined || typeof value === 'string') &&
    (fields.page === undefined || typeof fields.page === 'number' && Number.isSafeInteger(fields.page) && fields.page >= 1) &&
    (fields.maxPages === undefined || typeof fields.maxPages === 'number' && Number.isSafeInteger(fields.maxPages) && fields.maxPages >= 1 && fields.maxPages <= 10) &&
    (fields.publicPages === undefined || Array.isArray(fields.publicPages) && fields.publicPages.every(url => typeof url === 'string' && url.length <= 2048));
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
    version: require('../package.json').version,
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);


function jsonResult(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError };
}

const tools = [SEARCH_JOB_TOOL, JOB_DETAIL_TOOL, PREPARE_APPLICATION_TOOL, PLATFORM_LOGIN_TOOL,
  LOGIN_CONFIRMED_TOOL, PROFILE_STATUS_TOOL, WATCH_CHECK_TOOL, WATCH_ACK_TOOL, WATCH_RESET_TOOL, MY_PROFILE_TOOL,
  APPLY_JOB_TOOL, APPLICATION_LIST_TOOL, FEEDBACK_IMPORT_TOOL, CHECK_FEEDBACK_TOOL, FEEDBACK_ACK_TOOL,
  ACTIONS_LOG_TOOL];
const monitorTools = [PROFILE_STATUS_TOOL, WATCH_CHECK_TOOL, WATCH_ACK_TOOL, APPLICATION_LIST_TOOL, CHECK_FEEDBACK_TOOL, FEEDBACK_ACK_TOOL];
const availableTools = process.env.MCP_JOBS_MONITOR_ONLY === '1' ? monitorTools : tools;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: availableTools }));

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request, { signal }) => {
  const startTime = Date.now();
  try {
    const { name, arguments: args } = request.params;

    if (!availableTools.some(tool => tool.name === name)) {
      throw new Error('当前模式未提供该工具');
    }

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
        
        const { keyword, city, page, salary, workYear, publicPages } = args;
        
        server.sendLoggingMessage({
          level: 'info',
          data: `开始搜索职位，关键词: ${keyword}, 城市: ${city || '全国'}, 页码: ${page || 1}`,
        });

        try {
          const { education, jobType, maxPages } = args;
          const { jobs, sources } = await searchJobSources({ keyword, city, page, salary, workYear, education, jobType, maxPages, publicPages }, signal);

          server.sendLoggingMessage({
            level: 'info',
            data: `搜索完成，找到 ${jobs.length} 个职位`,
          });

          const responseData = {
            jobs,
            metadata: {
              totalResults: jobs.length,
              sources,
              searchParams: { keyword, city, page, salary, workYear, publicPages },
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData) }],
            isError: !sources.some(source => source.status === 'ok' || source.status === 'empty'),
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
                  searchParams: { keyword, city, page, salary, workYear, publicPages },
                  error: '搜索服务暂时不可用，请稍后重试',
                }
              })
            }],
            isError: true,
          };
        }
      }
      
      case 'mcp_prepare_application': {
        const draft = prepareApplication(args);
        return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
      }

      case 'mcp_platform_login': {
        const fields = args as Record<string, unknown>;
        const validPlatforms = ['zhipin', 'zhaopin', 'liepin', '51job'];
        if (!validPlatforms.includes(String(fields.platform))) {
          throw new Error('platform 必须是 zhipin/zhaopin/liepin/51job');
        }
        const waitSeconds = typeof fields.waitSeconds === 'number' && fields.waitSeconds >= 30 ? Math.min(fields.waitSeconds, 600) : 240;
        return jsonResult(await startPlatformLogin(fields.platform as typeof ALL_PLATFORMS[number], signal, waitSeconds * 1000));
      }

      case 'mcp_profile_status': {
        const snapshot = await snapshotProfile();
        return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
      }

      case 'mcp_watch_check': {
        const fields = args as Record<string, unknown>;
        if (typeof fields.keyword !== 'string' || !fields.keyword.trim()) throw new Error('keyword 必填');
        const platforms = Array.isArray(fields.platforms)
          ? fields.platforms.filter((p): p is typeof ALL_PLATFORMS[number] => ALL_PLATFORMS.includes(p as any))
          : undefined;
        const result = await watchCheck({
          keyword: fields.keyword,
          city: typeof fields.city === 'string' ? fields.city : undefined,
          platforms
        }, signal);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'mcp_watch_ack':
        return jsonResult(acknowledgeWatch(args.watchId as string, args.through as number));

      case 'mcp_watch_reset': {
        const fields = args as Record<string, unknown>;
        if (typeof fields.keyword !== 'string' || !fields.keyword.trim()) throw new Error('keyword 必填');
        const platforms = Array.isArray(fields.platforms)
          ? fields.platforms.filter((p): p is typeof ALL_PLATFORMS[number] => ALL_PLATFORMS.includes(p as any))
          : undefined;
        const watchId = resetWatch(fields.keyword, typeof fields.city === 'string' ? fields.city : undefined, platforms);
        return { content: [{ type: 'text', text: JSON.stringify({ watchId, reset: true }) }] };
      }

      case 'mcp_my_profile': {
        const fields = args as Record<string, unknown>;
        if (fields.action === 'set') {
          if (!fields.profile || typeof fields.profile !== 'object' || Array.isArray(fields.profile)) {
            throw new Error('action=set 需要 profile 对象');
          }
          const saved = setMyProfile(fields.profile as Record<string, unknown>);
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'saved', keys: Object.keys(saved) }) }] };
        }
        const profile = getMyProfile();
        return {
          content: [{ type: 'text', text: JSON.stringify(profile ?? { status: 'empty', hint: '尚未设置主简历档案；让用户提供 name/skills/experiences/education 后调用 action=set' }) }]
        };
      }

      case 'mcp_apply_job':
        return jsonResult(prepareTrackedApplication(args));

      case 'mcp_application_list':
        return jsonResult(listApplications(args));

      case 'mcp_feedback_import':
        return jsonResult(importFeedback(args));

      case 'mcp_check_feedback':
        return jsonResult(checkTrackedFeedback(args));

      case 'mcp_feedback_ack':
        return jsonResult(acknowledgeFeedback(args));

      case 'mcp_login_confirmed': {
        const fields = args as Record<string, unknown>;
        const validPlatforms = ['zhipin', 'zhaopin', 'liepin', '51job'];
        if (!validPlatforms.includes(String(fields.platform))) throw new Error('platform 必须是 zhipin/zhaopin/liepin/51job');
        const outcome = await confirmLogin(String(fields.platform) as any);
        return { content: [{ type: 'text', text: JSON.stringify(outcome) }] };
      }

      case 'mcp_actions_log': {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              note: '本地只做审计记录；平台服务端配额由平台自己管控，触发时以页面真实反馈为准',
              recent: recentActions(20)
            }, null, 2)
          }]
        };
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
          const { detail, ...source } = await readJobDetail(url, signal);

          if (!detail) {
            const responseData = {
              jobDetail: null,
              metadata: {
                url: url,
                ...source,
              }
            };

            return {
              content: [{ type: 'text', text: JSON.stringify(responseData) }],
              isError: true,
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
            isError: true,
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
    startProfilePoller(); // profile 状态感知：被动自检并落盘，mcp_profile_status 随时可读

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