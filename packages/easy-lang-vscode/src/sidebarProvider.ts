import * as vscode from "vscode";
import {
  getI18nKeyStatus,
  getI18nKeyStatusWithLocation,
  KeyLocation,
} from "./scanner";
import * as path from "path";
import * as fs from "fs";
import { autoTranslate, TranslateOptions } from "./translator";
import { appendTranslations } from "./scanner";

const DEFAULT_TRANSLATION_PATH = "locales/translation.json";

export class I18nSidebarProvider
  implements vscode.TreeDataProvider<I18nTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    I18nTreeItem | undefined | void
  > = new vscode.EventEmitter<I18nTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<I18nTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private workspaceRoot: string;
  private translationPath: string;
  private untranslatedLocations: KeyLocation[] = [];
  private translatedLocations: KeyLocation[] = [];

  constructor(workspaceRoot: string, translationPath?: string) {
    this.workspaceRoot = workspaceRoot;
    this.translationPath =
      translationPath || path.join(workspaceRoot, DEFAULT_TRANSLATION_PATH);
    this.refreshData();
  }

  async refreshData() {
    // 动态读取 .vscode/easy-lang.json 配置
    let translationPath = "";
    const configPath = path.join(
      this.workspaceRoot,
      ".vscode",
      "easy-lang.json"
    );
    if (fs.existsSync(configPath)) {
      try {
        const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
        translationPath = configData.translationPath || "";
      } catch (e) {
        translationPath = "";
      }
    }
    this.translationPath = translationPath
      ? path.isAbsolute(translationPath)
        ? translationPath
        : path.join(this.workspaceRoot, translationPath)
      : path.join(this.workspaceRoot, DEFAULT_TRANSLATION_PATH);

    const { untranslated, translated } = await getI18nKeyStatusWithLocation(
      this.workspaceRoot,
      this.translationPath
    );
    this.untranslatedLocations = untranslated;
    this.translatedLocations = translated;
    this._onDidChangeTreeData.fire();
  }

  async refresh() {
    await this.refreshData();
  }

  getTreeItem(element: I18nTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: I18nTreeItem): Thenable<I18nTreeItem[]> {
    if (!element) {
      // 根节点，返回两个分组
      return Promise.resolve([
        new I18nTreeItem("未翻译", "untranslatedRoot"),
        new I18nTreeItem("已翻译", "translatedRoot"),
      ]);
    }
    if (element.type === "untranslatedRoot") {
      // 未翻译分组，返回未翻译 key 子项，带位置信息
      const keyItems = this.untranslatedLocations.map((location) => {
        const item = new I18nTreeItem(
          location.key,
          "untranslated",
          location.key
        );
        item.keyLocation = location;
        item.command = {
          command: "easy-lang.gotoLocation",
          title: "跳转到位置",
          arguments: [location],
        };
        return item;
      });
      return Promise.resolve(keyItems);
    }
    if (element.type === "translatedRoot") {
      // 已翻译分组，返回已翻译 key 子项，带位置信息
      const keyItems = this.translatedLocations.map((location) => {
        const item = new I18nTreeItem(location.key, "translated", location.key);
        item.keyLocation = location;
        item.command = {
          command: "easy-lang.gotoLocation",
          title: "跳转到位置",
          arguments: [location],
        };
        return item;
      });
      return Promise.resolve(keyItems);
    }
    return Promise.resolve([]);
  }

  public async translateAll(options: TranslateOptions, targetLangs: string[]) {
    const untranslatedKeys = this.untranslatedLocations.map((loc) => loc.key);
    const uniqueKeys = Array.from(new Set(untranslatedKeys)); // 去重

    if (uniqueKeys.length === 0) {
      vscode.window.showInformationMessage("没有未翻译的 key");
      return;
    }
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在自动翻译全部未翻译 key...",
      },
      async (progress) => {
        const newEntries: Record<string, any> = {};
        let count = 0;
        for (const key of uniqueKeys) {
          newEntries[key] = {};
          for (const lang of targetLangs) {
            try {
              const translated = await autoTranslate(key, {
                ...options,
                to: lang,
              });
              newEntries[key][lang] = translated;
            } catch (e) {
              newEntries[key][lang] = "";
            }
          }
          count++;
          progress.report({ message: `${count}/${uniqueKeys.length}` });
        }
        appendTranslations(this.translationPath, newEntries);
        vscode.window.showInformationMessage(
          "全部未翻译 key 已自动翻译并写入 translation.json"
        );
        await this.refreshData();
      }
    );
  }
}

export type I18nTreeItemType =
  | "untranslatedRoot"
  | "translatedRoot"
  | "untranslated"
  | "translated";

export class I18nTreeItem extends vscode.TreeItem {
  type: I18nTreeItemType;
  key?: string;
  keyLocation?: KeyLocation;

  constructor(
    label: string,
    type: I18nTreeItemType,
    key?: string,
    commandId?: string
  ) {
    super(
      label,
      type.endsWith("Root")
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    this.type = type;
    this.key = key;
  }
}
