import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'easyLangSettings',
      'Easy Lang 设置',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
  }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === 'save') {
          await this._saveConfig(msg.data);
        }
      },
      undefined,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private async _saveConfig(data: any) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('未检测到工作区，无法保存配置');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const configPath = path.join(workspaceRoot, '.vscode', 'easy-lang.json');
    const configData = {
      translationPath: data.translationPath,
      translateMode: data.translateMode,
      targetLangs: (data.targetLangs as string)
        .split(',')
        .map((v: string) => v.trim())
        .filter(Boolean),
      model: {
        endpoint: data.modelEndpoint,
        model: data.modelName,
        apiKey: data.modelApiKey,
      },
    };
    // 确保 .vscode 目录存在
    const vscodeDir = path.join(workspaceRoot, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir);
    }
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
    vscode.window.showInformationMessage('Easy Lang 配置已保存到 .vscode/easy-lang.json');
  }

  public dispose() {
    SettingsPanel.currentPanel = undefined;

    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }

  private _getHtml() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let configData: any = {};
    if (workspaceFolders) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const configPath = path.join(workspaceRoot, '.vscode', 'easy-lang.json');
      if (fs.existsSync(configPath)) {
        try {
          configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {
          configData = {};
        }
      }
    }
    const translationPath = configData.translationPath || 'locales/translation.json';
    const translateMode = configData.translateMode || 'google';
    const targetLangs = (configData.targetLangs || ['en', 'zh_CN', 'zh_HK']).join(',');
    const modelEndpoint = (configData.model && configData.model.endpoint) || '';
    const modelName = (configData.model && configData.model.model) || '';
    const modelApiKey = (configData.model && configData.model.apiKey) || '';

    return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Easy Lang 设置</title>
  <style>
    body { font-family: sans-serif; padding: 16px; }
    label { display: block; margin-bottom: 8px; }
    input[type="text"], select { width: 100%; box-sizing: border-box; }
    button { margin-top: 16px; }
  </style>
</head>
<body>
  <h2>基础设置</h2>
  <label>
    translation.json 路径：
    <input id="translationPath" type="text" value="${translationPath}" />
  </label>

  <label>
    翻译模式：
    <select id="translateMode">
      <option value="google" ${translateMode === 'google' ? 'selected' : ''}>Google</option>
      <option value="model" ${translateMode === 'model' ? 'selected' : ''}>模型</option>
    </select>
  </label>

  <label>
    目标语言（逗号分隔）：
    <input id="targetLangs" type="text" value="${targetLangs}" />
  </label>

  <div id="modelSettings" style="display:${translateMode === 'model' ? 'block' : 'none'}">
    <h3>模型设置</h3>
    <label>模型地址：<input id="modelEndpoint" type="text" value="${modelEndpoint}" /></label>
    <label>模型名称：<input id="modelName" type="text" value="${modelName}" /></label>
    <label>模型 API Key：<input id="modelApiKey" type="text" value="${modelApiKey}" /></label>
  </div>

  <button id="saveBtn">保存</button>

  <script>
    const vscode = acquireVsCodeApi();

    const translateModeEl = document.getElementById('translateMode');
    translateModeEl.addEventListener('change', () => {
      document.getElementById('modelSettings').style.display = translateModeEl.value === 'model' ? 'block' : 'none';
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        data: {
          translationPath: document.getElementById('translationPath').value,
          translateMode: document.getElementById('translateMode').value,
          targetLangs: document.getElementById('targetLangs').value,
          modelEndpoint: document.getElementById('modelEndpoint').value,
          modelName: document.getElementById('modelName').value,
          modelApiKey: document.getElementById('modelApiKey').value,
        },
      });
    });
  </script>
</body>
</html>`;
  }
}
