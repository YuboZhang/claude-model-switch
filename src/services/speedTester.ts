import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { l10n } from '../i18n';
import { Profile } from '../models/profile';

export type SpeedTestStatus = 'success' | 'error';

export interface SpeedTestResult {
  profile: Profile;
  status: SpeedTestStatus;
  durationMs: number;
  firstTokenMs?: number;
  speedTokensPerSec?: number;
  model?: string;
  error?: string;
}

/** Models API 列表项（测速仍使用 id） */
export interface ListedModel {
  id: string;
  displayName?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 3;
const USER_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

interface ClaudeUserSettings {
  model?: unknown;
  env?: Record<string, unknown>;
}

interface ResolvedSpeedConfig {
  model?: string;
  token?: string;
  baseURL?: string;
  hasOneMillionContext?: boolean;
}

export class SpeedTester {
  /**
   * 生成随机测速提示，避免请求模式过于固定被封禁
   */
  private generateRandomPrompt(): string {
    // 多种问题模板
    const templates: ((n: number) => string)[] = [
      (n: number) => `List the numbers from 1 to ${n}, one per line.`,
      (n: number) => `Count from 1 to ${n}, each number on a new line.`,
      (n: number) => `Please output numbers 1 through ${n}, line by line.`,
      (n: number) => `Write numbers from 1 up to ${n}, one per line.`,
      (n: number) => `Enumerate numbers 1 to ${n}, each on its own line.`,
      // 字母表类
      (n: number) =>
        `List the first ${n} letters of the alphabet, one per line.`,
      (n: number) =>
        `Write letters A through ${String.fromCharCode(64 + n)}, one per line.`,
      // 简单任务类
      (n: number) => `Say "hello world" ${n} times, each on a new line.`,
      (n: number) => `Print the word "hello world" ${n} times, one per line.`,
      (n: number) => `List ${n} common colors, one per line.`,
      (n: number) => `Name ${n} fruits, one per line.`,
    ];

    // 随机选择模板和参数
    const template = templates[Math.floor(Math.random() * templates.length)];
    // 随机生成参数：字母类用 10-26，数字类用 20-50
    const randomNum = Math.floor(Math.random() * 31) + 20; // 20-50

    return template(randomNum);
  }

  async listModels(
    baseURL?: string,
    token?: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ListedModel[]> {
    const userSettings = this.readClaudeUserSettings();
    const userEnv = userSettings?.env;

    const effectiveToken =
      this.trimString(token) ||
      this.trimString(userEnv?.ANTHROPIC_AUTH_TOKEN) ||
      this.trimString(userEnv?.ANTHROPIC_API_KEY) ||
      undefined;

    const effectiveBaseURL =
      this.trimString(baseURL) ||
      this.trimString(userEnv?.ANTHROPIC_BASE_URL) ||
      undefined;

    const origin = this.normalizeBaseURL(effectiveBaseURL);
    if (!origin) {
      throw new Error(l10n('webviewBaseUrlRequired'));
    }

    const modelsUrl = `${origin}/v1/models`;
    const entries = await this.fetchOpenAICompatibleModelList(
      modelsUrl,
      effectiveToken,
      timeoutMs,
    );
    return this.dedupeAndSortListedModels(entries);
  }

  async testProfile(
    profile: Profile,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<SpeedTestResult> {
    const startedAt = Date.now();
    const config = this.resolveConfig(profile);
    const model = config.model;

    if (!model) {
      return {
        profile,
        status: 'error',
        durationMs: 0,
        error: l10n('speedMissingModel'),
      };
    }

    try {
      const client = this.createClient(config, timeoutMs);

      let firstTokenAt = 0;
      let outputTokens = 0;

      const stream = await client.messages.create({
        model,
        max_tokens: config.hasOneMillionContext ? 1100 : 256,
        thinking: { type: 'enabled', budget_tokens: 128 },
        messages: [{ role: 'user', content: this.generateRandomPrompt() }],
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (!firstTokenAt) {
            firstTokenAt = Date.now();
          }
        }
        if (event.type === 'message_delta') {
          if (event.usage && event.usage.output_tokens) {
            outputTokens = event.usage.output_tokens;
          }
        }
      }

      const endedAt = Date.now();
      const firstTokenMs = firstTokenAt ? firstTokenAt - startedAt : undefined;
      const durationMs = endedAt - startedAt;

      const generationDurationMs = endedAt - (firstTokenAt || startedAt);
      const speedTokensPerSec =
        generationDurationMs > 0 && outputTokens > 1
          ? Number(
              ((outputTokens - 1) / (generationDurationMs / 1000)).toFixed(1),
            )
          : undefined;

      return {
        profile,
        status: 'success',
        durationMs,
        firstTokenMs,
        speedTokensPerSec,
        model,
      };
    } catch (err) {
      return {
        profile,
        status: 'error',
        durationMs: Date.now() - startedAt,
        model,
        error: this.formatError(err),
      };
    }
  }

  async testProfiles(
    profiles: Profile[],
    onResult: (
      result: SpeedTestResult,
      completed: number,
      total: number,
    ) => void,
    concurrency = DEFAULT_CONCURRENCY,
  ): Promise<SpeedTestResult[]> {
    const results: SpeedTestResult[] = [];
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
      while (nextIndex < profiles.length) {
        const profile = profiles[nextIndex++];
        if (!profile) continue;

        const result = await this.testProfile(profile);
        results.push(result);
        completed++;
        onResult(result, completed, profiles.length);
      }
    };

    const workerCount = Math.min(concurrency, profiles.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  private resolveConfig(profile: Profile): ResolvedSpeedConfig {
    const userSettings = this.readClaudeUserSettings();
    const userEnv = userSettings?.env;
    const token =
      this.trimString(profile.env.ANTHROPIC_AUTH_TOKEN) ||
      this.trimString(userEnv?.ANTHROPIC_AUTH_TOKEN) ||
      this.trimString(userEnv?.ANTHROPIC_API_KEY) ||
      undefined;

    const rawModel =
      this.trimString(profile.env.ANTHROPIC_MODEL) ||
      this.trimString(profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL) ||
      this.trimString(profile.env.ANTHROPIC_DEFAULT_FABLE_MODEL) ||
      this.trimString(profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL) ||
      this.trimString(profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ||
      undefined;

    const hasOneMillionContext = rawModel?.endsWith('[1m]');

    return {
      model: this.stripOneMillionContextSuffix(rawModel),
      token,
      baseURL:
        this.trimString(profile.env.ANTHROPIC_BASE_URL) ||
        this.trimString(userEnv?.ANTHROPIC_BASE_URL) ||
        undefined,
      hasOneMillionContext,
    };
  }

  private createClient(
    config: ResolvedSpeedConfig,
    timeoutMs: number,
  ): Anthropic {
    const baseURL = this.normalizeBaseURL(config.baseURL);
    const authOptions = this.resolveAuthOptions(config.token);

    const defaultHeaders: Record<string, string | null> = config.token
      ? {}
      : { 'X-Api-Key': null, Authorization: null };
    defaultHeaders['User-Agent'] =
      'claude-cli/2.1.198 (external, claude-vscode, agent-sdk/0.3.198)';
    defaultHeaders['X-App'] = 'cli';
    // 如果启用了 1M 上下文，一些中转网站或 Claude Code 可能需要传递特定的 beta header 和模拟客户端标识
    if (config.hasOneMillionContext) {
      defaultHeaders['anthropic-beta'] =
        'prompt-caching-2024-07-31,context-1m-2025-08-07';
    }

    return new Anthropic({
      ...authOptions,
      baseURL,
      timeout: timeoutMs,
      maxRetries: 0,
      defaultHeaders:
        Object.keys(defaultHeaders).length > 0
          ? (defaultHeaders as Record<string, string>)
          : undefined,
    });
  }

  private resolveAuthOptions(token?: string): {
    apiKey: string | null;
    authToken: string | null;
  } {
    if (!token) return { apiKey: null, authToken: null };
    return token.startsWith('sk-ant-')
      ? { apiKey: token, authToken: null }
      : { apiKey: null, authToken: token };
  }

  private readClaudeUserSettings(): ClaudeUserSettings | undefined {
    if (!fs.existsSync(USER_SETTINGS_PATH)) return undefined;

    try {
      const settings = JSON.parse(
        fs.readFileSync(USER_SETTINGS_PATH, 'utf-8'),
      ) as ClaudeUserSettings;
      return settings && typeof settings === 'object' ? settings : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * OpenAI 兼容：GET {origin}/v1/models，解析 body.data[]。
   * 不附带 Anthropic SDK 的 User-Agent / X-App，避免网关返回另一套模型列表。
   */
  private async fetchOpenAICompatibleModelList(
    modelsUrl: string,
    token: string | undefined,
    timeoutMs: number,
  ): Promise<ListedModel[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token) {
      if (token.startsWith('sk-ant-')) {
        headers['x-api-key'] = token;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `Models API returned non-JSON (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'error' in body
          ? JSON.stringify((body as { error: unknown }).error)
          : text.slice(0, 300);
      throw new Error(`Models API ${response.status}: ${detail}`);
    }

    const items = this.extractOpenAIModelListItems(body);
    const entries: ListedModel[] = [];
    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) continue;
      entries.push({
        id,
        displayName: this.readModelDisplayName(item),
      });
    }
    return entries;
  }

  private extractOpenAIModelListItems(body: unknown): Array<Record<string, unknown>> {
    if (!body || typeof body !== 'object') return [];
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object',
    );
  }

  private readModelDisplayName(model: unknown): string | undefined {
    if (!model || typeof model !== 'object') return undefined;
    const rec = model as { display_name?: unknown; name?: unknown };
    const name =
      typeof rec.display_name === 'string'
        ? rec.display_name
        : typeof rec.name === 'string'
          ? rec.name
          : undefined;
    if (typeof name !== 'string') return undefined;
    const trimmed = name.trim();
    return trimmed || undefined;
  }

  /**
   * 部分 OpenAI 兼容网关会为同一模型返回 `id` 与 `id/子路径` 两条；保留较短 id。
   */
  private dedupeAndSortListedModels(entries: ListedModel[]): ListedModel[] {
    const idSet = new Set(entries.map((e) => e.id));
    const byId = new Map<string, ListedModel>();
    for (const entry of entries) {
      if (this.isRedundantGatewayModelId(entry.id, idSet)) {
        continue;
      }
      const prev = byId.get(entry.id);
      if (!prev) {
        byId.set(entry.id, entry);
        continue;
      }
      if (!prev.displayName && entry.displayName) {
        byId.set(entry.id, entry);
      }
    }
    return [...byId.values()].sort((a, b) => {
      const labelA = (a.displayName || a.id).toLowerCase();
      const labelB = (b.displayName || b.id).toLowerCase();
      const byLabel = labelA.localeCompare(labelB);
      return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
    });
  }

  private isRedundantGatewayModelId(id: string, allIds: Set<string>): boolean {
    const slash = id.indexOf('/');
    if (slash <= 0) return false;
    const base = id.slice(0, slash);
    return allIds.has(base);
  }

  private trimString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private stripOneMillionContextSuffix(value?: string): string | undefined {
    if (!value) return undefined;
    return value.endsWith('[1m]') ? value.slice(0, -4).trim() : value;
  }

  private normalizeBaseURL(baseURL?: string): string | undefined {
    const trimmed = baseURL?.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  public formatError(error: unknown): string {
    if (error instanceof Anthropic.AuthenticationError) {
      return l10n('speedAuthFailed');
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return l10n('speedPermissionDenied');
    }
    if (error instanceof Anthropic.NotFoundError) {
      return l10n('speedModelOrEndpointNotFound');
    }
    if (error instanceof Anthropic.RateLimitError) {
      return l10n('speedRateLimited');
    }
    if (error instanceof Anthropic.APIError) {
      return l10n(
        'speedApiError',
        error.status ? ` ${error.status}` : '',
        error.message,
      );
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
