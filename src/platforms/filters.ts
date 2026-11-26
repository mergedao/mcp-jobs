import type { JobPlatform } from '../config/urlConfig';

/**
 * 归一化搜索过滤层：
 * 1. 用户给人类可读条件（10-15K / 1-3年 / 本科）→ 归一化结构
 * 2. 各平台映射成自己的原生筛选码（能原生筛的原生筛，数据最准）
 * 3. 所有平台结果再过一遍客户端过滤（保证归一化语义一致，字段缺失的放行）
 * 原则：原生码错一个就静默筛错方向，所以原生映射只覆盖有公开实证的码；
 *      没有实证码的平台一律走客户端过滤。
 */

export type NormalizedFilters = {
  salaryMinK?: number;
  salaryMaxK?: number;
  workYear?: string;
  education?: string;
  jobType?: string;
};

export type RawFilters = {
  salary?: string;
  workYear?: string;
  education?: string;
  jobType?: string;
};

/** 把 '10-15K' / '10-15万' / '15K以上' / '8千-1.2万' 解析成 [minK, maxK]（maxK 缺省 Infinity）。 */
export function parseSalaryK(text: string): [number, number] | null {
  const t = text.replace(/\s/g, '');
  const unitK = /K|千/i.test(t);
  const unitW = /万/i.test(t);
  const num = (s: string): number => {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return NaN;
    if (unitW) return n * 10;
    if (unitK) return n;
    return n / 1000; // 裸数字按元处理
  };
  const above = /以上|≥|大于/.test(t);
  const below = /以下|≤|小于/.test(t);
  const range = /([\d.]+)\s*[-~到]\s*([\d.]+)/.exec(t);
  if (range) {
    const min = num(range[1]);
    const max = num(range[2]);
    if (Number.isNaN(min) || Number.isNaN(max)) return null;
    return [Math.min(min, max), Math.max(min, max)];
  }
  const single = /([\d.]+)/.exec(t);
  if (single) {
    const v = num(single[1]);
    if (Number.isNaN(v)) return null;
    return above ? [v, Infinity] : below ? [0, v] : [v, v];
  }
  return null;
}

/** 把 '3年经验' / '1-3年' / '经验不限' 解析成 [minYears, maxYears]。 */
export function parseWorkYears(text: string): [number, number] | null {
  if (!text) return null;
  if (/不限|无经验|无需|应届以下/.test(text)) return [0, 99];
  if (/应届/.test(text)) return [0, 0];
  const range = /(\d+)\s*[-~到]\s*(\d+)/.exec(text);
  if (range) return [Number(range[1]), Number(range[2])];
  const above = /(\d+)\s*年以上|(\d+)\s*年及其以上/.exec(text);
  if (above) return [Number(above[1] || above[2]), 99];
  const single = /(\d+)\s*年/.exec(text);
  if (single) return [Number(single[1]), Number(single[1])];
  return null;
}

const EDU_RANK: Record<string, number> = {
  '初中及以下': 1, '高中': 2, '中专/中技': 2, '大专': 3, '本科': 4, '硕士': 5, '博士': 6, 'MBA/EMBA': 6
};

function jobSalaryRangeK(job: Record<string, unknown>): [number, number] | null {
  const text = String(job.salary ?? job.salaryDesc ?? job.salary60 ?? job.salaryReal ?? job.provideSalaryString ?? '');
  return parseSalaryK(text);
}

function jobWorkYears(job: Record<string, unknown>): [number, number] | null {
  const text = String(job.workYearString ?? job.workingExp ?? job.requireWorkYears ?? job.workYear ?? '');
  return parseWorkYears(text);
}

function jobEducationRank(job: Record<string, unknown>): number | null {
  const text = String(job.education ?? job.degreeString ?? job.requireEduLevel ?? '');
  const hit = Object.keys(EDU_RANK).find(key => text.includes(key.split('/')[0]));
  return hit ? EDU_RANK[hit] : null;
}

/** 客户端归一化过滤：字段缺失/无法解析的一律放行（宁可多给不错杀）。 */
export function clientFilter(jobs: Array<Record<string, unknown>>, filters: NormalizedFilters): Array<Record<string, unknown>> {
  const wantsSalary = filters.salaryMinK !== undefined || filters.salaryMaxK !== undefined;
  return jobs.filter(job => {
    if (wantsSalary) {
      const range = jobSalaryRangeK(job);
      if (range) {
        const min = filters.salaryMinK ?? 0;
        const max = filters.salaryMaxK ?? Infinity;
        // 职位区间与用户区间有交集即通过
        if (range[1] < min || (range[0] > max && range[0] !== Infinity)) return false;
      }
    }
    if (filters.workYear) {
      const want = parseWorkYears(filters.workYear);
      const have = jobWorkYears(job);
      if (want && have) {
        const overlaps = have[0] <= want[1] && want[0] <= have[1];
        if (!overlaps) return false;
      }
    }
    if (filters.education && filters.education !== '不限') {
      const wantRank = EDU_RANK[filters.education];
      const jobRank = jobEducationRank(job);
      if (wantRank && jobRank !== null) {
        // 岗位要求略高于用户条件一档以内仍放行（学历只是底线的场景少见，从严更符合预期）
        if (jobRank > wantRank) return false;
      }
    }
    return true;
  });
}

/* ---------- 平台原生映射 ---------- */

const ZHIPIN_EXPERIENCE: Record<string, string> = {
  '应届生': '101', '1年以内': '102', '1-3年': '103', '3-5年': '104', '5-10年': '105', '10年以上': '106'
};

const ZHIPIN_SALARY: Record<string, string> = {
  '3K以下': '401', '3-5K': '402', '5-10K': '403', '10-20K': '404', '20-50K': '405', '50K以上': '406'
};

const LIEPIN_SALARY_CODE: Record<string, string> = {
  '10万以下': '1', '10-15万': '2', '16-20万': '3', '21-30万': '4', '31-50万': '5', '51-100万': '6', '100万以上': '7'
};

const LIEPIN_WORK_YEAR_CODE: Record<string, string> = {
  '应届生': '1', '实习生': '2', '1年以下': '0$1', '1-3年': '1$3', '3-5年': '3$5', '5-10年': '5$10', '10年以上': '10$999'
};

/** BOSS 直聘原生筛选（有公开实证的码）：experience/salary。 */
export function zhipinNativeFilters(filters: RawFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.workYear && ZHIPIN_EXPERIENCE[filters.workYear]) out.experience = ZHIPIN_EXPERIENCE[filters.workYear];
  if (filters.salary && ZHIPIN_SALARY[filters.salary]) out.salary = ZHIPIN_SALARY[filters.salary];
  return out;
}

/** 猎聘原生筛选（SPA 同源编码）：salaryCode/workYearCode。 */
export function liepinNativeFilters(filters: RawFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.salary && LIEPIN_SALARY_CODE[filters.salary]) out.salaryCode = LIEPIN_SALARY_CODE[filters.salary];
  if (filters.workYear && LIEPIN_WORK_YEAR_CODE[filters.workYear]) out.workYearCode = LIEPIN_WORK_YEAR_CODE[filters.workYear];
  return out;
}

/** 哪些平台支持哪些原生筛选（供 skill/agent 提示用户）。 */
export const FILTER_SUPPORT: Record<JobPlatform, string[]> = {
  zhipin: ['salary', 'workYear', 'city'],
  liepin: ['salary', 'workYear'],
  '51job': [], // 编码无公开实证：全部走客户端过滤
  zhaopin: []  // SSR 页参数未实证：全部走客户端过滤
};

export function normalizeFilters(raw: RawFilters): NormalizedFilters {
  const out: NormalizedFilters = {};
  if (raw.salary) {
    const range = parseSalaryK(raw.salary);
    if (range) {
      out.salaryMinK = range[0];
      out.salaryMaxK = range[1];
    }
  }
  if (raw.workYear) out.workYear = raw.workYear;
  if (raw.education) out.education = raw.education;
  if (raw.jobType) out.jobType = raw.jobType;
  return out;
}
