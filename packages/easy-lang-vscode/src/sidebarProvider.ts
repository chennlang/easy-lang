import * as vscode from "vscode";
import {
    getI18nKeyStatus,
    getI18nKeyStatusWithLocation,
    getSingleFileI18nKeyStatus,
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
    readonly onDidChangeTreeData: vscode.Event<
        I18nTreeItem | undefined | void
    > = this._onDidChangeTreeData.event;

    private workspaceRoot: string;
    private translationPath: string;
    private untranslatedLocations: KeyLocation[] = [];
    private translatedLocations: KeyLocation[] = [];
    private currentFileUntranslatedLocations: KeyLocation[] = [];
    private currentFileTranslatedLocations: KeyLocation[] = [];
    private currentFilePath: string = "";

    constructor(workspaceRoot: string, translationPath?: string) {
        this.workspaceRoot = workspaceRoot;
        this.translationPath =
            translationPath ||
            path.join(workspaceRoot, DEFAULT_TRANSLATION_PATH);
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
                const configData = JSON.parse(
                    fs.readFileSync(configPath, "utf8")
                );
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

    refreshCurrentFileData(filePath?: string) {
        // 如果没有提供文件路径，使用当前活动编辑器的文件
        if (!filePath) {
            const activeEditor = vscode.window.activeTextEditor;
            filePath = activeEditor?.document.uri.fsPath || "";
        }

        this.currentFilePath = filePath;

        if (!filePath) {
            // 没有活动文件，清空当前文件数据
            this.currentFileUntranslatedLocations = [];
            this.currentFileTranslatedLocations = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        // 获取当前文件的翻译状态
        const { untranslated, translated } = getSingleFileI18nKeyStatus(
            filePath,
            this.translationPath
        );

        this.currentFileUntranslatedLocations = untranslated;
        this.currentFileTranslatedLocations = translated;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: I18nTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: I18nTreeItem): Thenable<I18nTreeItem[]> {
        if (!element) {
            // 根节点，返回四个分组
            const currentFileName = this.currentFilePath
                ? path.basename(this.currentFilePath)
                : "无文件";

            return Promise.resolve([
                new I18nTreeItem(
                    `未翻译（${currentFileName}）`,
                    "currentFileUntranslatedRoot"
                ),
                new I18nTreeItem(
                    `已翻译（${currentFileName}）`,
                    "currentFileTranslatedRoot"
                ),
                new I18nTreeItem("未翻译（全局）", "untranslatedRoot"),
                new I18nTreeItem("已翻译（全局）", "translatedRoot"),
            ]);
        }

        if (element.type === "currentFileUntranslatedRoot") {
            // 当前文件未翻译分组
            const keyItems = this.currentFileUntranslatedLocations.map(
                (location) => {
                    const item = new I18nTreeItem(
                        location.key,
                        "currentFileUntranslated",
                        location.key
                    );
                    item.keyLocation = location;
                    item.command = {
                        command: "easy-lang.gotoLocation",
                        title: "跳转到位置",
                        arguments: [location],
                    };
                    return item;
                }
            );
            return Promise.resolve(keyItems);
        }

        if (element.type === "currentFileTranslatedRoot") {
            // 当前文件已翻译分组
            const keyItems = this.currentFileTranslatedLocations.map(
                (location) => {
                    const item = new I18nTreeItem(
                        location.key,
                        "currentFileTranslated",
                        location.key
                    );
                    item.keyLocation = location;
                    item.command = {
                        command: "easy-lang.gotoLocation",
                        title: "跳转到位置",
                        arguments: [location],
                    };
                    return item;
                }
            );
            return Promise.resolve(keyItems);
        }

        if (element.type === "untranslatedRoot") {
            // 全局未翻译分组，返回未翻译 key 子项，带位置信息
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
            // 全局已翻译分组，返回已翻译 key 子项，带位置信息
            const keyItems = this.translatedLocations.map((location) => {
                const item = new I18nTreeItem(
                    location.key,
                    "translated",
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
        return Promise.resolve([]);
    }

    public async translateAll(
        options: TranslateOptions,
        targetLangs: string[]
    ) {
        // 合并全局未翻译和当前文件未翻译的 key
        const globalUntranslatedKeys = this.untranslatedLocations.map(
            (loc) => loc.key
        );
        const currentFileUntranslatedKeys =
            this.currentFileUntranslatedLocations.map((loc) => loc.key);

        // 合并并去重
        const allUntranslatedKeys = [
            ...globalUntranslatedKeys,
            ...currentFileUntranslatedKeys,
        ];
        const uniqueKeys = Array.from(new Set(allUntranslatedKeys));

        if (uniqueKeys.length === 0) {
            vscode.window.showInformationMessage("没有未翻译的 key");
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "正在自动翻译全部未翻译 key...",
                cancellable: true,
            },
            async (progress, token) => {
                try {
                    const newEntries: Record<string, any> = {};
                    let count = 0;
                    for (const key of uniqueKeys) {
                        if (token.isCancellationRequested) {
                            break;
                        }

                        newEntries[key] = {};
                        for (const lang of targetLangs) {
                            try {
                                const translated = await autoTranslate(key, {
                                    ...options,
                                    to: lang,
                                });
                                newEntries[key][lang] = translated;
                            } catch (e) {
                                console.error(`翻译失败 ${key} -> ${lang}:`, e);
                                newEntries[key][lang] = "";
                            }
                        }
                        count++;
                        progress.report({
                            increment: 100 / uniqueKeys.length,
                            message: `${count}/${uniqueKeys.length}`,
                        });
                    }

                    if (!token.isCancellationRequested) {
                        console.log(
                            `准备写入翻译文件: ${this.translationPath}`
                        );
                        appendTranslations(this.translationPath, newEntries);
                        vscode.window.showInformationMessage(
                            "全部未翻译 key 已自动翻译并写入 translation.json"
                        );
                        // 刷新全局数据和当前文件数据
                        await this.refreshData();
                        this.refreshCurrentFileData();
                    }
                } catch (error) {
                    console.error("翻译过程中发生错误:", error);
                    vscode.window.showErrorMessage(
                        `翻译失败: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`
                    );
                }
            }
        );
    }
}

export type I18nTreeItemType =
    | "currentFileUntranslatedRoot"
    | "currentFileTranslatedRoot"
    | "untranslatedRoot"
    | "translatedRoot"
    | "currentFileUntranslated"
    | "currentFileTranslated"
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
