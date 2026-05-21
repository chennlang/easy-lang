import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    workspace: {
        findFiles: vi.fn(),
    },
}));

import { classifyKeyLocations, isSupportedSourceFile, scanTextI18nKeys } from "../scanner";

describe("isSupportedSourceFile", () => {
    it("matches supported source file extensions case-insensitively", () => {
        expect(isSupportedSourceFile("/project/src/app.ts")).toBe(true);
        expect(isSupportedSourceFile("/project/src/component.VUE")).toBe(true);
        expect(isSupportedSourceFile("/project/src/readme.md")).toBe(false);
    });
});

describe("scanTextI18nKeys", () => {
    it("extracts translation keys and locations from text", () => {
        const text = "const a = $t('保存');\nconst b = $t(\"错误\", { count: 1 });";

        const result = scanTextI18nKeys(text, "/project/src/app.ts");

        expect(result).toEqual([
            { key: "保存", filePath: "/project/src/app.ts", line: 0, character: 10 },
            { key: "错误", filePath: "/project/src/app.ts", line: 1, character: 10 },
        ]);
    });
});

describe("classifyKeyLocations", () => {
    it("splits key locations into untranslated and translated groups", () => {
        const locations = [
            { key: "保存", filePath: "/project/src/app.ts", line: 0, character: 10 },
            { key: "错误", filePath: "/project/src/app.ts", line: 1, character: 10 },
        ];

        const result = classifyKeyLocations(locations, new Set(["保存"]));

        expect(result).toEqual({
            untranslated: [
                { key: "错误", filePath: "/project/src/app.ts", line: 1, character: 10 },
            ],
            translated: [
                { key: "保存", filePath: "/project/src/app.ts", line: 0, character: 10 },
            ],
        });
    });
});
