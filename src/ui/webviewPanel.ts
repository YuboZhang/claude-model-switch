import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isChinese, l10n } from '../i18n';
import { Profile, generateId } from '../models/profile';
import { normalizeProfile, ProfileStore } from '../storage/profileStore';
import { SpeedTester } from '../services/speedTester';
import { SettingsWriter } from '../storage/settingsWriter';
import * as os from 'os';

type WebviewMode = 'create' | 'edit' | 'copy';

interface WebviewPanelOptions {
  mode: WebviewMode;
  profile?: Profile;
}

export class WebviewPanel {
  public static currentPanel: WebviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private readonly speedTester = new SpeedTester();

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
            const profile: Profile = normalizeProfile(msg.profile);
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
          case 'fetchModels': {
            const baseURL = typeof msg.baseURL === 'string' ? msg.baseURL.trim() : '';
            const token = typeof msg.token === 'string' ? msg.token.trim() : '';

            try {
              const models = await this.speedTester.listModels(baseURL, token);
              await this.panel.webview.postMessage({
                type: 'modelsFetched',
                modelEntries: models,
              });
            } catch (error) {
              await this.panel.webview.postMessage({
                type: 'modelsFetchFailed',
                error: this.speedTester.formatError(error),
              });
            }
            break;
          }
          case 'testModelSpeed': {
            const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
            const target = typeof msg.target === 'string' ? msg.target : '';
            const model = typeof msg.model === 'string' ? msg.model.trim() : '';
            const authToken = typeof msg.authToken === 'string' ? msg.authToken : '';
            const baseURL = typeof msg.baseURL === 'string' ? msg.baseURL : '';

            if (!model) {
              await this.panel.webview.postMessage({
                type: 'modelSpeedTestResult',
                requestId,
                target,
                status: 'error',
                durationMs: 0,
                requestedModel: model,
                error: l10n('speedMissingModel'),
              });
              break;
            }

            const profile: Profile = {
              id: `webview-${target || 'model-speed-test'}`,
              name: model,
              env: {
                ANTHROPIC_AUTH_TOKEN: authToken,
                ANTHROPIC_BASE_URL: baseURL,
                ANTHROPIC_MODEL: model,
              },
            };
            const result = await this.speedTester.testProfile(profile);
            let formattedText = '';
            if (result.status === 'success') {
              if (result.firstTokenMs !== undefined && result.speedTokensPerSec !== undefined) {
                formattedText = l10n('webviewSpeedResultSuccess', result.firstTokenMs, result.durationMs, result.speedTokensPerSec);
              } else {
                formattedText = `${result.durationMs}ms`;
              }
            }
            await this.panel.webview.postMessage({
              type: 'modelSpeedTestResult',
              requestId,
              target,
              status: result.status,
              durationMs: result.durationMs,
              firstTokenMs: result.firstTokenMs,
              speedTokensPerSec: result.speedTokensPerSec,
              formattedText,
              requestedModel: model,
              model: result.model,
              error: result.error,
            });
            break;
          }
          case 'loadConfig': {
            const source = msg.source === 'global' ? 'global' : 'project';
            let filePath: string | undefined;
            if (source === 'global') {
              filePath = path.join(os.homedir(), '.claude', 'settings.json');
            } else {
              const root = new SettingsWriter().getWorkspaceRoot();
              if (root) {
                filePath = path.join(root, '.claude', 'settings.local.json');
              }
            }

            if (!filePath || !fs.existsSync(filePath)) {
              await this.panel.webview.postMessage({
                type: 'configLoadFailed',
                source,
                error: source === 'global' ? l10n('webviewImportGlobalFailed') : l10n('webviewImportProjectFailed'),
              });
              break;
            }

            try {
              const fileContent = fs.readFileSync(filePath, 'utf-8');
              const settings = JSON.parse(fileContent);
              
              // Resolve values into a profile structure
              const env = settings.env && typeof settings.env === 'object' ? settings.env : {};
              
              const resolvedEnv: Record<string, string> = {};
              const extraEnv: Record<string, string> = {};
              
              const standardKeys = [
                'ANTHROPIC_AUTH_TOKEN',
                'ANTHROPIC_BASE_URL',
                'ANTHROPIC_DEFAULT_HAIKU_MODEL',
                'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
                'ANTHROPIC_DEFAULT_SONNET_MODEL',
                'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
                'ANTHROPIC_DEFAULT_OPUS_MODEL',
                'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
                'ANTHROPIC_DEFAULT_FABLE_MODEL',
                'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
                'ANTHROPIC_MODEL',
              ];
              
              const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || settings.apiKey || '';
              resolvedEnv.ANTHROPIC_AUTH_TOKEN = typeof token === 'string' ? token : '';
              
              const baseUrl = env.ANTHROPIC_BASE_URL || '';
              resolvedEnv.ANTHROPIC_BASE_URL = typeof baseUrl === 'string' ? baseUrl : '';
              
              const haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
              resolvedEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = typeof haiku === 'string' ? haiku : '';
              
              const sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
              resolvedEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = typeof sonnet === 'string' ? sonnet : '';
              
              const opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
              resolvedEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = typeof opus === 'string' ? opus : '';
              
              const fable = env.ANTHROPIC_DEFAULT_FABLE_MODEL || '';
              resolvedEnv.ANTHROPIC_DEFAULT_FABLE_MODEL = typeof fable === 'string' ? fable : '';
              
              const fallback = env.ANTHROPIC_MODEL || settings.model || '';
              resolvedEnv.ANTHROPIC_MODEL = typeof fallback === 'string' ? fallback : '';
              
              // Any other env vars go to extraSettings.env
              for (const [k, v] of Object.entries(env)) {
                if (!standardKeys.includes(k) && k !== 'ANTHROPIC_API_KEY' && !k.endsWith('_NAME')) {
                  extraEnv[k] = String(v);
                }
              }
              
              // Other settings at top-level go to extraSettings
              const extraSettings: Record<string, any> = {};
              for (const [k, v] of Object.entries(settings)) {
                if (k !== 'env' && k !== 'model' && k !== 'apiKey') {
                  extraSettings[k] = v;
                }
              }
              if (Object.keys(extraEnv).length > 0) {
                extraSettings.env = extraEnv;
              }

              const name = resolvedEnv.ANTHROPIC_MODEL || resolvedEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || (source === 'global' ? 'Global settings' : 'Project settings');

              await this.panel.webview.postMessage({
                type: 'configLoaded',
                source,
                config: {
                  name,
                  env: resolvedEnv,
                  extraSettings,
                },
              });
            } catch (e: any) {
              await this.panel.webview.postMessage({
                type: 'configLoadFailed',
                source,
                error: `${source === 'global' ? l10n('webviewImportGlobalFailed') : l10n('webviewImportProjectFailed')}: ${e.message}`,
              });
            }
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
        retainContextWhenHidden: true,
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

  private getExtraEnvVars(profile: Profile | undefined): Array<{ key: string; value: string }> {
    if (!profile?.env) return [];
    const knownKeys = new Set([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
      'ANTHROPIC_MODEL',
    ]);
    return Object.entries(profile.env)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, value]) => ({ key, value: value ?? '' }));
  }

  private getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const profile = this.options.profile;
    const isEdit = this.options.mode === 'edit';
    const sonnetModel = parseOneMillionContextModel(profile?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '');
    const opusModel = parseOneMillionContextModel(profile?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '');
    const fableModel = parseOneMillionContextModel(profile?.env?.ANTHROPIC_DEFAULT_FABLE_MODEL ?? '');
    const fallbackModel = parseOneMillionContextModel(profile?.env?.ANTHROPIC_MODEL ?? '');

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
    html = html.replace(/{{cardConnection}}/g, l10n('cardConnection'));
    html = html.replace(/{{cardModels}}/g, l10n('cardModels'));
    html = html.replace('{{profileName}}', l10n('webviewProfileName'));
    html = html.replace('{{nameHint}}', escapeAttr(l10n('webviewNameHint')));
    html = html.replace('{{save}}', l10n('webviewSave'));
    html = html.replace('{{cancel}}', l10n('webviewCancel'));
    html = html.replace('{{showHide}}', l10n('webviewShowHide'));
    html = html.replace('{{authToken}}', l10n('webviewAuthToken'));
    html = html.replace('{{baseUrl}}', l10n('webviewBaseUrl'));
    html = html.replace('{{fetchModels}}', l10n('webviewFetchModels'));
    html = html.replace(/\{\{modelSpeedTest\}\}/g, l10n('webviewModelSpeedTest'));
    html = html.replace('{{fetchModelsLoading}}', escapeAttr(l10n('webviewFetchModelsLoading')));
    html = html.replace('{{fetchModelsSuccess}}', escapeAttr(l10n('webviewFetchModelsSuccess', '{0}')));
    html = html.replace('{{fetchModelsFailed}}', escapeAttr(l10n('webviewFetchModelsFailed', '{0}')));
    html = html.replace('{{baseUrlRequired}}', escapeAttr(l10n('webviewBaseUrlRequired')));
    html = html.replace(/\{\{selectModelPlaceholder\}\}/g, escapeAttr(l10n('webviewSelectModelPlaceholder')));
    html = html.replace('{{defaultHaikuModel}}', l10n('webviewDefaultHaikuModel'));
    html = html.replace('{{defaultSonnetModel}}', l10n('webviewDefaultSonnetModel'));
    html = html.replace('{{defaultOpusModel}}', l10n('webviewDefaultOpusModel'));
    html = html.replace('{{defaultFableModel}}', l10n('webviewDefaultFableModel'));
    html = html.replace('{{fallbackModel}}', l10n('webviewFallbackModel'));
    html = html.replace(/\{\{oneMillionContext\}\}/g, l10n('webviewOneMillionContext'));
    html = html.replace('{{unnamed}}', escapeAttr(l10n('webviewUnnamed')));
    html = html.replace('{{name}}', escapeAttr(profile?.name ?? ''));
    html = html.replace('{{ANTHROPIC_AUTH_TOKEN}}', escapeAttr(profile?.env?.ANTHROPIC_AUTH_TOKEN ?? ''));
    html = html.replace('{{ANTHROPIC_BASE_URL}}', escapeAttr(profile?.env?.ANTHROPIC_BASE_URL ?? ''));
    html = html.replace('{{ANTHROPIC_DEFAULT_HAIKU_MODEL}}', escapeAttr(profile?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? ''));
    html = html.replace('{{ANTHROPIC_DEFAULT_OPUS_MODEL}}', escapeAttr(opusModel.model));
    html = html.replace('{{ANTHROPIC_DEFAULT_OPUS_MODEL_ONE_MILLION_CONTEXT_CHECKED}}', opusModel.supportsOneMillionContext ? 'checked' : '');
    html = html.replace('{{ANTHROPIC_DEFAULT_FABLE_MODEL}}', escapeAttr(fableModel.model));
    html = html.replace('{{ANTHROPIC_DEFAULT_FABLE_MODEL_ONE_MILLION_CONTEXT_CHECKED}}', fableModel.supportsOneMillionContext ? 'checked' : '');
    html = html.replace('{{ANTHROPIC_DEFAULT_SONNET_MODEL}}', escapeAttr(sonnetModel.model));
    html = html.replace('{{ANTHROPIC_DEFAULT_SONNET_MODEL_ONE_MILLION_CONTEXT_CHECKED}}', sonnetModel.supportsOneMillionContext ? 'checked' : '');
    html = html.replace('{{ANTHROPIC_MODEL}}', escapeAttr(fallbackModel.model));
    html = html.replace('{{ANTHROPIC_MODEL_ONE_MILLION_CONTEXT_CHECKED}}', fallbackModel.supportsOneMillionContext ? 'checked' : '');

    // Effort dropdown
    html = html.replace('{{effortLabel}}', l10n('webviewEffort'));
    const currentEffort = profile?.effort || 'high';
    html = html.replace('{{EFFORT_LOW_SELECTED}}', currentEffort === 'low' ? 'selected' : '');
    html = html.replace('{{EFFORT_MEDIUM_SELECTED}}', currentEffort === 'medium' ? 'selected' : '');
    html = html.replace('{{EFFORT_HIGH_SELECTED}}', currentEffort === 'high' ? 'selected' : '');
    html = html.replace('{{EFFORT_XHIGH_SELECTED}}', currentEffort === 'xhigh' ? 'selected' : '');
    html = html.replace('{{EFFORT_MAX_SELECTED}}', currentEffort === 'max' ? 'selected' : '');

    // Extra env vars
    const extraEnv = this.getExtraEnvVars(profile);
    html = html.replace('{{extraEnvVars}}', l10n('webviewExtraEnvVars'));
    html = html.replace('{{envKey}}', l10n('webviewEnvKey'));
    html = html.replace('{{envValue}}', l10n('webviewEnvValue'));
    html = html.replace('{{addEnvVar}}', l10n('webviewAddEnvVar'));
    html = html.replace('{{removeEnvVar}}', l10n('webviewRemoveEnvVar'));
    html = html.replace('{{extraEnvData}}', escapeAttr(JSON.stringify(extraEnv)));


    // Extra settings (tree, sibling of env)
    const extraSettings = profile?.extraSettings && typeof profile.extraSettings === 'object'
      ? profile.extraSettings
      : {};
    html = html.replace('{{extraSettings}}', l10n('webviewExtraSettings'));
    html = html.replace('{{treeView}}', l10n('webviewTreeView'));
    html = html.replace('{{importFromProject}}', l10n('webviewImportFromProject'));
    html = html.replace('{{importFromGlobal}}', l10n('webviewImportFromGlobal'));
    html = html.replace('{{importSuccess}}', escapeAttr(l10n('webviewImportSuccess')));
    html = html.replace('{{globalSource}}', escapeAttr(l10n('webviewGlobalSource')));
    html = html.replace('{{projectSource}}', escapeAttr(l10n('webviewProjectSource')));
    html = html.replace('{{extraSettingsHint}}', escapeAttr(l10n('webviewExtraSettingsHint')));
    html = html.replace('{{addSetting}}', l10n('webviewAddSetting'));
    html = html.replace('{{esAddChild}}', escapeAttr(l10n('webviewAddChild')));
    html = html.replace('{{esAddItem}}', escapeAttr(l10n('webviewAddItem')));
    html = html.replace('{{esRemove}}', escapeAttr(l10n('webviewRemoveEnvVar')));
    html = html.replace('{{esKeyPlaceholder}}', escapeAttr(l10n('esKeyPlaceholder')));
    html = html.replace('{{esTypeString}}', escapeAttr(l10n('esTypeString')));
    html = html.replace('{{esTypeNumber}}', escapeAttr(l10n('esTypeNumber')));
    html = html.replace('{{esTypeBoolean}}', escapeAttr(l10n('esTypeBoolean')));
    html = html.replace('{{esTypeNull}}', escapeAttr(l10n('esTypeNull')));
    html = html.replace('{{esTypeObject}}', escapeAttr(l10n('esTypeObject')));
    html = html.replace('{{esTypeArray}}', escapeAttr(l10n('esTypeArray')));
    html = html.replace('{{esJsonLabel}}', l10n('esJsonLabel'));
    html = html.replace('{{esApplyJson}}', l10n('esApplyJson'));
    html = html.replace('{{esJsonInvalid}}', escapeAttr(l10n('esJsonInvalid')));
    html = html.replace('{{esJsonValid}}', escapeAttr(l10n('esJsonValid')));
    html = html.replace('{{esJsonApplied}}', escapeAttr(l10n('esJsonApplied')));
    html = html.replace('{{esJsonSynced}}', escapeAttr(l10n('esJsonSynced')));
    html = html.replace('{{esJsonNotObject}}', escapeAttr(l10n('esJsonNotObject')));
    html = html.replace('{{extraSettingsData}}', escapeAttr(JSON.stringify(extraSettings)));
    html = html.replace(/\{\{searchModels\}\}/g, escapeAttr(l10n('webviewSearchModels')));
    html = html.replace(/\{\{noModelsFound\}\}/g, escapeAttr(l10n('webviewNoModelsFound')));
    html = html.replace('{{pleaseFetchModels}}', escapeAttr(l10n('webviewPleaseFetchModels')));

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

function parseOneMillionContextModel(value: string): { model: string; supportsOneMillionContext: boolean } {
  const trimmed = value.trim();
  if (!trimmed.endsWith('[1m]')) {
    return { model: trimmed, supportsOneMillionContext: false };
  }
  return {
    model: trimmed.slice(0, -4).trim(),
    supportsOneMillionContext: true,
  };
}