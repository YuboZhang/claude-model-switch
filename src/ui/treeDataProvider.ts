import * as vscode from 'vscode';
import { l10n } from '../i18n';
import { Profile, maskToken } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';

const PROFILE_MIME_TYPE = 'application/vnd.code.tree.claudeModelSwitchProfiles';

type SpeedResultStatus = 'success' | 'error';

interface ProfileSpeedResult {
  status: SpeedResultStatus;
  durationMs: number;
  error?: string;
}

export class ProfileTreeDataProvider implements vscode.TreeDataProvider<ProfileItem>, vscode.TreeDragAndDropController<ProfileItem> {
  readonly dragMimeTypes = [PROFILE_MIME_TYPE];
  readonly dropMimeTypes = [PROFILE_MIME_TYPE];

  private _onDidChangeTreeData = new vscode.EventEmitter<ProfileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private speedResults = new Map<string, ProfileSpeedResult>();

  constructor(
    private store: ProfileStore,
    private writer: SettingsWriter,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setSpeedResult(profileId: string, result: ProfileSpeedResult): void {
    this.speedResults.set(profileId, result);
    this.refresh();
  }

  setSpeedResults(results: Array<{ profileId: string; result: ProfileSpeedResult }>): void {
    for (const { profileId, result } of results) {
      this.speedResults.set(profileId, result);
    }
    this.refresh();
  }

  getTreeItem(element: ProfileItem): vscode.TreeItem {
    const activeId = this.writer.getActiveProfileId();
    const isActive = element.profile.id === activeId;

    const speedResult = this.speedResults.get(element.profile.id);
    const item = new vscode.TreeItem(element.profile.name, vscode.TreeItemCollapsibleState.None);
    item.id = element.profile.id;
    item.description = this.buildDescription(element.profile, speedResult);
    item.contextValue = 'profile';
    item.tooltip = this.buildTooltip(element.profile, isActive, speedResult);
    item.iconPath = this.buildIcon(isActive, speedResult);

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

  private buildDescription(profile: Profile, speedResult?: ProfileSpeedResult): string {
    const parts = [profile.model ?? ''];
    if (speedResult) {
      parts.push(speedResult.status === 'success' ? `${speedResult.durationMs}ms` : l10n('treeSpeedFailed'));
    }
    return parts.filter(Boolean).join(' · ');
  }

  private buildIcon(isActive: boolean, speedResult?: ProfileSpeedResult): vscode.ThemeIcon {
    if (!speedResult) {
      return isActive
        ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('circle-outline');
    }

    if (speedResult.status === 'error') {
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    }

    if (speedResult.durationMs < 5000) {
      return new vscode.ThemeIcon(isActive ? 'check' : 'circle-filled', new vscode.ThemeColor('charts.green'));
    }

    if (speedResult.durationMs <= 10000) {
      return new vscode.ThemeIcon(isActive ? 'check' : 'circle-filled', new vscode.ThemeColor('charts.yellow'));
    }

    return new vscode.ThemeIcon(isActive ? 'check' : 'circle-filled', new vscode.ThemeColor('charts.red'));
  }

  private buildTooltip(profile: Profile, isActive: boolean, speedResult?: ProfileSpeedResult): string {
    const lines: string[] = [];
    lines.push(`**${profile.name}**`);
    if (isActive) lines.push(l10n('treeCurrentProfile'));
    lines.push('');
    if (profile.model) lines.push(l10n('treeModel', profile.model));
    if (profile.env.ANTHROPIC_BASE_URL) lines.push(l10n('treeBaseUrl', profile.env.ANTHROPIC_BASE_URL));
    if (profile.env.ANTHROPIC_AUTH_TOKEN) lines.push(l10n('treeAuthToken', maskToken(profile.env.ANTHROPIC_AUTH_TOKEN)));
    if (profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) lines.push(`Haiku: ${profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
    if (profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL) lines.push(`Opus: ${profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL}`);
    if (profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL) lines.push(`Sonnet: ${profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
    if (speedResult) {
      lines.push('');
      if (speedResult.status === 'success') {
        lines.push(l10n('treeSpeed', speedResult.durationMs));
      } else {
        lines.push(l10n('treeSpeedFailedDetail', speedResult.error ?? l10n('unknownError')));
      }
    }
    return lines.join('\n');
  }
}

export class ProfileItem {
  constructor(public readonly profile: Profile) {}
}