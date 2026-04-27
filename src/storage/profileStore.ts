import * as vscode from 'vscode';
import { Profile } from '../models/profile';

const STORAGE_KEY = 'claudeModelSwitchProfiles';

export class ProfileStore {
  constructor(private context: vscode.ExtensionContext) {}

  getAll(): Profile[] {
    return this.context.globalState.get<Profile[]>(STORAGE_KEY) ?? [];
  }

  getById(id: string): Profile | undefined {
    return this.getAll().find(p => p.id === id);
  }

  add(profile: Profile): void {
    const profiles = this.getAll();
    profiles.push(profile);
    this.context.globalState.update(STORAGE_KEY, profiles);
  }

  update(profile: Profile): void {
    const profiles = this.getAll();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
      this.context.globalState.update(STORAGE_KEY, profiles);
    }
  }

  setAll(profiles: Profile[]): void {
    this.context.globalState.update(STORAGE_KEY, [...profiles]);
  }

  delete(id: string): void {
    const profiles = this.getAll().filter(p => p.id !== id);
    this.context.globalState.update(STORAGE_KEY, profiles);
  }

  exportAll(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  async importFromJSON(jsonStr: string, conflictHandler: (name: string) => Promise<'overwrite' | 'skip'>): Promise<{ imported: number; skipped: number }> {
    let parsed: Profile[];
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      vscode.window.showErrorMessage('Invalid JSON file');
      return { imported: 0, skipped: 0 };
    }

    const existing = this.getAll();
    let imported = 0;
    let skipped = 0;
    const result: Profile[] = [...existing];

    for (const profile of parsed) {
      const conflictIdx = result.findIndex(p => p.name === profile.name);
      if (conflictIdx >= 0) {
        const choice = await conflictHandler(profile.name);
        if (choice === 'overwrite') {
          result[conflictIdx] = profile;
          imported++;
        } else {
          skipped++;
        }
      } else {
        result.push(profile);
        imported++;
      }
    }

    this.context.globalState.update(STORAGE_KEY, result);
    return { imported, skipped };
  }
}