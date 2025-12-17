export interface I18nCreateProps<T, L> {
    defaultLang: L;
    langs: L[];
    translations: T;
    // 改变语言自动更新页面
    autoReload?: boolean;
}

// 基础类型定义
export type FlatTranslations = Record<string, Record<string, string>>;
export type ModuleTranslations = Record<string, FlatTranslations>;

// 配置类型
export type I18nBaseConfig = {
    [key: string]: any;
};

// 重载的函数类型
export interface I18nFnType<MT extends ModuleTranslations, L extends string> {
    // 不带 module 参数的调用，只能使用 default 模块的 key
    (text: keyof MT['default'], contexts?: Record<string, any>, currentLang?: L): string;
    
    // 带 module 参数的调用，只能使用指定模块的 key
    <M extends keyof MT>(
        text: keyof MT[M],
        contexts: Record<string, any> & { module: M },
        currentLang?: L
    ): string;
}

// 类型守卫函数，用于判断是否为模块化翻译对象
function isModuleTranslations(translations: any): translations is ModuleTranslations {
    if (!translations || typeof translations !== 'object') return false;
    
    // 检查每个模块是否符合 FlatTranslations 类型
    return Object.values(translations).every(module => {
        if (!module || typeof module !== 'object') return false;
        
        // 检查每个翻译项是否符合 Record<string, string> 类型
        return Object.values(module).every(item => {
            if (!item || typeof item !== 'object') return false;
            return Object.values(item).every(text => typeof text === 'string');
        });
    });
}

// 创建翻译工具
// 条件类型：如果 T 是 FlatTranslations 则转换为 { default: T }，否则保持不变
type ToModuleType<T> = T extends FlatTranslations 
    ? { default: T } 
    : T extends ModuleTranslations 
        ? T 
        : never;

// 模块化翻译函数类型
export type ModuleI18nFnType<MT extends ModuleTranslations, L extends string, M extends keyof MT> = {
    (text: keyof MT[M], contexts?: Record<string, any>, currentLang?: L): string;
}

export function createI18nTool<
    T extends FlatTranslations | ModuleTranslations,
    L extends string,
    MT extends ToModuleType<T> = ToModuleType<T>
>(
    options: I18nCreateProps<T, L>
): {
    $t: I18nFnType<MT, L>;
    $module: <M extends keyof MT>(module: M) => ModuleI18nFnType<MT, L, M>;
    changeLang: (lang: L) => void;
    untranslatedList: string[];
    langs: L[];
    defaultLang: L;
    getCurrentLang: () => L;
} {
    let targetTranslations: ModuleTranslations
    const { defaultLang, langs, translations, autoReload = true } = options;

    const untranslatedList: string[] = [];

    // 如果翻译对象是模块化翻译对象，则转换为模块化翻译对象
    if (!isModuleTranslations(translations)) {
        targetTranslations = {
            default: translations,
        };
    } else {
        targetTranslations = translations
    }

    // 获取当前语言
    function getCurrentLang() {
        if (typeof window !== "undefined") {
            return (localStorage.getItem("lang") as L) || defaultLang;
        } else {
            return defaultLang;
        }
    }

    // 翻译
    const _$t = function(text: string, contexts: Record<string, any> = {}, setLang?: L): string {
        const lang = setLang || getCurrentLang();
        const moduleKey = contexts?.module || "default";

        const translatedText =
            targetTranslations?.[moduleKey]?.[text as string]?.[lang];

        // 没有找到翻译
        if (!translatedText) {
            if (!untranslatedList.includes(text as string))
                untranslatedList.push(text as string);
            // console.info(`ui18n[${lang}]: [${text}] undefined`)
            return text as string;
        }

        // 替换变量
        return translatedText.replace(/\{([^}]+)\}/g, (_: string, p1: string) => {
            return contexts[p1];
        });
    };

    function changeLang(lang: L) {
        if (typeof window !== "undefined") {
            localStorage.setItem("lang", lang);
        }
        autoReload && location.reload();
    }

    // 创建指定模块的翻译函数
    function $module<M extends keyof MT>(module: M): ModuleI18nFnType<MT, L, M> {
        return ((text: keyof MT[M], contexts: Record<string, any> = {}, currentLang?: L) => {
            return _$t(text as string, { ...contexts, module }, currentLang);
        }) as ModuleI18nFnType<MT, L, M>;
    }

    return {
        langs,
        untranslatedList,
        defaultLang,
        getCurrentLang,
        $t: _$t as I18nFnType<MT, L>,
        $module,
        changeLang,
    };
}