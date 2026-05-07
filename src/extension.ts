import * as vscode from 'vscode';
import { ProfileStore } from './storage/profileStore';
import { SettingsWriter } from './storage/settingsWriter';
import { ProfileTreeDataProvider } from './ui/treeDataProvider';
import { StatusBar } from './ui/statusBar';
import { registerCommands } from './commands/registerCommands';

export function activate(context: vscode.ExtensionContext): void {
  // Enable VS Code Settings Sync for profiles across devices
  context.globalState.setKeysForSync(['claudeModelSwitchProfiles']);

  const store = new ProfileStore(context);
  const writer = new SettingsWriter();
  const treeProvider = new ProfileTreeDataProvider(store, writer);
  const statusBar = new StatusBar(store, writer);

  const treeView = vscode.window.createTreeView('claudeModelSwitchProfiles', {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    showCollapseAll: false,
    manageCheckboxStateManually: true,
  });

  void vscode.commands.executeCommand('setContext', 'claudeModelSwitch.speedSelectionMode', false);
  void vscode.commands.executeCommand('setContext', 'claudeModelSwitch.deleteSelectionMode', false);

  context.subscriptions.push(
    treeView,
    treeView.onDidChangeCheckboxState(event => {
      for (const [item, state] of event.items) {
        const selected = state === vscode.TreeItemCheckboxState.Checked;
        if (treeProvider.isSpeedSelectionMode()) {
          treeProvider.setSpeedTestSelection(item.profile.id, selected);
        } else if (treeProvider.isDeleteSelectionMode()) {
          treeProvider.setDeleteSelection(item.profile.id, selected);
        }
      }
    }),
    statusBar,
  );

  registerCommands(context, store, writer, treeProvider, statusBar);

  // Refresh on active editor change (for multi-workspace support)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      statusBar.update();
      treeProvider.refresh();
    }),
  );

  // Watch for settings.local.json changes
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '.claude/settings.local.json'),
      );
      watcher.onDidChange(() => {
        statusBar.update();
        treeProvider.refresh();
      });
      watcher.onDidCreate(() => {
        statusBar.update();
        treeProvider.refresh();
      });
      context.subscriptions.push(watcher);
    }
  }

  statusBar.update();
}

export function deactivate(): void {}