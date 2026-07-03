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

function migrateProfile(profile: Profile): Profile {
  let migrated = false;
  const newEnv = { ...profile.env };
  const extraSettings = profile.extraSettings ? { ...profile.extraSettings } : {};
  const extraEnv = extraSettings.env && typeof extraSettings.env === 'object'
    ? { ...extraSettings.env } as Record<string, string>
    : {};

  for (const [key, value] of Object.entries(profile.env)) {
    if (!ENV_KEYS.includes(key) && value !== undefined) {
      extraEnv[key] = value;
      delete newEnv[key];
      migrated = true;
    }
  }

  if (migrated) {
    extraSettings.env = extraEnv;
    return {
      ...profile,
      env: newEnv,
      extraSettings,
    };
  }
  return profile;
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
    profiles.push(profile);
    this.context.globalState.update(STORAGE_KEY, profiles);
  }

  update(profile: Profile): void {
    const profiles = this.getAll();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
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
      const conflictIdx = result.findIndex(p => p.name === profile.name);
      if (conflictIdx >= 0) {
        const choice = await conflictHandler(profile.name);
        if (choice === 'overwrite') {
          result[conflictIdx] = profile;
          imported++;
        } else {
          skipped++;
        }
      } else {
        result.push(profile);
        imported++;
      }
    }

    this.context.globalState.update(STORAGE_KEY, result);
    return { imported, skipped };
  }
}