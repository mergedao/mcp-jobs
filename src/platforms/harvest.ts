import { officialJobLink, jobPlatform } from '../config/jobLinks';
import type { JobPlatform } from '../config/urlConfig';
import type { ApiJob } from './types';

/**
 * 防御式字段收割：站点 JSON 形状随时可能漂移，按候选名深度匹配，
 * 全量原始字段透传（...item）保证「拿到最全数据」。
 */

type FieldPlan = {
  title: string[];
  company: string[];
  salary: string[];
  address: string[];
  link: string[];
  id?: string[];
};

const FIELD_PLANS: Record<JobPlatform, FieldPlan> = {
  '51job': {
    title: ['jobName', 'jobTitle', 'title', 'positionName'],
    company: ['fullCompanyName', 'companyName', 'relateCompName', 'companyFullName', 'compName'],
    salary: ['provideSalaryString', 'salaryDc', 'salary', 'jobSalary', 'salaryDesc'],
    address: ['jobAreaString', 'jobArea', 'area', 'workLocationText', 'cityName'],
    link: ['jobHref', 'jobHrefUrl', 'link', 'detailUrl'],
    id: ['jobId', 'number']
  },
  liepin: {
    title: ['jobName', 'title', 'name'],
    company: ['compName', 'companyName', 'companyFullName', 'compTitle'],
    salary: ['salary', 'salaryDesc'],
    address: ['city', 'dq', 'workCity', 'jobArea', 'compLocation'],
    link: ['link', 'jobHref', 'url', 'detailUrl'],
    id: ['jobId']
  },
  zhipin: {
    title: ['jobName', 'title', 'positionName'],
    company: ['brandName', 'companyName', 'brandComName'],
    salary: ['salaryDesc', 'salary'],
    address: ['cityDistrict', 'areaDistrict', 'cityName', 'city', 'businessDistrict'],
    link: ['link', 'jobHref', 'url'],
    id: ['encryptJobId', 'jobId']
  },
  zhaopin: {
    title: ['name', 'jobName', 'title', 'positionName'],
    company: ['companyName', 'company', 'compName', 'companyFullName'],
    salary: ['salary60', 'salaryReal', 'salary', 'salaryDesc'],
    address: ['cityDistrict', 'workCity', 'city', 'jobArea', 'location'],
    link: ['positionURL', 'positionUrl', 'detailUrl', 'link', 'jobUrl', 'url'],
    id: ['jobId', 'number']
  }
};

function pickText(item: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = item[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/** 公司名允许一层子对象兜底（猎聘 jobCardList[N].comp.compName）。 */
function pickCompany(item: Record<string, unknown>, names: string[]): string {
  const direct = pickText(item, names);
  if (direct) return direct;
  for (const child of Object.values(item)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const value = pickText(child as Record<string, unknown>, names);
      if (value) return value;
    }
  }
  return '';
}

/** 从任意 JSON 深度收割职位数组：形状漂移时靠字段候选名兜底。 */
export function harvestJobs(root: unknown, platform: JobPlatform, base: string): ApiJob[] {
  const plan = FIELD_PLANS[platform];
  const jobs: ApiJob[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || !value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const title = pickText(item, plan.title);
    if (!title) {
      for (const child of Object.values(item)) visit(child, depth + 1);
      return;
    }
    let link = pickText(item, plan.link);
    if (link) {
      const resolved = officialJobLink(link, base);
      if (!resolved || jobPlatform(resolved) !== platform) link = '';
      else link = resolved.href;
    }
    if (!link && plan.id) {
      const id = pickText(item, plan.id);
      if (platform === 'zhipin' && /^[A-Za-z0-9]+$/.test(id)) link = `https://www.zhipin.com/job_detail/${id}.html`;
    }
    if (!link || seen.has(link)) return;
    seen.add(link);
    jobs.push({
      title,
      jobDetail: link,
      company: pickCompany(item, plan.company) || undefined,
      salary: pickText(item, plan.salary) || undefined,
      address: pickText(item, plan.address) || undefined,
      ...item
    });
  };
  visit(root, 0);
  return jobs;
}
