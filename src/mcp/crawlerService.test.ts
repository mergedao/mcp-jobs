// src/mcp/crawlerService.test.ts
import { CrawlerService } from './crawlerService';
import { WebCrawler } from '../crawler/webCrawler';
import { SiteConfig } from '../config/crawlerConfig';

// Mock WebCrawler
jest.mock('../crawler/webCrawler', () => {
  return {
    WebCrawler: jest.fn().mockImplementation(() => {
      return {
        crawl: jest.fn().mockResolvedValue(undefined),
        getData: jest.fn().mockReturnValue([]),
        close: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

const MockedWebCrawler = WebCrawler as jest.MockedClass<typeof WebCrawler>;
let mockCrawl: jest.Mock;
let mockGetData: jest.Mock;
let mockClose: jest.Mock;

describe('CrawlerService', () => {
  let crawlerService: CrawlerService;
  let mockWebCrawlerInstance: WebCrawler;

  beforeEach(() => {
    // Clear all previous mock data and implementations
    MockedWebCrawler.mockClear();
    
    // Setup new mocks for each test
    mockCrawl = jest.fn().mockResolvedValue(undefined);
    mockGetData = jest.fn().mockReturnValue([{ url: 'http://example.com', data: {}, timestamp: Date.now(), succeeded: true }]);
    mockClose = jest.fn().mockResolvedValue(undefined);

    MockedWebCrawler.mockImplementation(() => ({
      crawl: mockCrawl,
      getData: mockGetData,
      close: mockClose,
      // Add other methods if they are called and need specific mock implementations
    })) as any;
    
    crawlerService = new CrawlerService();
    // Access the instance created by the service
    mockWebCrawlerInstance = MockedWebCrawler.mock.instances[0] as WebCrawler;
  });

  afterEach(async () => {
    // Ensure the service's crawler close method is called if applicable
    // This might be redundant if tests explicitly call service.close()
    // await crawlerService.close(); 
  });

  describe('startCrawling URL construction', () => {
    const baseConfig: SiteConfig = {
      url: 'http://example.com/search',
      name: 'test-site',
      rules: {},
    };

    test('should correctly append keyword to a URL without existing query parameters', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await crawlerService.startCrawling({ ...baseConfig }, { keyword: 'typescript' });
      
      expect(mockCrawl).toHaveBeenCalledTimes(1);
      const calledConfig = mockCrawl.mock.calls[0][0] as SiteConfig;
      expect(calledConfig.url).toBe('http://example.com/search?keyword=typescript');
      consoleLogSpy.mockRestore();
    });

    test('should correctly append keyword to a URL with existing query parameters', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const configWithParams: SiteConfig = {
        ...baseConfig,
        url: 'http://example.com/search?city=london',
      };
      await crawlerService.startCrawling(configWithParams, { keyword: 'javascript' });
      
      expect(mockCrawl).toHaveBeenCalledTimes(1);
      const calledConfig = mockCrawl.mock.calls[0][0] as SiteConfig;
      expect(calledConfig.url).toBe('http://example.com/search?city=london&keyword=javascript');
      consoleLogSpy.mockRestore();
    });

    test('should not modify URL if no keyword is provided', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await crawlerService.startCrawling({ ...baseConfig }, {}); // No params.keyword
      
      expect(mockCrawl).toHaveBeenCalledTimes(1);
      const calledConfig = mockCrawl.mock.calls[0][0] as SiteConfig;
      expect(calledConfig.url).toBe('http://example.com/search');
      consoleLogSpy.mockRestore();
    });

    test('should append an empty keyword if keyword is an empty string', async () => {
      // Current implementation appends `keyword=` if params.keyword is ''
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await crawlerService.startCrawling({ ...baseConfig }, { keyword: '' });
      
      expect(mockCrawl).toHaveBeenCalledTimes(1);
      const calledConfig = mockCrawl.mock.calls[0][0] as SiteConfig;
      expect(calledConfig.url).toBe('http://example.com/search?keyword=');
      consoleLogSpy.mockRestore();
    });

    test('should handle invalid base URL gracefully and log an error', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const invalidBaseConfig: SiteConfig = {
        ...baseConfig,
        url: 'this is not a valid url',
      };
      await crawlerService.startCrawling(invalidBaseConfig, { keyword: 'test' });

      expect(mockCrawl).toHaveBeenCalledTimes(1);
      const calledConfig = mockCrawl.mock.calls[0][0] as SiteConfig;
      // The URL should remain the invalid one as URL construction will fail
      expect(calledConfig.url).toBe('this is not a valid url'); 
      
      let foundErrorLog = false;
      for (const call of consoleErrorSpy.mock.calls) {
        if (typeof call[0] === 'string' && call[0].includes('[CrawlerService] Error constructing URL with keyword')) {
          foundErrorLog = true;
          break;
        }
      }
      expect(foundErrorLog).toBe(true);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('close method', () => {
    test('should call crawler.close when service.close is called', async () => {
      await crawlerService.close();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
