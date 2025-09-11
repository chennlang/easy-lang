import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// 支持的文件后缀
const FILE_GLOB = "**/*.{js,jsx,ts,tsx,vue}";

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

/**
 * 扫描单个文件，返回该文件中所有 $t key 及其位置
 */
export function scanSingleFileI18nKeys(filePath: string): KeyLocation[] {
    const keyLocations: KeyLocation[] = [];

    // 检查文件是否存在且是支持的文件类型
    if (!fs.existsSync(filePath)) {
        return keyLocations;
    }

    const ext = path.extname(filePath).toLowerCase();
    const supportedExts = [".js", ".jsx", ".ts", ".tsx", ".vue"];
    if (!supportedExts.includes(ext)) {
        return keyLocations;
    }

    try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        let match;
        I18N_REGEX.lastIndex = 0; // 重置正则状态
        while ((match = I18N_REGEX.exec(content))) {
            const key = match[2];
            const matchIndex = match.index;

            // 计算行号和列号
            let line = 0;
            let character = 0;
            let currentIndex = 0;

            for (let i = 0; i < lines.length; i++) {
                if (currentIndex + lines[i].length >= matchIndex) {
                    line = i;
                    character = matchIndex - currentIndex;
                    break;
                }
                currentIndex += lines[i].length + 1; // +1 for newline
            }

            keyLocations.push({
                key,
                filePath,
                line,
                character,
            });
        }
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

/**
 * 获取未翻译和已翻译 key 列表及其位置
 */
export async function getI18nKeyStatusWithLocation(
    workspaceRoot: string,
    translationPath: string
) {
    const allKeyLocations = await scanI18nKeysWithLocation(workspaceRoot);
    const translatedKeys = readTranslatedKeys(translationPath);
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
 * 获取单个文件的未翻译和已翻译 key 列表及其位置
 */
export function getSingleFileI18nKeyStatus(
    filePath: string,
    translationPath: string
) {
    console.log("filePath", filePath);
    console.log("translationPath", translationPath);
    const allKeyLocations = scanSingleFileI18nKeys(filePath);
    const translatedKeys = readTranslatedKeys(translationPath);
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
