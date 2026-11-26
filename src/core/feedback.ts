import { managedCdpUrl } from '../core/browser';
import { rawConnect, rawSend, httpJson, pause } from './cdp';

/**
 * 反馈捕获（BOSS）：聊天页面的会话/回复列表走被动监听——
 * 打开聊天页，SPA 自己拉会话列表和消息，我们只听 Network 响应，零页面操作。
 */

const CHAT_PAGE_URL = 'https://www.zhipin.com/web/common/chat/im';

export type BossChatSummary = {
  status: 'ok' | 'unknown';
  detail: string;
  conversations: Array<{ name?: string; lastMessage?: string; url?: string }>;
};

/** 打开聊天页并捕获会话列表相关响应（返回原始 JSON 数组，shape 由调用方宽容解析）。 */
export async function captureBossChats(timeoutMs = 20000): Promise<BossChatSummary> {
  const cdpUrl = managedCdpUrl();
  const tabs = await httpJson<any[]>(`${cdpUrl}/json/list`);
  const tab = (tabs ?? []).find((t: any) => t.type === 'page' && /zhipin\.com/.test(t.url ?? ''));
  if (!tab) return { status: 'unknown', detail: '未发现 BOSS 标签页', conversations: [] };
  const session = await rawConnect(tab.webSocketDebuggerUrl).catch(() => null);
  if (!session) return { status: 'unknown', detail: 'CDP 会话失败', conversations: [] };

  await rawSend(session, 'Network.enable').catch(() => {});
  await rawSend(session, 'Page.enable').catch(() => {});

  const bodies: unknown[] = [];
  return new Promise(resolve => {
    let settled = false;
    const pendingDocs = new Set<string>();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.listeners.delete(handler);
      // 汇总：宽容遍历所有 JSON，找含会话特征（friendList/chatList/conversations）的结构
      const conversations: Array<{ name?: string; lastMessage?: string; url?: string }> = [];
      for (const body of bodies) {
        walkArrays(body, (arr, path) => {
          if (arr.length && arr[0] && typeof arr[0] === 'object') {
            const first = arr[0] as Record<string, unknown>;
            if (('friendId' in first || 'encryptFriendId' in first || 'name' in first) && ('lastContent' in first || 'lastMsg' in first || 'content' in first || 'updateTime' in first)) {
              for (const item of arr.slice(0, 20)) {
                const o = item as Record<string, unknown>;
                conversations.push({
                  name: typeof o.name === 'string' ? o.name : typeof o.friendName === 'string' ? o.friendName : undefined,
                  lastMessage: typeof o.lastContent === 'string' ? o.lastContent : typeof o.lastMsg === 'string' ? o.lastMsg : undefined,
                  url: path
                });
              }
            }
          }
        });
      }
      resolve({
        status: conversations.length ? 'ok' : 'unknown',
        detail: conversations.length
          ? `捕获 ${conversations.length} 个会话（含招聘方回复状态）`
          : '未捕获到会话列表（页面可能还在加载）',
        conversations: conversations.slice(0, 20)
      });
    };
    const walkArrays = (v: any, cb: (arr: any[], path: string) => void, d = 0, path = '') => {
      if (d > 8 || !v || typeof v !== 'object') return;
      if (Array.isArray(v)) { cb(v, path); v.forEach((e, i) => walkArrays(e, cb, d + 1, `${path}[${i}]`)); return; }
      for (const [k, c] of Object.entries(v)) walkArrays(c, cb, d + 1, path + '.' + k);
    };
    const handler = (msg: any) => {
      // responseReceived 与 loadingFinished 是互斥事件，必须同级判断——
      // 嵌套写法会导致 body 读取分支永远不可达（review P1 修复）
      if (msg.method === 'Network.responseReceived') {
        const url = String(msg.params?.response?.url ?? '');
        if (/zhipin\.com/.test(url) && /(chat|friend|message|im)/i.test(url) && !/\.(js|css|png|gif|woff)/i.test(url)) {
          pendingDocs.add(String(msg.params.requestId));
        }
      }
      if (msg.method === 'Network.loadingFinished' && pendingDocs.has(String(msg.params?.requestId))) {
        const id = String(msg.params.requestId);
        pendingDocs.delete(id);
        rawSend<{ body: string; base64Encoded: boolean }>(session, 'Network.getResponseBody', { requestId: id })
          .then(body => {
            const parsed = safeJsonParseCompat(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body);
            if (parsed) bodies.push(parsed);
          })
          .catch(() => {});
      }
    };
    session.listeners.add(handler);
    const timer = setTimeout(finish, Math.max(timeoutMs, 5000));
    void timer;
    // 导航到聊天页触发 SPA 拉会话
    rawSend(session, 'Page.navigate', { url: CHAT_PAGE_URL }).catch(() => finish());
    // 导航后延迟收尾（等延迟加载的消息列表）
    pause(Math.max(timeoutMs - 3000, 8000)).then(() => { if (!settled) finish(); });
  });
}

function safeJsonParseCompat(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}
