import { PageFailure } from '../crawler/webCrawler';
import type { JobPlatform } from '../config/urlConfig';

export type ApiStatus = PageFailure | 'ok' | 'empty';
export type ApiJob = { title: string; jobDetail: string; company?: string; salary?: string; address?: string } & Record<string, unknown>;
export type ApiSearchResult = { status: ApiStatus; jobs: ApiJob[]; note?: string };
export type { JobPlatform };
