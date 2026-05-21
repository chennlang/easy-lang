import { stat } from "node:fs/promises";
import * as vscode from "vscode";
import { KeyLocation, isSupportedSourceFile, scanTextI18nKeys } from "./scanner";

export type IndexStatus = "idle" | "indexing" | "ready" | "cancelled" | "error";

export interface FileIndex {
    filePath: string;
    mtimeMs: number;
    size: number;
    locations: KeyLocation[];
}

const DEFAULT_INCLUDE = "**/*.{js,jsx,ts,tsx,vue}";
const DEFAULT_EXCLUDE = "**/{node_modules,dist,build,.next,.nuxt,coverage,out,.git}/**";
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;
const YIELD_EVERY_CANDIDATES = 25;

function delayToNextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export class SourceIndex {
    private files = new Map<string, FileIndex>();

    updateFile(
        filePath: string,
        locations: KeyLocation[],
        mtimeMs = 0,
        size = 0
    ): void {
        this.files.set(filePath, {
            filePath,
            mtimeMs,
            size,
            locations: locations.map((location) => ({ ...location })),
        });
    }

    removeFile(filePath: string): void {
        this.files.delete(filePath);
    }

    allLocations(): KeyLocation[] {
        return Array.from(this.files.values()).flatMap((file) =>
            file.locations.map((location) => ({ ...location }))
        );
    }

    getFile(filePath: string): FileIndex | undefined {
        const file = this.files.get(filePath);
        if (!file) return undefined;

        return {
            ...file,
            locations: file.locations.map((location) => ({ ...location })),
        };
    }

    replaceWith(source: SourceIndex): void {
        this.files = new Map(
            Array.from(source.files.entries()).map(([filePath, file]) => [
                filePath,
                {
                    ...file,
                    locations: file.locations.map((location) => ({ ...location })),
                },
            ])
        );
    }

    clear(): void {
        this.files.clear();
    }
}

export interface IndexServiceOptions {
    workspaceRoot: string;
    includeGlob?: string;
    excludeGlob?: string;
    maxFileSizeBytes?: number;
}

export class IndexService {
    readonly index = new SourceIndex();
    private cancellation: vscode.CancellationTokenSource | undefined;
    private status: IndexStatus = "idle";
    private rebuildGeneration = 0;
    private fileVersions = new Map<string, number>();

    constructor(private options: IndexServiceOptions) {}

    getStatus(): IndexStatus {
        return this.status;
    }

    cancel(): void {
        this.cancellation?.cancel();
    }

    private isCurrentRebuild(
        generation: number,
        cancellation: vscode.CancellationTokenSource
    ): boolean {
        return this.rebuildGeneration === generation && this.cancellation === cancellation;
    }

    private bumpFileVersion(filePath: string): number {
        const version = (this.fileVersions.get(filePath) ?? 0) + 1;
        this.fileVersions.set(filePath, version);
        return version;
    }

    private getFileVersion(filePath: string): number {
        return this.fileVersions.get(filePath) ?? 0;
    }

    private isCurrentFileVersion(filePath: string, version: number): boolean {
        return this.getFileVersion(filePath) === version;
    }

    private finishIfCancelled(
        generation: number,
        cancellation: vscode.CancellationTokenSource
    ): boolean {
        if (!cancellation.token.isCancellationRequested) {
            return false;
        }

        if (this.isCurrentRebuild(generation, cancellation)) {
            this.status = "cancelled";
        }

        return true;
    }

    private async yieldIfNeeded(
        candidates: number,
        generation: number,
        cancellation: vscode.CancellationTokenSource
    ): Promise<boolean> {
        if (candidates % YIELD_EVERY_CANDIDATES !== 0) {
            return true;
        }

        await delayToNextTick();
        return this.isCurrentRebuild(generation, cancellation) &&
            !this.finishIfCancelled(generation, cancellation);
    }

    async updateFile(uri: vscode.Uri): Promise<void> {
        if (!isSupportedSourceFile(uri.fsPath)) {
            return;
        }

        const operationVersion = this.bumpFileVersion(uri.fsPath);
        const fileStat = await stat(uri.fsPath).catch(() => undefined);
        const maxFileSizeBytes = this.options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
        if (!this.isCurrentFileVersion(uri.fsPath, operationVersion)) {
            return;
        }
        if (!fileStat || fileStat.size > maxFileSizeBytes) {
            this.index.removeFile(uri.fsPath);
            return;
        }

        let bytes: Uint8Array;
        try {
            bytes = await vscode.workspace.fs.readFile(uri);
        } catch {
            if (this.isCurrentFileVersion(uri.fsPath, operationVersion)) {
                this.index.removeFile(uri.fsPath);
            }
            return;
        }
        if (!this.isCurrentFileVersion(uri.fsPath, operationVersion)) {
            return;
        }

        const text = Buffer.from(bytes).toString("utf8");
        if (!this.isCurrentFileVersion(uri.fsPath, operationVersion)) {
            return;
        }
        this.index.updateFile(
            uri.fsPath,
            scanTextI18nKeys(text, uri.fsPath),
            fileStat.mtimeMs,
            fileStat.size
        );
    }

    removeFile(uri: vscode.Uri): void {
        this.bumpFileVersion(uri.fsPath);
        this.index.removeFile(uri.fsPath);
    }

    async rebuild(progress?: vscode.Progress<{ message?: string; increment?: number }>) {
        this.cancel();
        const cancellation = new vscode.CancellationTokenSource();
        const generation = ++this.rebuildGeneration;
        this.cancellation = cancellation;
        const token = cancellation.token;
        this.status = "indexing";
        const nextIndex = new SourceIndex();
        const initialFileVersions = new Map(this.fileVersions);

        try {
            const files = await vscode.workspace.findFiles(
                this.options.includeGlob ?? DEFAULT_INCLUDE,
                this.options.excludeGlob ?? DEFAULT_EXCLUDE
            );
            if (!this.isCurrentRebuild(generation, cancellation)) {
                return;
            }
            if (this.finishIfCancelled(generation, cancellation)) {
                return;
            }

            const maxFileSizeBytes = this.options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
            const rebuildFileVersions = new Map(
                files.map((file) => [file.fsPath, this.getFileVersion(file.fsPath)])
            );
            let processed = 0;
            let candidates = 0;

            for (const file of files) {
                candidates++;
                if (!this.isCurrentRebuild(generation, cancellation)) {
                    return;
                }
                if (this.finishIfCancelled(generation, cancellation)) {
                    return;
                }

                if (!isSupportedSourceFile(file.fsPath)) {
                    if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                        return;
                    }
                    continue;
                }

                const fileVersion = this.getFileVersion(file.fsPath);
                const fileStat = await stat(file.fsPath).catch(() => undefined);
                if (!this.isCurrentRebuild(generation, cancellation)) {
                    return;
                }
                if (this.finishIfCancelled(generation, cancellation)) {
                    return;
                }
                if (!this.isCurrentFileVersion(file.fsPath, fileVersion)) {
                    if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                        return;
                    }
                    continue;
                }
                if (!fileStat || fileStat.size > maxFileSizeBytes) {
                    if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                        return;
                    }
                    continue;
                }

                let bytes: Uint8Array | undefined;
                try {
                    bytes = await vscode.workspace.fs.readFile(file);
                } catch (error) {
                    if (!this.isCurrentRebuild(generation, cancellation) || token.isCancellationRequested) {
                        throw error;
                    }
                }
                if (!this.isCurrentRebuild(generation, cancellation)) {
                    return;
                }
                if (this.finishIfCancelled(generation, cancellation)) {
                    return;
                }
                if (!bytes) {
                    if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                        return;
                    }
                    continue;
                }

                const text = Buffer.from(bytes).toString("utf8");
                if (!this.isCurrentRebuild(generation, cancellation)) {
                    return;
                }
                if (this.finishIfCancelled(generation, cancellation)) {
                    return;
                }
                if (!this.isCurrentFileVersion(file.fsPath, fileVersion)) {
                    if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                        return;
                    }
                    continue;
                }
                nextIndex.updateFile(
                    file.fsPath,
                    scanTextI18nKeys(text, file.fsPath),
                    fileStat.mtimeMs,
                    fileStat.size
                );
                processed++;

                if (processed % 25 === 0) {
                    progress?.report({ message: `已扫描 ${processed}/${files.length}` });
                    await delayToNextTick();
                    if (!this.isCurrentRebuild(generation, cancellation)) {
                        return;
                    }
                    if (this.finishIfCancelled(generation, cancellation)) {
                        return;
                    }
                } else if (!(await this.yieldIfNeeded(candidates, generation, cancellation))) {
                    return;
                }
            }

            if (this.isCurrentRebuild(generation, cancellation)) {
                if (token.isCancellationRequested) {
                    this.status = "cancelled";
                } else {
                    const changedFilePaths = new Set<string>();
                    for (const file of files) {
                        if (this.getFileVersion(file.fsPath) !== rebuildFileVersions.get(file.fsPath)) {
                            changedFilePaths.add(file.fsPath);
                        }
                    }
                    for (const [filePath, version] of this.fileVersions) {
                        if (version !== (initialFileVersions.get(filePath) ?? 0)) {
                            changedFilePaths.add(filePath);
                        }
                    }
                    for (const filePath of changedFilePaths) {
                        const liveFile = this.index.getFile(filePath);
                        if (liveFile) {
                            nextIndex.updateFile(
                                liveFile.filePath,
                                liveFile.locations,
                                liveFile.mtimeMs,
                                liveFile.size
                            );
                        } else {
                            nextIndex.removeFile(filePath);
                        }
                    }
                    this.index.replaceWith(nextIndex);
                    this.status = "ready";
                }
            }
        } catch (error) {
            if (!this.isCurrentRebuild(generation, cancellation)) {
                return;
            }
            if (token.isCancellationRequested) {
                this.status = "cancelled";
                return;
            }
            this.status = "error";
            throw error;
        } finally {
            cancellation.dispose();
            if (this.cancellation === cancellation) {
                this.cancellation = undefined;
            }
        }
    }
}
