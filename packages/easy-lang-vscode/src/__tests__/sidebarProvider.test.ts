import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const vscodeMock = vi.hoisted(() => {
    const withProgress = vi.fn();
    const showInformationMessage = vi.fn();
    const showWarningMessage = vi.fn();
    const showErrorMessage = vi.fn();
    const findFiles = vi.fn();
    const tokenListeners: Array<() => void> = [];
    const progressTokens: Array<{ isCancellationRequested: boolean }> = [];
    const onDidChangeTextDocument = vi.fn();
    const createTreeView = vi.fn();
    const createFileSystemWatcher = vi.fn();
    const registerCommand = vi.fn();
    const onDidChangeActiveTextEditor = vi.fn();
    const getConfiguration = vi.fn();
    const treeVisibilityListeners: Array<(event: { visible: boolean }) => void> = [];
    const watcherRecords: Array<{
        pattern: string;
        onCreate?: (uri: unknown) => void;
        onChange?: (uri: unknown) => void;
        onDelete?: (uri: unknown) => void;
    }> = [];

    return {
        withProgress,
        showInformationMessage,
        showWarningMessage,
        showErrorMessage,
        findFiles,
        tokenListeners,
        progressTokens,
        onDidChangeTextDocument,
        createTreeView,
        createFileSystemWatcher,
        registerCommand,
        onDidChangeActiveTextEditor,
        getConfiguration,
        treeVisibilityListeners,
        watcherRecords,
        workspaceFolders: [{ uri: { fsPath: "/project" } }],
    };
});

vi.mock("vscode", () => {
    class EventEmitter<T> {
        event = vi.fn();
        fire = vi.fn<(data?: T) => void>();
    }

    class TreeItem {
        constructor(
            public label: string,
            public collapsibleState?: number
        ) {}
    }

    return {
        EventEmitter,
        TreeItem,
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2,
        },
        window: {
            activeTextEditor: undefined,
            showInformationMessage: vscodeMock.showInformationMessage,
            showWarningMessage: vscodeMock.showWarningMessage,
            showErrorMessage: vscodeMock.showErrorMessage,
            withProgress: vscodeMock.withProgress,
            createTreeView: vscodeMock.createTreeView,
            onDidChangeActiveTextEditor: vscodeMock.onDidChangeActiveTextEditor,
        },
        workspace: {
            workspaceFolders: vscodeMock.workspaceFolders,
            findFiles: vscodeMock.findFiles,
            createFileSystemWatcher: vscodeMock.createFileSystemWatcher,
            onDidChangeTextDocument: vscodeMock.onDidChangeTextDocument,
            getConfiguration: vscodeMock.getConfiguration,
        },
        commands: {
            registerCommand: vscodeMock.registerCommand,
        },
        ViewColumn: {
            One: 1,
        },
        Position: class Position {
            constructor(public line: number, public character: number) {}
        },
        Selection: class Selection {
            constructor(public start: unknown, public end: unknown) {}
        },
        Range: class Range {
            constructor(public start: unknown, public end: unknown) {}
        },
        TextEditorRevealType: {
            InCenter: 1,
        },
        ProgressLocation: {
            Notification: 1,
        },
    };
});

const translatorMock = vi.hoisted(() => ({
    autoTranslate: vi.fn(),
}));

vi.mock("../translator", () => ({
    autoTranslate: translatorMock.autoTranslate,
}));

import { I18nSidebarProvider } from "../sidebarProvider";

let dir = "";

beforeEach(() => {
    vscodeMock.withProgress.mockImplementation(async (_options, task) => {
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: vi.fn((listener: () => void) => {
                vscodeMock.tokenListeners.push(listener);
                return { dispose: vi.fn() };
            }),
        };
        vscodeMock.progressTokens.push(token);

        return task({ report: vi.fn() }, token);
    });
    vscodeMock.showInformationMessage.mockReset();
    vscodeMock.showWarningMessage.mockReset();
    vscodeMock.showErrorMessage.mockReset();
    vscodeMock.createFileSystemWatcher.mockReset();
    vscodeMock.createFileSystemWatcher.mockImplementation((pattern: string) => {
        const watcherRecord: {
            pattern: string;
            onCreate?: (uri: unknown) => void;
            onChange?: (uri: unknown) => void;
            onDelete?: (uri: unknown) => void;
        } = { pattern };
        vscodeMock.watcherRecords.push(watcherRecord);
        return {
            onDidCreate: vi.fn((listener: (uri: unknown) => void) => {
                watcherRecord.onCreate = listener;
                return { dispose: vi.fn() };
            }),
            onDidChange: vi.fn((listener: (uri: unknown) => void) => {
                watcherRecord.onChange = listener;
                return { dispose: vi.fn() };
            }),
            onDidDelete: vi.fn((listener: (uri: unknown) => void) => {
                watcherRecord.onDelete = listener;
                return { dispose: vi.fn() };
            }),
            dispose: vi.fn(),
        };
    });
    vscodeMock.createTreeView.mockReset();
    vscodeMock.createTreeView.mockReturnValue({
        onDidChangeVisibility: vi.fn((listener: (event: { visible: boolean }) => void) => {
            vscodeMock.treeVisibilityListeners.push(listener);
            return { dispose: vi.fn() };
        }),
        dispose: vi.fn(),
    });
    vscodeMock.registerCommand.mockReset();
    vscodeMock.registerCommand.mockReturnValue({ dispose: vi.fn() });
    vscodeMock.onDidChangeActiveTextEditor.mockReset();
    vscodeMock.onDidChangeActiveTextEditor.mockReturnValue({ dispose: vi.fn() });
    vscodeMock.onDidChangeTextDocument.mockReset();
    vscodeMock.onDidChangeTextDocument.mockReturnValue({ dispose: vi.fn() });
    vscodeMock.getConfiguration.mockReset();
    vscodeMock.getConfiguration.mockReturnValue({ get: vi.fn((_key: string, fallback: unknown) => fallback) });
    translatorMock.autoTranslate.mockReset();
    translatorMock.autoTranslate.mockResolvedValue("translated");
    vscodeMock.watcherRecords.length = 0;
    vscodeMock.treeVisibilityListeners.length = 0;
    vscodeMock.workspaceFolders[0].uri.fsPath = "/project";
    vscodeMock.findFiles.mockReset();
    vscodeMock.tokenListeners.length = 0;
    vscodeMock.progressTokens.length = 0;
});

afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
});

function createDocument(filePath: string, text: string) {
    return {
        uri: {
            scheme: "file",
            fsPath: filePath,
        },
        getText: () => text,
    } as any;
}

function makeLocations(prefix: string, count: number) {
    return Array.from({ length: count }, (_, index) => ({
        key: `${prefix}-${index + 1}`,
        filePath: `/project/${prefix}-${index + 1}.ts`,
        line: index,
        character: 0,
    }));
}

async function getFirstPageChildren(provider: I18nSidebarProvider, root: any) {
    const pages = await provider.getChildren(root);
    return pages[0] ? provider.getChildren(pages[0]) : [];
}

describe("I18nSidebarProvider global tree paging", () => {
    it("renders no page nodes for zero global untranslated locations", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        (provider as any).untranslatedLocations = [];

        const roots = await provider.getChildren();
        const pages = await provider.getChildren(roots[2]);

        expect(pages).toHaveLength(0);
    });

    it("renders fewer than 100 global untranslated locations in one labelled page", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        (provider as any).untranslatedLocations = makeLocations("missing", 3);

        const roots = await provider.getChildren();
        const pages = await provider.getChildren(roots[2]);

        expect(pages).toMatchObject([
            { label: "1-3", type: "untranslatedPage", pageStart: 0, pageType: "untranslated" },
        ]);

        const pageItems = await provider.getChildren(pages[0]);

        expect(pageItems).toHaveLength(3);
        expect(pageItems).toMatchObject([
            { key: "missing-1" },
            { key: "missing-2" },
            { key: "missing-3" },
        ]);
    });

    it("renders exactly 100 global untranslated locations in one labelled page", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        (provider as any).untranslatedLocations = makeLocations("missing", 100);

        const roots = await provider.getChildren();
        const pages = await provider.getChildren(roots[2]);

        expect(pages).toMatchObject([
            { label: "1-100", type: "untranslatedPage", pageStart: 0, pageType: "untranslated" },
        ]);

        const pageItems = await provider.getChildren(pages[0]);

        expect(pageItems).toHaveLength(100);
        expect(pageItems[0]).toMatchObject({ key: "missing-1" });
        expect(pageItems[99]).toMatchObject({ key: "missing-100" });
    });

    it("renders global untranslated locations through page nodes of 100 items", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        (provider as any).untranslatedLocations = makeLocations("missing", 205);

        const roots = await provider.getChildren();
        const pages = await provider.getChildren(roots[2]);

        expect(pages).toMatchObject([
            { label: "1-100", type: "untranslatedPage", pageStart: 0, pageType: "untranslated" },
            { label: "101-200", type: "untranslatedPage", pageStart: 100, pageType: "untranslated" },
            { label: "201-205", type: "untranslatedPage", pageStart: 200, pageType: "untranslated" },
        ]);
        expect(pages[0].collapsibleState).toBe(1);

        const secondPageItems = await provider.getChildren(pages[1]);

        expect(secondPageItems).toHaveLength(100);
        expect(secondPageItems[0]).toMatchObject({
            label: "missing-101",
            type: "untranslated",
            key: "missing-101",
            keyLocation: { key: "missing-101" },
            command: {
                command: "easy-lang.gotoLocation",
                title: "跳转到位置",
                arguments: [{ key: "missing-101", filePath: "/project/missing-101.ts", line: 100, character: 0 }],
            },
        });
        expect(secondPageItems[99]).toMatchObject({ key: "missing-200" });
    });

    it("renders global translated locations through page nodes with final short page", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        (provider as any).translatedLocations = makeLocations("done", 101);

        const roots = await provider.getChildren();
        const pages = await provider.getChildren(roots[3]);

        expect(pages).toMatchObject([
            { label: "1-100", type: "translatedPage", pageStart: 0, pageType: "translated" },
            { label: "101-101", type: "translatedPage", pageStart: 100, pageType: "translated" },
        ]);

        const finalPageItems = await provider.getChildren(pages[1]);

        expect(finalPageItems).toHaveLength(1);
        expect(finalPageItems[0]).toMatchObject({
            label: "done-101",
            type: "translated",
            key: "done-101",
            keyLocation: { key: "done-101" },
        });
    });
});

describe("I18nSidebarProvider global refresh", () => {
    it("prevents an older global refresh from publishing stale results after a newer refresh starts", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        let releaseOlderRebuild: (() => void) | undefined;
        let releaseNewerRebuild: (() => void) | undefined;

        let indexedLocations = [
            { key: "旧", filePath: "/project/old.ts", line: 0, character: 0 },
        ];

        (provider as any).indexService = {
            index: {
                allLocations: vi.fn(() => indexedLocations),
            },
            cancel: vi.fn(),
            getStatus: vi.fn(() => "ready"),
            rebuild: vi.fn()
                .mockImplementationOnce(async () => {
                    await new Promise<void>((resolve) => {
                        releaseOlderRebuild = resolve;
                    });
                })
                .mockImplementationOnce(async () => {
                    await new Promise<void>((resolve) => {
                        releaseNewerRebuild = resolve;
                    });
                    indexedLocations = [
                        { key: "新", filePath: "/project/new.ts", line: 0, character: 0 },
                    ];
                }),
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        const olderRefresh = provider.refreshData();
        await vi.waitFor(() => expect((provider as any).indexService.rebuild).toHaveBeenCalledTimes(1));
        const newerRefresh = provider.refreshData();
        await vi.waitFor(() => expect((provider as any).indexService.rebuild).toHaveBeenCalledTimes(2));

        releaseOlderRebuild?.();
        await olderRefresh;
        releaseNewerRebuild?.();
        await newerRefresh;

        const roots = await provider.getChildren();

        expect(roots[2].label).toBe("未翻译（全局 1，已完成）");
        expect(await getFirstPageChildren(provider, roots[2])).toMatchObject([
            { key: "新" },
        ]);
    });

    it("does not let a stale progress token cancel the current global refresh", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        let releaseOlderRebuild: (() => void) | undefined;
        let releaseNewerRebuild: (() => void) | undefined;
        const cancel = vi.fn();

        (provider as any).indexService = {
            index: {
                allLocations: vi.fn(() => []),
            },
            cancel,
            getStatus: vi.fn(() => "ready"),
            rebuild: vi.fn()
                .mockImplementationOnce(async () => {
                    await new Promise<void>((resolve) => {
                        releaseOlderRebuild = resolve;
                    });
                })
                .mockImplementationOnce(async () => {
                    await new Promise<void>((resolve) => {
                        releaseNewerRebuild = resolve;
                    });
                }),
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        const olderRefresh = provider.refreshData();
        await vi.waitFor(() => expect((provider as any).indexService.rebuild).toHaveBeenCalledTimes(1));
        const newerRefresh = provider.refreshData();
        await vi.waitFor(() => expect((provider as any).indexService.rebuild).toHaveBeenCalledTimes(2));

        vscodeMock.tokenListeners[0]();

        expect(cancel).not.toHaveBeenCalled();

        releaseOlderRebuild?.();
        await olderRefresh;
        releaseNewerRebuild?.();
        await newerRefresh;
    });

    it("keeps previous global results when a refresh is cancelled", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");

        (provider as any).untranslatedLocations = [
            { key: "保留", filePath: "/project/keep.ts", line: 0, character: 0 },
        ];
        (provider as any).translatedLocations = [
            { key: "已翻译", filePath: "/project/done.ts", line: 0, character: 0 },
        ];
        (provider as any).indexService = {
            index: {
                allLocations: vi.fn(() => [
                    { key: "部分", filePath: "/project/partial.ts", line: 0, character: 0 },
                ]),
            },
            cancel: vi.fn(),
            getStatus: vi.fn(() => "cancelled"),
            rebuild: vi.fn(async () => undefined),
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        await provider.refreshData();
        const roots = await provider.getChildren();

        expect(roots[2].label).toBe("未翻译（全局 1，已取消）");
        expect(roots[3].label).toBe("已翻译（全局 1，已取消）");
        expect(await getFirstPageChildren(provider, roots[2])).toMatchObject([
            { key: "保留" },
        ]);
        expect((provider as any).indexService.index.allLocations).not.toHaveBeenCalled();
    });

    it("does not start a rebuild when the progress token is already cancelled", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        const rebuild = vi.fn(async () => undefined);
        const cancel = vi.fn();

        vscodeMock.withProgress.mockImplementationOnce(async (_options, task) => {
            const token = {
                isCancellationRequested: true,
                onCancellationRequested: vi.fn((_listener: () => void) => ({ dispose: vi.fn() })),
            };

            return task({ report: vi.fn() }, token);
        });
        (provider as any).indexService = {
            index: { allLocations: vi.fn() },
            cancel,
            getStatus: vi.fn(() => "idle"),
            rebuild,
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        const result = await provider.refreshData();
        const roots = await provider.getChildren();

        expect(result).toBe("cancelled");
        expect(rebuild).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(roots[2].label).toBe("未翻译（全局 0，已取消）");
    });
});
describe("I18nSidebarProvider watcher refresh", () => {
    it("coalesces burst indexed file updates into one global classification", async () => {
        vi.useFakeTimers();
        try {
            const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
            const updateFile = vi.fn(async () => undefined);
            const load = vi.fn(async () => undefined);
            const allLocations = vi.fn(() => [
                { key: "保存", filePath: "/project/app.ts", line: 0, character: 0 },
            ]);

            (provider as any).indexService = {
                index: { allLocations },
                updateFile,
            };
            (provider as any).translationStore = {
                load,
                snapshot: vi.fn(() => new Set<string>()),
                updatePath: vi.fn(),
            };

            const firstUpdate = provider.updateIndexedFile({ fsPath: "/project/a.ts" } as any);
            const secondUpdate = provider.updateIndexedFile({ fsPath: "/project/b.ts" } as any);
            await Promise.resolve();
            expect(load).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(150);
            await Promise.all([firstUpdate, secondUpdate]);
            const roots = await provider.getChildren();

            expect(updateFile).toHaveBeenCalledTimes(2);
            expect(load).toHaveBeenCalledTimes(1);
            expect(await getFirstPageChildren(provider, roots[2])).toMatchObject([
                { key: "保存" },
            ]);
        } finally {
            vi.useRealTimers();
        }
    });


    it("rejects pending indexed file updates when provider is disposed before classification runs", async () => {
        vi.useFakeTimers();
        try {
            const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
            (provider as any).indexService = {
                index: { allLocations: vi.fn(() => []) },
                updateFile: vi.fn(async () => undefined),
            };
            (provider as any).translationStore = {
                load: vi.fn(async () => undefined),
                snapshot: vi.fn(() => new Set<string>()),
                updatePath: vi.fn(),
            };

            const update = provider.updateIndexedFile({ fsPath: "/project/app.ts" } as any);
            await Promise.resolve();

            provider.dispose();

            await expect(update).rejects.toThrow("Easy Lang provider disposed");
            await vi.advanceTimersByTimeAsync(150);
            expect((provider as any).translationStore.load).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects indexed file updates when global classification fails", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        const classificationError = new Error("load failed");
        (provider as any).indexService = {
            index: { allLocations: vi.fn(() => []) },
            updateFile: vi.fn(async () => undefined),
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => {
                throw classificationError;
            }),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        await expect(provider.updateIndexedFile({ fsPath: "/project/app.ts" } as any)).rejects.toThrow(classificationError);
    });

    it("rejects indexed file removals when global classification fails", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        const classificationError = new Error("load failed");
        (provider as any).indexService = {
            index: { allLocations: vi.fn(() => []) },
            removeFile: vi.fn(),
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => {
                throw classificationError;
            }),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };

        await expect(provider.removeIndexedFile({ fsPath: "/project/app.ts" } as any)).rejects.toThrow(classificationError);
    });

    it("updates one indexed file and reclassifies global locations", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        const fileUri = { fsPath: "/project/app.ts" } as any;
        const updateFile = vi.fn(async () => undefined);
        const allLocations = vi.fn(() => [
            { key: "保存", filePath: "/project/app.ts", line: 0, character: 0 },
            { key: "错误", filePath: "/project/app.ts", line: 1, character: 0 },
        ]);

        (provider as any).indexService = {
            index: { allLocations },
            updateFile,
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set(["保存"])),
            updatePath: vi.fn(),
        };

        await provider.updateIndexedFile(fileUri);
        const roots = await provider.getChildren();

        expect(updateFile).toHaveBeenCalledWith(fileUri);
        expect(await getFirstPageChildren(provider, roots[2])).toMatchObject([
            { key: "错误" },
        ]);
        expect(await getFirstPageChildren(provider, roots[3])).toMatchObject([
            { key: "保存" },
        ]);
    });

    it("removes one indexed file and reclassifies global locations", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        const fileUri = { fsPath: "/project/app.ts" } as any;
        const removeFile = vi.fn();
        const allLocations = vi.fn(() => []);

        (provider as any).indexService = {
            index: { allLocations },
            removeFile,
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set<string>()),
            updatePath: vi.fn(),
        };
        (provider as any).untranslatedLocations = [
            { key: "旧", filePath: "/project/app.ts", line: 0, character: 0 },
        ];

        await provider.removeIndexedFile(fileUri);
        const roots = await provider.getChildren();

        expect(removeFile).toHaveBeenCalledWith(fileUri);
        expect(roots[2].label).toBe("未翻译（全局 0，未加载）");
        expect(await provider.getChildren(roots[2])).toEqual([]);
    });

    it("registers a config watcher for easy-lang config changes", async () => {
        const { activate } = await import("../extension");
        const subscriptions: Array<{ dispose(): void }> = [];

        activate({
            extensionUri: { fsPath: "/extension" },
            subscriptions,
        } as any);

        expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledWith("**/*.json");
        expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledWith("**/.vscode/easy-lang.json");
        expect(vscodeMock.createFileSystemWatcher).toHaveBeenCalledTimes(3);
    });

    it("starts global indexing once when the sidebar first becomes visible", async () => {
        const { activate } = await import("../extension");
        const subscriptions: Array<{ dispose(): void }> = [];

        activate({
            extensionUri: { fsPath: "/extension" },
            subscriptions,
        } as any);

        const provider = vscodeMock.createTreeView.mock.calls[0][1].treeDataProvider as I18nSidebarProvider;
        const refresh = vi.spyOn(provider, "refresh").mockResolvedValue("completed");

        expect(refresh).not.toHaveBeenCalled();

        vscodeMock.treeVisibilityListeners[0]({ visible: false });
        expect(refresh).not.toHaveBeenCalled();

        vscodeMock.treeVisibilityListeners[0]({ visible: true });
        await Promise.resolve();
        vscodeMock.treeVisibilityListeners[0]({ visible: true });
        await Promise.resolve();

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(subscriptions).toContain(vscodeMock.createTreeView.mock.results[0].value);
    });

    it("logs a rejected first visible refresh without surfacing an unhandled rejection", async () => {
        const { activate } = await import("../extension");
        const subscriptions: Array<{ dispose(): void }> = [];
        const refreshError = new Error("visibility refresh failed");
        const unhandledRejections: unknown[] = [];
        const trackUnhandledRejection = (reason: unknown) => {
            unhandledRejections.push(reason);
        };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        process.on("unhandledRejection", trackUnhandledRejection);
        try {
            activate({
                extensionUri: { fsPath: "/extension" },
                subscriptions,
            } as any);

            const provider = vscodeMock.createTreeView.mock.calls[0][1].treeDataProvider as I18nSidebarProvider;
            const refresh = vi.spyOn(provider, "refresh").mockRejectedValue(refreshError);

            vscodeMock.treeVisibilityListeners[0]({ visible: true });

            await vi.waitFor(() => {
                expect(consoleError).toHaveBeenCalledWith(
                    "首次显示侧边栏刷新国际化数据失败: visibility refresh failed",
                    refreshError
                );
            });
            await new Promise((resolve) => setImmediate(resolve));

            expect(refresh).toHaveBeenCalledTimes(1);
            expect(unhandledRejections).toEqual([]);
            expect(vscodeMock.showErrorMessage).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", trackUnhandledRejection);
            consoleError.mockRestore();
        }
    });

    it("lets manual refresh rebuild after the visibility trigger has run", async () => {
        const { activate } = await import("../extension");
        const subscriptions: Array<{ dispose(): void }> = [];

        activate({
            extensionUri: { fsPath: "/extension" },
            subscriptions,
        } as any);

        const provider = vscodeMock.createTreeView.mock.calls[0][1].treeDataProvider as I18nSidebarProvider;
        const refresh = vi.spyOn(provider, "refresh").mockResolvedValue("completed");
        const refreshCommand = vscodeMock.registerCommand.mock.calls.find(
            ([command]) => command === "easy-lang.refresh"
        )?.[1] as () => Promise<void>;

        vscodeMock.treeVisibilityListeners[0]({ visible: true });
        await Promise.resolve();
        await refreshCommand();

        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("refreshes only when a JSON watcher event matches the configured translation path", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, ".vscode"));
        await writeFile(
            join(dir, ".vscode", "easy-lang.json"),
            JSON.stringify({ translationPath: "locales/custom.json" })
        );
        const { activate } = await import("../extension");
        const subscriptions: Array<{ dispose(): void }> = [];
        vscodeMock.workspaceFolders[0].uri.fsPath = dir;

        activate({
            extensionUri: { fsPath: "/extension" },
            subscriptions,
        } as any);

        const translationWatcher = vscodeMock.watcherRecords.find(
            (watcher) => watcher.pattern === "**/*.json"
        );
        const provider = vscodeMock.createTreeView.mock.calls[0][1].treeDataProvider as I18nSidebarProvider;
        const refreshTranslationData = vi.spyOn(provider, "refreshTranslationData").mockResolvedValue(undefined);

        translationWatcher?.onChange?.({ fsPath: join(dir, "locales", "custom.json") });
        await vi.waitFor(() => expect(refreshTranslationData).toHaveBeenCalledTimes(1));

        translationWatcher?.onChange?.({ fsPath: join(dir, "package.json") });
        await Promise.resolve();

        expect(refreshTranslationData).toHaveBeenCalledTimes(1);
    });

    it("refreshes translation data, global classification, and current-file data", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, ".vscode"));
        await writeFile(
            join(dir, ".vscode", "easy-lang.json"),
            JSON.stringify({ translationPath: "locales/custom.json" })
        );
        const provider = new I18nSidebarProvider(dir, join(dir, "locales", "old.json"));
        const refreshCurrentFileData = vi.spyOn(provider, "refreshCurrentFileData").mockResolvedValue(undefined);

        (provider as any).indexService = {
            index: {
                allLocations: vi.fn(() => [
                    { key: "保存", filePath: join(dir, "app.ts"), line: 0, character: 0 },
                ]),
            },
        };
        (provider as any).translationStore = {
            load: vi.fn(async () => undefined),
            snapshot: vi.fn(() => new Set(["保存"])),
            updatePath: vi.fn(),
        };

        await provider.refreshTranslationData();
        const roots = await provider.getChildren();

        expect((provider as any).translationStore.updatePath).toHaveBeenCalledWith(join(dir, "locales", "custom.json"));
        expect((provider as any).translationStore.load).toHaveBeenCalled();
        expect(refreshCurrentFileData).toHaveBeenCalled();
        expect(await getFirstPageChildren(provider, roots[3])).toMatchObject([
            { key: "保存" },
        ]);
    });
});


describe("I18nSidebarProvider translateAll", () => {
    it("auto-translates unique global and current-file keys with at most three concurrent keys", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, "locales"));
        const translationPath = join(dir, "locales", "translation.json");
        await writeFile(translationPath, "{}");
        const provider = new I18nSidebarProvider(dir, translationPath);
        const inFlightKeys = new Set<string>();
        const callsByKey = new Map<string, string[]>();
        let maxConcurrentKeys = 0;

        (provider as any).untranslatedLocations = [
            { key: "a", filePath: join(dir, "a.ts"), line: 0, character: 0 },
            { key: "b", filePath: join(dir, "b.ts"), line: 0, character: 0 },
            { key: "c", filePath: join(dir, "c.ts"), line: 0, character: 0 },
        ];
        (provider as any).currentFileUntranslatedLocations = [
            { key: "c", filePath: join(dir, "current.ts"), line: 0, character: 0 },
            { key: "d", filePath: join(dir, "current.ts"), line: 1, character: 0 },
        ];
        const refreshData = vi.spyOn(provider, "refreshData").mockResolvedValue("completed");
        const refreshCurrentFileData = vi.spyOn(provider, "refreshCurrentFileData").mockResolvedValue(undefined);
        translatorMock.autoTranslate.mockImplementation(async (key: string, options: { to: string }) => {
            inFlightKeys.add(key);
            maxConcurrentKeys = Math.max(maxConcurrentKeys, inFlightKeys.size);
            callsByKey.set(key, [...(callsByKey.get(key) ?? []), options.to]);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlightKeys.delete(key);
            return `${key}-${options.to}`;
        });

        await provider.translateAll({ mode: "google" } as any, ["en", "zh"]);

        expect(maxConcurrentKeys).toBe(3);
        expect(translatorMock.autoTranslate).toHaveBeenCalledTimes(8);
        expect(callsByKey).toEqual(new Map([
            ["a", ["en", "zh"]],
            ["b", ["en", "zh"]],
            ["c", ["en", "zh"]],
            ["d", ["en", "zh"]],
        ]));
        expect(JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(translationPath, "utf8")))).toEqual({
            a: { en: "a-en", zh: "a-zh" },
            b: { en: "b-en", zh: "b-zh" },
            c: { en: "c-en", zh: "c-zh" },
            d: { en: "d-en", zh: "d-zh" },
        });
        expect(refreshData).toHaveBeenCalled();
        expect(refreshCurrentFileData).toHaveBeenCalled();
        expect(vscodeMock.showInformationMessage).toHaveBeenCalledWith(
            "全部未翻译 key 已自动翻译并写入 translation.json"
        );
    });

    it("does not translate or write when target languages are empty", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, "locales"));
        const translationPath = join(dir, "locales", "translation.json");
        await writeFile(translationPath, "{}");
        const provider = new I18nSidebarProvider(dir, translationPath);
        const refreshData = vi.spyOn(provider, "refreshData").mockResolvedValue("completed");
        const refreshCurrentFileData = vi.spyOn(provider, "refreshCurrentFileData").mockResolvedValue(undefined);

        (provider as any).untranslatedLocations = [
            { key: "a", filePath: join(dir, "a.ts"), line: 0, character: 0 },
        ];

        await provider.translateAll({ mode: "google" } as any, []);

        expect(translatorMock.autoTranslate).not.toHaveBeenCalled();
        expect(JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(translationPath, "utf8")))).toEqual({});
        expect(refreshData).not.toHaveBeenCalled();
        expect(refreshCurrentFileData).not.toHaveBeenCalled();
        expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith("请选择至少一个目标语言");
    });

    it("writes empty strings and warns for partial translation failures", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, "locales"));
        const translationPath = join(dir, "locales", "translation.json");
        await writeFile(translationPath, "{}");
        const provider = new I18nSidebarProvider(dir, translationPath);

        (provider as any).untranslatedLocations = [
            { key: "a", filePath: join(dir, "a.ts"), line: 0, character: 0 },
        ];
        vi.spyOn(provider, "refreshData").mockResolvedValue("completed");
        vi.spyOn(provider, "refreshCurrentFileData").mockResolvedValue(undefined);
        translatorMock.autoTranslate.mockImplementation(async (_key: string, options: { to: string }) => {
            if (options.to === "zh") throw new Error("boom");
            return "translated-en";
        });

        await provider.translateAll({ mode: "google" } as any, ["en", "zh"]);

        expect(JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(translationPath, "utf8")))).toEqual({
            a: { en: "translated-en", zh: "" },
        });
        expect(vscodeMock.showWarningMessage).toHaveBeenCalledWith("部分翻译失败（1 项），已写入空字符串");
    });

    it("does not write, refresh, or show success after cancellation", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, "locales"));
        const translationPath = join(dir, "locales", "translation.json");
        await writeFile(translationPath, "{}");
        const provider = new I18nSidebarProvider(dir, translationPath);
        const refreshData = vi.spyOn(provider, "refreshData").mockResolvedValue("completed");
        const refreshCurrentFileData = vi.spyOn(provider, "refreshCurrentFileData").mockResolvedValue(undefined);

        (provider as any).untranslatedLocations = [
            { key: "a", filePath: join(dir, "a.ts"), line: 0, character: 0 },
        ];
        vscodeMock.withProgress.mockImplementationOnce(async (_options, task) => {
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
            };
            translatorMock.autoTranslate.mockImplementationOnce(async () => {
                token.isCancellationRequested = true;
                return "translated";
            });

            return task({ report: vi.fn() }, token);
        });

        await provider.translateAll({ mode: "google" } as any, ["en"]);

        expect(JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(translationPath, "utf8")))).toEqual({});
        expect(refreshData).not.toHaveBeenCalled();
        expect(refreshCurrentFileData).not.toHaveBeenCalled();
        expect(vscodeMock.showInformationMessage).not.toHaveBeenCalledWith(
            "全部未翻译 key 已自动翻译并写入 translation.json"
        );
    });
});

describe("I18nSidebarProvider current-file refresh", () => {

    it("resolves the translation path before loading the current-file store", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-sidebar-"));
        await mkdir(join(dir, ".vscode"));
        await writeFile(
            join(dir, ".vscode", "easy-lang.json"),
            JSON.stringify({ translationPath: "locales/custom.json" })
        );
        await mkdir(join(dir, "locales"));
        await writeFile(join(dir, "locales", "custom.json"), JSON.stringify({ 保存: "Save" }));

        const provider = new I18nSidebarProvider(dir, join(dir, "locales", "old.json"));

        await provider.refreshCurrentFileData(
            createDocument(join(dir, "src", "app.ts"), "const label = $t('保存');")
        );
        const roots = await provider.getChildren();

        expect(await provider.getChildren(roots[0])).toEqual([]);
        expect(await provider.getChildren(roots[1])).toMatchObject([
            { key: "保存" },
        ]);
    });

    it("prevents an in-flight current-file refresh from writing after invalidation", async () => {
        const provider = new I18nSidebarProvider("/project", "/project/locales/translation.json");
        let releaseLoad: (() => void) | undefined;
        const loadCanFinish = new Promise<void>((resolve) => {
            releaseLoad = resolve;
        });

        (provider as any).translationStore = {
            updatePath: vi.fn(),
            load: async () => {
                await loadCanFinish;
            },
            snapshot: () => new Set<string>(),
        };

        const refresh = provider.refreshCurrentFileData(
            createDocument("/project/src/app.ts", "const label = $t('保存');")
        );
        await Promise.resolve();

        provider.invalidateCurrentFileRefresh();
        releaseLoad?.();
        await refresh;

        const roots = await provider.getChildren();

        expect(roots[0].label).toBe("未翻译（无文件）");
        expect(await provider.getChildren(roots[0])).toEqual([]);
    });
});
