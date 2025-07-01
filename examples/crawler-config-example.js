#!/usr/bin/env node

/**
 * 爬虫配置示例
 * 展示如何使用不同的配置选项
 */

const { WebCrawler } = require('../dist/crawler/webCrawler');
const { crawlerConfigService } = require('../dist/services/crawlerConfigService');

async function basicExample() {
  console.log('🚀 基础示例：使用默认配置');
  console.log('─'.repeat(50));
  
  const crawler = new WebCrawler();
  console.log('默认配置:', crawlerConfigService.getConfigSummary());
  
  // 这里会使用默认的 headless=true 配置
  // 实际使用时替换为真实的爬虫配置
}

async function debugExample() {
  console.log('\n🐛 调试示例：启用可视化浏览器');
  console.log('─'.repeat(50));
  
  // 运行时更新配置
  crawlerConfigService.updateConfig({
    headless: false,  // 显示浏览器窗口
    debug: true,      // 启用调试日志
    timeout: 45000    // 增加超时时间
  });
  
  const crawler = new WebCrawler();
  console.log('调试配置:', crawlerConfigService.getConfigSummary());
  
  // 这里会使用 headless=false 配置，可以看到浏览器窗口
}

async function customViewportExample() {
  console.log('\n📱 自定义视窗示例：模拟移动设备');
  console.log('─'.repeat(50));
  
  // 模拟移动设备视窗
  crawlerConfigService.updateConfig({
    viewport: {
      width: 375,   // iPhone 视窗宽度
      height: 667   // iPhone 视窗高度
    },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  
  const crawler = new WebCrawler();
  console.log('移动设备配置:', crawlerConfigService.getConfigSummary());
}

async function environmentVariableExample() {
  console.log('\n🌍 环境变量示例');
  console.log('─'.repeat(50));
  
  console.log('设置环境变量来配置爬虫:');
  console.log('export CRAWLER_HEADLESS=false');
  console.log('export CRAWLER_DEBUG=true');
  console.log('export CRAWLER_TIMEOUT=60000');
  console.log('export CRAWLER_VIEWPORT_WIDTH=1920');
  console.log('export CRAWLER_VIEWPORT_HEIGHT=1080');
  console.log('');
  console.log('然后运行: npx -y mcp-jobs');
  console.log('');
  console.log('或者一次性设置:');
  console.log('CRAWLER_HEADLESS=false CRAWLER_DEBUG=true npx -y mcp-jobs');
}

async function siteSpecificExample() {
  console.log('\n🎯 站点特定配置示例');
  console.log('─'.repeat(50));
  
  console.log('在 crawlerConfig.ts 中为特定网站配置:');
  console.log(`
{
  url: 'https://example.com',
  name: 'example',
  browserConfig: {
    headless: false,        // 此网站显示浏览器窗口
    timeout: 60000,         // 此网站需要更长加载时间
    viewport: {
      width: 1920,
      height: 1080
    }
  },
  // ... 其他配置
}
  `);
}

// 运行示例
async function runExamples() {
  console.log('🧪 MCP Jobs 爬虫配置示例\n');
  
  await basicExample();
  await debugExample();
  await customViewportExample();
  await environmentVariableExample();
  await siteSpecificExample();
  
  console.log('\n✨ 配置示例完成！');
  console.log('\n📚 更多信息请查看 README.md 中的调试和开发部分');
}

if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  basicExample,
  debugExample,
  customViewportExample,
  environmentVariableExample,
  siteSpecificExample
};
