const platforms = [
  'zhipin.com', 'liepin.com', 'zhaopin.com', '51job.com'
];

export function officialJobLink(value: string, base?: string): URL | undefined {
  try {
    const url = new URL(value, base);
    const allowed = platforms.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    if (allowed && url.protocol === 'https:' && !url.username && !url.password && !url.port) return url;
  } catch {
    // Invalid or unsupported input.
  }
  return undefined;
}

export function jobPlatform(url: URL) {
  return platforms.find(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))?.split('.')[0];
}
