import * as vscode from "vscode";
import { I18nSidebarProvider } from "./sidebarProvider";
import * as path from "path";
import * as fs from "fs";
import { TranslateOptions } from "./translator";
import { KeyLocation } from "./scanner";
import { SettingsPanel } from "./settingsView";

function reportWatcherError(action: string, error: unknown) {
    console.error(
        `${action}: ${error instanceof Error ? error.message : String(error)}`,
        error
    );
}

export function activate(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showWarningMessage(
            "未检测到工作区，Easy Lang 插件部分功能不可用"
        );
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    let translationPath = "";
    const configPath = path.join(workspaceRoot, ".vscode", "easy-lang.json");
    if (fs.existsSync(configPath)) {
        try {
            const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
            translationPath = path.join(
                workspaceRoot,
                configData.translationPath || ""
            );
        } catch (e) {
            translationPath = "";
        }
    }
    const sidebarProvider = new I18nSidebarProvider(
        workspaceRoot,
        translationPath
    );
    const treeView = vscode.window.createTreeView("easy-lang-sidebar", {
        treeDataProvider: sidebarProvider,
        showCollapseAll: true,
    });

    let hasStartedGlobalIndex = false;
    const treeViewVisibilitySubscription = treeView.onDidChangeVisibility((event) => {
        if (event.visible && !hasStartedGlobalIndex) {
            hasStartedGlobalIndex = true;
            void sidebarProvider.refresh().catch((error) => {
                reportWatcherError("首次显示侧边栏刷新国际化数据失败", error);
            });
        }
    });

    let currentFileRefreshTimer: NodeJS.Timeout | undefined;

    function scheduleCurrentFileRefresh(document?: vscode.TextDocument) {
        sidebarProvider.invalidateCurrentFileRefresh();

        if (currentFileRefreshTimer) {
            clearTimeout(currentFileRefreshTimer);
        }

        currentFileRefreshTimer = setTimeout(() => {
            currentFileRefreshTimer = undefined;
            void sidebarProvider.refreshCurrentFileData(document).catch((error) => {
                console.error("刷新当前文件国际化数据失败:", error);
            });
        }, 300);
    }

    context.subscriptions.push({
        dispose: () => {
            if (currentFileRefreshTimer) {
                clearTimeout(currentFileRefreshTimer);
                currentFileRefreshTimer = undefined;
            }
        },
    });

    context.subscriptions.push(treeView, treeViewVisibilitySubscription, sidebarProvider);

    const sourceWatcher = vscode.workspace.createFileSystemWatcher(
        "**/*.{js,jsx,ts,tsx,vue}"
    );
    context.subscriptions.push(
        sourceWatcher,
        sourceWatcher.onDidCreate((uri) => {
            void sidebarProvider.updateIndexedFile(uri).catch((error) => {
                reportWatcherError("更新新增源文件索引失败", error);
            });
        }),
        sourceWatcher.onDidChange((uri) => {
            void sidebarProvider.updateIndexedFile(uri).catch((error) => {
                reportWatcherError("更新变更源文件索引失败", error);
            });
        }),
        sourceWatcher.onDidDelete((uri) => {
            void sidebarProvider.removeIndexedFile(uri).catch((error) => {
                reportWatcherError("移除源文件索引失败", error);
            });
        })
    );

    const translationWatcher = vscode.workspace.createFileSystemWatcher(
        "**/*.json"
    );

    function refreshTranslationDataWhenMatched(
        uri: vscode.Uri,
        action: string
    ) {
        void sidebarProvider.isTranslationFile(uri).then((isTranslationFile) => {
            if (!isTranslationFile) return;

            return sidebarProvider.refreshTranslationData().catch((error) => {
                reportWatcherError(action, error);
            });
        }).catch((error) => {
            reportWatcherError(action, error);
        });
    }

    context.subscriptions.push(
        translationWatcher,
        translationWatcher.onDidCreate((uri) => {
            refreshTranslationDataWhenMatched(uri, "刷新新增翻译数据失败");
        }),
        translationWatcher.onDidChange((uri) => {
            refreshTranslationDataWhenMatched(uri, "刷新变更翻译数据失败");
        }),
        translationWatcher.onDidDelete((uri) => {
            refreshTranslationDataWhenMatched(uri, "刷新删除翻译数据失败");
        })
    );

    const configWatcher = vscode.workspace.createFileSystemWatcher(
        "**/.vscode/easy-lang.json"
    );
    context.subscriptions.push(
        configWatcher,
        configWatcher.onDidCreate(() => {
            void sidebarProvider.refreshTranslationData().catch((error) => {
                reportWatcherError("刷新新增 Easy Lang 配置失败", error);
            });
        }),
        configWatcher.onDidChange(() => {
            void sidebarProvider.refreshTranslationData().catch((error) => {
                reportWatcherError("刷新变更 Easy Lang 配置失败", error);
            });
        }),
        configWatcher.onDidDelete(() => {
            void sidebarProvider.refreshTranslationData().catch((error) => {
                reportWatcherError("刷新删除 Easy Lang 配置失败", error);
            });
        })
    );

    // 注册刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand("easy-lang.refresh", async () => {
            try {
                const result = await sidebarProvider.refresh();
                if (result === "completed") {
                    vscode.window.showInformationMessage("已刷新国际化数据");
                } else if (result === "cancelled") {
                    vscode.window.showInformationMessage("刷新国际化数据已取消");
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `刷新国际化数据失败: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        })
    );

    // 注册全部翻译命令
    context.subscriptions.push(
        vscode.commands.registerCommand("easy-lang.translateAll", async () => {
            let targetLangs: string[] = [];
            const config = vscode.workspace.getConfiguration("easyCode");
            const mode = config.get<"google" | "model">(
                "translateMode",
                "google"
            );
            const from = "zh-CN"; // 可扩展为配置项

            // 优先从 easy-lang.json 读取配置
            if (fs.existsSync(configPath)) {
                try {
                    const configData = JSON.parse(
                        fs.readFileSync(configPath, "utf8")
                    );
                    targetLangs = configData.targetLangs || [];
                } catch (e) {
                    // 如果解析失败，使用默认值
                    targetLangs = [];
                }
            }

            // 如果 easy-lang.json 中没有配置，则使用 VSCode 工作区配置
            if (targetLangs.length === 0) {
                targetLangs = config.get<string[]>("targetLangs", [
                    "en",
                    "zh_CN",
                    "zh_HK",
                ]);
            }

            const modelConfig =
                mode === "model"
                    ? {
                          endpoint: config.get<string>("model.endpoint", ""),
                          model: config.get<string>("model.model", ""),
                          apiKey: config.get<string>("model.apiKey", ""),
                      }
                    : undefined;
            const options: TranslateOptions = {
                mode,
                from,
                modelConfig,
                to: targetLangs[0] || "en", // 实际用时会被 translateAll 覆盖
            };
            await sidebarProvider.translateAll(options, targetLangs);
        })
    );

    // 注册跳转到位置命令
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "easy-lang.gotoLocation",
            async (location: KeyLocation) => {
                try {
                    const document = await vscode.workspace.openTextDocument(
                        location.filePath
                    );
                    const editor = await vscode.window.showTextDocument(
                        document
                    );
                    const position = new vscode.Position(
                        location.line,
                        location.character
                    );
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(
                        new vscode.Range(position, position),
                        vscode.TextEditorRevealType.InCenter
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(`无法跳转到位置: ${error}`);
                }
            }
        )
    );

    // 注册打开设置页面命令
    context.subscriptions.push(
        vscode.commands.registerCommand("easy-lang.openSettings", () => {
            SettingsPanel.createOrShow(context.extensionUri);
        })
    );

    // 设置文件监听器
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            scheduleCurrentFileRefresh(editor?.document);
        })
    );

    // 设置文件内容变化监听器
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && event.document === activeEditor.document) {
                scheduleCurrentFileRefresh(event.document);
            }
        })
    );
}

export function deactivate() {}
