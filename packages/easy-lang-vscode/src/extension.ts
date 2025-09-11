import * as vscode from "vscode";
import { I18nSidebarProvider } from "./sidebarProvider";
import * as path from "path";
import * as fs from "fs";
import { TranslateOptions } from "./translator";
import { KeyLocation } from "./scanner";
import { SettingsPanel } from "./settingsView";

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage("Easy Lang 插件已激活！");

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

    context.subscriptions.push(treeView);

    // 注册刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand("easy-lang.refresh", async () => {
            await sidebarProvider.refresh();
            vscode.window.showInformationMessage("已刷新国际化数据");
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
            if (editor) {
                sidebarProvider.refreshCurrentFileData(
                    editor.document.uri.fsPath
                );
            } else {
                sidebarProvider.refreshCurrentFileData();
            }
        })
    );

    // 设置文件内容变化监听器
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && event.document === activeEditor.document) {
                // 使用防抖避免频繁更新，延迟500ms
                setTimeout(() => {
                    const currentActiveEditor = vscode.window.activeTextEditor;
                    if (
                        currentActiveEditor &&
                        currentActiveEditor.document === event.document
                    ) {
                        sidebarProvider.refreshCurrentFileData(
                            event.document.uri.fsPath
                        );
                    }
                }, 500);
            }
        })
    );

    // 初始化当前文件数据
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        sidebarProvider.refreshCurrentFileData(
            activeEditor.document.uri.fsPath
        );
    } else {
        sidebarProvider.refreshCurrentFileData();
    }
}

export function deactivate() {}
