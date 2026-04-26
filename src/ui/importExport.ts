import * as vscode from 'vscode';
import * as fs from 'fs';
import { ProfileStore } from '../storage/profileStore';

export async function exportProfiles(store: ProfileStore): Promise<void> {
  const content = store.exportAll();
  if (!content || content === '[]') {
    vscode.window.showInformationMessage('No profiles to export');
    return;
  }

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('claude-model-profiles.json'),
    filters: { JSON: ['json'] },
    title: 'Export Model Profiles',
  });

  if (!uri) return;

  fs.writeFileSync(uri.fsPath, content, 'utf-8');
  vscode.window.showInformationMessage(`Profiles exported to ${uri.fsPath}`);
}

export async function importProfiles(store: ProfileStore): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    filters: { JSON: ['json'] },
    title: 'Import Model Profiles',
    canSelectMany: false,
  });

  if (!uris || uris.length === 0) return;

  const content = fs.readFileSync(uris[0].fsPath, 'utf-8');

  const result = await store.importFromJSON(content, async (name) => {
    const choice = await vscode.window.showWarningMessage(
      `Profile "${name}" already exists. What do you want to do?`,
      { modal: true },
      'Overwrite',
      'Skip',
    );
    return choice === 'Overwrite' ? 'overwrite' : 'skip';
  });

  vscode.window.showInformationMessage(
    `Imported ${result.imported} profiles, skipped ${result.skipped}`,
  );
}