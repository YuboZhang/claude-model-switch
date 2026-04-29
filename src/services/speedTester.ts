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

export class SpeedTester {
  async testProfile(profile: Profile, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SpeedTestResult> {
    const startedAt = Date.now();
    const model = this.resolveModel(profile);

    if (!model) {
      return {
        profile,
        status: 'error',
        durationMs: 0,
        error: l10n('speedMissingModel'),
      };
    }

    const token = profile.env.ANTHROPIC_AUTH_TOKEN?.trim();
    if (!token) {
      return {
        profile,
        status: 'error',
        durationMs: 0,
        model,
        error: l10n('speedMissingAuthToken'),
      };
    }

    try {
      const client = this.createClient(profile, token, timeoutMs);
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

  private resolveModel(profile: Profile): string | undefined {
    return profile.env.ANTHROPIC_MODEL?.trim() || profile.model?.trim() || undefined;
  }

  private createClient(profile: Profile, token: string, timeoutMs: number): Anthropic {
    const baseURL = this.normalizeBaseURL(profile.env.ANTHROPIC_BASE_URL);
    const authOptions = token.startsWith('sk-ant-')
      ? { apiKey: token, authToken: null }
      : { apiKey: null, authToken: token };

    return new Anthropic({
      ...authOptions,
      baseURL,
      timeout: timeoutMs,
      maxRetries: 0,
    });
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
