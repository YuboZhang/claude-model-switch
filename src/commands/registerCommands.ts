import * as vscode from 'vscode';
import { Profile } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';
import { SettingsWriter } from '../storage/settingsWriter';
import { ProfileTreeDataProvider } from '../ui/treeDataProvider';
import { WebviewPanel } from '../ui/webviewPanel';
import { StatusBar } from '../ui/statusBar';
import { exportProfiles, importProfiles } from '../ui/importExport';
import { SpeedTester, SpeedTestResult } from '../services/speedTester';
import { l10n } from '../i18n';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: ProfileStore,
  writer: SettingsWriter,
  treeProvider: ProfileTreeDataProvider,
  statusBar: StatusBar,
): void {
  const speedTester = new SpeedTester();
  const speedOutput = vscode.window.createOutputChannel(l10n('outputChannelSpeedTest'));
  context.subscriptions.push(speedOutput);

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

      const profile = await pickProfile(store, writer, l10n('switchClaudeModel'));
      if (profile) {
        await writer.switchToProfile(profile);
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
        l10n('deleteProfileConfirm', item.profile.name),
        { modal: true },
        l10n('delete'),
      );
      if (confirm === l10n('delete')) {
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

    vscode.commands.registerCommand('claude-model-switch.testProfileSpeed', async (item?: { profile: Profile }) => {
      const profile = item?.profile ?? await pickProfile(store, writer, l10n('modelSpeedTest'));
      if (!profile) return;

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: l10n('testingProfile', formatProfileLabel(profile)),
          cancellable: false,
        },
        () => speedTester.testProfile(profile),
      );

      treeProvider.setSpeedResult(profile.id, {
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      });

      if (result.status === 'success') {
        vscode.window.showInformationMessage(`${profile.name}: ${result.durationMs}ms (${result.model ?? l10n('unknownModel')})`);
      } else {
        vscode.window.showErrorMessage(`${profile.name}: ${result.error ?? l10n('speedTestFailed')} (${result.durationMs}ms)`);
      }
    }),

    vscode.commands.registerCommand('claude-model-switch.testAllProfilesSpeed', async () => {
      const profiles = store.getAll();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage(l10n('noProfilesAvailable'));
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        l10n('speedTestAllConfirm', profiles.length),
        { modal: true },
        l10n('startSpeedTest'),
      );
      if (confirm !== l10n('startSpeedTest')) return;

      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: l10n('testingAllProfiles'),
          cancellable: false,
        },
        (progress) => speedTester.testProfiles(profiles, (result, completed, total) => {
          treeProvider.setSpeedResult(result.profile.id, {
            status: result.status,
            durationMs: result.durationMs,
            error: result.error,
          });
          progress.report({
            increment: 100 / total,
            message: `${completed}/${total} ${formatProfileLabel(result.profile)}`,
          });
        }),
      );

      showSpeedTestResults(speedOutput, results);
      const successCount = results.filter(result => result.status === 'success').length;
      vscode.window.showInformationMessage(l10n('speedTestComplete', successCount, results.length));
    }),

    vscode.commands.registerCommand('claude-model-switch.clearSettings', async () => {
      const confirm = await vscode.window.showWarningMessage(
        l10n('clearSettingsConfirm'),
        { modal: true },
        l10n('clear'),
      );
      if (confirm === l10n('clear')) {
        await writer.clearSettings();
        refreshAll();
      }
    }),
  );
}

function formatProfileLabel(profile: Profile): string {
  const model = profile.env.ANTHROPIC_MODEL || profile.model;
  return model ? `${profile.name} (${model})` : profile.name;
}

async function pickProfile(store: ProfileStore, writer: SettingsWriter, title: string): Promise<Profile | undefined> {
  const profiles = store.getAll();
  if (profiles.length === 0) {
    vscode.window.showInformationMessage(l10n('noProfilesAvailable'));
    return undefined;
  }

  const activeId = writer.getActiveProfileId();
  const selected = await vscode.window.showQuickPick(
    profiles.map(profile => ({
      label: profile.id === activeId ? `$(check) ${profile.name}` : profile.name,
      description: profile.env.ANTHROPIC_MODEL || profile.model || '',
      profile,
    })),
    {
      title,
      placeHolder: l10n('pickProfilePlaceholder'),
    },
  );

  return selected?.profile;
}

function showSpeedTestResults(output: vscode.OutputChannel, results: SpeedTestResult[]): void {
  const sorted = [...results].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'success' ? -1 : 1;
    return a.durationMs - b.durationMs;
  });

  output.clear();
  output.appendLine(l10n('speedResultsHeader'));
  output.appendLine('');
  for (const result of sorted) {
    const model = result.model ? ` ${result.model}` : '';
    if (result.status === 'success') {
      output.appendLine(l10n('speedResultSuccess', result.durationMs, result.profile.name, model));
    } else {
      output.appendLine(l10n('speedResultError', result.durationMs, result.profile.name, model, result.error ?? l10n('speedTestFailed')));
    }
  }
  output.show(true);
}
