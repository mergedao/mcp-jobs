import * as nodeCrypto from 'crypto';

/**
 * 待确认动作（半自动的核心闸门）：
 * stage 生成动作预览 → 用户在对话里确认 → confirm 才真正执行。
 * 30 分钟未确认自动过期（配额与日志照常把关）。
 */

export type PendingAction = {
  id: string;
  platform: string;
  kind: 'apply' | 'greet';
  url: string;
  title?: string;
  message?: string;
  stagedAt: number;
};

const pending = new Map<string, PendingAction>();
const TTL_MS = 30 * 60 * 1000;

export function stageAction(input: Omit<PendingAction, 'id' | 'stagedAt'>): PendingAction {
  // 清理过期
  for (const [id, p] of pending) {
    if (Date.now() - p.stagedAt > TTL_MS) pending.delete(id);
  }
  const action: PendingAction = { ...input, id: nodeCrypto.randomBytes(4).toString('hex'), stagedAt: Date.now() };
  pending.set(action.id, action);
  return action;
}

export function takeAction(id: string): PendingAction | null {
  const action = pending.get(id);
  if (!action) return null;
  if (Date.now() - action.stagedAt > TTL_MS) {
    pending.delete(id);
    return null;
  }
  pending.delete(id); // 一次性：取出即消费
  return action;
}

export function peekAction(id: string): PendingAction | null {
  return pending.get(id) ?? null;
}
