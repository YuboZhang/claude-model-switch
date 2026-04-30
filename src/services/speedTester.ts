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
  model?: string;
  error?: string;
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
}

export class SpeedTester {
  async testProfile(profile: Profile, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SpeedTestResult> {
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
      const response = await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply ok.' }],
      });

      return {
        profile,
        status: 'success',
        durationMs: Date.now() - startedAt,
        model: response.model,
      };
    } catch (error) {
      return {
        profile,
        status: 'error',
        durationMs: Date.now() - startedAt,
        model,
        error: this.formatError(error),
      };
    }
  }

  async testProfiles(
    profiles: Profile[],
    onResult: (result: SpeedTestResult, completed: number, total: number) => void,
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
    const token = this.trimString(profile.env.ANTHROPIC_AUTH_TOKEN)
      || this.trimString(userEnv?.ANTHROPIC_AUTH_TOKEN)
      || this.trimString(userEnv?.ANTHROPIC_API_KEY)
      || undefined;

    return {
      model: this.trimString(profile.env.ANTHROPIC_MODEL)
        || this.trimString(profile.model)
        || this.trimString(userEnv?.ANTHROPIC_MODEL)
        || this.trimString(userSettings?.model)
        || undefined,
      token,
      baseURL: this.trimString(profile.env.ANTHROPIC_BASE_URL)
        || this.trimString(userEnv?.ANTHROPIC_BASE_URL)
        || undefined,
    };
  }

  private createClient(config: ResolvedSpeedConfig, timeoutMs: number): Anthropic {
    const baseURL = this.normalizeBaseURL(config.baseURL);
    const authOptions = this.resolveAuthOptions(config.token);

    return new Anthropic({
      ...authOptions,
      baseURL,
      timeout: timeoutMs,
      maxRetries: 0,
      defaultHeaders: config.token ? undefined : { 'X-Api-Key': null, Authorization: null },
    });
  }

  private resolveAuthOptions(token?: string): { apiKey: string | null; authToken: string | null } {
    if (!token) return { apiKey: null, authToken: null };
    return token.startsWith('sk-ant-')
      ? { apiKey: token, authToken: null }
      : { apiKey: null, authToken: token };
  }

  private readClaudeUserSettings(): ClaudeUserSettings | undefined {
    if (!fs.existsSync(USER_SETTINGS_PATH)) return undefined;

    try {
      const settings = JSON.parse(fs.readFileSync(USER_SETTINGS_PATH, 'utf-8')) as ClaudeUserSettings;
      return settings && typeof settings === 'object' ? settings : undefined;
    } catch {
      return undefined;
    }
  }

  private trimString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private normalizeBaseURL(baseURL?: string): string | undefined {
    const trimmed = baseURL?.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  private formatError(error: unknown): string {
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
      return l10n('speedApiError', error.status ? ` ${error.status}` : '', error.message);
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
