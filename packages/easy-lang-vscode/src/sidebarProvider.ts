import * as vscode from "vscode";
import {
    classifyKeyLocations,
    KeyLocation,
    scanTextI18nKeys,
    appendTranslations,
} from "./scanner";
import * as path from "path";
import * as fs from "fs";
import { TranslationStore } from "./translationStore";
import { IndexService } from "./indexService";
import { autoTranslate, TranslateOptions } from "./translator";

const DEFAULT_TRANSLATION_PATH = "locales/translation.json";
const TREE_PAGE_SIZE = 100;

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
) {
    const workerCount = Math.min(limit, items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export type RefreshResult = "completed" | "cancelled" | "stale";

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
    private currentFileRefreshVersion = 0;
    private translationStore: TranslationStore;
    private indexService: IndexService;
    private globalIndexStatus = "未加载";
    private globalRefreshGeneration = 0;
    private globalClassificationTimer: NodeJS.Timeout | undefined;
    private pendingGlobalClassification: Promise<void> | undefined;
    private resolvePendingGlobalClassification: (() => void) | undefined;
    private rejectPendingGlobalClassification: ((error: unknown) => void) | undefined;
    private disposed = false;

    constructor(workspaceRoot: string, translationPath?: string) {
        this.workspaceRoot = workspaceRoot;
        this.translationPath =
            translationPath ||
            path.join(workspaceRoot, DEFAULT_TRANSLATION_PATH);
        this.translationStore = new TranslationStore(this.translationPath);
        this.indexService = new IndexService({ workspaceRoot: this.workspaceRoot });
    }

    private async resolveTranslationPath() {
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
        this.translationStore.updatePath(this.translationPath);
    }

    public async isTranslationFile(uri: vscode.Uri) {
        await this.resolveTranslationPath();
        return path.resolve(uri.fsPath) === path.resolve(this.translationPath);
    }

    async refreshData(): Promise<RefreshResult> {
        const refreshGeneration = ++this.globalRefreshGeneration;
        const isCurrentRefresh = () => refreshGeneration === this.globalRefreshGeneration;

        await this.resolveTranslationPath();
        if (!isCurrentRefresh()) return "stale";

        this.globalIndexStatus = "索引中";
        this._onDidChangeTreeData.fire();

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Easy Lang 正在扫描项目 i18n key",
                cancellable: true,
            },
            async (progress, token): Promise<RefreshResult> => {
                const cancellationSubscription = token.onCancellationRequested(() => {
                    if (isCurrentRefresh()) {
                        this.indexService.cancel();
                    }
                });

                try {
                    if (token.isCancellationRequested) {
                        if (isCurrentRefresh()) {
                            this.indexService.cancel();
                            this.globalIndexStatus = "已取消";
                        }
                        return "cancelled";
                    }

                    await this.indexService.rebuild(progress);
                    if (!isCurrentRefresh()) return "stale";

                    if (
                        token.isCancellationRequested ||
                        this.indexService.getStatus() === "cancelled"
                    ) {
                        this.globalIndexStatus = "已取消";
                        return "cancelled";
                    }

                    await this.translationStore.load();
                    if (!isCurrentRefresh()) return "stale";

                    const { untranslated, translated } = classifyKeyLocations(
                        this.indexService.index.allLocations(),
                        this.translationStore.snapshot()
                    );
                    if (!isCurrentRefresh()) return "stale";

                    this.untranslatedLocations = untranslated;
                    this.translatedLocations = translated;
                    this.globalIndexStatus = "已完成";
                    return "completed";
                } catch (error) {
                    if (isCurrentRefresh()) {
                        this.globalIndexStatus = "失败";
                    }
                    throw error;
                } finally {
                    cancellationSubscription.dispose();
                    if (isCurrentRefresh()) {
                        this._onDidChangeTreeData.fire();
                    }
                }
            }
        );
    }

    async refresh(): Promise<RefreshResult> {
        return this.refreshData();
    }

    public invalidateCurrentFileRefresh() {
        this.currentFileRefreshVersion++;
    }

    async refreshCurrentFileData(document?: vscode.TextDocument) {
        const refreshVersion = ++this.currentFileRefreshVersion;

        if (!document) {
            const activeEditor = vscode.window.activeTextEditor;
            document = activeEditor?.document;
        }

        if (!document || document.uri.scheme !== "file") {
            if (refreshVersion !== this.currentFileRefreshVersion) return;

            this.currentFilePath = document?.uri.fsPath || "";
            this.currentFileUntranslatedLocations = [];
            this.currentFileTranslatedLocations = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        const currentFilePath = document.uri.fsPath;
        const documentText = document.getText();

        await this.resolveTranslationPath();
        await this.translationStore.load();
        const allKeyLocations = scanTextI18nKeys(documentText, currentFilePath);
        const { untranslated, translated } = classifyKeyLocations(
            allKeyLocations,
            this.translationStore.snapshot()
        );

        if (refreshVersion !== this.currentFileRefreshVersion) return;

        this.currentFilePath = currentFilePath;
        this.currentFileUntranslatedLocations = untranslated;
        this.currentFileTranslatedLocations = translated;
        this._onDidChangeTreeData.fire();
    }

    private async refreshGlobalClassification() {
        await this.translationStore.load();
        const { untranslated, translated } = classifyKeyLocations(
            this.indexService.index.allLocations(),
            this.translationStore.snapshot()
        );
        this.untranslatedLocations = untranslated;
        this.translatedLocations = translated;
        this._onDidChangeTreeData.fire();
    }

    private async runGlobalClassification() {
        this.globalClassificationTimer = undefined;
        try {
            await this.refreshGlobalClassification();
            this.resolvePendingGlobalClassification?.();
        } catch (error) {
            this.rejectPendingGlobalClassification?.(error);
        } finally {
            this.resolvePendingGlobalClassification = undefined;
            this.rejectPendingGlobalClassification = undefined;
            this.pendingGlobalClassification = undefined;
        }
    }

    private scheduleGlobalClassification(delayMs = 150): Promise<void> {
        if (this.disposed) {
            return Promise.reject(new Error("Easy Lang provider disposed"));
        }

        if (this.globalClassificationTimer) {
            clearTimeout(this.globalClassificationTimer);
        }

        if (!this.pendingGlobalClassification) {
            this.pendingGlobalClassification = new Promise<void>((resolve, reject) => {
                this.resolvePendingGlobalClassification = resolve;
                this.rejectPendingGlobalClassification = reject;
            });
        }

        this.globalClassificationTimer = setTimeout(() => {
            void this.runGlobalClassification();
        }, delayMs);

        return this.pendingGlobalClassification;
    }

    public disposeGlobalClassificationTimer() {
        if (this.globalClassificationTimer) {
            clearTimeout(this.globalClassificationTimer);
            this.globalClassificationTimer = undefined;
        }

        if (this.pendingGlobalClassification) {
            this.rejectPendingGlobalClassification?.(new Error("Easy Lang provider disposed"));
            this.resolvePendingGlobalClassification = undefined;
            this.rejectPendingGlobalClassification = undefined;
            this.pendingGlobalClassification = undefined;
        }
    }

    public dispose() {
        this.disposed = true;
        this.disposeGlobalClassificationTimer();
    }

    async updateIndexedFile(uri: vscode.Uri) {
        await this.indexService.updateFile(uri);
        await this.scheduleGlobalClassification();
    }

    async removeIndexedFile(uri: vscode.Uri) {
        this.indexService.removeFile(uri);
        await this.scheduleGlobalClassification();
    }

    async refreshTranslationData() {
        await this.resolveTranslationPath();
        await this.translationStore.load();
        await this.refreshGlobalClassification();
        await this.refreshCurrentFileData();
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
                new I18nTreeItem(
                    `未翻译（全局 ${this.untranslatedLocations.length}，${this.globalIndexStatus}）`,
                    "untranslatedRoot"
                ),
                new I18nTreeItem(
                    `已翻译（全局 ${this.translatedLocations.length}，${this.globalIndexStatus}）`,
                    "translatedRoot"
                ),
            ]);
        }

        if (element.type === "currentFileUntranslatedRoot") {
            // 当前文件未翻译分组
            const keyItems = this.currentFileUntranslatedLocations.map(
                (location) => this.createLocationItem(location, "currentFileUntranslated")
            );
            return Promise.resolve(keyItems);
        }

        if (element.type === "currentFileTranslatedRoot") {
            // 当前文件已翻译分组
            const keyItems = this.currentFileTranslatedLocations.map(
                (location) => this.createLocationItem(location, "currentFileTranslated")
            );
            return Promise.resolve(keyItems);
        }

        if (element.type === "untranslatedRoot") {
            return Promise.resolve(
                this.createPageItems("untranslated", this.untranslatedLocations.length)
            );
        }

        if (element.type === "translatedRoot") {
            return Promise.resolve(
                this.createPageItems("translated", this.translatedLocations.length)
            );
        }

        if (element.type === "untranslatedPage") {
            const start = element.pageStart ?? 0;
            return Promise.resolve(
                this.untranslatedLocations
                    .slice(start, start + TREE_PAGE_SIZE)
                    .map((location) => this.createLocationItem(location, "untranslated"))
            );
        }

        if (element.type === "translatedPage") {
            const start = element.pageStart ?? 0;
            return Promise.resolve(
                this.translatedLocations
                    .slice(start, start + TREE_PAGE_SIZE)
                    .map((location) => this.createLocationItem(location, "translated"))
            );
        }
        return Promise.resolve([]);
    }

    private createPageItems(pageType: "untranslated" | "translated", total: number) {
        const type = pageType === "untranslated" ? "untranslatedPage" : "translatedPage";
        const items: I18nTreeItem[] = [];

        for (let start = 0; start < total; start += TREE_PAGE_SIZE) {
            const end = Math.min(start + TREE_PAGE_SIZE, total);
            const item = new I18nTreeItem(`${start + 1}-${end}`, type);
            item.pageStart = start;
            item.pageType = pageType;
            items.push(item);
        }

        return items;
    }

    private createLocationItem(
        location: KeyLocation,
        type: "untranslated" | "translated" | "currentFileUntranslated" | "currentFileTranslated"
    ) {
        const item = new I18nTreeItem(location.key, type, location.key);
        item.keyLocation = location;
        item.command = {
            command: "easy-lang.gotoLocation",
            title: "跳转到位置",
            arguments: [location],
        };
        return item;
    }

    public async translateAll(
        options: TranslateOptions,
        targetLangs: string[]
    ) {
        const uniqueKeys = Array.from(
            new Set([
                ...this.untranslatedLocations.map((loc) => loc.key),
                ...this.currentFileUntranslatedLocations.map((loc) => loc.key),
            ])
        );

        if (uniqueKeys.length === 0) {
            vscode.window.showInformationMessage("没有未翻译的 key");
            return;
        }

        if (targetLangs.length === 0) {
            vscode.window.showWarningMessage("请选择至少一个目标语言");
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
                    const newEntries: Record<string, Record<string, string>> = {};
                    const failures: string[] = [];
                    let count = 0;

                    await runWithConcurrency(uniqueKeys, 3, async (key) => {
                        if (token.isCancellationRequested) {
                            return;
                        }

                        const entry: Record<string, string> = {};
                        for (const lang of targetLangs) {
                            if (token.isCancellationRequested) {
                                return;
                            }

                            try {
                                const translated = await autoTranslate(key, {
                                    ...options,
                                    to: lang,
                                });
                                entry[lang] = translated;
                            } catch (e) {
                                const message = e instanceof Error ? e.message : String(e);
                                failures.push(`${key} -> ${lang}: ${message}`);
                                console.error(`翻译失败 ${key} -> ${lang}:`, e);
                                entry[lang] = "";
                            }
                        }

                        if (token.isCancellationRequested) {
                            return;
                        }

                        newEntries[key] = entry;
                        count++;
                        progress.report({
                            increment: 100 / uniqueKeys.length,
                            message: `${count}/${uniqueKeys.length}`,
                        });
                    });

                    if (!token.isCancellationRequested) {
                        console.log(
                            `准备写入翻译文件: ${this.translationPath}`
                        );
                        appendTranslations(this.translationPath, newEntries);
                        try {
                            await this.refreshData();
                            await this.refreshCurrentFileData();
                        } catch (refreshError) {
                            console.error("翻译写入后刷新数据失败:", refreshError);
                            vscode.window.showWarningMessage(
                                `翻译已写入，但刷新数据失败: ${
                                    refreshError instanceof Error
                                        ? refreshError.message
                                        : String(refreshError)
                                }`
                            );
                            return;
                        }
                        if (failures.length > 0) {
                            vscode.window.showWarningMessage(
                                `部分翻译失败（${failures.length} 项），已写入空字符串`
                            );
                            console.warn("自动翻译部分失败:", failures);
                        }
                        vscode.window.showInformationMessage(
                            "全部未翻译 key 已自动翻译并写入 translation.json"
                        );
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
    | "translated"
    | "untranslatedPage"
    | "translatedPage";

export class I18nTreeItem extends vscode.TreeItem {
    type: I18nTreeItemType;
    key?: string;
    keyLocation?: KeyLocation;
    pageStart?: number;
    pageType?: "untranslated" | "translated";

    constructor(
        label: string,
        type: I18nTreeItemType,
        key?: string,
        commandId?: string
    ) {
        const collapsibleState =
            type === "currentFileUntranslatedRoot" ||
            type === "currentFileTranslatedRoot"
                ? vscode.TreeItemCollapsibleState.Expanded
                : type.endsWith("Root") || type.endsWith("Page")
                  ? vscode.TreeItemCollapsibleState.Collapsed
                  : vscode.TreeItemCollapsibleState.None;

        super(label, collapsibleState);
        this.type = type;
        this.key = key;
    }
}
