import type { CrawlerData, PageFailure } from '../crawler/webCrawler';

const maxBytes = 2 * 1024 * 1024;

function restrictedPage(location: string): PageFailure | undefined {
  const path = new URL(location).pathname;
  if (/(?:^|\/)(?:security|captcha|verify)(?:[./-]|$)/i.test(path)) return 'access_restricted';
  if (/(?:^|\/)(?:login|signin|passport)(?:[./-]|$)/i.test(path)) return 'login_required';
}

export async function readPublicHtml(
  url: string,
  parse: (html: string) => Record<string, unknown>,
  signal?: AbortSignal
): Promise<CrawlerData[]> {
  const fail = (failure: PageFailure): CrawlerData[] => [{ url, data: {}, timestamp: Date.now(), succeeded: false, failure }];
  try {
    const response = await fetch(url, { redirect: 'manual', signal });
    if (!response.ok) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (location && response.status >= 300 && response.status < 400) {
        return fail(restrictedPage(new URL(location, url).href) ?? 'unrecognized_page');
      }
      switch (response.status) {
        case 401: return fail('login_required');
        case 403: return fail('access_restricted');
        case 404:
        case 410: return fail('not_found');
        case 429: return fail('rate_limited');
        default: return fail('unavailable');
      }
    }

    const reader = response.body?.getReader();
    if (!reader || !response.headers.get('content-type')?.includes('text/html')) {
      await reader?.cancel();
      return fail('unrecognized_page');
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          return fail('unrecognized_page');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }

    const body = Buffer.concat(chunks);
    const charsets = response.headers.get('content-type') + ' ' + body.subarray(0, 4096).toString('ascii');
    const html = new TextDecoder(/charset\s*=\s*["']?gb(?:k|18030|2312)/i.test(charsets) ? 'gb18030' : 'utf-8').decode(body);
    if (/<title[^>]*>\s*(?:Security Verification|安全验证|访问验证)\s*<\/title>/i.test(html)) return fail('access_restricted');
    return [{ url, data: parse(html), timestamp: Date.now(), succeeded: true }];
  } catch {
    return fail(signal?.aborted ? 'timeout' : 'unavailable');
  }
}
