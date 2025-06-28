export interface I18nCreateProps<T, L> {
    defaultLang: L;
    langs: L[];
    translations: T;
    // 改变语言自动更新页面
    autoReload?: boolean;
}

export interface I18nConfig<T> {
    [key: string]: any;
    module?: keyof T;
}

export type I18nFnType<T, L> = (
    text: {
        [K in keyof T]: keyof T[K];
    }[keyof T],
    contexts?: I18nConfig<T>,
    currentLang?: L
) => string;

// 创建翻译工具
export function createI18nTool<
    T extends Record<string, Record<string, Record<string, string>>>,
    L extends string
>(
    options: I18nCreateProps<T, L>
): {
    $t: I18nFnType<T, L>;
    changeLang: (lang: L) => void;
    untranslatedList: string[];
    langs: L[];
    defaultLang: L;
    getCurrentLang: () => L;
} {
    const { defaultLang, langs, translations, autoReload = true } = options;

    const untranslatedList: string[] = [];

    // 获取当前语言
    function getCurrentLang() {
        if (typeof window !== "undefined") {
            return (localStorage.getItem("lang") as L) || defaultLang;
        } else {
            return defaultLang;
        }
    }

    // 翻译
    const _$t: I18nFnType<T, L> = (text, contexts = {}, setLang) => {
        const lang = setLang || getCurrentLang();

        const translatedText =
            translations?.[contexts?.module || "default"]?.[text]?.[lang];

        // 没有找到翻译
        if (!translatedText) {
            if (!untranslatedList.includes(text as string))
                untranslatedList.push(text as string);
            // console.info(`ui18n[${lang}]: [${text}] undefined`)
            return text as string;
        }

        // 替换变量
        return translatedText.replace(/\{([^}]+)\}/g, (_, p1: string) => {
            return contexts[p1];
        });
    };

    // 切换语言
    function changeLang(lang: L) {
        if (typeof window !== "undefined") {
            localStorage.setItem("lang", lang);
        }
        autoReload && location.reload();
    }

    return {
        langs,
        untranslatedList,
        defaultLang,
        getCurrentLang,
        $t: _$t,
        changeLang,
    };
}
