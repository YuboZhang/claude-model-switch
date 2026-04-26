import * as vscode from 'vscode';
import { Profile, maskToken } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';

export class ProfileTreeDataProvider implements vscode.TreeDataProvider<ProfileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProfileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private store: ProfileStore,
    private writer: SettingsWriter,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProfileItem): vscode.TreeItem {
    const activeId = this.writer.getActiveProfileId();
    const isActive = element.profile.id === activeId;

    const item = new vscode.TreeItem(element.profile.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.profile.model ?? '';
    item.contextValue = 'profile';
    item.tooltip = this.buildTooltip(element.profile, isActive);

    if (isActive) {
      item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    } else {
      item.iconPath = new vscode.ThemeIcon('circle-outline');
    }

    return item;
  }

  getChildren(): ProfileItem[] {
    return this.store.getAll().map(p => new ProfileItem(p));
  }

  private buildTooltip(profile: Profile, isActive: boolean): string {
    const lines: string[] = [];
    lines.push(`**${profile.name}**`);
    if (isActive) lines.push('(Active)');
    lines.push('');
    if (profile.model) lines.push(`Model: ${profile.model}`);
    if (profile.env.ANTHROPIC_BASE_URL) lines.push(`Base URL: ${profile.env.ANTHROPIC_BASE_URL}`);
    if (profile.env.ANTHROPIC_AUTH_TOKEN) lines.push(`Auth Token: ${maskToken(profile.env.ANTHROPIC_AUTH_TOKEN)}`);
    if (profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) lines.push(`Haiku: ${profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
    if (profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL) lines.push(`Opus: ${profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL}`);
    if (profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL) lines.push(`Sonnet: ${profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
    return lines.join('\n');
  }
}

export class ProfileItem {
  constructor(public readonly profile: Profile) {}
}