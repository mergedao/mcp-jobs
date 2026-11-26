import { officialJobLink } from '../config/jobLinks';

export function prepareApplication(args: unknown) {
  if (!args || typeof args !== 'object') throw new Error('请提供官方职位链接和职位名称');
  const fields = args as Record<string, unknown>;
  const url = typeof fields.url === 'string' && fields.url.length <= 2048 && officialJobLink(fields.url);
  const title = readText(fields.title, '职位名称', 200);
  const company = readText(fields.company, '公司名称', 200);
  const jobDescription = readText(fields.jobDescription, '职位说明', 12000);
  const candidateSummary = readText(fields.candidateSummary, '相关经历', 1200);
  if (!url || !title) throw new Error('请提供受支持招聘平台的 HTTPS 职位链接和职位名称');

  return {
    status: 'draft_ready',
    job: { url: url.href, title, company, jobDescription },
    communicationDraft: [
      `您好，我对${company ? `「${company}」的` : '贵司的'}「${title}」职位感兴趣。`,
      candidateSummary,
      '如果方便，我想进一步了解岗位要求和团队情况。谢谢！'
    ].filter(Boolean).join('\n'),
    nextAction: { type: 'open_official_page', url: url.href, instruction: '请核对草稿，在官方页面登录后提交申请或发送消息。' }
  };
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${field}应为不超过 ${maxLength} 字的文本`);
  return value.trim();
}
