import { activateTab, ensureManagedChrome, managedCdpUrl, openPage } from './browser';
import { recordLogin } from './profileState';

export type LoginPlatform = 'zhipin' | 'zhaopin' | 'liepin' | '51job';

const LOGIN_PAGES: Record<LoginPlatform, string> = {
  zhipin: 'https://www.zhipin.com/web/user/?ka=header-login',
  zhaopin: 'https://passport.zhaopin.com/login',
  liepin: 'https://account.liepin.com/account/v4/#/login',
  '51job': 'https://www.51job.com/'
};

export async function startPlatformLogin(platform: LoginPlatform, signal?: AbortSignal) {
  const browserUrl = LOGIN_PAGES[platform];
  const waiting = { platform, status: 'manual_required', browserUrl, detail: '请在官方页面完成登录。' };
  if (platform === '51job' || signal?.aborted || !(await ensureManagedChrome())) return waiting;
  if (signal?.aborted) return waiting;
  const cdpUrl = managedCdpUrl();
  const tabId = await openPage(cdpUrl, browserUrl);
  if (!tabId || signal?.aborted) return waiting;
  await activateTab(cdpUrl, tabId);
  return { ...waiting, status: 'waiting', detail: '已打开官方登录页。完成后可另行检查会话状态。' };
}

export function confirmLogin(platform: LoginPlatform) {
  recordLogin(platform);
  return { platform, status: 'user_reported', detail: '已保存用户确认时间。当前会话仍需单独核对。' };
}
