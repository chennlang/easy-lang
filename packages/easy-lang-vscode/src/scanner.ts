import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// 支持的文件后缀
const FILE_GLOB = "**/*.{js,jsx,ts,tsx,vue}";
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue"]);

// 默认忽略的文件夹
const DEFAULT_IGNORES = ["dist", "node_modules", ".next", ".nuxt"];

// 匹配 $t('xxx') 或 $("xxx")
const I18N_REGEX = /\$t\s*\(\s*(['\"])((?:\\\1|.)*?)\1\s*[,)\)]/g;

/**
 * Key 位置信息
 */
export interface KeyLocation {
    key: string;
    filePath: string;
    line: number;
    character: number;
}

/**
 * 判断文件是否在忽略目录下
 */
function isIgnored(filePath: string, workspaceRoot: string): boolean {
    const rel = path.relative(workspaceRoot, filePath);
    return DEFAULT_IGNORES.some(
        (dir) => rel === dir || rel.startsWith(dir + path.sep)
    );
}

export function isSupportedSourceFile(filePath: string) {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * 扫描文本内容，返回所有 $t key 及其位置
 */
export function scanTextI18nKeys(text: string, filePath: string): KeyLocation[] {
    const keyLocations: KeyLocation[] = [];
    const newlineIndexes: number[] = [];

    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") {
            newlineIndexes.push(i);
        }
    }

    function getPosition(index: number): { line: number; character: number } {
        let low = 0;
        let high = newlineIndexes.length;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (newlineIndexes[mid] < index) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        const line = low;
        const lineStart = line === 0 ? 0 : newlineIndexes[line - 1] + 1;
        return { line, character: index - lineStart };
    }

    let match;
    I18N_REGEX.lastIndex = 0;
    while ((match = I18N_REGEX.exec(text))) {
        const key = match[2];
        const { line, character } = getPosition(match.index);

        keyLocations.push({
            key,
            filePath,
            line,
            character,
        });
    }
    I18N_REGEX.lastIndex = 0;

    return keyLocations;
}

/**
 * 扫描单个文件，返回该文件中所有 $t key 及其位置
 */
export function scanSingleFileI18nKeys(filePath: string): KeyLocation[] {
    const keyLocations: KeyLocation[] = [];

    // 检查文件是否存在且是支持的文件类型
    if (!fs.existsSync(filePath)) {
        return keyLocations;
    }

    if (!isSupportedSourceFile(filePath)) {
        return keyLocations;
    }

    try {
        return scanTextI18nKeys(fs.readFileSync(filePath, "utf8"), filePath);
    } catch (error) {
        console.error(`Error scanning file ${filePath}:`, error);
    }

    return keyLocations;
}

/**
 * 扫描项目文件，返回所有 $t key 及其位置
 */
export async function scanI18nKeysWithLocation(
    workspaceRoot: string
): Promise<KeyLocation[]> {
    const files = await vscode.workspace.findFiles(FILE_GLOB);
    const keyLocations: KeyLocation[] = [];

    for (const file of files) {
        if (isIgnored(file.fsPath, workspaceRoot)) continue;
        const fileKeyLocations = scanSingleFileI18nKeys(file.fsPath);
        keyLocations.push(...fileKeyLocations);
    }
    return keyLocations;
}

/**
 * 扫描项目文件，返回所有 $t key（兼容性函数）
 */
export async function scanI18nKeys(workspaceRoot: string): Promise<string[]> {
    const keyLocations = await scanI18nKeysWithLocation(workspaceRoot);
    const keys = new Set<string>();
    keyLocations.forEach((loc) => keys.add(loc.key));
    return Array.from(keys);
}

/**
 * 读取 translation.json，返回所有已翻译 key
 */
export function readTranslatedKeys(translationPath: string): Set<string> {
    if (!fs.existsSync(translationPath)) return new Set();
    const json = JSON.parse(fs.readFileSync(translationPath, "utf8"));
    return new Set(Object.keys(json));
}

export function classifyKeyLocations(
    allKeyLocations: KeyLocation[],
    translatedKeys: Set<string>
): { untranslated: KeyLocation[]; translated: KeyLocation[] } {
    const untranslated: KeyLocation[] = [];
    const translated: KeyLocation[] = [];

    for (const keyLocation of allKeyLocations) {
        if (translatedKeys.has(keyLocation.key)) {
            translated.push(keyLocation);
        } else {
            untranslated.push(keyLocation);
        }
    }

    return { untranslated, translated };
}

/**
 * 获取未翻译和已翻译 key 列表及其位置
 */
export async function getI18nKeyStatusWithLocation(
    workspaceRoot: string,
    translationPath: string
) {
    const allKeyLocations = await scanI18nKeysWithLocation(workspaceRoot);
    const translatedKeys = readTranslatedKeys(translationPath);
    return classifyKeyLocations(allKeyLocations, translatedKeys);
}

/**
 * 获取单个文件的未翻译和已翻译 key 列表及其位置
 */
export function getSingleFileI18nKeyStatus(
    filePath: string,
    translationPath: string
) {
    const allKeyLocations = scanSingleFileI18nKeys(filePath);
    const translatedKeys = readTranslatedKeys(translationPath);
    return classifyKeyLocations(allKeyLocations, translatedKeys);
}

/**
 * 获取未翻译和已翻译 key 列表（兼容性函数）
 */
export async function getI18nKeyStatus(
    workspaceRoot: string,
    translationPath: string
) {
    const allKeys = await scanI18nKeys(workspaceRoot);
    const translatedKeys = readTranslatedKeys(translationPath);
    const untranslated: string[] = [];
    const translated: string[] = [];
    for (const key of allKeys) {
        if (translatedKeys.has(key)) {
            translated.push(key);
        } else {
            untranslated.push(key);
        }
    }
    return { untranslated, translated };
}

/**
 * 批量追加翻译内容到 translation.json
 * @param translationPath 文件路径
 * @param newEntries 新增内容 { key: { lang: value, ... } }
 */
export function appendTranslations(
    translationPath: string,
    newEntries: Record<string, any>
) {
    let json = {};
    if (fs.existsSync(translationPath)) {
        json = JSON.parse(fs.readFileSync(translationPath, "utf8"));
    }
    Object.assign(json, newEntries);
    fs.writeFileSync(translationPath, JSON.stringify(json, null, 2), "utf8");
}
