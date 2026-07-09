import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { l10n } from '../i18n';
import { Profile, ProfileEnv } from '../models/profile';

const ACTIVE_PROFILE_FILENAME = '.claude-model-switch-active.json';
const CLAUDE_DIR = '.claude';
const SETTINGS_FILENAME = 'settings.local.json';

const ENV_KEYS: (keyof ProfileEnv)[] = [
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

const DEFAULT_MODEL_NAME_PAIRS: Array<[keyof ProfileEnv, keyof ProfileEnv]> = [
  ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME'],
  ['ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME'],
  ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME'],
  ['ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME'],
];

export class SettingsWriter {
  getWorkspaceRoot(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const docPath = activeEditor.document.uri.fsPath;
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(docPath));
      if (folder) return folder.uri.fsPath;
    }
    if (vscode.workspace.workspaceFolders?.length) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return undefined;
  }

  async switchToProfile(profile: Profile, previousProfile?: Profile): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage(l10n('noWorkspaceFolder'));
      return;
    }

    const claudeDir = path.join(root, CLAUDE_DIR);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Write active profile id
    const activeFilePath = path.join(claudeDir, ACTIVE_PROFILE_FILENAME);
    fs.writeFileSync(activeFilePath, JSON.stringify({ id: profile.id }, null, 2), 'utf-8');

    // Merge into settings.local.json
    const settingsPath = path.join(claudeDir, SETTINGS_FILENAME);
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    delete settings['model'];

    const env = settings['env'] && typeof settings['env'] === 'object'
      ? settings['env'] as Record<string, string>
      : {};

    // Remove every env key the previous profile wrote (standard + extra) so
    // stale values, including custom env vars, never leak into the new profile.
    if (previousProfile) {
      for (const key of Object.keys(this.buildEffectiveEnv(previousProfile))) {
        delete env[key];
      }
      if (previousProfile.extraSettings && typeof previousProfile.extraSettings === 'object' && 'env' in previousProfile.extraSettings) {
        const prevExtraEnv = (previousProfile.extraSettings as any).env;
        if (prevExtraEnv && typeof prevExtraEnv === 'object') {
          for (const key of Object.keys(prevExtraEnv)) {
            delete env[key];
          }
        }
      }
    }

    const effectiveEnv = this.buildEffectiveEnv(profile);
    // Standard keys always reflect the new profile (set or removed).
    for (const key of ENV_KEYS) {
      if (effectiveEnv[key] !== undefined) {
        env[key] = effectiveEnv[key];
      } else {
        delete env[key];
      }
    }
    // Extra env vars from the new profile (from extraSettings.env).
    if (profile.extraSettings && typeof profile.extraSettings === 'object' && 'env' in profile.extraSettings) {
      const extraEnv = (profile.extraSettings as any).env;
      if (extraEnv && typeof extraEnv === 'object') {
        for (const [key, value] of Object.entries(extraEnv)) {
          if ((ENV_KEYS as string[]).includes(key)) {
            continue;
          }
          if (value !== undefined && value !== null && value !== '') {
            env[key] = String(value);
          } else {
            delete env[key];
          }
        }
      }
    }

    if (Object.keys(env).length === 0) {
      delete settings['env'];
    } else {
      settings['env'] = env;
    }

    // 额外其他配置（与 env 平级的顶层 key）：先删上一个 profile 写过的，
    // 再整键写入新 profile 的，实现切换清空。
    if (previousProfile) {
      for (const key of this.getExtraSettingsKeys(previousProfile)) {
        delete settings[key];
      }
    }
    if (profile.extraSettings) {
      for (const key of this.getExtraSettingsKeys(profile)) {
        settings[key] = (profile.extraSettings as Record<string, unknown>)[key];
      }
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  /**
   * 计算某个 profile 实际写入 settings 的 env 键值对：展开默认模型名映射、
   * 过滤空值。返回的 key 集合就是这个 profile 托管的全部 env（含额外变量）。
   */
  private buildEffectiveEnv(profile: Profile): Record<string, string> {
    const profileEnv: ProfileEnv = { ...profile.env };
    for (const [modelKey, nameKey] of DEFAULT_MODEL_NAME_PAIRS) {
      const value = profileEnv[modelKey];
      if (value !== undefined && value !== '') {
        profileEnv[nameKey] = value;
      } else {
        delete profileEnv[nameKey];
      }
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(profileEnv)) {
      if (value !== undefined && value !== '') {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 返回某 profile 管理的「额外其他配置」顶层 key 集合（过滤保留字 env/model，
   * 避免与专用区域冲突）。这些 key 与 env 平级，直接写入 settings 根对象。
   */
  private getExtraSettingsKeys(profile: Profile): string[] {
    const extra = profile.extraSettings;
    if (!extra || typeof extra !== 'object') return [];
    return Object.keys(extra).filter(key => key !== 'env' && key !== 'model');
  }

  getActiveProfileId(): string | undefined {
    const root = this.getWorkspaceRoot();
    if (!root) return undefined;

    const activeFilePath = path.join(root, CLAUDE_DIR, ACTIVE_PROFILE_FILENAME);
    if (!fs.existsSync(activeFilePath)) return undefined;

    try {
      const data = JSON.parse(fs.readFileSync(activeFilePath, 'utf-8'));
      return data.id as string;
    } catch {
      return undefined;
    }
  }

  getCurrentModel(): string | undefined {
    const root = this.getWorkspaceRoot();
    if (!root) return undefined;

    const settingsPath = path.join(root, CLAUDE_DIR, SETTINGS_FILENAME);
    if (!fs.existsSync(settingsPath)) return undefined;

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const env = settings['env'] && typeof settings['env'] === 'object'
        ? settings['env'] as Record<string, unknown>
        : undefined;
      return this.trimString(env?.ANTHROPIC_MODEL)
        || this.trimString(env?.ANTHROPIC_DEFAULT_OPUS_MODEL)
        || this.trimString(env?.ANTHROPIC_DEFAULT_FABLE_MODEL)
        || this.trimString(env?.ANTHROPIC_DEFAULT_SONNET_MODEL)
        || this.trimString(env?.ANTHROPIC_DEFAULT_HAIKU_MODEL)
        || this.trimString(settings['model']);
    } catch {
      return undefined;
    }
  }

  private trimString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  async clearSettings(activeProfile?: Profile): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage(l10n('noWorkspaceFolder'));
      return;
    }

    const claudeDir = path.join(root, CLAUDE_DIR);
    const settingsPath = path.join(claudeDir, SETTINGS_FILENAME);
    const activeFilePath = path.join(claudeDir, ACTIVE_PROFILE_FILENAME);

    // Remove active profile id file
    if (fs.existsSync(activeFilePath)) {
      fs.unlinkSync(activeFilePath);
    }

    // Remove model and env fields from settings.local.json
    if (!fs.existsSync(settingsPath)) {
      vscode.window.showInformationMessage(l10n('noSettingsFile'));
      return;
    }

    // Standard keys plus any extra env vars the active profile wrote.
    const keysToClear = new Set<string>(ENV_KEYS as string[]);
    if (activeProfile) {
      for (const key of Object.keys(this.buildEffectiveEnv(activeProfile))) {
        keysToClear.add(key);
      }
      if (activeProfile.extraSettings && typeof activeProfile.extraSettings === 'object' && 'env' in activeProfile.extraSettings) {
        const extraEnv = (activeProfile.extraSettings as any).env;
        if (extraEnv && typeof extraEnv === 'object') {
          for (const key of Object.keys(extraEnv)) {
            keysToClear.add(key);
          }
        }
      }
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      delete settings['model'];
      if (settings['env'] && typeof settings['env'] === 'object') {
        const env = settings['env'] as Record<string, string>;
        for (const key of keysToClear) {
          delete env[key];
        }
        if (Object.keys(env).length === 0) {
          delete settings['env'];
        }
      }
      if (activeProfile) {
        for (const key of this.getExtraSettingsKeys(activeProfile)) {
          delete settings[key];
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      vscode.window.showInformationMessage(l10n('modelSettingsCleared'));
    } catch {
      vscode.window.showErrorMessage(l10n('parseSettingsFailed'));
    }
  }
}