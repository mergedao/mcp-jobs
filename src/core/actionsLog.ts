import * as fs from 'fs';
import * as path from 'path';
import { profileDir } from './browser';

/**
 * 写操作（投递/打招呼）的配额与日志：
 * 每平台每日硬上限（BOSS 非会员 ~10，社区实证），全部动作留痕可审计。
 * 半自动约定：执行前必须有人工确认记录（confirmedBy）。
 */

const ACTIONS_FILE = () => path.join(profileDir(), '..', 'actions-log.json');

export const DAILY_CAPS: Record<string, number> = {
  zhipin: 10,
  zhaopin: 15,
  liepin: 10,
  '51job': 10
};

export type ActionRecord = {
  id: string;
  platform: string;
  kind: 'apply' | 'greet';
  jobUrl: string;
  jobTitle?: string;
  message?: string;
  at: string;
  result: 'ok' | 'failed' | 'unknown';
  detail?: string;
};

type ActionsShape = {
  days: Record<string, Record<string, ActionRecord[]>>; // 'YYYY-MM-DD' → platform → records
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readActions(): ActionsShape {
  try {
    return JSON.parse(fs.readFileSync(ACTIONS_FILE(), 'utf8')) as ActionsShape;
  } catch {
    return { days: {} };
  }
}

function writeActions(state: ActionsShape): void {
  try {
    fs.mkdirSync(path.dirname(ACTIONS_FILE()), { recursive: true });
    fs.writeFileSync(ACTIONS_FILE(), JSON.stringify(state, null, 2));
  } catch { /* 日志失败不影响动作本身 */ }
}

export function todayCount(platform: string): number {
  const state = readActions();
  return (state.days[today()]?.[platform] ?? []).length;
}

export function quotaLeft(platform: string): number {
  const cap = DAILY_CAPS[platform] ?? 10;
  return Math.max(0, cap - todayCount(platform));
}

export function logAction(record: Omit<ActionRecord, 'id' | 'at'>): ActionRecord {
  const state = readActions();
  const day = today();
  state.days[day] = state.days[day] ?? {};
  state.days[day][record.platform] = state.days[day][record.platform] ?? [];
  const full: ActionRecord = {
    ...record,
    id: `${record.platform}-${record.kind}-${Date.now()}`,
    at: new Date().toISOString()
  };
  state.days[day][record.platform].push(full);
  writeActions(state);
  return full;
}

/** 审计：最近 N 条动作。 */
export function recentActions(limit = 20): ActionRecord[] {
  const state = readActions();
  const all: ActionRecord[] = [];
  for (const day of Object.keys(state.days).sort().reverse()) {
    for (const platform of Object.keys(state.days[day])) {
      all.push(...state.days[day][platform]);
    }
    if (all.length >= limit) break;
  }
  return all.slice(0, limit);
}
