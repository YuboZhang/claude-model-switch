import * as vscode from 'vscode';
import { l10n } from '../i18n';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor(
    private store: ProfileStore,
    private writer: SettingsWriter,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'claude-model-switch.switchProfile';
    this.item.show();
  }

  update(): void {
    const activeId = this.writer.getActiveProfileId();
    const currentModel = this.writer.getCurrentModel();

    if (activeId) {
      const profile = this.store.getById(activeId);
      if (profile) {
        this.item.text = `$(symbol-event) ${profile.name}`;
        this.item.tooltip = l10n('statusTooltipProfile', profile.name);
        return;
      }
    }

    if (currentModel) {
      this.item.text = `$(symbol-event) ${currentModel}`;
      this.item.tooltip = l10n('statusTooltipUnmatchedModel', currentModel);
      return;
    }

    this.item.text = `$(symbol-event) ${l10n('statusNoModel')}`;
    this.item.tooltip = l10n('statusTooltipNoModel');
  }

  dispose(): void {
    this.item.dispose();
  }
}