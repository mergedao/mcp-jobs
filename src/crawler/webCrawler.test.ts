// src/crawler/webCrawler.test.ts
import { WebCrawler } from './webCrawler';
import { SiteConfig } from '../config/crawlerConfig';
import { chromium } from 'playwright';

// Mock Playwright
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn().mockResolvedValue({
      newContext: jest.fn().mockResolvedValue({
        newPage: jest.fn().mockResolvedValue({
          goto: jest.fn(),
          waitForSelector: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
          $$: jest.fn().mockResolvedValue([]), // Default mock for element selection
          isClosed: jest.fn().mockReturnValue(false),
        }),
        close: jest.fn().mockResolvedValue(undefined),
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Helper to get mocked Playwright objects
const mockedChromium = chromium as jest.Mocked<typeof chromium>;
const mockPage = {
  goto: jest.fn(),
  waitForSelector: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  $$: jest.fn().mockResolvedValue([]),
  textContent: jest.fn(),
  getAttribute: jest.fn(),
  innerHTML: jest.fn(),
  isClosed: jest.fn().mockReturnValue(false),
};
const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  // Configure the global mock to return our specific mocks
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newContext.mockResolvedValue(mockContext);
  mockContext.newPage.mockResolvedValue(mockPage);
  mockPage.isClosed.mockReturnValue(false); // Default to page not being closed
});

describe('WebCrawler', () => {
  let webCrawler: WebCrawler;
  const basicSiteConfig: SiteConfig = {
    url: 'http://example.com',
    name: 'example',
    rules: {
      title: { selector: 'h1', type: 'text' },
    },
    timeout: 5000, // Short timeout for tests
  };

  beforeEach(() => {
    webCrawler = new WebCrawler(false); // Disable debug logging for cleaner test output
  });

  afterEach(async () => {
    // Ensure crawler's browser resources are closed if a test failed to do so
    // or if a test doesn't involve calling close() itself.
    await webCrawler.close();
  });

  describe('handleUrl retry logic', () => {
    // Mock extractData to prevent actual data extraction logic from running
    // We are testing handleUrl's retry behavior, not extractData itself.
    let mockExtractData: jest.SpyInstance;

    beforeEach(() => {
      // @ts-ignore access private method for spying
      mockExtractData = jest.spyOn(WebCrawler.prototype as any, 'extractData')
        .mockResolvedValue({ rawData: { title: 'Mocked Title' }, processedData: { title: 'Mocked Title' } });
      mockPage.$$ = jest.fn().mockImplementation(async (selector) => {
        if (selector === 'h1') {
          return [{ textContent: async () => 'Mocked Title' }];
        }
        return [];
      });
    });

    afterEach(() => {
      mockExtractData.mockRestore();
    });

    test('should succeed on the first attempt if goto and extractData succeed', async () => {
      mockPage.goto.mockResolvedValueOnce(null); // Simulate successful navigation

      // @ts-ignore access private method for testing
      await webCrawler['handleUrl']('http://example.com', basicSiteConfig);

      expect(mockPage.goto).toHaveBeenCalledTimes(1);
      expect(mockPage.goto).toHaveBeenCalledWith('http://example.com', { waitUntil: 'domcontentloaded', timeout: 5000 });
      expect(mockExtractData).toHaveBeenCalledTimes(1);
      // @ts-ignore
      const data = webCrawler['crawledData'].get('example');
      expect(data).toHaveLength(1);
      expect(data![0].succeeded).toBe(true);
      expect(data![0].data.title).toBe('Mocked Title');
    });

    test('should retry and succeed if goto fails once then succeeds', async () => {
      mockPage.goto
        .mockRejectedValueOnce(new Error('Navigation failed')) // First attempt fails
        .mockResolvedValueOnce(null); // Second attempt succeeds

      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', { ...basicSiteConfig, retryDelayMs: 1 }); // Use short delay

      expect(mockPage.goto).toHaveBeenCalledTimes(2);
      expect(mockExtractData).toHaveBeenCalledTimes(1);
      // @ts-ignore
      const data = webCrawler['crawledData'].get('example');
      expect(data).toHaveLength(1);
      expect(data![0].succeeded).toBe(true);
      expect(data![0].data.title).toBe('Mocked Title');
    });

    test('should retry and fail if goto consistently fails, then save error data', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation failed consistently'));

      const configWithRetries: SiteConfig = {
        ...basicSiteConfig,
        maxRetries: 2, // Configure for 2 retries
        retryDelayMs: 1,
      };
      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', configWithRetries);

      expect(mockPage.goto).toHaveBeenCalledTimes(2); // Called twice (initial + 1 retry)
      expect(mockExtractData).not.toHaveBeenCalled();
      // @ts-ignore
      const data = webCrawler['crawledData'].get('example');
      expect(data).toHaveLength(1);
      expect(data![0].succeeded).toBe(false);
      expect(data![0].errors).toEqual(['Navigation failed consistently']);
    });
    
    test('should respect custom maxRetries and retryDelayMs from SiteConfig', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation failed'));

      const customConfig: SiteConfig = {
        ...basicSiteConfig,
        maxRetries: 1, // Only 1 attempt (initial call, 0 retries)
        retryDelayMs: 5,
      };
      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', customConfig);

      expect(mockPage.goto).toHaveBeenCalledTimes(1); // Called once (initial attempt only)
      // @ts-ignore
      const data = webCrawler['crawledData'].get('example');
      expect(data![0].succeeded).toBe(false);
      // Check if delay was respected (hard to test precisely without complex timer mocks)
      // We'll rely on the fact that playwright's waitForTimeout would have been called if retries happened.
    });

    test('should retry if extractData fails (if designed to trigger main retry loop)', async () => {
      mockPage.goto.mockResolvedValue(null); // Navigation succeeds
      mockExtractData
        .mockRejectedValueOnce(new Error('ExtractData failed')) // First extractData fails
        .mockResolvedValueOnce({ rawData: { title: 'Success Title' }, processedData: { title: 'Success Title' } }); // Second extractData succeeds

      const config: SiteConfig = {
        ...basicSiteConfig,
        maxRetries: 2,
        retryDelayMs: 1,
      };
      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', config);

      expect(mockPage.goto).toHaveBeenCalledTimes(2); // Called twice because the whole attempt is retried
      expect(mockExtractData).toHaveBeenCalledTimes(2);
      // @ts-ignore
      const data = webCrawler['crawledData'].get('example');
      expect(data).toHaveLength(1);
      expect(data![0].succeeded).toBe(true);
      expect(data![0].data.title).toBe('Success Title');
    });

    test('should use readinessSelector if provided', async () => {
      mockPage.goto.mockResolvedValueOnce(null);
      mockPage.waitForSelector.mockResolvedValueOnce(null); // Simulate selector found

      const configWithReadiness: SiteConfig = {
        ...basicSiteConfig,
        readinessSelector: '.ready',
      };
      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', configWithReadiness);

      expect(mockPage.goto).toHaveBeenCalledTimes(1);
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(1);
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.ready', { state: 'visible', timeout: 5000 });
      expect(mockExtractData).toHaveBeenCalledTimes(1);
      // @ts-ignore
      const data = webCrawler['crawledData'].get(configWithReadiness.name);
      expect(data![0].succeeded).toBe(true);
    });

    test('should proceed if readinessSelector times out (and log)', async () => {
      mockPage.goto.mockResolvedValueOnce(null);
      mockPage.waitForSelector.mockRejectedValueOnce(new Error('Timeout waiting for selector'));

      // Mock console.log to check for log messages
      const consoleLogSpy = jest.spyOn(console, 'log');

      const configWithReadiness: SiteConfig = {
        ...basicSiteConfig,
        readinessSelector: '.not-gonna-appear',
      };
      // @ts-ignore
      await webCrawler['handleUrl']('http://example.com', configWithReadiness);
      
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(1);
      expect(mockExtractData).toHaveBeenCalledTimes(1); // Should still attempt extraction
      // @ts-ignore
      const data = webCrawler['crawledData'].get(configWithReadiness.name);
      expect(data![0].succeeded).toBe(true); // Succeeded because extractData was mocked to succeed

      let foundLog = false;
      for (const call of consoleLogSpy.mock.calls) {
        if (typeof call[0] === 'string' && call[0].includes('Timeout or error waiting for readiness selector ".not-gonna-appear"')) {
          foundLog = true;
          break;
        }
      }
      expect(foundLog).toBe(true);
      consoleLogSpy.mockRestore();
    });
  });

  describe('setupBrowser and close', () => {
    test('should setup browser and context only once', async () => {
      // @ts-ignore
      await webCrawler['setupBrowser']();
      // @ts-ignore
      await webCrawler['setupBrowser'](); // Call again

      expect(chromium.launch).toHaveBeenCalledTimes(1);
      expect(mockBrowser.newContext).toHaveBeenCalledTimes(1);
      
      await webCrawler.close();
      expect(mockContext.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    test('close should be idempotent', async () => {
      // @ts-ignore
      await webCrawler['setupBrowser']();
      await webCrawler.close();
      await webCrawler.close(); // Call again

      expect(mockContext.close).toHaveBeenCalledTimes(1);
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });
  });
});

// Add more tests for other public methods if necessary (e.g., getData, clearData)
// For this task, focus is on retry logic and recent changes.
