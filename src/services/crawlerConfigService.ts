import * as dotenv from 'dotenv';
import { BrowserConfig } from '../config/crawlerConfig';

dotenv.config();

export interface CrawlerGlobalConfig {
  headless: boolean;
  timeout: number;
  viewport: {
    width: number;
    height: number;
  };
  userAgent: string;
  debug: boolean;
}

export class CrawlerConfigService {
  private config: CrawlerGlobalConfig;

  constructor() {
    this.config = this.loadConfiguration();
  }

  private loadConfiguration(): CrawlerGlobalConfig {
    return {
      // 从环境变量读取 headless 配置，默认为 true（生产环境）
      headless: this.parseBoolean(process.env.CRAWLER_HEADLESS, true),
      
      // 从环境变量读取超时配置，默认 30 秒
      timeout: this.parseNumber(process.env.CRAWLER_TIMEOUT, 30000),
      
      // 从环境变量读取视窗大小配置
      viewport: {
        width: this.parseNumber(process.env.CRAWLER_VIEWPORT_WIDTH, 1280),
        height: this.parseNumber(process.env.CRAWLER_VIEWPORT_HEIGHT, 800),
      },
      
      // 从环境变量读取用户代理配置
      userAgent: process.env.CRAWLER_USER_AGENT || 
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36',
      
      // 从环境变量读取调试模式配置
      debug: this.parseBoolean(process.env.CRAWLER_DEBUG, false),
    };
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }

  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * 获取全局爬虫配置
   */
  public getGlobalConfig(): CrawlerGlobalConfig {
    return { ...this.config };
  }

  /**
   * 获取浏览器配置，支持站点特定的覆盖
   */
  public getBrowserConfig(siteConfig?: BrowserConfig): BrowserConfig {
    const globalConfig = this.getGlobalConfig();
    
    return {
      headless: siteConfig?.headless ?? globalConfig.headless,
      timeout: siteConfig?.timeout ?? globalConfig.timeout,
      viewport: siteConfig?.viewport ?? globalConfig.viewport,
      userAgent: siteConfig?.userAgent ?? globalConfig.userAgent,
    };
  }

  /**
   * 运行时更新配置
   */
  public updateConfig(newConfig: Partial<CrawlerGlobalConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取浏览器启动参数
   */
  public getBrowserLaunchOptions(siteConfig?: BrowserConfig): {
    headless: boolean;
    args: string[];
  } {
    const browserConfig = this.getBrowserConfig(siteConfig);
    
    return {
      headless: browserConfig.headless!,
      args: [
        `--user-agent="${browserConfig.userAgent}"`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    };
  }

  /**
   * 获取浏览器上下文选项
   */
  public getBrowserContextOptions(siteConfig?: BrowserConfig): {
    viewport: { width: number; height: number };
    userAgent: string;
  } {
    const browserConfig = this.getBrowserConfig(siteConfig);
    
    return {
      viewport: browserConfig.viewport!,
      userAgent: browserConfig.userAgent!,
    };
  }

  /**
   * 检查是否为调试模式
   */
  public isDebugMode(): boolean {
    return this.config.debug;
  }

  /**
   * 获取配置摘要（用于日志）
   */
  public getConfigSummary(): string {
    const config = this.getGlobalConfig();
    return `Crawler Config: headless=${config.headless}, timeout=${config.timeout}ms, debug=${config.debug}, viewport=${config.viewport.width}x${config.viewport.height}`;
  }
}

// 导出单例实例
export const crawlerConfigService = new CrawlerConfigService();
