import { managedCdpUrl } from '../core/browser';
import { domBoxCenter, domSearch, humanClickAt, humanType, pause, waitForText } from '../core/cdp';
import { logAction } from '../core/actionsLog';
import type { RawSession } from '../core/cdp';

/**
 * BOSS 直聘写操作（半自动，纯模拟点击，不碰任何接口）：
 * 实测行为：点击「立即沟通」= BOSS 立即自动发送默认招呼语并翻转为「继续沟通」。
 * 自定义文案作为后续聊天消息补发（textarea.input-area → 逐字输入 → 严格匹配「发送」点击）。
 * 判断依据只用页面真实状态（按钮翻转/已发送标记），不用本地配额计数（服务端配额才是真配额）。
 * 注意：可能遇到隐私设置类弹窗——流程会如实上报，由用户处理。
 */

const ACTION_PAGE_ROLE = 'zhipin';

export type ApplyResult = {
  status: 'ok' | 'already_applied' | 'failed' | 'login_required' | 'unknown';
  detail: string;
  note?: string;
};

/** 严格文本匹配点击：html.trim() === text 才点（防止「发送」误匹配「发送验证码」）。 */
async function clickButtonByTextStrict(session: RawSession, texts: string[]): Promise<{ clicked: boolean; matched: string }> {
  for (const text of texts) {
    const nodes = await domSearch(session, text, 6);
    for (const node of nodes) {
      if (node.html.trim() !== text) continue; // 严格等值
      const box = await domBoxCenter(session, node.nodeId);
      if (box && box.x > 0 && box.y > 0) {
        await humanClickAt(session, box.x, box.y);
        return { clicked: true, matched: text };
      }
    }
  }
  return { clicked: false, matched: '' };
}

export async function applyZhipinJob(jobUrl: string, message: string | undefined, jobTitle: string | undefined): Promise<ApplyResult> {
  const platform = 'zhipin';
  const page = await (async () => {
    const { rawDomPage } = await import('../core/cdp');
    return rawDomPage(managedCdpUrl(), ACTION_PAGE_ROLE, jobUrl);
  })();
  if (!page) return { status: 'failed', detail: '页面会话创建失败' };
  const { session } = page;

  try {
    // 等职位卡片渲染（「立即沟通」或「继续沟通」出现其一）
    const ready = await waitForText(session, '立即沟通', 15000);
    const continuedBtn = ready ? [] : await domSearch(session, '继续沟通', 2);
    if (!ready && !continuedBtn.length) {
      return { status: 'failed', detail: '页面上未找到沟通按钮（可能需要登录或页面改版）' };
    }

    if (!ready && continuedBtn.length) {
      // 已沟通过：补发自定义文案（可选）
      if (message) {
        const followUp = await sendFollowUpMessage(session, message);
        return { status: followUp ? 'ok' : 'unknown', detail: followUp ? '已沟通过；自定义补充消息已发送' : '已沟通过；补充消息发送状态未确认，请人工核对' };
      }
      return { status: 'already_applied', detail: '该职位已沟通过（BOSS 显示「继续沟通」）' };
    }

    // 点击「立即沟通」→ BOSS 自动发送默认招呼语并翻转为「继续沟通」
    const clicked = await clickButtonByTextStrict(session, ['立即沟通']);
    if (!clicked.clicked) {
      return { status: 'failed', detail: '「立即沟通」按钮点击失败' };
    }

    // 以页面真实状态判定成功：按钮翻转 或 出现「已发送」
    await pause(2500 + Math.floor(Math.random() * 1500));
    const flipped = await domSearch(session, '继续沟通', 2);
    const sentMark = await domSearch(session, '已发送', 2);
    const greeted = flipped.length > 0 || sentMark.length > 0;
    if (!greeted) {
      // 可能弹出了隐私/设置类弹窗——如实上报给用户
      logAction({ platform, kind: 'greet', jobUrl, jobTitle, message, result: 'unknown', detail: '点击后未见按钮翻转（可能有弹窗待人工处理）' });
      return { status: 'unknown', detail: '已点击「立即沟通」，但未见按钮翻转——可能有弹窗（如简历隐私设置）需要你在窗口里处理，处理后重试搜索确认' };
    }

    // 默认招呼语已发出；自定义文案作为后续聊天消息补发
    if (message) {
      const followUp = await sendFollowUpMessage(session, message);
      const record = logAction({ platform, kind: 'greet', jobUrl, jobTitle, message, result: followUp ? 'ok' : 'unknown' });
      return {
        status: followUp ? 'ok' : 'ok',
        detail: followUp
          ? `默认招呼语已发 + 定制文案已补发（记录 ${record.id}）`
          : `默认招呼语已发；定制文案补发状态未确认，请在 BOSS App 核对（记录 ${record.id}）`
      };
    }

    const record = logAction({ platform, kind: 'greet', jobUrl, jobTitle, result: 'ok' });
    return { status: 'ok', detail: `已向「${jobTitle ?? jobUrl}」发送默认招呼语（记录 ${record.id}）` };
  } catch (error) {
    logAction({ platform, kind: 'greet', jobUrl, jobTitle, message, result: 'failed', detail: String(error) });
    return { status: 'failed', detail: `动作异常：${String(error).slice(0, 80)}` };
  }
}

/** 在已打开的聊天面板补发一条消息（textarea.input-area → 逐字输入 → 严格匹配「发送」）。 */
async function sendFollowUpMessage(session: RawSession, message: string): Promise<boolean> {
  const inputNodes = await domSearch(session, 'textarea.input-area', 2);
  if (!inputNodes.length) return false;
  const ibox = await domBoxCenter(session, inputNodes[0].nodeId);
  if (!ibox) return false;
  await humanType(session, ibox.x, ibox.y, message);
  const sendNodes = await domSearch(session, '发送', 6);
  let sendBox: { x: number; y: number } | null = null;
  for (const n of sendNodes) {
    if (n.html.trim() !== '发送') continue; // 严格等值，防误匹配「发送验证码」
    const box = await domBoxCenter(session, n.nodeId);
    if (box && box.x > 0 && box.y > 0) { sendBox = box; break; }
  }
  if (!sendBox) return false;
  await humanClickAt(session, sendBox.x, sendBox.y);
  await pause(1500 + Math.floor(Math.random() * 800));
  const verify = await domSearch(session, message.slice(0, 12), 2);
  return verify.length > 0;
}

