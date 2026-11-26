import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { officialJobLink } from '../config/jobLinks';
import { profileDir } from './browser';

export const TRACKED_PLATFORMS = ['51job', 'liepin', 'zhipin', 'zhaopin'] as const;
export const APPLICATION_STATUSES = ['submitted', 'viewed', 'interview', 'rejected', 'withdrawn', 'closed', 'unknown'] as const;
export const SYNC_STATUSES = ['ok', 'login_required', 'session_expired', 'unavailable'] as const;

type Platform = typeof TRACKED_PLATFORMS[number];
type ApplicationStatus = typeof APPLICATION_STATUSES[number];
type SyncStatus = typeof SYNC_STATUSES[number];
type Scope = { platform: Platform; accountId: string };
type Job = { jobId: string; url: string; title?: string; company?: string };
type Application = Job & {
  status: ApplicationStatus | 'prepared';
  source: 'local' | 'user_reported';
  observedAt: string;
  resumeVersion?: string;
  submittedAt?: string;
  receiptReference?: string;
  needsVerificationAt?: string;
};
type Update =
  | { type: 'application'; application: Application; changed: boolean }
  | { type: 'reply'; conversationId: string; messageId: string; occurredAt: string; company?: string; jobId?: string };
type Entry =
  | { type: 'update'; events: Update[]; sync?: { status: SyncStatus; checkedAt: string } }
  | { type: 'ack'; consumer: string; through: number };

function text(value: unknown, field: string, limit = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${field} 无效`);
  return value.trim();
}

function optionalText(value: unknown, field: string, limit?: number): string | undefined {
  return value === undefined ? undefined : text(value, field, limit);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记录格式无效');
  return value as Record<string, unknown>;
}

export function isTrackedPlatform(value: unknown): value is Platform {
  return TRACKED_PLATFORMS.some(platform => platform === value);
}

function scopeOf(fields: Record<string, unknown>): Scope {
  if (!isTrackedPlatform(fields.platform)) throw new Error('投递追踪仅支持 51job、猎聘、BOSS 直聘和智联');
  const accountId = text(fields.accountId, 'accountId', 64);
  if (!/^[a-z0-9_-]+$/i.test(accountId)) throw new Error('accountId 应为本地账号代号');
  return { platform: fields.platform, accountId };
}

function jobOf(platform: Platform, fields: Record<string, unknown>): Job {
  const url = officialJobLink(text(fields.url, 'url', 2048));
  if (!url) throw new Error('需要官方 HTTPS 职位链接');
  const paths: Record<Platform, RegExp> = {
    liepin: /^https:\/\/(?:www|m)\.liepin\.com\/(?:job\/(\d+)|a\/([A-Za-z0-9]+))\.shtml$/,
    '51job': /^https:\/\/(?:jobs|msearch)\.51job\.com\/(?:jobs\/)?[a-z0-9-]+\/(\d+)\.html$/i,
    zhipin: /^https:\/\/(?:www|m)\.zhipin\.com\/job_detail\/([A-Za-z0-9_-]+)\.html$/,
    zhaopin: /^https:\/\/(?:www\.zhaopin\.com\/jobdetail|m\.zhaopin\.com\/jobs)\/([A-Za-z0-9]+)\.htm$/
  };
  const match = paths[platform].exec(url.origin + url.pathname);
  if (!match) throw new Error('职位链接与所选平台不匹配');
  url.search = '';
  url.hash = '';
  if (platform === 'liepin') url.hostname = 'www.liepin.com';
  return {
    jobId: match[1] ?? match[2],
    url: url.href,
    title: optionalText(fields.title, 'title'),
    company: optionalText(fields.company, 'company')
  };
}

function timestamp(value: unknown, field: string): string {
  const input = text(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) ||
      !Number.isFinite(Date.parse(input))) throw new Error(`${field} 需要带时区的 ISO 时间`);
  return new Date(input).toISOString();
}

function ledgerPath(scope: Scope): string {
  const key = createHash('sha256').update(scope.accountId).digest('hex');
  return join(`${resolve(profileDir())}.application-tracker`, scope.platform, key);
}

function loadLedger(dir: string): Entry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.filter(name => /^\d{12}\.json$/.test(name)).sort().map((name, index) => {
    if (Number(name.slice(0, 12)) !== index + 1) throw new Error('投递追踪记录不连续');
    return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Entry;
  });
}

/** Publish complete ledger entries atomically. A competing process retries against the new revision. */
function transact<T>(scope: Scope, update: (entries: Entry[]) => { entry?: Entry; result: T }): T {
  const dir = ledgerPath(scope);
  for (let attempt = 0; attempt < 8; attempt++) {
    const entries = loadLedger(dir);
    const { entry, result } = update(entries);
    if (!entry) return result;

    mkdirSync(dir, { mode: 0o700, recursive: true });
    const temp = join(dir, `.${randomUUID()}.tmp`);
    const handle = openSync(temp, 'wx', 0o600);
    try {
      try {
        writeFileSync(handle, JSON.stringify(entry));
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      linkSync(temp, join(dir, `${String(entries.length + 1).padStart(12, '0')}.json`));
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      try { unlinkSync(temp); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  throw new Error('投递追踪正在被其他进程更新，请重试');
}

function project(entries: Entry[]) {
  const applications = new Map<string, Application>();
  const replies = new Set<string>();
  const cursors = new Map<string, number>();
  let sync: Extract<Entry, { type: 'update' }>['sync'];
  for (const entry of entries) {
    if (entry.type === 'ack') {
      cursors.set(entry.consumer, entry.through);
      continue;
    }
    if (entry.sync) sync = entry.sync;
    for (const event of entry.events) {
      if (event.type === 'application') applications.set(event.application.jobId, event.application);
      else replies.add(JSON.stringify([event.conversationId, event.messageId]));
    }
  }
  return { applications, replies, cursors, sync };
}

export function prepareTrackedApplication(fields: Record<string, unknown>) {
  const scope = scopeOf(fields);
  const job = jobOf(scope.platform, fields);
  const resumeVersion = optionalText(fields.resumeVersion, 'resumeVersion');
  return transact(scope, entries => {
    const previous = project(entries).applications.get(job.jobId);
    if (previous) return {
      result: { ...scope, status: 'already_tracked', application: previous, browserUrl: previous.url }
    };
    const application: Application = { ...job, status: 'prepared', source: 'local', observedAt: new Date().toISOString(), resumeVersion };
    return {
      result: { ...scope, status: 'manual_required', application, browserUrl: job.url, instruction: '请在官方页面核对职位、简历或沟通文案，完成操作后回填结果。' },
      entry: { type: 'update', events: [{ type: 'application', application, changed: false }] }
    };
  });
}

export function listApplications(fields: Record<string, unknown>) {
  const scope = scopeOf(fields);
  const { applications, sync } = project(loadLedger(ledgerPath(scope)));
  const limit = fields.limit === undefined ? 100 : fields.limit;
  const offset = fields.offset === undefined ? 0 : fields.offset;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('limit 必须是 1 至 100 的整数，offset 必须是非负整数');
  }
  const sorted = [...applications.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.jobId.localeCompare(b.jobId));
  const page = sorted.slice(offset, offset + limit);
  return {
    ...scope,
    sync: sync ?? { status: 'not_synced' },
    applications: page,
    total: sorted.length,
    nextOffset: offset + page.length < sorted.length ? offset + page.length : null
  };
}

export function importFeedback(fields: Record<string, unknown>) {
  const scope = scopeOf(fields);
  const checks = fields.events === undefined ? [] : fields.events;
  if (!Array.isArray(checks) || checks.length > 25) throw new Error('每次最多导入 25 条动态');
  const status = fields.syncStatus;
  if (status !== undefined && !SYNC_STATUSES.some(candidate => candidate === status)) throw new Error('同步状态无效');
  if (!checks.length && status === undefined) throw new Error('请提供动态或同步状态');
  if (checks.length && status !== undefined && status !== 'ok') throw new Error('同步失败请单独上报，保留上次已知状态');

  return transact(scope, entries => {
    const { applications, replies } = project(entries);
    const events: Update[] = [];
    let duplicates = 0;
    for (const value of checks) {
      const input = record(value);
      if (input.type === 'application') {
        const job = jobOf(scope.platform, input);
        const next = input.status as ApplicationStatus;
        if (!APPLICATION_STATUSES.includes(next)) throw new Error('投递状态无效');
        const observedAt = timestamp(input.observedAt, 'observedAt');
        const previous = applications.get(job.jobId);
        if (next === 'unknown' && previous?.source === 'user_reported' && previous.status !== 'unknown') {
          if (observedAt <= (previous.needsVerificationAt ?? previous.observedAt)) {
            duplicates++;
            continue;
          }
          const application = { ...previous, needsVerificationAt: observedAt };
          applications.set(job.jobId, application);
          events.push({ type: 'application', application, changed: false });
          continue;
        }
        if (previous?.source === 'user_reported' && observedAt <= previous.observedAt) {
          duplicates++;
          continue;
        }
        const application: Application = {
          ...job,
          title: job.title ?? previous?.title,
          company: job.company ?? previous?.company,
          resumeVersion: optionalText(input.resumeVersion, 'resumeVersion') ?? previous?.resumeVersion,
          status: next,
          source: 'user_reported',
          observedAt,
          receiptReference: optionalText(input.receiptReference, 'receiptReference') ?? previous?.receiptReference,
          needsVerificationAt: previous?.needsVerificationAt && observedAt < previous.needsVerificationAt
            ? previous.needsVerificationAt : undefined,
          submittedAt: previous?.submittedAt ?? (next === 'submitted' ? observedAt : undefined)
        };
        applications.set(job.jobId, application);
        events.push({ type: 'application', application, changed: previous?.status !== next });
      } else if (input.type === 'reply') {
        const conversationId = text(input.conversationId, 'conversationId');
        const messageId = text(input.messageId, 'messageId');
        const key = JSON.stringify([conversationId, messageId]);
        const occurredAt = timestamp(input.occurredAt, 'occurredAt');
        const company = optionalText(input.company, 'company');
        const jobId = input.url === undefined ? undefined : jobOf(scope.platform, input).jobId;
        if (replies.has(key)) {
          duplicates++;
          continue;
        }
        replies.add(key);
        events.push({ type: 'reply', conversationId, messageId, occurredAt, company, jobId });
      } else {
        throw new Error('动态类型必须为 application 或 reply');
      }
    }
    const sync = status === undefined ? undefined : { status: status as SyncStatus, checkedAt: new Date().toISOString() };
    return {
      entry: events.length || sync ? { type: 'update', events, sync } : undefined,
      result: { ...scope, recorded: events.length, duplicates, source: 'user_reported', sync }
    };
  });
}

function feedbackWindow(entries: Entry[], cursor: number) {
  const updates: Array<{ revision: number; entry: Extract<Entry, { type: 'update' }> }> = [];
  for (let index = cursor; index < entries.length && updates.length < 11; index++) {
    const entry = entries[index];
    if (entry.type === 'update') updates.push({ revision: index + 1, entry });
  }
  const page = updates.slice(0, 10);
  return {
    nextCursor: page[page.length - 1]?.revision ?? cursor,
    hasMore: updates.length > 10,
    events: page.flatMap(({ entry, revision }) => entry.events
      .flatMap((event, index) => event.type === 'application' && !event.changed ? []
        : [{ ...event, revision, notificationId: `${revision}:${index}` }]))
  };
}

export function checkTrackedFeedback(fields: Record<string, unknown>) {
  const scope = scopeOf(fields);
  const consumer = optionalText(fields.consumer, 'consumer', 80) ?? 'workbuddy';
  const entries = loadLedger(ledgerPath(scope));
  const { sync, cursors } = project(entries);
  const cursor = cursors.get(consumer) ?? 0;
  const window = feedbackWindow(entries, cursor);
  const status = window.events.length ? 'updates_available'
    : window.hasMore ? 'more_available'
    : sync?.status === 'ok' ? 'no_updates'
    : sync?.status ?? 'not_synced';
  return {
    ...scope,
    consumer,
    cursor,
    status,
    source: 'user_reported',
    sync: sync ?? { status: 'not_synced' },
    ...window
  };
}

export function acknowledgeFeedback(fields: Record<string, unknown>) {
  const scope = scopeOf(fields);
  const consumer = optionalText(fields.consumer, 'consumer', 80) ?? 'workbuddy';
  const cursor = fields.cursor;
  const through = fields.through;
  if (typeof cursor !== 'number' || typeof through !== 'number' ||
      !Number.isSafeInteger(cursor) || !Number.isSafeInteger(through) || cursor < 0 || through < cursor) {
    throw new Error('反馈游标无效');
  }
  return transact(scope, entries => {
    const current = project(entries).cursors.get(consumer) ?? 0;
    if (through <= current) return { result: { ...scope, consumer, cursor: current } };
    if (cursor !== current || through > feedbackWindow(entries, current).nextCursor || entries[through - 1]?.type !== 'update') throw new Error('反馈游标已变化，请重新读取动态');
    return { entry: { type: 'ack', consumer, through }, result: { ...scope, consumer, cursor: through } };
  });
}
