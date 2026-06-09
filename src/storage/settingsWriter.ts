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
  'ANTHROPIC_MODEL',
];

const DEFAULT_MODEL_NAME_PAIRS: Array<[keyof ProfileEnv, keyof ProfileEnv]> = [
  ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME'],
  ['ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME'],
  ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME'],
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

  async switchToProfile(profile: Profile): Promise<void> {
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

    const profileEnv: ProfileEnv = { ...profile.env };
    for (const [modelKey, nameKey] of DEFAULT_MODEL_NAME_PAIRS) {
      const value = profileEnv[modelKey];
      if (value !== undefined && value !== '') {
        profileEnv[nameKey] = value;
      } else {
        delete profileEnv[nameKey];
      }
    }

    const env = settings['env'] && typeof settings['env'] === 'object'
      ? settings['env'] as Record<string, string>
      : {};
    for (const key of ENV_KEYS) {
      if (profileEnv[key] !== undefined && profileEnv[key] !== '') {
        env[key] = profileEnv[key]!;
      } else {
        delete env[key];
      }
    }
    settings['env'] = env;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
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

  async clearSettings(): Promise<void> {
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

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      delete settings['model'];
      if (settings['env'] && typeof settings['env'] === 'object') {
        const env = settings['env'] as Record<string, string>;
        for (const key of ENV_KEYS) {
          delete env[key];
        }
        if (Object.keys(env).length === 0) {
          delete settings['env'];
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      vscode.window.showInformationMessage(l10n('modelSettingsCleared'));
    } catch {
      vscode.window.showErrorMessage(l10n('parseSettingsFailed'));
    }
  }
}