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

const SPEED_SELECTION_CONTEXT = 'claudeModelSwitch.speedSelectionMode';
const DELETE_SELECTION_CONTEXT = 'claudeModelSwitch.deleteSelectionMode';

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

  const exitSelectionMode = async () => {
    treeProvider.exitSelectionMode();
    await vscode.commands.executeCommand('setContext', SPEED_SELECTION_CONTEXT, false);
    await vscode.commands.executeCommand('setContext', DELETE_SELECTION_CONTEXT, false);
  };

  const enterSpeedSelectionMode = async () => {
    treeProvider.enterSpeedSelectionMode();
    await vscode.commands.executeCommand('setContext', SPEED_SELECTION_CONTEXT, true);
    await vscode.commands.executeCommand('setContext', DELETE_SELECTION_CONTEXT, false);
  };

  const enterDeleteSelectionMode = async () => {
    treeProvider.enterDeleteSelectionMode();
    await vscode.commands.executeCommand('setContext', SPEED_SELECTION_CONTEXT, false);
    await vscode.commands.executeCommand('setContext', DELETE_SELECTION_CONTEXT, true);
  };

  const clearWorkspaceModelSettings = async () => {
    const confirm = await vscode.window.showWarningMessage(
      l10n('clearWorkspaceModelSettingsConfirm'),
      { modal: true },
      l10n('clear'),
    );
    if (confirm === l10n('clear')) {
      const activeId = writer.getActiveProfileId();
      const activeProfile = activeId ? store.getById(activeId) : undefined;
      await writer.clearSettings(activeProfile);
      refreshAll();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-model-switch.addProfile', () => {
      WebviewPanel.createOrShow(context.extensionUri, store, { mode: 'create' }, () => {
        refreshAll();
      });
    }),

    vscode.commands.registerCommand('claude-model-switch.switchProfile', async (item?: { profile: Profile }) => {
      const previousId = writer.getActiveProfileId();
      const previousProfile = previousId ? store.getById(previousId) : undefined;

      if (item?.profile) {
        await writer.switchToProfile(item.profile, previousProfile);
        refreshAll();
        vscode.window.showInformationMessage(l10n('profileSwitched', formatProfileLabel(item.profile)));
        return;
      }

      const profile = await pickProfile(store, writer, l10n('switchClaudeModel'));
      if (profile) {
        await writer.switchToProfile(profile, previousProfile);
        refreshAll();
        vscode.window.showInformationMessage(l10n('profileSwitched', formatProfileLabel(profile)));
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
          location: vscode.ProgressLocation.Window,
          title: l10n('testingProfile', formatProfileLabel(profile)),
          cancellable: false,
        },
        () => speedTester.testProfile(profile),
      );

      treeProvider.setSpeedResult(profile.id, {
        status: result.status,
        durationMs: result.durationMs,
        firstTokenMs: result.firstTokenMs,
        speedTokensPerSec: result.speedTokensPerSec,
        error: result.error,
      });

      if (result.status === 'success') {
        if (result.firstTokenMs !== undefined && result.speedTokensPerSec !== undefined) {
          vscode.window.showInformationMessage(`${profile.name}: ${l10n('webviewSpeedResultSuccess', result.firstTokenMs, result.durationMs, result.speedTokensPerSec)} (${result.model ?? l10n('unknownModel')})`);
        } else {
          vscode.window.showInformationMessage(`${profile.name}: ${result.durationMs}ms (${result.model ?? l10n('unknownModel')})`);
        }
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

      await enterSpeedSelectionMode();
    }),

    vscode.commands.registerCommand('claude-model-switch.toggleAllSpeedTestProfiles', () => {
      treeProvider.toggleAllSpeedTestProfiles();
    }),

    vscode.commands.registerCommand('claude-model-switch.toggleSpeedTestProfile', (item?: { profile: Profile }) => {
      if (!item?.profile) return;
      treeProvider.toggleSpeedTestProfile(item.profile.id);
    }),

    vscode.commands.registerCommand('claude-model-switch.cancelSpeedTestSelection', async () => {
      await exitSelectionMode();
    }),

    vscode.commands.registerCommand('claude-model-switch.startSelectedProfilesSpeedTest', async () => {
      const selectedProfiles = treeProvider.getSpeedTestSelectedProfiles();
      if (selectedProfiles.length === 0) {
        vscode.window.showInformationMessage(l10n('noSpeedTestProfilesSelected'));
        return;
      }

      await exitSelectionMode();

      const speedResultsTemp: Array<{ profileId: string; result: any }> = [];

      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: l10n('testingAllProfiles'),
          cancellable: false,
        },
        (progress) => speedTester.testProfiles(selectedProfiles, (result, completed, total) => {
          speedResultsTemp.push({
            profileId: result.profile.id,
            result: {
              status: result.status,
              durationMs: result.durationMs,
              firstTokenMs: result.firstTokenMs,
              speedTokensPerSec: result.speedTokensPerSec,
              error: result.error,
            }
          });
          progress.report({
            message: `${completed}/${total} ${formatProfileLabel(result.profile)}`,
          });
        }),
      );

      // 全部测完后，一次性更新列表，仅重绘 1 次
      treeProvider.setSpeedResults(speedResultsTemp);

      showSpeedTestResults(speedOutput, results);
      const successCount = results.filter(result => result.status === 'success').length;
      vscode.window.showInformationMessage(l10n('speedTestComplete', successCount, results.length));
    }),

    vscode.commands.registerCommand('claude-model-switch.deleteModelProfiles', async () => {
      const profiles = store.getAll();
      if (profiles.length === 0) {
        vscode.window.showInformationMessage(l10n('noProfilesAvailable'));
        return;
      }

      await enterDeleteSelectionMode();
    }),

    vscode.commands.registerCommand('claude-model-switch.toggleAllDeleteProfiles', () => {
      treeProvider.toggleAllDeleteProfiles();
    }),

    vscode.commands.registerCommand('claude-model-switch.toggleDeleteProfileSelection', (item?: { profile: Profile }) => {
      if (!item?.profile) return;
      treeProvider.toggleDeleteProfile(item.profile.id);
    }),

    vscode.commands.registerCommand('claude-model-switch.cancelDeleteProfileSelection', async () => {
      await exitSelectionMode();
    }),

    vscode.commands.registerCommand('claude-model-switch.startSelectedProfilesDelete', async () => {
      const selectedProfiles = treeProvider.getDeleteSelectedProfiles();
      if (selectedProfiles.length === 0) {
        vscode.window.showInformationMessage(l10n('noDeleteProfilesSelected'));
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        l10n('deleteSelectedProfilesConfirm', selectedProfiles.length),
        { modal: true },
        l10n('delete'),
      );
      if (confirm !== l10n('delete')) return;

      for (const profile of selectedProfiles) {
        store.delete(profile.id);
      }
      await exitSelectionMode();
      refreshAll();
      vscode.window.showInformationMessage(l10n('deleteProfilesComplete', selectedProfiles.length));
    }),

    vscode.commands.registerCommand('claude-model-switch.clearWorkspaceModelSettings', clearWorkspaceModelSettings),

    vscode.commands.registerCommand('claude-model-switch.clearSettings', clearWorkspaceModelSettings),
  );
}

function getDisplayModel(profile: Profile): string {
  return profile.env.ANTHROPIC_MODEL
    || profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    || profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    || profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    || '';
}

function formatProfileLabel(profile: Profile): string {
  const model = getDisplayModel(profile);
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
      description: getDisplayModel(profile),
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
    const model = result.model ? ` (${result.model})` : '';
    if (result.status === 'success') {
      if (result.firstTokenMs !== undefined && result.speedTokensPerSec !== undefined) {
        output.appendLine(l10n('speedResultSuccessDetail', result.firstTokenMs, result.durationMs, result.speedTokensPerSec, result.profile.name, model));
      } else {
        output.appendLine(l10n('speedResultSuccess', result.durationMs, result.profile.name, model));
      }
    } else {
      output.appendLine(l10n('speedResultError', result.durationMs, result.profile.name, model, result.error ?? l10n('speedTestFailed')));
    }
  }
  output.show(true);
}
