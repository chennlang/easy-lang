import { stat, readFile } from "node:fs/promises";

export type TranslationStoreFileSystem = {
    stat: typeof stat;
    readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
};

export class TranslationStore {
    private keys = new Set<string>();
    private lastMtimeMs = -1;
    private fileSystem: TranslationStoreFileSystem;
    private loadGeneration = 0;

    constructor(private translationPath: string, fileSystem?: TranslationStoreFileSystem) {
        this.fileSystem = fileSystem || { stat, readFile };
    }

    updatePath(translationPath: string): void {
        if (this.translationPath === translationPath) return;

        this.translationPath = translationPath;
        this.keys = new Set<string>();
        this.lastMtimeMs = -1;
    }

    async load(): Promise<void> {
        const translationPath = this.translationPath;
        const generation = ++this.loadGeneration;
        const isCurrentLoad = () =>
            generation === this.loadGeneration && translationPath === this.translationPath;

        try {
            const fileStat = await this.fileSystem.stat(translationPath);
            if (!isCurrentLoad()) return;
            if (fileStat.mtimeMs === this.lastMtimeMs) return;

            const json = JSON.parse(await this.fileSystem.readFile(translationPath, "utf8"));
            if (!isCurrentLoad()) return;

            this.keys = new Set(Object.keys(json));
            this.lastMtimeMs = fileStat.mtimeMs;
        } catch {
            if (!isCurrentLoad()) return;

            this.keys = new Set<string>();
            this.lastMtimeMs = -1;
        }
    }

    has(key: string): boolean {
        return this.keys.has(key);
    }

    snapshot(): Set<string> {
        return new Set(this.keys);
    }
}
