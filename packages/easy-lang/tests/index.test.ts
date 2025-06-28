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
const testTranslations = {
    default: {
        hello: {
            "zh-CN": "你好",
            "en-US": "Hello",
        },
        goodbye: {
            "zh-CN": "再见",
            "en-US": "Goodbye",
        },
    },
    custom: {
        welcome: {
            "zh-CN": "欢迎 {name}",
            "en-US": "Welcome {name}",
        },
        test: {
            "zh-CN": "测试",
            "en-US": "Test",
        },
    },
};

type TestLangs = "zh-CN" | "en-US";

describe("I18n Tool 核心功能测试", () => {
    let i18nTool: any;

    beforeEach(() => {
        global.localStorage.clear();
        i18nTool = createI18nTool({
            defaultLang: "zh-CN" as TestLangs,
            langs: ["zh-CN", "en-US"] as TestLangs[],
            translations: testTranslations,
            autoReload: false,
        });
    });

    describe("基础配置测试", () => {
        test("应该返回正确的默认语言", () => {
            expect(i18nTool.defaultLang).toBe("zh-CN");
        });

        test("应该返回正确的语言列表", () => {
            expect(i18nTool.langs).toEqual(["zh-CN", "en-US"]);
        });

        test("应该返回当前语言", () => {
            expect(i18nTool.getCurrentLang()).toBe("zh-CN");
        });
    });

    describe("翻译功能测试", () => {
        test("应该翻译默认模块的文本", () => {
            const result = i18nTool.$t("hello");
            expect(result).toBe("你好");
        });

        test("应该翻译自定义模块的文本", () => {
            const result = i18nTool.$t("welcome", { module: "custom" });
            expect(result).toBe("欢迎 {name}");
        });

        test("应该根据指定语言翻译", () => {
            const zhResult = i18nTool.$t("hello", {}, "zh-CN");
            const enResult = i18nTool.$t("hello", {}, "en-US");

            expect(zhResult).toBe("你好");
            expect(enResult).toBe("Hello");
        });

        test("应该处理不存在的翻译键", () => {
            const result = i18nTool.$t("nonexistent");
            expect(result).toBe("nonexistent");
        });

        test("应该追踪未翻译的文本", () => {
            const initialCount = i18nTool.untranslatedList.length;
            i18nTool.$t("missing1");
            i18nTool.$t("missing2");
            i18nTool.$t("missing1"); // 重复不应增加

            expect(i18nTool.untranslatedList.length).toBe(initialCount + 2);
            expect(i18nTool.untranslatedList).toContain("missing1");
            expect(i18nTool.untranslatedList).toContain("missing2");
        });
    });

    describe("变量替换测试", () => {
        test("应该正确替换变量", () => {
            const result = i18nTool.$t("welcome", {
                module: "custom",
                name: "张三",
            });
            expect(result).toBe("欢迎 张三");
        });

        test("应该在不同语言中替换变量", () => {
            const zhResult = i18nTool.$t(
                "welcome",
                {
                    module: "custom",
                    name: "张三",
                },
                "zh-CN"
            );

            const enResult = i18nTool.$t(
                "welcome",
                {
                    module: "custom",
                    name: "John",
                },
                "en-US"
            );

            expect(zhResult).toBe("欢迎 张三");
            expect(enResult).toBe("Welcome John");
        });

        test("应该保留未提供的变量", () => {
            const result = i18nTool.$t("welcome", { module: "custom" });
            expect(result).toBe("欢迎 {name}");
        });
    });

    describe("语言切换测试", () => {
        test("应该正确切换语言", () => {
            i18nTool.changeLang("en-US");
            expect(global.localStorage.getItem("lang")).toBe("en-US");
            expect(i18nTool.getCurrentLang()).toBe("en-US");
        });

        test("切换语言后应使用新语言翻译", () => {
            i18nTool.changeLang("en-US");
            const result = i18nTool.$t("hello");
            expect(result).toBe("Hello");
        });

        test("在非浏览器环境应返回默认语言", () => {
            const originalWindow = global.window;
            delete (global as any).window;

            const newTool = createI18nTool({
                defaultLang: "zh-CN" as TestLangs,
                langs: ["zh-CN", "en-US"] as TestLangs[],
                translations: testTranslations,
            });

            expect(newTool.getCurrentLang()).toBe("zh-CN");
            (global as any).window = originalWindow;
        });
    });

    describe("模块化支持测试", () => {
        test("应该支持默认模块", () => {
            const result = i18nTool.$t("hello");
            expect(result).toBe("你好");
        });

        test("应该支持自定义模块", () => {
            const result = i18nTool.$t("test", { module: "custom" });
            expect(result).toBe("测试");
        });

        test("不存在的模块应返回原文", () => {
            const result = i18nTool.$t("hello", { module: "nonexistent" });
            expect(result).toBe("hello");
        });
    });

    describe("边界条件测试", () => {
        test("应该处理空上下文", () => {
            const result = i18nTool.$t("hello", {});
            expect(result).toBe("你好");
        });

        test("应该处理undefined上下文", () => {
            const result = i18nTool.$t("hello", undefined);
            expect(result).toBe("你好");
        });

        test("应该处理无效语言", () => {
            const result = i18nTool.$t("hello", {}, "invalid-lang");
            expect(result).toBe("hello"); // 找不到翻译应返回原文
        });
    });

    describe("自动重载功能测试", () => {
        test("默认应启用自动重载", () => {
            const tool = createI18nTool({
                defaultLang: "zh-CN" as TestLangs,
                langs: ["zh-CN", "en-US"] as TestLangs[],
                translations: testTranslations,
            });

            tool.changeLang("en-US");
            expect(global.location.reload).toHaveBeenCalled();
        });

        test("可以禁用自动重载", () => {
            vi.clearAllMocks();
            const tool = createI18nTool({
                defaultLang: "zh-CN" as TestLangs,
                langs: ["zh-CN", "en-US"] as TestLangs[],
                translations: testTranslations,
                autoReload: false,
            });

            tool.changeLang("en-US");
            expect(global.location.reload).not.toHaveBeenCalled();
        });
    });
});
