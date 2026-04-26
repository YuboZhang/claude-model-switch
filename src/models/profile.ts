export interface ProfileEnv {
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_MODEL?: string;
}

export interface Profile {
  id: string;
  name: string;
  model?: string;
  env: ProfileEnv;
}

export function createDefaultProfile(model?: string): Profile {
  const id = generateId();
  return {
    id,
    name: model ?? '',
    model: model ?? '',
    env: {},
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