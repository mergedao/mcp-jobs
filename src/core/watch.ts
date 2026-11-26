import * as fs from 'fs';
import * as path from 'path';
import * as nodeCrypto from 'crypto';
import { profileDir } from './browser';
import { platformApiSearch } from '../platforms/registry';
import { recordLogin } from './profileState';
import type { JobPlatform } from '../config/urlConfig';

/**
 * 职位监控（给 agent 的定时任务用）：
 * watch_check 用稳定的职位 URL 做增量 diff，服务端持久化已见集合——
 * agent 定时调用一次就拿到「新职位」，无状态、可重入、可多端复用。
 */

const WATCH_FILE = () => path.join(profileDir(), '..', 'watch-state.json');
const MAX_SEEN = 2000;

type WatchShape = {
  watches: Record<string, { seenIds: string[]; pendingIds: string[]; updatedAt: string; lastNewCount: number }>;
};

function readWatchState(): WatchShape {
  try {
    return JSON.parse(fs.readFileSync(WATCH_FILE(), 'utf8')) as WatchShape;
  } catch {
    return { watches: {} };
  }
}

function writeWatchState(state: WatchShape): void {
  try {
    fs.writeFileSync(WATCH_FILE(), JSON.stringify(state, null, 2));
  } catch { /* 状态文件失败不影响返回结果 */ }
}

export type WatchCheckArgs = {
  keyword: string;
  city?: string;
  page?: number;
  platforms?: JobPlatform[];
};

export type WatchCheckResult = {
  watchId: string;
  keyword: string;
  city?: string;
  newJobs: Array<Record<string, unknown>>;
  totalJobs: number;
  newCount: number;
  baseline: boolean;
  sources: Array<{ source: string; status: string; count: number }>;
  checkedAt: string;
};

export async function watchCheck(args: WatchCheckArgs): Promise<WatchCheckResult> {
  const platforms = args.platforms?.length ? args.platforms : (['zhipin', 'liepin', '51job', 'zhaopin'] as JobPlatform[]);
  const watchId = nodeCrypto.createHash('sha1')
    .update([args.keyword.trim().toLowerCase(), args.city?.trim() ?? '', [...platforms].sort().join(',')]
      .join('|'))
    .digest('hex')
    .slice(0, 12);

  const results = await Promise.all(platforms.map(platform =>
    platformApiSearch(platform, { keyword: args.keyword, city: args.city, page: args.page ?? 1 }, undefined, 25000)
  ));

  const jobs = results.flatMap((r, index) => {
    const items = r?.jobs ?? [];
    return items.map(job => ({ ...job, source: platforms[index] }));
  });

  const sources = results.map((r, index) => ({
    source: platforms[index],
    status: r?.status ?? 'unavailable',
    count: r?.jobs.length ?? 0
  }));

  // 职位身份 = 详情 URL 去掉查询串（追踪参数如 51job 的 req= 每次请求都变，不能当主键）
  const jobIdOf = (job: Record<string, unknown>): string => {
    const raw = String(job.jobDetail ?? '');
    try {
      const url = new URL(raw);
      return url.origin + url.pathname;
    } catch {
      return raw;
    }
  };

  const state = readWatchState();
  const entry = state.watches[watchId] ?? { seenIds: [], pendingIds: [], updatedAt: '', lastNewCount: 0 };
  const isFirstBaseline = entry.seenIds.length === 0 && entry.pendingIds.length === 0;

  // 当前快照
  const currentById = new Map<string, Record<string, unknown>>();
  for (const job of jobs) {
    const id = jobIdOf(job);
    if (id && !currentById.has(id)) currentById.set(id, job);
  }
  const currentIds = [...currentById.keys()];

  // 基线：首次调用只记录「开监控时已存在的职位」，不报告（它们不是新的）
  if (isFirstBaseline) {
    state.watches[watchId] = {
      seenIds: currentIds.slice(-MAX_SEEN),
      pendingIds: [],
      updatedAt: new Date().toISOString(),
      lastNewCount: 0
    };
    writeWatchState(state);
    return {
      watchId,
      keyword: args.keyword,
      city: args.city,
      newJobs: [],
      totalJobs: jobs.length,
      newCount: 0,
      baseline: true,
      sources,
      checkedAt: new Date().toISOString()
    };
  }

  const seen = new Set(entry.seenIds);
  const pending = new Set(entry.pendingIds);

  // 二次确认：上一轮候选里、本轮仍在场的、且从未报告过的 → 确认为新职位。
  // 源结果页自身轮动（广告位/第 1 页抽样漂移）只出现一轮就会被自然过滤。
  const confirmedIds = [...pending].filter(id => currentById.has(id) && !seen.has(id));
  const newJobs = confirmedIds.map(id => currentById.get(id)!).filter(Boolean);

  // 候选更新：本轮新出现且未报告过的进候选；已报告的进 seen；消失的候选直接淘汰
  for (const id of confirmedIds) {
    seen.add(id);
    pending.delete(id);
  }
  for (const id of currentIds) {
    if (!seen.has(id)) pending.add(id);
  }
  for (const id of [...pending]) {
    if (!currentById.has(id)) pending.delete(id); // 上轮候选本轮消失 → 轮动噪声，淘汰
  }

  state.watches[watchId] = {
    seenIds: [...seen].slice(-MAX_SEEN),
    pendingIds: [...pending].slice(-MAX_SEEN),
    updatedAt: new Date().toISOString(),
    lastNewCount: newJobs.length
  };
  writeWatchState(state);

  return {
    watchId,
    keyword: args.keyword,
    city: args.city,
    newJobs,
    totalJobs: jobs.length,
    newCount: newJobs.length,
    baseline: isFirstBaseline,
    sources,
    checkedAt: new Date().toISOString()
  };
}

export function resetWatch(keyword: string, city?: string, platforms?: JobPlatform[]): string {
  const list = platforms?.length ? platforms : (['zhipin', 'liepin', '51job', 'zhaopin'] as JobPlatform[]);
  const watchId = nodeCrypto.createHash('sha1')
    .update([keyword.trim().toLowerCase(), city?.trim() ?? '', [...list].sort().join(',')].join('|'))
    .digest('hex')
    .slice(0, 12);
  const state = readWatchState();
  delete state.watches[watchId];
  writeWatchState(state);
  return watchId;
}

// 登录成功时同步记录（registry 会调用）
export { recordLogin };
