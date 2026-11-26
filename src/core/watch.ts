import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { profileDir } from './browser';
import { officialJobLink } from '../config/jobLinks';
import { jobSearchUrls, type JobPlatform } from '../config/urlConfig';
import { searchJobSources } from '../index';

const MAX_SEEN = 2000;
const PAGE_SIZE = 100;
const PENDING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
type Job = Awaited<ReturnType<typeof searchJobSources>>['jobs'][number];
type SourceBaseline = { seen: string[]; pending: Record<string, number>; checkedAt: number };
type Notice = { id: number; job: Job };
type Watch = {
  generation: number;
  sources: Record<string, SourceBaseline>;
  notices: Notice[];
  lastId: number;
};
const emptyWatch = (): Watch => ({ generation: 0, sources: {}, notices: [], lastId: 0 });

const watchDir = (id: string) => path.join(path.resolve(profileDir()) + '.watches', id);
const revisionFile = (revision: number) => String(revision).padStart(12, '0') + '.json';

function revisions(dir: string) {
  try {
    return fs.readdirSync(dir).filter(name => /^\d{12}\.json$/.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function readWatch(dir: string) {
  const latest = revisions(dir).at(-1);
  if (!latest) return { revision: 0, state: emptyWatch() };
  return {
    revision: Number(latest.slice(0, 12)),
    state: JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8')) as Watch
  };
}

function updateWatch<T>(dir: string, update: (state: Watch) => { result: T; changed: boolean }): T {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { revision, state } = readWatch(dir);
    const { result, changed } = update(state);
    if (!changed) return result;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, '.' + randomUUID());
    try {
      fs.writeFileSync(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600, flush: true });
      // A revision is claimed atomically. A competing writer must reload and merge.
      fs.linkSync(temp, path.join(dir, revisionFile(revision + 1)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return result;
  }
  throw new Error('监控状态正在更新，请重试');
}

export type WatchCheckArgs = { keyword: string; city?: string; platforms?: JobPlatform[] };

function watchKey(args: WatchCheckArgs) {
  const platforms = args.platforms?.length
    ? [...new Set(args.platforms)].sort()
    : jobSearchUrls.map(source => source.name).sort();
  const watchId = createHash('sha1')
    .update([args.keyword.trim().toLowerCase(), args.city?.trim() ?? '', platforms.join(',')].join('|'))
    .digest('hex').slice(0, 12);
  return { watchId, platforms };
}

export async function watchCheck(args: WatchCheckArgs, signal?: AbortSignal) {
  const { watchId, platforms } = watchKey(args);
  const dir = watchDir(watchId);
  const { state: initial } = readWatch(dir);
  const startedAt = Date.now();
  const { jobs, sources } = await searchJobSources({ ...args, platforms }, signal);
  const checkedAt = new Date();
  const now = checkedAt.getTime();
  const healthy = sources.filter(source => !source.partial && (source.status === 'ok' || source.status === 'empty'));
  return updateWatch(dir, state => {
    let baseline = false;
    let changed = false;
    if (!signal?.aborted && state.generation === initial.generation) {
      for (const source of healthy) {
        // A public listing and a complete search may represent different result sets.
        const key = source.source + ':' + source.coverage;
        const previous = state.sources[key];
        if (previous && previous.checkedAt > startedAt) continue;
        const current = new Map<string, Job>();
        for (const job of jobs) {
          if (job.source !== source.source || typeof job.jobDetail !== 'string') continue;
          const url = officialJobLink(job.jobDetail);
          if (url) current.set(url.origin + url.pathname, job);
        }
        if (!previous) {
          changed = true;
          state.sources[key] = { seen: [...current.keys()].slice(-MAX_SEEN), pending: {}, checkedAt: now };
          baseline = true;
          continue;
        }

        const seen = new Set(previous.seen);
        const pending: Record<string, number> = {};
        for (const [id, job] of current) {
          if (seen.has(id)) continue;
          const firstSeenAt = previous.pending[id];
          if (firstSeenAt !== undefined && now - firstSeenAt < PENDING_TTL_MS) {
            state.notices.push({ id: ++state.lastId, job });
            seen.add(id);
          } else {
            pending[id] = now;
          }
        }
        const nextSeen = [...seen].slice(-MAX_SEEN);
        const nextPending = Object.fromEntries(Object.entries(pending).slice(-MAX_SEEN));
        if (JSON.stringify(nextSeen) !== JSON.stringify(previous.seen) ||
            JSON.stringify(nextPending) !== JSON.stringify(previous.pending)) {
          changed = true;
          state.sources[key] = { seen: nextSeen, pending: nextPending, checkedAt: now };
        }
      }
    }
    const notices = signal?.aborted ? [] : state.notices.slice(0, PAGE_SIZE);
    return {
      changed,
      result: {
        watchId, keyword: args.keyword, city: args.city,
        newJobs: notices.map(({ id, job }) => ({ ...job, notificationId: id })),
        totalJobs: jobs.length, newCount: notices.length, baseline, sources,
        nextCursor: notices.at(-1)?.id, hasMore: state.notices.length > notices.length,
        checkedAt: checkedAt.toISOString()
      }
    };
  });
}

export function acknowledgeWatch(watchId: string, through: number) {
  if (typeof watchId !== 'string' || !/^[a-f0-9]{12}$/.test(watchId) || !Number.isSafeInteger(through) || through < 1) {
    throw new Error('watchId 或 through 无效');
  }
  return updateWatch(watchDir(watchId), state => {
    if (through > state.lastId ||
        (state.notices.length && through > (state.notices[PAGE_SIZE - 1] ?? state.notices.at(-1)!).id)) {
      throw new Error('只能确认已返回的一页通知');
    }
    const remaining = state.notices.filter(notice => notice.id > through);
    const changed = remaining.length !== state.notices.length;
    state.notices = remaining;
    return { changed, result: { watchId, through, acknowledged: true } };
  });
}

export function resetWatch(keyword: string, city?: string, platforms?: JobPlatform[]): string {
  const { watchId } = watchKey({ keyword, city, platforms });
  return updateWatch(watchDir(watchId), state => {
    state.generation++;
    state.sources = {};
    state.notices = [];
    return { changed: true, result: watchId };
  });
}
