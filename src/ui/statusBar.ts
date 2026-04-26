import * as vscode from 'vscode';
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
        this.item.tooltip = `Claude Model: ${profile.name}\nClick to switch`;
        return;
      }
    }

    if (currentModel) {
      this.item.text = `$(symbol-event) ${currentModel}`;
      this.item.tooltip = `Claude Model: ${currentModel} (unmatched profile)\nClick to switch`;
      return;
    }

    this.item.text = '$(symbol-event) No Model';
    this.item.tooltip = 'No Claude model configured\nClick to switch';
  }

  dispose(): void {
    this.item.dispose();
  }
}