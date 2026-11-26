import { managedCdpUrl } from '../core/browser';
import { navigateAndVerifyTarget, rawDomPage, domSearch, pause, waitForText } from '../core/cdp';
import { logAction } from '../core/actionsLog';

/**
 * 智联写操作（半自动，纯模拟点击）：职位详情页 → 「申请职位/立即申请」→ 确认弹窗（若有）→ 完成。
 * 判断依据只用页面真实状态（已申请标记），不用本地配额计数。
 * 反馈：投递记录页被动读取标记。
 */

const ACTION_PAGE_ROLE = 'zhaopin';

export type ZhaopinApplyResult = {
  status: 'ok' | 'already_applied' | 'failed' | 'login_required' | 'unknown';
  detail: string;
};

export async function applyZhaopinJob(jobUrl: string, jobTitle: string | undefined): Promise<ZhaopinApplyResult> {
  const platform = 'zhaopin';
  const page = await rawDomPage(managedCdpUrl(), ACTION_PAGE_ROLE, jobUrl);
  if (!page) return { status: 'failed', detail: '页面会话创建失败' };
  const { session } = page;

  try {
    // P0 安全闸：导航到确认单 URL 并核对页面确实是目标职位
    const verify = await navigateAndVerifyTarget(session, jobUrl, jobTitle, 20000);
    if (!verify.ok) {
      logAction({ platform, kind: 'apply', jobUrl, jobTitle, result: 'failed', detail: verify.detail });
      return { status: 'failed', detail: verify.detail };
    }

    const ready = await waitForText(session, '申请职位', 15000).catch(() => false);
    if (!ready) {
      const applied = await domSearch(session, '已申请', 2);
      if (applied.length) {
        return { status: 'already_applied', detail: '该职位已申请过' };
      }
      return { status: 'failed', detail: '未找到「申请职位」按钮（可能未登录或页面改版）' };
    }

    const clicked = await (async () => {
      const { domBoxCenter, humanClickAt } = await import('../core/cdp');
      for (const text of ['申请职位', '立即申请', '投递简历']) {
        const nodes = await domSearch(session, text, 6);
        for (const node of nodes) {
          if (node.html.trim() !== text) continue; // 严格等值
          const box = await domBoxCenter(session, node.nodeId);
          if (box && box.x > 0 && box.y > 0) {
            await humanClickAt(session, box.x, box.y);
            return true;
          }
        }
      }
      return false;
    })();
    if (!clicked) {
      return { status: 'failed', detail: '申请按钮点击失败' };
    }

    // 可能出现确认弹窗：找「确认」类按钮（严格等值）
    await pause(1800 + Math.floor(Math.random() * 1200));
    const confirm = await (async () => {
      const { domBoxCenter, humanClickAt } = await import('../core/cdp');
      for (const text of ['确认投递', '确定', '确认']) {
        const nodes = await domSearch(session, text, 8);
        for (const node of nodes) {
          if (node.html.trim() !== text) continue;
          const box = await domBoxCenter(session, node.nodeId);
          if (box && box.x > 0 && box.y > 0) {
            await humanClickAt(session, box.x, box.y);
            return true;
          }
        }
      }
      return false;
    })();
    void confirm; // 无弹窗则直投成功

    await pause(1500 + Math.floor(Math.random() * 900));
    const applied = await domSearch(session, '已申请', 2);
    const ok = applied.length > 0;
    const record = logAction({ platform, kind: 'apply', jobUrl, jobTitle, result: ok ? 'ok' : 'unknown' });
    return {
      status: ok ? 'ok' : 'unknown',
      detail: ok
        ? `已申请「${jobTitle ?? jobUrl}」，页面显示已申请，记录 ${record.id}`
        : '已执行点击但未确认到「已申请」状态，请人工核对'
    };
  } catch (error) {
    logAction({ platform, kind: 'apply', jobUrl, jobTitle, result: 'failed', detail: String(error) });
    return { status: 'failed', detail: `动作异常：${String(error).slice(0, 80)}` };
  }
}

/** 投递/沟通反馈：打开投递记录页（被动读，不做写操作）。 */
export async function zhaopinFeedback(): Promise<{ status: string; detail: string }> {
  const page = await rawDomPage(managedCdpUrl(), 'zhaopin-feedback', 'https://i.zhaopin.com/');
  if (!page) return { status: 'failed', detail: '页面会话失败' };
  await pause(3500);
  const { domSearch } = await import('../core/cdp');
  // 常见反馈节点：投递成功/被查看/不合适
  const markers = ['被查看', '投递成功', '不合适', '待查看'];
  const found: string[] = [];
  for (const marker of markers) {
    const nodes = await domSearch(page.session, marker, 5);
    if (nodes.length) found.push(`${marker}×${nodes.length}`);
  }
  return {
    status: found.length ? 'ok' : 'unknown',
    detail: found.length ? `投递反馈：${found.join('、')}` : '未识别到反馈状态（页面可能需要人工查看）'
  };
}
