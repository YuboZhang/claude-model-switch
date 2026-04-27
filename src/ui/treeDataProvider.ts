import * as vscode from 'vscode';
import { Profile, maskToken } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';

const PROFILE_MIME_TYPE = 'application/vnd.code.tree.claudeModelSwitchProfiles';

export class ProfileTreeDataProvider implements vscode.TreeDataProvider<ProfileItem>, vscode.TreeDragAndDropController<ProfileItem> {
  readonly dragMimeTypes = [PROFILE_MIME_TYPE];
  readonly dropMimeTypes = [PROFILE_MIME_TYPE];

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
    item.id = element.profile.id;
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

  async handleDrag(source: readonly ProfileItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    const draggedIds = source.map(item => item.profile.id);
    dataTransfer.set(PROFILE_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(draggedIds)));
  }

  async handleDrop(target: ProfileItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    const transferItem = dataTransfer.get(PROFILE_MIME_TYPE);
    if (!transferItem) return;

    const rawValue = await transferItem.asString();
    let draggedIds: string[];

    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
        return;
      }
      draggedIds = parsed;
    } catch {
      return;
    }

    const draggedId = draggedIds[0];
    const profiles = this.store.getAll();
    const fromIndex = profiles.findIndex(profile => profile.id === draggedId);
    if (fromIndex < 0) return;

    const targetId = target?.profile.id;
    if (targetId === draggedId) return;

    const reordered = [...profiles];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;

    if (!targetId) {
      reordered.push(moved);
    } else {
      const targetIndex = reordered.findIndex(profile => profile.id === targetId);
      if (targetIndex < 0) {
        reordered.push(moved);
      } else {
        reordered.splice(targetIndex, 0, moved);
      }
    }

    this.store.setAll(reordered);
    this.refresh();
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