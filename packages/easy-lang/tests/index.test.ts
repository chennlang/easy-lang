import { createI18nTool } from "../src/index";
import { beforeAll, test, expect, describe, beforeEach, vi } from "vitest";

beforeAll(() => {
    // mock localStorage
    global.localStorage = {
        store: {} as Record<string, string>,
        getItem(key: string) {
            return this.store[key] || null;
        },
        setItem(key: string, value: string) {
            this.store[key] = value;
        },
        removeItem(key: string) {
            delete this.store[key];
        },
        clear() {
            this.store = {};
        },
    } as any;

    // mock location.reload
    global.location = {
        reload: vi.fn(),
    } as any;
});

// 简化的测试翻译数据
const testFlatTranslations = {
    '你好': {
        "zh-CN": "你好",
        "en-US": "Hello",
    },
    '再见': {
        "zh-CN": "再见",
        "en-US": "Goodbye",
    },
 
} as const;

// 简化的测试翻译数据
const testModuleTranslations = {
    default: {
        '你好': {
            "zh-CN": "你好",
            "en-US": "Hello",
        },
        '再见': {
            "zh-CN": "再见",
            "en-US": "Goodbye",
        },
    },
    custom: {
        '欢迎 {name}': {
            "zh-CN": "欢迎 {name}",
            "en-US": "Welcome {name}",
        },
        '测试': {
            "zh-CN": "测试",
            "en-US": "Test",
        },
        '欢迎 {name1}': {
            "zh-CN": "欢迎 {name1}",
            "en-US": "Welcome {name1}",
        },
    },
} as const;

type TestLangs = "zh-CN" | "en-US";

describe("I18n Tool 核心功能测试", () => {
    let i18nToolFlat: ReturnType<typeof createI18nTool<typeof testFlatTranslations, TestLangs>>;
    let i18nToolModule: ReturnType<typeof createI18nTool<typeof testModuleTranslations, TestLangs>>;

    beforeEach(() => {
        localStorage.clear();
        i18nToolFlat = createI18nTool<typeof testFlatTranslations, TestLangs>({
            defaultLang: "zh-CN",
            langs: ["zh-CN", "en-US"],
            translations: testFlatTranslations,
            autoReload: false,
        });

        i18nToolModule = createI18nTool<typeof testModuleTranslations, TestLangs>({
            defaultLang: "zh-CN",
            langs: ["zh-CN", "en-US"],
            translations: testModuleTranslations,
            autoReload: false,
        });
    });

    describe("基础翻译功能", () => {
        test("扁平模式 - 默认语言翻译", () => {
            expect(i18nToolFlat.$t("你好")).toBe("你好");
            expect(i18nToolFlat.$t("再见")).toBe("再见");
        });

        test("扁平模式 - 英文翻译", () => {
            expect(i18nToolFlat.$t("你好", {}, "en-US")).toBe("Hello");
            expect(i18nToolFlat.$t("再见", {}, "en-US")).toBe("Goodbye");
        });

        test("模块化模式 - default模块翻译", () => {
            expect(i18nToolModule.$t("你好")).toBe("你好");
            expect(i18nToolModule.$t("再见")).toBe("再见");
        });

        test("模块化模式 - custom模块翻译", () => {
            expect(i18nToolModule.$t("测试", { module: "custom" })).toBe("测试");
            expect(i18nToolModule.$t("测试", { module: "custom" }, "en-US")).toBe("Test");
        });

        test("模块化模式 - $module方法使用", () => {
            const $t_custom = i18nToolModule.$module("custom");
            expect($t_custom("测试")).toBe("测试");
            expect($t_custom("测试", {}, "en-US")).toBe("Test");
        });
    });

    describe("变量替换功能", () => {
        test("模块化模式 - 变量替换", () => {
            expect(i18nToolModule.$t("欢迎 {name}", { name: "张三", module: "custom" })).toBe("欢迎 张三");
            expect(i18nToolModule.$t("欢迎 {name}", { name: "John", module: "custom" }, "en-US")).toBe("Welcome John");
            // 未定义的原样返回
            expect(i18nToolModule.$t("欢迎 {name1}", { module: "custom" }, "en-US")).toBe("Welcome {name1}");
        });
    });

    describe("语言切换功能", () => {
        test("切换语言并验证localStorage", () => {
            i18nToolFlat.changeLang("en-US");
            expect(localStorage.getItem("lang")).toBe("en-US");
            expect(i18nToolFlat.getCurrentLang()).toBe("en-US");
        });

        test("切换语言时自动刷新页面", () => {
            const i18nToolWithReload = createI18nTool<typeof testFlatTranslations, TestLangs>({
                defaultLang: "zh-CN",
                langs: ["zh-CN", "en-US"],
                translations: testFlatTranslations,
                autoReload: true,
            });
            i18nToolWithReload.changeLang("en-US");
            expect(location.reload).toHaveBeenCalled();
        });
    });

    describe("未翻译文本处理", () => {
        test("处理未翻译的文本", () => {
            const notExistKey = "不存在的键";
            expect(i18nToolFlat.$t(notExistKey as any)).toBe(notExistKey);
            expect(i18nToolFlat.untranslatedList).toContain(notExistKey);
        });
    });

    describe("工具基础属性", () => {
        test("验证基础属性", () => {
            expect(i18nToolFlat.langs).toEqual(["zh-CN", "en-US"]);
            expect(i18nToolFlat.defaultLang).toBe("zh-CN");
            expect(i18nToolFlat.getCurrentLang()).toBe("zh-CN");
        });
    });
});
