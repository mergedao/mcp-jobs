import * as fs from 'fs';
import * as path from 'path';
import { profileDir } from './browser';

/**
 * 用户主简历档案（本地，永不上传）：
 * agent 读 master profile + 目标职位 JD → 本地生成定制简历文件。
 * 这就是跨平台简历同步难题的解法——不让平台替我们存，本地按职位生成。
 */

const MY_PROFILE_FILE = () => path.join(profileDir(), '..', 'my-profile.json');

export type MasterProfile = {
  name?: string;
  contact?: Record<string, string>;
  summary?: string;
  skills?: string[];
  experiences?: Array<{ company?: string; title?: string; period?: string; highlights?: string[] }>;
  education?: Array<{ school?: string; major?: string; degree?: string; period?: string }>;
  projects?: Array<{ name?: string; role?: string; highlights?: string[] }>;
  extras?: Record<string, unknown>;
};

export function getMyProfile(): MasterProfile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(MY_PROFILE_FILE(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as MasterProfile : null;
  } catch {
    return null;
  }
}

export function setMyProfile(profile: MasterProfile): MasterProfile {
  fs.mkdirSync(path.dirname(MY_PROFILE_FILE()), { recursive: true });
  fs.writeFileSync(MY_PROFILE_FILE(), JSON.stringify(profile, null, 2));
  return profile;
}
