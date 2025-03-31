import { SiteConfig } from '../config/crawlerConfig';

export class ConfigMatcher {
  private configs: SiteConfig[];

  constructor(configs: SiteConfig[]) {
    this.configs = configs;
  }

  findMatchingConfig(url: string): SiteConfig | null {
    // 首先尝试精确匹配
    const exactMatch = this.configs.find(config => config.url === url);
    if (exactMatch) {
      return exactMatch;
    }

    // 然后尝试模式匹配
    for (const config of this.configs) {
      if (config.urlPattern) {
        try {
          const pattern = new RegExp(config.urlPattern);
          if (pattern.test(url)) {
            return config;
          }
        } catch (error) {
          console.error(`Invalid URL pattern for config ${config.name}:`, error);
        }
      }
    }

    return null;
  }

  // 从 URL 中提取参数
  extractUrlParams(url: string, config: SiteConfig): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (config.urlPattern) {
      try {
        const pattern = new RegExp(config.urlPattern);
        const matches = url.match(pattern);
        if (matches) {
          // 提取命名捕获组
          const namedGroups = matches.groups || {};
          Object.assign(params, namedGroups);
        }
      } catch (error) {
        console.error(`Error extracting URL params for ${config.name}:`, error);
      }
    }

    return params;
  }
} 