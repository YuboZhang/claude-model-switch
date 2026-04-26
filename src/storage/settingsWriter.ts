import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Profile, ProfileEnv } from '../models/profile';

const ACTIVE_PROFILE_FILENAME = '.claude-model-switch-active.json';
const CLAUDE_DIR = '.claude';
const SETTINGS_FILENAME = 'settings.local.json';

const ENV_KEYS: (keyof ProfileEnv)[] = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
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
      vscode.window.showErrorMessage('No workspace folder open');
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

    if (profile.model) {
      settings['model'] = profile.model;
    }

    const env = (settings['env'] as Record<string, string>) ?? {};
    for (const key of ENV_KEYS) {
      if (profile.env[key] !== undefined && profile.env[key] !== '') {
        env[key] = profile.env[key]!;
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
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return (settings as Record<string, unknown>)['model'] as string;
    } catch {
      return undefined;
    }
  }

  async clearSettings(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      vscode.window.showErrorMessage('No workspace folder open');
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
      vscode.window.showInformationMessage('No settings.local.json found');
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
      vscode.window.showInformationMessage('Model settings cleared');
    } catch {
      vscode.window.showErrorMessage('Failed to parse settings.local.json');
    }
  }
}