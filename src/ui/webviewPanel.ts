import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isChinese, l10n } from '../i18n';
import { Profile, generateId } from '../models/profile';
import { ProfileStore } from '../storage/profileStore';

type WebviewMode = 'create' | 'edit' | 'copy';

interface WebviewPanelOptions {
  mode: WebviewMode;
  profile?: Profile;
}

export class WebviewPanel {
  public static currentPanel: WebviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private store: ProfileStore,
    private options: WebviewPanelOptions,
    private onSave: (profile: Profile) => void,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getWebviewContent(this.panel.webview, extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case 'save': {
            const profile: Profile = msg.profile;
            if (this.options.mode === 'edit' && this.options.profile) {
              profile.id = this.options.profile.id;
              this.store.update(profile);
            } else {
              if (!profile.id) {
                profile.id = generateId();
              }
              this.store.add(profile);
            }
            this.onSave(profile);
            this.panel.dispose();
            break;
          }
          case 'cancel': {
            this.panel.dispose();
            break;
          }
        }
      },
      null,
      this.disposables,
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    store: ProfileStore,
    options: WebviewPanelOptions,
    onSave: (profile: Profile) => void,
  ): WebviewPanel {
    if (WebviewPanel.currentPanel) {
      WebviewPanel.currentPanel.panel.dispose();
    }

    const title = options.mode === 'edit'
      ? l10n('webviewEditPanelTitle', options.profile?.name ?? '')
      : l10n('webviewAddPanelTitle');

    const panel = vscode.window.createWebviewPanel(
      'claudeModelSwitchEdit',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    WebviewPanel.currentPanel = new WebviewPanel(panel, extensionUri, store, options, onSave);
    return WebviewPanel.currentPanel;
  }

  private dispose(): void {
    WebviewPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const profile = this.options.profile;
    const isEdit = this.options.mode === 'edit';

    const mediaDir = path.join(extensionUri.fsPath, 'media');
    const htmlTemplate = fs.readFileSync(path.join(mediaDir, 'webview.html'), 'utf-8');

    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));

    let html = htmlTemplate;
    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace('{{cssSrc}}', cssUri.toString());
    html = html.replace('{{cssUri}}', cssUri.toString());
    html = html.replace('{{jsUri}}', jsUri.toString());
    html = html.replace('{{htmlLang}}', isChinese() ? 'zh-CN' : 'en');
    html = html.replace('{{title}}', isEdit ? l10n('webviewEditTitle') : l10n('webviewAddTitle'));
    html = html.replace('{{heading}}', isEdit ? l10n('webviewEditHeading') : l10n('webviewAddHeading'));
    html = html.replace('{{environmentVariables}}', l10n('webviewEnvironmentVariables'));
    html = html.replace('{{profileName}}', l10n('webviewProfileName'));
    html = html.replace('{{nameHint}}', l10n('webviewNameHint'));
    html = html.replace('{{save}}', l10n('webviewSave'));
    html = html.replace('{{cancel}}', l10n('webviewCancel'));
    html = html.replace('{{showHide}}', l10n('webviewShowHide'));
    html = html.replace('{{unnamed}}', escapeAttr(l10n('webviewUnnamed')));
    html = html.replace('{{name}}', escapeAttr(profile?.name ?? ''));
    html = html.replace('{{model}}', escapeAttr(profile?.model ?? ''));
    html = html.replace('{{ANTHROPIC_AUTH_TOKEN}}', escapeAttr(profile?.env?.ANTHROPIC_AUTH_TOKEN ?? ''));
    html = html.replace('{{ANTHROPIC_BASE_URL}}', escapeAttr(profile?.env?.ANTHROPIC_BASE_URL ?? ''));
    html = html.replace('{{ANTHROPIC_DEFAULT_HAIKU_MODEL}}', escapeAttr(profile?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? ''));
    html = html.replace('{{ANTHROPIC_DEFAULT_OPUS_MODEL}}', escapeAttr(profile?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL ?? ''));
    html = html.replace('{{ANTHROPIC_DEFAULT_SONNET_MODEL}}', escapeAttr(profile?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? ''));
    html = html.replace('{{ANTHROPIC_MODEL}}', escapeAttr(profile?.env?.ANTHROPIC_MODEL ?? ''));

    return html;
  }
}

function getNonce(): string {
  let result = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}