# VS Code Extension Performance Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Easy Lang VS Code extension so opening and editing files never blocks VS Code, while global i18n status is maintained through delayed, cancellable, incremental indexing.

**Architecture:** Activation becomes lightweight and only wires commands, views, and services. Current-file scanning uses the already-open `TextDocument` content synchronously but cheaply, while global indexing runs in cancellable async batches with per-file cache and file watchers. Translation metadata is cached separately so translation changes reclassify keys without rescanning source files.

**Tech Stack:** TypeScript, VS Code Extension API, Node `fs/promises`, pnpm, `tsc`, optional `vitest` for pure scanning/indexing units.

---

## Root Cause Summary

The current extension can freeze VS Code because `packages/easy-lang-vscode/src/extension.ts` activates on `onStartupFinished`, creates the tree view immediately, and calls `refreshCurrentFileData()` for the active editor. That path calls `getSingleFileI18nKeyStatus()` in `packages/easy-lang-vscode/src/scanner.ts`, which synchronously reads the active file and synchronously parses `translation.json` on the Extension Host main thread. Older built artifacts also call full workspace scan in the provider constructor. On Windows, synchronous filesystem work is slower and more likely to make the Extension Host appear hung or exit.

Do not solve this by merely making full scan faster. The core design is: current file first, delayed global index, incremental updates after the first index.

---

### Task 1: Add Test Harness for Pure Extension Logic

**Files:**
- Modify: `packages/easy-lang-vscode/package.json`
- Modify: `packages/easy-lang-vscode/tsconfig.json`
- Create: `packages/easy-lang-vscode/src/__tests__/scanner.test.ts`

**Step 1: Add test dependencies and scripts**

Modify `packages/easy-lang-vscode/package.json` scripts and dev dependencies:

```json
{
  "scripts": {
    "compile": "tsc -p .",
    "type-check": "tsc -p . --noEmit",
    "test": "vitest run",
    "build": "pnpm run compile && pnpm exec vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/node-fetch": "^2.6.12",
    "@types/vscode": "^1.70.0",
    "@vscode/vsce": "^3.4.2",
    "typescript": "^5.0.0",
    "vitest": "^3.1.4"
  }
}
```

If `vitest` is already available elsewhere in the workspace, keep versions consistent with the lockfile.

**Step 2: Include tests in TypeScript config**

Modify `packages/easy-lang-vscode/tsconfig.json`:

```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", ".vscode-test", "dist"]
}
```

Keep this if already equivalent. Do not add VS Code integration tests yet; start with pure functions.

**Step 3: Write a failing scanner test**

Create `packages/easy-lang-vscode/src/__tests__/scanner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scanTextI18nKeys } from "../scanner";

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
```

**Step 4: Run test to verify it fails**

Run:

```bash
pnpm --filter easy-lang-vscode test
```

Expected: FAIL because `scanTextI18nKeys` does not exist.

**Step 5: Commit**

Do not commit unless the user explicitly asks. If they ask, commit only the test harness files.

---

### Task 2: Extract Fast Text Scanner with No Disk I/O

**Files:**
- Modify: `packages/easy-lang-vscode/src/scanner.ts`
- Test: `packages/easy-lang-vscode/src/__tests__/scanner.test.ts`

**Step 1: Implement `scanTextI18nKeys`**

Add this function to `scanner.ts` and keep `KeyLocation` unchanged:

```ts
export function scanTextI18nKeys(text: string, filePath: string): KeyLocation[] {
  const keyLocations: KeyLocation[] = [];
  let line = 0;
  let lineStart = 0;
  let searchStart = 0;
  I18N_REGEX.lastIndex = 0;

  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      while (searchStart <= i) {
        I18N_REGEX.lastIndex = searchStart;
        const match = I18N_REGEX.exec(text);
        if (!match || match.index > i) break;

        keyLocations.push({
          key: match[2],
          filePath,
          line,
          character: match.index - lineStart,
        });
        searchStart = I18N_REGEX.lastIndex;
      }
      line++;
      lineStart = i + 1;
    }
  }

  while (searchStart < text.length) {
    I18N_REGEX.lastIndex = searchStart;
    const match = I18N_REGEX.exec(text);
    if (!match) break;

    while (lineStart <= match.index) {
      const nextNewline = text.indexOf("\n", lineStart);
      if (nextNewline === -1 || nextNewline > match.index) break;
      line++;
      lineStart = nextNewline + 1;
    }

    keyLocations.push({
      key: match[2],
      filePath,
      line,
      character: match.index - lineStart,
    });
    searchStart = I18N_REGEX.lastIndex;
  }

  return keyLocations;
}
```

If this is too complex during implementation, use a simpler newline-index + binary-search implementation. The requirement is no per-match full line scan.

**Step 2: Refactor file scanner to delegate**

Change `scanSingleFileI18nKeys(filePath)` to:

```ts
export function scanSingleFileI18nKeys(filePath: string): KeyLocation[] {
  if (!fs.existsSync(filePath)) return [];

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return [];

  try {
    return scanTextI18nKeys(fs.readFileSync(filePath, "utf8"), filePath);
  } catch (error) {
    console.error(`Error scanning file ${filePath}:`, error);
    return [];
  }
}
```

Add near constants:

```ts
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue"]);
```

**Step 3: Run scanner tests**

Run:

```bash
pnpm --filter easy-lang-vscode test
```

Expected: PASS.

**Step 4: Run type check**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

---

### Task 3: Add Cached Translation Store

**Files:**
- Create: `packages/easy-lang-vscode/src/translationStore.ts`
- Create: `packages/easy-lang-vscode/src/__tests__/translationStore.test.ts`
- Modify: `packages/easy-lang-vscode/src/scanner.ts`

**Step 1: Write failing tests**

Create `packages/easy-lang-vscode/src/__tests__/translationStore.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter easy-lang-vscode test src/__tests__/translationStore.test.ts
```

Expected: FAIL because `translationStore.ts` does not exist.

**Step 3: Implement `TranslationStore`**

Create `packages/easy-lang-vscode/src/translationStore.ts`:

```ts
import { stat, readFile } from "node:fs/promises";

export class TranslationStore {
  private keys = new Set<string>();
  private lastMtimeMs = -1;

  constructor(private translationPath: string) {}

  updatePath(translationPath: string) {
    if (this.translationPath === translationPath) return;
    this.translationPath = translationPath;
    this.keys = new Set();
    this.lastMtimeMs = -1;
  }

  async load() {
    try {
      const fileStat = await stat(this.translationPath);
      if (fileStat.mtimeMs === this.lastMtimeMs) return;

      const json = JSON.parse(await readFile(this.translationPath, "utf8"));
      this.keys = new Set(Object.keys(json));
      this.lastMtimeMs = fileStat.mtimeMs;
    } catch {
      this.keys = new Set();
      this.lastMtimeMs = -1;
    }
  }

  has(key: string) {
    return this.keys.has(key);
  }

  snapshot() {
    return new Set(this.keys);
  }
}
```

**Step 4: Keep old scanner API working**

Do not remove `readTranslatedKeys` yet. Existing commands can keep using it until provider refactor is complete. Avoid a large breaking change in this task.

**Step 5: Run tests and type check**

Run:

```bash
pnpm --filter easy-lang-vscode test
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

---

### Task 4: Make Current File Refresh Use `TextDocument` Content

**Files:**
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`
- Modify: `packages/easy-lang-vscode/src/extension.ts`
- Test: `packages/easy-lang-vscode/src/__tests__/scanner.test.ts`

**Step 1: Add classification helper test**

Extend `scanner.test.ts`:

```ts
import { classifyKeyLocations } from "../scanner";

it("classifies scanned keys with translated key set", () => {
  const locations = [
    { key: "保存", filePath: "a.ts", line: 0, character: 0 },
    { key: "错误", filePath: "a.ts", line: 1, character: 0 },
  ];

  expect(classifyKeyLocations(locations, new Set(["保存"]))).toEqual({
    untranslated: [{ key: "错误", filePath: "a.ts", line: 1, character: 0 }],
    translated: [{ key: "保存", filePath: "a.ts", line: 0, character: 0 }],
  });
});
```

**Step 2: Implement helper**

Add to `scanner.ts`:

```ts
export function classifyKeyLocations(
  allKeyLocations: KeyLocation[],
  translatedKeys: Set<string>
) {
  const untranslated: KeyLocation[] = [];
  const translated: KeyLocation[] = [];

  for (const keyLocation of allKeyLocations) {
    if (translatedKeys.has(keyLocation.key)) translated.push(keyLocation);
    else untranslated.push(keyLocation);
  }

  return { untranslated, translated };
}
```

Then update `getSingleFileI18nKeyStatus` and `getI18nKeyStatusWithLocation` to call this helper.

**Step 3: Change provider API**

In `sidebarProvider.ts`, add import:

```ts
import { TranslationStore } from "./translationStore";
import { classifyKeyLocations, scanTextI18nKeys } from "./scanner";
```

Add property:

```ts
private translationStore: TranslationStore;
```

Initialize in constructor after `this.translationPath`:

```ts
this.translationStore = new TranslationStore(this.translationPath);
```

Change `refreshCurrentFileData` to async and accept a `TextDocument`:

```ts
async refreshCurrentFileData(document?: vscode.TextDocument) {
  if (!document) {
    const activeEditor = vscode.window.activeTextEditor;
    document = activeEditor?.document;
  }

  this.currentFilePath = document?.uri.fsPath || "";

  if (!document || document.uri.scheme !== "file") {
    this.currentFileUntranslatedLocations = [];
    this.currentFileTranslatedLocations = [];
    this._onDidChangeTreeData.fire();
    return;
  }

  await this.translationStore.load();
  const locations = scanTextI18nKeys(document.getText(), document.uri.fsPath);
  const { untranslated, translated } = classifyKeyLocations(
    locations,
    this.translationStore.snapshot()
  );

  this.currentFileUntranslatedLocations = untranslated;
  this.currentFileTranslatedLocations = translated;
  this._onDidChangeTreeData.fire();
}
```

**Step 4: Update extension event calls**

In `extension.ts`, replace calls like:

```ts
sidebarProvider.refreshCurrentFileData(editor.document.uri.fsPath);
```

with:

```ts
void sidebarProvider.refreshCurrentFileData(editor.document);
```

Replace no-argument calls with:

```ts
void sidebarProvider.refreshCurrentFileData();
```

**Step 5: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode test
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

---

### Task 5: Stop Activation-Time Work and Fix Debounce

**Files:**
- Modify: `packages/easy-lang-vscode/src/extension.ts`
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`
- Modify: `packages/easy-lang-vscode/package.json`

**Step 1: Remove noisy activation notification**

Delete this line from `activate()`:

```ts
vscode.window.showInformationMessage("Easy Lang 插件已激活！");
```

Activation must be silent.

**Step 2: Avoid current-file scan during activation**

Delete the block at the end of `activate()` that immediately calls `refreshCurrentFileData()`. Current-file scan should happen on active editor change or when the view becomes visible.

**Step 3: Add real debounce disposal**

In `extension.ts`, add:

```ts
let currentFileRefreshTimer: NodeJS.Timeout | undefined;

function scheduleCurrentFileRefresh(document?: vscode.TextDocument) {
  if (currentFileRefreshTimer) clearTimeout(currentFileRefreshTimer);
  currentFileRefreshTimer = setTimeout(() => {
    currentFileRefreshTimer = undefined;
    void sidebarProvider.refreshCurrentFileData(document);
  }, 300);
}
```

Use it in `onDidChangeActiveTextEditor` and `onDidChangeTextDocument`:

```ts
vscode.window.onDidChangeActiveTextEditor((editor) => {
  scheduleCurrentFileRefresh(editor?.document);
})
```

```ts
vscode.workspace.onDidChangeTextDocument((event) => {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && event.document === activeEditor.document) {
    scheduleCurrentFileRefresh(event.document);
  }
})
```

Add disposal:

```ts
context.subscriptions.push({
  dispose() {
    if (currentFileRefreshTimer) clearTimeout(currentFileRefreshTimer);
  },
});
```

**Step 4: Make global roots collapsed by default**

In `I18nTreeItem` constructor in `sidebarProvider.ts`, make global roots collapsed:

```ts
const collapsibleState =
  type === "currentFileUntranslatedRoot" || type === "currentFileTranslatedRoot"
    ? vscode.TreeItemCollapsibleState.Expanded
    : type.endsWith("Root")
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

super(label, collapsibleState);
```

**Step 5: Consider activation event**

Keep `onStartupFinished` for this phase if needed, because activation is now light. Do not change activation semantics and performance architecture in the same task.

**Step 6: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 6: Add Async Index Service Skeleton

**Files:**
- Create: `packages/easy-lang-vscode/src/indexService.ts`
- Create: `packages/easy-lang-vscode/src/__tests__/indexService.test.ts`

**Step 1: Write failing unit test for index aggregation**

Create `packages/easy-lang-vscode/src/__tests__/indexService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SourceIndex } from "../indexService";

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
});
```

**Step 2: Implement `SourceIndex`**

Create `indexService.ts`:

```ts
import * as vscode from "vscode";
import { KeyLocation, scanTextI18nKeys } from "./scanner";

export type IndexStatus = "idle" | "indexing" | "ready" | "cancelled" | "error";

export interface FileIndex {
  filePath: string;
  mtimeMs: number;
  size: number;
  locations: KeyLocation[];
}

export class SourceIndex {
  private files = new Map<string, FileIndex>();

  updateFile(filePath: string, locations: KeyLocation[], mtimeMs = 0, size = 0) {
    this.files.set(filePath, { filePath, locations, mtimeMs, size });
  }

  removeFile(filePath: string) {
    this.files.delete(filePath);
  }

  allLocations() {
    return Array.from(this.files.values()).flatMap((file) => file.locations);
  }

  clear() {
    this.files.clear();
  }
}
```

**Step 3: Run index service test**

Run:

```bash
pnpm --filter easy-lang-vscode test src/__tests__/indexService.test.ts
```

Expected: PASS.

**Step 4: Add `IndexService` shell**

In the same file, add:

```ts
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

  constructor(private options: IndexServiceOptions) {}

  getStatus() {
    return this.status;
  }

  cancel() {
    this.cancellation?.cancel();
  }
}
```

**Step 5: Run type check**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

---

### Task 7: Implement Cancellable Batched Global Indexing

**Files:**
- Modify: `packages/easy-lang-vscode/src/indexService.ts`
- Modify: `packages/easy-lang-vscode/src/scanner.ts`

**Step 1: Add scanner utilities**

In `scanner.ts`, export supported extension check:

```ts
export function isSupportedSourceFile(filePath: string) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
```

**Step 2: Implement async scan in `IndexService`**

Add imports:

```ts
import { stat } from "node:fs/promises";
import { isSupportedSourceFile } from "./scanner";
```

Add helper:

```ts
const DEFAULT_INCLUDE = "**/*.{js,jsx,ts,tsx,vue}";
const DEFAULT_EXCLUDE = "**/{node_modules,dist,build,.next,.nuxt,coverage,out,.git}/**";
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

function delayToNextTick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
```

Add method:

```ts
async rebuild(progress?: vscode.Progress<{ message?: string; increment?: number }>) {
  this.cancel();
  this.cancellation = new vscode.CancellationTokenSource();
  const token = this.cancellation.token;
  this.status = "indexing";
  this.index.clear();

  try {
    const files = await vscode.workspace.findFiles(
      this.options.includeGlob || DEFAULT_INCLUDE,
      this.options.excludeGlob || DEFAULT_EXCLUDE
    );

    let processed = 0;
    for (const file of files) {
      if (token.isCancellationRequested) {
        this.status = "cancelled";
        return;
      }

      if (!isSupportedSourceFile(file.fsPath)) continue;
      const fileStat = await stat(file.fsPath).catch(() => undefined);
      if (!fileStat || fileStat.size > (this.options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE)) continue;

      const bytes = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(bytes).toString("utf8");
      this.index.updateFile(file.fsPath, scanTextI18nKeys(text, file.fsPath), fileStat.mtimeMs, fileStat.size);

      processed++;
      if (processed % 25 === 0) {
        progress?.report({ message: `已扫描 ${processed}/${files.length}` });
        await delayToNextTick();
      }
    }

    this.status = "ready";
  } catch (error) {
    this.status = "error";
    throw error;
  }
}
```

**Step 3: Run type check**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

**Step 4: Manual cancellation check**

Add no UI yet. This task only verifies compilation. UI calls are next.

---

### Task 8: Wire Index Service into Sidebar Provider

**Files:**
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`
- Modify: `packages/easy-lang-vscode/src/extension.ts`

**Step 1: Add provider dependencies**

In `sidebarProvider.ts`, import:

```ts
import { IndexService } from "./indexService";
```

Add property:

```ts
private indexService: IndexService;
private globalIndexStatus = "未加载";
```

Initialize in constructor:

```ts
this.indexService = new IndexService({ workspaceRoot: this.workspaceRoot });
```

**Step 2: Change `refreshData` to background progress**

Replace full scan logic in `refreshData` with:

```ts
async refreshData() {
  await this.resolveTranslationPath();
  this.globalIndexStatus = "索引中";
  this._onDidChangeTreeData.fire();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Easy Lang 正在扫描项目 i18n key",
      cancellable: true,
    },
    async (progress, token) => {
      const cancelSubscription = token.onCancellationRequested(() => this.indexService.cancel());
      try {
        await this.indexService.rebuild(progress);
        await this.translationStore.load();
        const result = classifyKeyLocations(
          this.indexService.index.allLocations(),
          this.translationStore.snapshot()
        );
        this.untranslatedLocations = result.untranslated;
        this.translatedLocations = result.translated;
        this.globalIndexStatus = "已完成";
      } finally {
        cancelSubscription.dispose();
        this._onDidChangeTreeData.fire();
      }
    }
  );
}
```

Extract the config-reading part of current `refreshData()` into:

```ts
private async resolveTranslationPath() {
  let translationPath = "";
  const configPath = path.join(this.workspaceRoot, ".vscode", "easy-lang.json");
  if (fs.existsSync(configPath)) {
    try {
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      translationPath = configData.translationPath || "";
    } catch {
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
```

This still uses small sync reads for config. That is acceptable here because `.vscode/easy-lang.json` is tiny and command-triggered. Do not use it in hot editor-change paths.

**Step 3: Show global status in tree root**

Change root labels in `getChildren()`:

```ts
new I18nTreeItem(`未翻译（全局 ${this.untranslatedLocations.length}，${this.globalIndexStatus}）`, "untranslatedRoot"),
new I18nTreeItem(`已翻译（全局 ${this.translatedLocations.length}，${this.globalIndexStatus}）`, "translatedRoot"),
```

**Step 4: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 9: Add File Watcher Incremental Updates

**Files:**
- Modify: `packages/easy-lang-vscode/src/indexService.ts`
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`
- Modify: `packages/easy-lang-vscode/src/extension.ts`

**Step 1: Add single-file update method**

In `indexService.ts`, add:

```ts
async updateFile(uri: vscode.Uri) {
  if (!isSupportedSourceFile(uri.fsPath)) return;

  const fileStat = await stat(uri.fsPath).catch(() => undefined);
  if (!fileStat || fileStat.size > (this.options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE)) {
    this.index.removeFile(uri.fsPath);
    return;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(bytes).toString("utf8");
  this.index.updateFile(uri.fsPath, scanTextI18nKeys(text, uri.fsPath), fileStat.mtimeMs, fileStat.size);
}

removeFile(uri: vscode.Uri) {
  this.index.removeFile(uri.fsPath);
}
```

**Step 2: Add provider reclassification method**

In `sidebarProvider.ts`, add:

```ts
private async refreshGlobalClassification() {
  await this.translationStore.load();
  const result = classifyKeyLocations(
    this.indexService.index.allLocations(),
    this.translationStore.snapshot()
  );
  this.untranslatedLocations = result.untranslated;
  this.translatedLocations = result.translated;
  this._onDidChangeTreeData.fire();
}

async updateIndexedFile(uri: vscode.Uri) {
  await this.indexService.updateFile(uri);
  await this.refreshGlobalClassification();
}

async removeIndexedFile(uri: vscode.Uri) {
  this.indexService.removeFile(uri);
  await this.refreshGlobalClassification();
}
```

**Step 3: Register source watcher**

In `extension.ts`, after provider creation:

```ts
const sourceWatcher = vscode.workspace.createFileSystemWatcher("**/*.{js,jsx,ts,tsx,vue}");
context.subscriptions.push(
  sourceWatcher,
  sourceWatcher.onDidCreate((uri) => void sidebarProvider.updateIndexedFile(uri)),
  sourceWatcher.onDidChange((uri) => void sidebarProvider.updateIndexedFile(uri)),
  sourceWatcher.onDidDelete((uri) => void sidebarProvider.removeIndexedFile(uri))
);
```

**Step 4: Register translation watcher**

For this phase, refresh translation classification when any JSON in `locales` changes:

```ts
const translationWatcher = vscode.workspace.createFileSystemWatcher("**/locales/translation.json");
context.subscriptions.push(
  translationWatcher,
  translationWatcher.onDidChange(() => void sidebarProvider.refreshTranslationData()),
  translationWatcher.onDidCreate(() => void sidebarProvider.refreshTranslationData()),
  translationWatcher.onDidDelete(() => void sidebarProvider.refreshTranslationData())
);
```

Add provider method:

```ts
async refreshTranslationData() {
  await this.translationStore.load();
  await this.refreshGlobalClassification();
  await this.refreshCurrentFileData();
}
```

**Step 5: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 10: Prevent Large Tree Rendering Spikes

**Files:**
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`

**Step 1: Add page constants**

Add near top:

```ts
const TREE_PAGE_SIZE = 100;
```

Extend `I18nTreeItemType` with:

```ts
| "untranslatedPage"
| "translatedPage"
```

Add fields to `I18nTreeItem`:

```ts
pageStart?: number;
pageType?: "untranslated" | "translated";
```

**Step 2: Return pages for global roots**

Replace global root child generation with page nodes:

```ts
if (element.type === "untranslatedRoot") {
  return Promise.resolve(this.createPageItems("untranslated", this.untranslatedLocations.length));
}

if (element.type === "translatedRoot") {
  return Promise.resolve(this.createPageItems("translated", this.translatedLocations.length));
}
```

Add helper:

```ts
private createPageItems(pageType: "untranslated" | "translated", total: number) {
  const pages: I18nTreeItem[] = [];
  for (let start = 0; start < total; start += TREE_PAGE_SIZE) {
    const end = Math.min(start + TREE_PAGE_SIZE, total);
    const item = new I18nTreeItem(
      `${start + 1}-${end}`,
      pageType === "untranslated" ? "untranslatedPage" : "translatedPage"
    );
    item.pageStart = start;
    item.pageType = pageType;
    pages.push(item);
  }
  return pages;
}
```

**Step 3: Render only one page of key items**

Add in `getChildren()`:

```ts
if (element.type === "untranslatedPage" || element.type === "translatedPage") {
  const source = element.pageType === "untranslated"
    ? this.untranslatedLocations
    : this.translatedLocations;
  const start = element.pageStart || 0;
  return Promise.resolve(
    source.slice(start, start + TREE_PAGE_SIZE).map((location) => this.createLocationItem(location, element.pageType!))
  );
}
```

Extract repeated item creation:

```ts
private createLocationItem(location: KeyLocation, type: "untranslated" | "translated" | "currentFileUntranslated" | "currentFileTranslated") {
  const item = new I18nTreeItem(location.key, type, location.key);
  item.keyLocation = location;
  item.command = {
    command: "easy-lang.gotoLocation",
    title: "跳转到位置",
    arguments: [location],
  };
  return item;
}
```

Use this helper for current-file groups too.

**Step 4: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 11: Add Delayed Global Index Trigger

**Files:**
- Modify: `packages/easy-lang-vscode/src/extension.ts`

**Step 1: Start global index only when useful**

After tree view creation, register visibility trigger:

```ts
let hasStartedGlobalIndex = false;

treeView.onDidChangeVisibility((event) => {
  if (event.visible && !hasStartedGlobalIndex) {
    hasStartedGlobalIndex = true;
    void sidebarProvider.refresh();
  }
});
```

**Step 2: Optional idle trigger**

If product wants automatic global data without opening the sidebar, add a delayed idle trigger:

```ts
const idleIndexTimer = setTimeout(() => {
  if (!hasStartedGlobalIndex) {
    hasStartedGlobalIndex = true;
    void sidebarProvider.refresh();
  }
}, 15_000);

context.subscriptions.push({ dispose: () => clearTimeout(idleIndexTimer) });
```

If Windows stability remains the top priority, skip the idle trigger and rely on sidebar/command trigger only.

**Step 3: Ensure refresh command can always rebuild**

Keep `easy-lang.refresh` command as:

```ts
await sidebarProvider.refresh();
vscode.window.showInformationMessage("已刷新国际化数据");
```

**Step 4: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 12: Add Auto-Translate Concurrency Limit and Cancellation Hygiene

**Files:**
- Modify: `packages/easy-lang-vscode/src/sidebarProvider.ts`

**Step 1: Add small concurrency helper**

Add near top:

```ts
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}
```

**Step 2: Use indexed untranslated keys**

In `translateAll`, keep unique key collection but make source explicit:

```ts
const uniqueKeys = Array.from(
  new Set([
    ...this.untranslatedLocations.map((loc) => loc.key),
    ...this.currentFileUntranslatedLocations.map((loc) => loc.key),
  ])
);
```

**Step 3: Limit requests**

Replace nested sequential key loop with:

```ts
const failures: string[] = [];
let count = 0;

await runWithConcurrency(uniqueKeys, 3, async (key) => {
  if (token.isCancellationRequested) return;

  const entry: Record<string, string> = {};
  for (const lang of targetLangs) {
    if (token.isCancellationRequested) return;
    try {
      entry[lang] = await autoTranslate(key, { ...options, to: lang });
    } catch (error) {
      failures.push(`${key} -> ${lang}: ${error instanceof Error ? error.message : String(error)}`);
      entry[lang] = "";
    }
  }

  newEntries[key] = entry;
  count++;
  progress.report({ increment: 100 / uniqueKeys.length, message: `${count}/${uniqueKeys.length}` });
});
```

**Step 4: Show failure summary**

After writing translations:

```ts
if (failures.length > 0) {
  vscode.window.showWarningMessage(`部分翻译失败：${failures.length} 条，请查看 Extension Host 日志`);
  console.warn("Easy Lang translation failures", failures);
}
```

**Step 5: Run checks**

Run:

```bash
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

---

### Task 13: Clean Dist Layout and Package Entry

**Files:**
- Modify: `packages/easy-lang-vscode/package.json`
- Delete if safe: `packages/easy-lang-vscode/dist/src/*`

**Step 1: Verify compile output**

Run:

```bash
pnpm --filter easy-lang-vscode compile
```

Expected: `packages/easy-lang-vscode/dist/extension.js`, `scanner.js`, `sidebarProvider.js`, `indexService.js`, `translationStore.js` exist.

**Step 2: Confirm package entry**

Keep:

```json
"main": "./dist/extension.js"
```

Do not point to `dist/src/extension.js`.

**Step 3: Remove stale nested dist artifacts only after confirming they are not referenced**

Check references:

```bash
git grep "dist/src" -- packages/easy-lang-vscode package.json pnpm-workspace.yaml
```

Expected: no matches.

If no matches, delete stale nested build files:

```bash
rm -rf packages/easy-lang-vscode/dist/src
```

This is destructive. Only do it if the user approves deletion or it is part of an approved implementation session.

**Step 4: Run build**

Run:

```bash
pnpm --filter easy-lang-vscode compile
pnpm --filter easy-lang-vscode type-check
```

Expected: PASS.

---

### Task 14: Manual Performance Verification

**Files:**
- No source changes unless verification fails.

**Step 1: Build extension**

Run:

```bash
pnpm --filter easy-lang-vscode compile
```

Expected: PASS.

**Step 2: Launch Extension Development Host**

Use VS Code extension debugging or run the package in an Extension Development Host. If the user has a Windows reproduction machine, this must be verified there before claiming the Windows issue is fixed.

**Step 3: Verify startup**

Open a workspace with the extension installed.

Expected:
- No activation notification.
- No project scan starts immediately.
- Opening VS Code editor does not freeze.
- Extension Host log has no repeated synchronous scan output.

**Step 4: Verify current file**

Open a `.ts`, `.tsx`, `.vue`, `.js`, or `.jsx` file containing `$t('保存')`.

Expected:
- Current file section updates after editor change or edit debounce.
- No disk read is required for the source file; scan uses document text.
- Editing repeatedly only schedules one delayed refresh at a time.

**Step 5: Verify global index**

Open Easy Lang sidebar or run `Easy Lang: 刷新`.

Expected:
- Progress appears.
- Cancellation works.
- UI remains responsive during scan.
- Global roots show counts/status.
- Global lists render pages instead of thousands of children.

**Step 6: Verify incremental update**

Edit/save one source file and create/delete one source file.

Expected:
- Only that file’s index changes.
- Global counts update without a full rescan.

**Step 7: Verify translation changes**

Modify `locales/translation.json`.

Expected:
- Keys are reclassified as translated/untranslated without rescanning all source files.

---

### Task 15: Final Quality Gate

**Files:**
- No source changes unless checks fail.

**Step 1: Run all package checks**

Run:

```bash
pnpm --filter easy-lang-vscode test
pnpm --filter easy-lang-vscode type-check
pnpm --filter easy-lang-vscode compile
```

Expected: all PASS.

**Step 2: Run workspace checks if time allows**

Run:

```bash
pnpm type-check
pnpm build
```

Expected: PASS. If unrelated packages fail, capture exact failing package and reason.

**Step 3: Review changed files**

Run:

```bash
git status --short
git diff -- packages/easy-lang-vscode
```

Expected:
- No unrelated changes.
- No generated stale `dist/src` references.
- No synchronous source-file scanning in activation or editor-change hot paths.

**Step 4: Request code review**

Use `superpowers:requesting-code-review` before claiming the implementation is complete.

---

## Implementation Notes

- Do not add worker threads in the first pass. Batched async scanning and avoiding startup scans should fix the main freeze with less complexity.
- Do not scan files on every keystroke. Current file scanning should debounce and use document text only.
- Do not expand global translated/untranslated lists by default.
- Do not parse `translation.json` in the editor-change hot path unless its mtime changed.
- Do not claim the Windows freeze is fixed until it has been verified on Windows or the user accepts non-Windows verification as provisional.
