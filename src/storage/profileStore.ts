import * as vscode from 'vscode';
import { l10n } from '../i18n';
import { Profile } from '../models/profile';

const STORAGE_KEY = 'claudeModelSwitchProfiles';

const ENV_KEYS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_MODEL',
];

function isNonEmptyEnvValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** 将 extraSettings.env 中的标准键提升到 profile.env，并把 env 中非标准键迁入 extra。 */
function migrateProfile(profile: Profile): Profile {
  let migrated = false;
  const newEnv = { ...profile.env };
  const extraSettings = profile.extraSettings ? { ...profile.extraSettings } : {};
  const extraEnv = extraSettings.env && typeof extraSettings.env === 'object'
    ? { ...extraSettings.env } as Record<string, unknown>
    : {};

  for (const key of ENV_KEYS) {
    if (!(key in extraEnv)) {
      continue;
    }
    const extraVal = extraEnv[key];
    const extraStr = extraVal === undefined || extraVal === null ? '' : String(extraVal).trim();
    if (!isNonEmptyEnvValue(newEnv[key]) && extraStr !== '') {
      newEnv[key] = extraStr;
      migrated = true;
    }
    delete extraEnv[key];
    migrated = true;
  }

  for (const [key, value] of Object.entries(newEnv)) {
    if (!ENV_KEYS.includes(key) && value !== undefined && value !== '') {
      extraEnv[key] = value;
      delete newEnv[key];
      migrated = true;
    }
  }

  if (!migrated) {
    return profile;
  }

  if (Object.keys(extraEnv).length > 0) {
    extraSettings.env = extraEnv;
  } else {
    delete extraSettings.env;
  }

  const hasExtra = Object.keys(extraSettings).length > 0;
  return {
    ...profile,
    env: newEnv,
    extraSettings: hasExtra ? extraSettings : undefined,
  };
}

export function normalizeProfile(profile: Profile): Profile {
  return migrateProfile(profile);
}

export class ProfileStore {
  constructor(private context: vscode.ExtensionContext) {}

  getAll(): Profile[] {
    const profiles = this.context.globalState.get<Profile[]>(STORAGE_KEY) ?? [];
    let modified = false;
    const migrated = profiles.map(p => {
      const m = migrateProfile(p);
      if (m !== p) {
        modified = true;
      }
      return m;
    });
    if (modified) {
      this.context.globalState.update(STORAGE_KEY, migrated);
    }
    return migrated;
  }

  getById(id: string): Profile | undefined {
    return this.getAll().find(p => p.id === id);
  }

  add(profile: Profile): void {
    const profiles = this.getAll();
    profiles.push(migrateProfile(profile));
    this.context.globalState.update(STORAGE_KEY, profiles);
  }

  update(profile: Profile): void {
    const profiles = this.getAll();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = migrateProfile(profile);
      this.context.globalState.update(STORAGE_KEY, profiles);
    }
  }

  setAll(profiles: Profile[]): void {
    this.context.globalState.update(STORAGE_KEY, [...profiles]);
  }

  delete(id: string): void {
    const profiles = this.getAll().filter(p => p.id !== id);
    this.context.globalState.update(STORAGE_KEY, profiles);
  }

  exportAll(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  async importFromJSON(jsonStr: string, conflictHandler: (name: string) => Promise<'overwrite' | 'skip'>): Promise<{ imported: number; skipped: number }> {
    let parsed: Profile[];
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      vscode.window.showErrorMessage(l10n('invalidJsonFile'));
      return { imported: 0, skipped: 0 };
    }

    const existing = this.getAll();
    let imported = 0;
    let skipped = 0;
    const result: Profile[] = [...existing];

    for (const profile of parsed) {
      const normalized = migrateProfile(profile);
      const conflictIdx = result.findIndex(p => p.name === normalized.name);
      if (conflictIdx >= 0) {
        const choice = await conflictHandler(normalized.name);
        if (choice === 'overwrite') {
          result[conflictIdx] = normalized;
          imported++;
        } else {
          skipped++;
        }
      } else {
        result.push(normalized);
        imported++;
      }
    }

    this.context.globalState.update(STORAGE_KEY, result);
    return { imported, skipped };
  }
}