import * as vscode from 'vscode';
import { Profile } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';
import { ProfileTreeDataProvider } from '../ui/treeDataProvider';
import { WebviewPanel } from '../ui/webviewPanel';
import { StatusBar } from '../ui/statusBar';
import { exportProfiles, importProfiles } from '../ui/importExport';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: ProfileStore,
  writer: SettingsWriter,
  treeProvider: ProfileTreeDataProvider,
  statusBar: StatusBar,
): void {
  const refreshAll = () => {
    treeProvider.refresh();
    statusBar.update();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-model-switch.addProfile', () => {
      WebviewPanel.createOrShow(context.extensionUri, store, { mode: 'create' }, () => {
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('claude-model-switch.switchProfile', async (item?: { profile: Profile }) => {
      if (item?.profile) {
        await writer.switchToProfile(item.profile);
        refreshAll();
        return;
      }

      // Command palette: show QuickPick
      const profiles = store.getAll();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage('No profiles available. Add one first.');
        return;
      }

      const activeId = writer.getActiveProfileId();
      const items = profiles.map(p => ({
        label: p.id === activeId ? `$(check) ${p.name}` : p.name,
        description: p.model ?? '',
        profile: p,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Switch Claude Model',
        placeHolder: 'Select a model profile',
      });

      if (selected) {
        await writer.switchToProfile(selected.profile);
        refreshAll();
      }
    }),

    vscode.commands.registerCommand('claude-model-switch.editProfile', (item?: { profile: Profile }) => {
      if (!item?.profile) return;
      WebviewPanel.createOrShow(context.extensionUri, store, { mode: 'edit', profile: item.profile }, () => {
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('claude-model-switch.copyProfile', (item?: { profile: Profile }) => {
      if (!item?.profile) return;
      WebviewPanel.createOrShow(context.extensionUri, store, { mode: 'copy', profile: item.profile }, () => {
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('claude-model-switch.deleteProfile', async (item?: { profile: Profile }) => {
      if (!item?.profile) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete profile "${item.profile.name}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm === 'Delete') {
        store.delete(item.profile.id);
        refreshAll();
      }
    }),

    vscode.commands.registerCommand('claude-model-switch.exportProfiles', async () => {
      await exportProfiles(store);
    }),

    vscode.commands.registerCommand('claude-model-switch.importProfiles', async () => {
      await importProfiles(store);
      refreshAll();
    }),

    vscode.commands.registerCommand('claude-model-switch.clearSettings', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear model settings from the current project\'s .claude/settings.local.json?',
        { modal: true },
        'Clear',
      );
      if (confirm === 'Clear') {
        await writer.clearSettings();
        refreshAll();
      }
    }),
  );
}