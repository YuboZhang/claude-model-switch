export interface ProfileEnv {
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME?: string;
  ANTHROPIC_MODEL?: string;
  [key: string]: string | undefined;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Profile {
  id: string;
  name: string;
  env: ProfileEnv;
  effort?: Effort;
}

export function createDefaultProfile(): Profile {
  const id = generateId();
  return {
    id,
    name: '',
    env: {},
    effort: 'high',
  };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function maskToken(token?: string): string {
  if (!token) return '';
  if (token.length <= 8) return token;
  return token.slice(0, 6) + '...' + token.slice(-4);
}