import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TranslationStore } from "../translationStore";

let dir = "";

afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
});

describe("TranslationStore", () => {
    it("loads translated keys from json", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        await writeFile(file, JSON.stringify({ 保存: { en: "Save" } }));

        const store = new TranslationStore(file);

        await store.load();
        expect(store.has("保存")).toBe(true);
        expect(store.has("错误")).toBe(false);
    });

    it("keeps keys empty without throwing when file is missing", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "missing.json");
        const store = new TranslationStore(file);

        await expect(store.load()).resolves.toBeUndefined();

        expect(store.snapshot()).toEqual(new Set());
    });

    it("clears loaded keys when file is missing", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        await writeFile(file, JSON.stringify({ 保存: { en: "Save" } }));
        const store = new TranslationStore(file);
        await store.load();

        await rm(file);
        await expect(store.load()).resolves.toBeUndefined();

        expect(store.has("保存")).toBe(false);
        expect(store.snapshot()).toEqual(new Set());
    });

    it("clears loaded keys after invalid json", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        await writeFile(file, JSON.stringify({ 保存: { en: "Save" } }));
        const store = new TranslationStore(file);
        await store.load();

        await writeFile(file, "{");
        await expect(store.load()).resolves.toBeUndefined();

        expect(store.has("保存")).toBe(false);
        expect(store.snapshot()).toEqual(new Set());
    });

    it("loads keys from new path after updatePath", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const firstFile = join(dir, "first.json");
        const secondFile = join(dir, "second.json");
        await writeFile(firstFile, JSON.stringify({ 保存: { en: "Save" } }));
        await writeFile(secondFile, JSON.stringify({ 错误: { en: "Error" } }));
        const store = new TranslationStore(firstFile);
        await store.load();

        store.updatePath(secondFile);
        await store.load();

        expect(store.has("保存")).toBe(false);
        expect(store.has("错误")).toBe(true);
    });

    it("ignores stale loads after updatePath changes the translation path", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const firstFile = join(dir, "first.json");
        const secondFile = join(dir, "second.json");
        await writeFile(firstFile, JSON.stringify({ 保存: { en: "Save" } }));
        await writeFile(secondFile, JSON.stringify({ 错误: { en: "Error" } }));

        let releaseFirstRead: (() => void) | undefined;
        const firstReadCanFinish = new Promise<void>((resolve) => {
            releaseFirstRead = resolve;
        });
        const store = new TranslationStore(firstFile, {
            stat: async (path) => ({ mtimeMs: path === firstFile ? 1 : 2 }) as any,
            readFile: async (path) => {
                if (path === firstFile) {
                    await firstReadCanFinish;
                    return JSON.stringify({ 保存: { en: "Save" } });
                }

                return JSON.stringify({ 错误: { en: "Error" } });
            },
        });

        const staleLoad = store.load();
        await Promise.resolve();
        store.updatePath(secondFile);
        await store.load();
        expect(store.has("错误")).toBe(true);

        releaseFirstRead?.();
        await staleLoad;

        expect(store.has("错误")).toBe(true);
        expect(store.has("保存")).toBe(false);
    });

    it("does not let an older same-path load overwrite a newer load", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        let releaseOlderRead: (() => void) | undefined;
        const olderReadCanFinish = new Promise<void>((resolve) => {
            releaseOlderRead = resolve;
        });
        let readCount = 0;
        const store = new TranslationStore(file, {
            stat: async () => ({ mtimeMs: 1 }) as any,
            readFile: async () => {
                readCount++;
                if (readCount === 1) {
                    await olderReadCanFinish;
                    return JSON.stringify({ 旧: { en: "Old" } });
                }

                return JSON.stringify({ 新: { en: "New" } });
            },
        });

        const olderLoad = store.load();
        await Promise.resolve();
        await store.load();
        expect(store.has("新")).toBe(true);

        releaseOlderRead?.();
        await olderLoad;

        expect(store.has("新")).toBe(true);
        expect(store.has("旧")).toBe(false);
    });

    it("returns a defensive copy from snapshot", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        await writeFile(file, JSON.stringify({ 保存: { en: "Save" } }));
        const store = new TranslationStore(file);
        await store.load();

        const snapshot = store.snapshot();
        snapshot.delete("保存");
        snapshot.add("错误");

        expect(store.has("保存")).toBe(true);
        expect(store.has("错误")).toBe(false);
    });

    it("does not reread file content when mtime is unchanged", async () => {
        dir = await mkdtemp(join(tmpdir(), "easy-lang-"));
        const file = join(dir, "translation.json");
        await writeFile(file, JSON.stringify({ 保存: { en: "Save" } }));
        const originalTime = new Date("2024-01-01T00:00:00.000Z");
        await utimes(file, originalTime, originalTime);
        const store = new TranslationStore(file);
        await store.load();

        await writeFile(file, JSON.stringify({ 错误: { en: "Error" } }));
        await utimes(file, originalTime, originalTime);
        await store.load();

        expect(store.has("保存")).toBe(true);
        expect(store.has("错误")).toBe(false);
    });
});
