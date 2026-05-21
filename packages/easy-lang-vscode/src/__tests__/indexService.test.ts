import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const vscodeMock = vi.hoisted(() => {
    const findFiles = vi.fn();
    const readFile = vi.fn();
    const cancellationSources: CancellationTokenSource[] = [];

    class CancellationTokenSource {
        token = { isCancellationRequested: false };
        cancel = vi.fn(() => {
            this.token.isCancellationRequested = true;
        });
        dispose = vi.fn();

        constructor() {
            cancellationSources.push(this);
        }
    }

    return { CancellationTokenSource, findFiles, readFile, cancellationSources };
});

vi.mock("vscode", () => ({
    CancellationTokenSource: vscodeMock.CancellationTokenSource,
    workspace: {
        findFiles: vscodeMock.findFiles,
        fs: {
            readFile: vscodeMock.readFile,
        },
    },
}));

import { IndexService, SourceIndex } from "../indexService";

let dir = "";

beforeEach(() => {
    vscodeMock.findFiles.mockReset();
    vscodeMock.readFile.mockReset();
    vscodeMock.cancellationSources.length = 0;
});

afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
});

describe("SourceIndex", () => {
    it("updates and removes file indexes", () => {
        const index = new SourceIndex();

        index.updateFile("/a.ts", [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
        index.updateFile("/b.ts", [
            { key: "错误", filePath: "/b.ts", line: 0, character: 1 },
        ]);

        expect(index.allLocations().map((item) => item.key)).toEqual(["保存", "错误"]);

        index.removeFile("/a.ts");

        expect(index.allLocations().map((item) => item.key)).toEqual(["错误"]);
    });

    it("replaces an existing file's locations", () => {
        const index = new SourceIndex();

        index.updateFile("/a.ts", [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
        index.updateFile("/a.ts", [
            { key: "打开", filePath: "/a.ts", line: 1, character: 2 },
        ]);

        expect(index.allLocations()).toEqual([
            { key: "打开", filePath: "/a.ts", line: 1, character: 2 },
        ]);
    });

    it("clear removes all indexed files", () => {
        const index = new SourceIndex();

        index.updateFile("/a.ts", [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
        index.updateFile("/b.ts", [
            { key: "错误", filePath: "/b.ts", line: 0, character: 1 },
        ]);

        index.clear();

        expect(index.allLocations()).toEqual([]);
    });

    it("does not allow updateFile input mutations to mutate stored state", () => {
        const index = new SourceIndex();
        const locations = [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ];

        index.updateFile("/a.ts", locations);
        locations[0].key = "已变更";
        locations.push({ key: "新增", filePath: "/a.ts", line: 2, character: 3 });

        expect(index.allLocations()).toEqual([
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
    });

    it("does not allow allLocations result mutations to mutate stored state", () => {
        const index = new SourceIndex();

        index.updateFile("/a.ts", [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);

        const locations = index.allLocations();
        locations[0].key = "已变更";

        expect(index.allLocations()).toEqual([
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
    });

    it("keeps insertion order when updating an existing file", () => {
        const index = new SourceIndex();

        index.updateFile("/a.ts", [
            { key: "保存", filePath: "/a.ts", line: 0, character: 1 },
        ]);
        index.updateFile("/b.ts", [
            { key: "错误", filePath: "/b.ts", line: 0, character: 1 },
        ]);
        index.updateFile("/a.ts", [
            { key: "打开", filePath: "/a.ts", line: 1, character: 2 },
        ]);

        expect(index.allLocations().map((item) => item.key)).toEqual(["打开", "错误"]);
    });
});

describe("IndexService.updateFile", () => {
    it("updates the indexed locations for a supported file", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('旧');");
        vscodeMock.readFile.mockResolvedValue(Buffer.from("const label = $t('保存');"));

        const service = new IndexService({ workspaceRoot: dir });
        await service.updateFile({ fsPath: filePath } as any);

        expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: filePath });
        expect(service.index.allLocations()).toEqual([
            { key: "保存", filePath, line: 0, character: 14 },
        ]);
    });

    it("removes an indexed file when the file is missing, oversized, or unreadable", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const missingFile = join(dir, "missing.ts");
        const oversizedFile = join(dir, "large.ts");
        const unreadableFile = join(dir, "unreadable.ts");
        await writeFile(oversizedFile, "const label = $t('太大');");
        await writeFile(unreadableFile, "const label = $t('读取失败');");
        vscodeMock.readFile.mockRejectedValue(new Error("read failed"));

        const service = new IndexService({ workspaceRoot: dir, maxFileSizeBytes: 0 });
        service.index.updateFile(missingFile, [
            { key: "缺失", filePath: missingFile, line: 0, character: 0 },
        ]);
        service.index.updateFile(oversizedFile, [
            { key: "旧太大", filePath: oversizedFile, line: 0, character: 0 },
        ]);
        service.index.updateFile(unreadableFile, [
            { key: "旧读取失败", filePath: unreadableFile, line: 0, character: 0 },
        ]);

        await service.updateFile({ fsPath: missingFile } as any);
        await service.updateFile({ fsPath: oversizedFile } as any);
        await service.updateFile({ fsPath: unreadableFile } as any);

        expect(service.index.allLocations()).toEqual([]);
    });

    it("does not let an older in-flight update overwrite a later remove", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('旧');");
        let resolveRead: (value: Buffer) => void = () => undefined;

        vscodeMock.readFile.mockImplementation(
            () => new Promise<Buffer>((resolve) => {
                resolveRead = resolve;
            })
        );

        const service = new IndexService({ workspaceRoot: dir });
        const update = service.updateFile({ fsPath: filePath } as any);
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: filePath }));

        service.removeFile({ fsPath: filePath } as any);
        resolveRead(Buffer.from("const label = $t('旧');"));
        await update;

        expect(service.index.allLocations()).toEqual([]);
    });

    it("does not let an older in-flight update overwrite a later update", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('新');");
        let resolveOlderRead: (value: Buffer) => void = () => undefined;

        vscodeMock.readFile
            .mockImplementationOnce(
                () => new Promise<Buffer>((resolve) => {
                    resolveOlderRead = resolve;
                })
            )
            .mockResolvedValueOnce(Buffer.from("const label = $t('新');"));

        const service = new IndexService({ workspaceRoot: dir });
        const olderUpdate = service.updateFile({ fsPath: filePath } as any);
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledTimes(1));

        await service.updateFile({ fsPath: filePath } as any);
        resolveOlderRead(Buffer.from("const label = $t('旧');"));
        await olderUpdate;

        expect(service.index.allLocations()).toEqual([
            { key: "新", filePath, line: 0, character: 14 },
        ]);
    });

    it("removes a file from the index", () => {
        const service = new IndexService({ workspaceRoot: "/project" });
        service.index.updateFile("/project/app.ts", [
            { key: "保存", filePath: "/project/app.ts", line: 0, character: 0 },
        ]);

        service.removeFile({ fsPath: "/project/app.ts" } as any);

        expect(service.index.allLocations()).toEqual([]);
    });
});

describe("IndexService.rebuild", () => {
    it("indexes supported files while skipping unsupported and oversized files", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const supportedFile = join(dir, "app.ts");
        const unsupportedFile = join(dir, "readme.md");
        const oversizedFile = join(dir, "large.ts");
        await writeFile(supportedFile, "const label = $t('保存');");
        await writeFile(unsupportedFile, "const ignored = $t('忽略');");
        await writeFile(oversizedFile, "const ignored = $t('太大');");
        const supportedStat = await stat(supportedFile);

        vscodeMock.findFiles.mockResolvedValue([
            { fsPath: supportedFile },
            { fsPath: unsupportedFile },
            { fsPath: oversizedFile },
        ]);
        vscodeMock.readFile.mockImplementation(async (file: { fsPath: string }) => {
            if (file.fsPath === supportedFile) return Buffer.from("const label = $t('保存');");
            if (file.fsPath === oversizedFile) return Buffer.from("const ignored = $t('太大');");
            return Buffer.from("const ignored = $t('忽略');");
        });

        const service = new IndexService({ workspaceRoot: dir, maxFileSizeBytes: supportedStat.size });
        await service.rebuild();

        expect(service.getStatus()).toBe("ready");
        expect(vscodeMock.findFiles).toHaveBeenCalledWith(
            "**/*.{js,jsx,ts,tsx,vue}",
            "**/{node_modules,dist,build,.next,.nuxt,coverage,out,.git}/**"
        );
        expect(vscodeMock.readFile).toHaveBeenCalledTimes(1);
        expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: supportedFile });
        expect(service.index.allLocations()).toEqual([
            { key: "保存", filePath: supportedFile, line: 0, character: 14 },
        ]);
    });

    it("reports progress every 25 scanned files", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const files: Array<{ fsPath: string }> = [];
        for (let index = 0; index < 25; index++) {
            const filePath = join(dir, `file-${index}.ts`);
            await writeFile(filePath, `const label = $t('key-${index}');`);
            files.push({ fsPath: filePath });
        }
        vscodeMock.findFiles.mockResolvedValue(files);
        vscodeMock.readFile.mockImplementation(async (file: { fsPath: string }) =>
            Buffer.from(`const label = $t('${file.fsPath}');`)
        );
        const progress = { report: vi.fn() };

        const service = new IndexService({ workspaceRoot: dir });
        await service.rebuild(progress);

        expect(progress.report).toHaveBeenCalledWith({ message: "已扫描 25/25" });
    });

    it("does not allow an older rebuild to update index or status after a newer rebuild starts", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const olderFile = join(dir, "older.ts");
        const newerFile = join(dir, "newer.ts");
        await writeFile(olderFile, "const label = $t('旧');");
        await writeFile(newerFile, "const label = $t('新');");
        let resolveOlderRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles
            .mockResolvedValueOnce([{ fsPath: olderFile }])
            .mockResolvedValueOnce([{ fsPath: newerFile }]);
        vscodeMock.readFile.mockImplementation((file: { fsPath: string }) => {
            if (file.fsPath === olderFile) {
                return new Promise<Buffer>((resolve) => {
                    resolveOlderRead = resolve;
                });
            }

            return Promise.resolve(Buffer.from("const label = $t('新');"));
        });

        const service = new IndexService({ workspaceRoot: dir });
        const olderRebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: olderFile }));

        await service.rebuild();
        resolveOlderRead(Buffer.from("const label = $t('旧');"));
        await olderRebuild;

        expect(service.getStatus()).toBe("ready");
        expect(service.index.allLocations()).toEqual([
            { key: "新", filePath: newerFile, line: 0, character: 14 },
        ]);
    });

    it("does not overwrite a watcher update that happens while rebuild is reading the same file", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('监听');");
        let resolveRebuildRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles.mockResolvedValue([{ fsPath: filePath }]);
        vscodeMock.readFile
            .mockImplementationOnce(
                () => new Promise<Buffer>((resolve) => {
                    resolveRebuildRead = resolve;
                })
            )
            .mockResolvedValueOnce(Buffer.from("const label = $t('监听');"));

        const service = new IndexService({ workspaceRoot: dir });
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: filePath }));

        await service.updateFile({ fsPath: filePath } as any);
        resolveRebuildRead(Buffer.from("const label = $t('重建');"));
        await rebuild;

        expect(service.index.allLocations()).toEqual([
            { key: "监听", filePath, line: 0, character: 14 },
        ]);
    });

    it("does not overwrite a watcher update that happens while file discovery is pending", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const rebuildFile = join(dir, "rebuild.ts");
        const watcherFile = join(dir, "watcher.ts");
        await writeFile(rebuildFile, "const label = $t('重建');");
        await writeFile(watcherFile, "const label = $t('监听');");
        let resolveFindFiles: (value: Array<{ fsPath: string }>) => void = () => undefined;

        vscodeMock.findFiles.mockImplementation(
            () => new Promise<Array<{ fsPath: string }>>((resolve) => {
                resolveFindFiles = resolve;
            })
        );
        vscodeMock.readFile
            .mockResolvedValueOnce(Buffer.from("const label = $t('监听');"))
            .mockResolvedValueOnce(Buffer.from("const label = $t('重建');"));

        const service = new IndexService({ workspaceRoot: dir });
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.findFiles).toHaveBeenCalled());

        await service.updateFile({ fsPath: watcherFile } as any);
        resolveFindFiles([{ fsPath: rebuildFile }]);
        await rebuild;

        expect(service.index.allLocations()).toEqual([
            { key: "重建", filePath: rebuildFile, line: 0, character: 14 },
            { key: "监听", filePath: watcherFile, line: 0, character: 14 },
        ]);
    });

    it("does not overwrite a watcher update for a file absent from the rebuild snapshot", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const rebuildFile = join(dir, "rebuild.ts");
        const watcherFile = join(dir, "watcher.ts");
        await writeFile(rebuildFile, "const label = $t('重建');");
        await writeFile(watcherFile, "const label = $t('监听');");
        let resolveRebuildRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles.mockResolvedValue([{ fsPath: rebuildFile }]);
        vscodeMock.readFile
            .mockImplementationOnce(
                () => new Promise<Buffer>((resolve) => {
                    resolveRebuildRead = resolve;
                })
            )
            .mockResolvedValueOnce(Buffer.from("const label = $t('监听');"));

        const service = new IndexService({ workspaceRoot: dir });
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: rebuildFile }));

        await service.updateFile({ fsPath: watcherFile } as any);
        resolveRebuildRead(Buffer.from("const label = $t('重建');"));
        await rebuild;

        expect(service.index.allLocations()).toEqual([
            { key: "重建", filePath: rebuildFile, line: 0, character: 14 },
            { key: "监听", filePath: watcherFile, line: 0, character: 14 },
        ]);
    });

    it("does not overwrite a watcher remove that happens while rebuild is reading the same file", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('重建');");
        let resolveRebuildRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles.mockResolvedValue([{ fsPath: filePath }]);
        vscodeMock.readFile.mockImplementation(
            () => new Promise<Buffer>((resolve) => {
                resolveRebuildRead = resolve;
            })
        );

        const service = new IndexService({ workspaceRoot: dir });
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: filePath }));

        service.removeFile({ fsPath: filePath } as any);
        resolveRebuildRead(Buffer.from("const label = $t('重建');"));
        await rebuild;

        expect(service.index.allLocations()).toEqual([]);
    });

    it("keeps the previous live index when a rebuild is cancelled", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const oldFile = join(dir, "old.ts");
        const newFile = join(dir, "new.ts");
        await writeFile(oldFile, "const label = $t('旧');");
        await writeFile(newFile, "const label = $t('新');");
        let resolveRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles.mockResolvedValue([{ fsPath: newFile }]);
        vscodeMock.readFile.mockImplementation(
            () => new Promise<Buffer>((resolve) => {
                resolveRead = resolve;
            })
        );

        const service = new IndexService({ workspaceRoot: dir });
        service.index.updateFile(oldFile, [
            { key: "旧", filePath: oldFile, line: 0, character: 14 },
        ]);
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: newFile }));

        service.cancel();
        resolveRead(Buffer.from("const label = $t('新');"));
        await rebuild;

        expect(service.getStatus()).toBe("cancelled");
        expect(service.index.allLocations()).toEqual([
            { key: "旧", filePath: oldFile, line: 0, character: 14 },
        ]);
    });

    it("keeps the previous live index when a rebuild fails", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const oldFile = join(dir, "old.ts");
        await writeFile(oldFile, "const label = $t('旧');");

        vscodeMock.findFiles.mockRejectedValue(new Error("find failed"));

        const service = new IndexService({ workspaceRoot: dir });
        service.index.updateFile(oldFile, [
            { key: "旧", filePath: oldFile, line: 0, character: 14 },
        ]);

        await expect(service.rebuild()).rejects.toThrow("find failed");

        expect(service.getStatus()).toBe("error");
        expect(service.index.allLocations()).toEqual([
            { key: "旧", filePath: oldFile, line: 0, character: 14 },
        ]);
    });

    it("keeps cancelled status when a rebuild is cancelled", async () => {        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const filePath = join(dir, "app.ts");
        await writeFile(filePath, "const label = $t('保存');");
        let resolveRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles.mockResolvedValue([{ fsPath: filePath }]);
        vscodeMock.readFile.mockImplementation(
            () => new Promise<Buffer>((resolve) => {
                resolveRead = resolve;
            })
        );

        const service = new IndexService({ workspaceRoot: dir });
        const rebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: filePath }));

        service.cancel();
        resolveRead(Buffer.from("const label = $t('保存');"));
        await rebuild;

        expect(service.getStatus()).toBe("cancelled");
        expect(service.index.allLocations()).toEqual([]);
    });

    it("skips files that cannot be read after stat succeeds", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const unreadableFile = join(dir, "removed.ts");
        const readableFile = join(dir, "app.ts");
        await writeFile(unreadableFile, "const label = $t('跳过');");
        await writeFile(readableFile, "const label = $t('保留');");

        vscodeMock.findFiles.mockResolvedValue([
            { fsPath: unreadableFile },
            { fsPath: readableFile },
        ]);
        vscodeMock.readFile.mockImplementation((file: { fsPath: string }) => {
            if (file.fsPath === unreadableFile) {
                return Promise.reject(new Error("file disappeared"));
            }

            return Promise.resolve(Buffer.from("const label = $t('保留');"));
        });

        const service = new IndexService({ workspaceRoot: dir });
        await service.rebuild();

        expect(service.getStatus()).toBe("ready");
        expect(service.index.allLocations()).toEqual([
            { key: "保留", filePath: readableFile, line: 0, character: 14 },
        ]);
    });

    it("disposes each rebuild source after completion without disposing the in-flight newer source", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-index-"));
        const olderFile = join(dir, "older.ts");
        const newerFile = join(dir, "newer.ts");
        await writeFile(olderFile, "const label = $t('旧');");
        await writeFile(newerFile, "const label = $t('新');");
        let resolveOlderRead: (value: Buffer) => void = () => undefined;
        let resolveNewerRead: (value: Buffer) => void = () => undefined;

        vscodeMock.findFiles
            .mockResolvedValueOnce([{ fsPath: olderFile }])
            .mockResolvedValueOnce([{ fsPath: newerFile }]);
        vscodeMock.readFile.mockImplementation((file: { fsPath: string }) => {
            if (file.fsPath === olderFile) {
                return new Promise<Buffer>((resolve) => {
                    resolveOlderRead = resolve;
                });
            }

            return new Promise<Buffer>((resolve) => {
                resolveNewerRead = resolve;
            });
        });

        const service = new IndexService({ workspaceRoot: dir });
        const olderRebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: olderFile }));
        const olderSource = vscodeMock.cancellationSources[0];

        const newerRebuild = service.rebuild();
        await vi.waitFor(() => expect(vscodeMock.readFile).toHaveBeenCalledWith({ fsPath: newerFile }));
        const newerSource = vscodeMock.cancellationSources[1];

        resolveOlderRead(Buffer.from("const label = $t('旧');"));
        await olderRebuild;

        expect(olderSource.dispose).toHaveBeenCalledTimes(1);
        expect(newerSource.dispose).not.toHaveBeenCalled();

        service.cancel();
        expect(newerSource.cancel).toHaveBeenCalledTimes(1);
        resolveNewerRead(Buffer.from("const label = $t('新');"));
        await newerRebuild;

        expect(newerSource.dispose).toHaveBeenCalledTimes(1);
    });
});
