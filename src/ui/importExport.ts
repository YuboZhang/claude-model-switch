import * as vscode from 'vscode';
import * as fs from 'fs';
import { l10n } from '../i18n';
import { ProfileStore } from '../storage/profileStore';

export async function exportProfiles(store: ProfileStore): Promise<void> {
  const content = store.exportAll();
  if (!content || content === '[]') {
    vscode.window.showInformationMessage(l10n('noProfilesToExport'));
    return;
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('claude-model-profiles.json'),
    filters: { JSON: ['json'] },
    title: l10n('exportProfilesTitle'),
  });

  if (!uri) return;

  fs.writeFileSync(uri.fsPath, content, 'utf-8');
  vscode.window.showInformationMessage(l10n('profilesExportedTo', uri.fsPath));
}

export async function importProfiles(store: ProfileStore): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    filters: { JSON: ['json'] },
    title: l10n('importProfilesTitle'),
    canSelectMany: false,
  });

  if (!uris || uris.length === 0) return;

  const content = fs.readFileSync(uris[0].fsPath, 'utf-8');

  const result = await store.importFromJSON(content, async (name) => {
    const choice = await vscode.window.showWarningMessage(
      l10n('profileConflict', name),
      { modal: true },
      l10n('overwrite'),
      l10n('skip'),
    );
    return choice === l10n('overwrite') ? 'overwrite' : 'skip';
  });

  vscode.window.showInformationMessage(
    l10n('importResult', result.imported, result.skipped),
  );
}