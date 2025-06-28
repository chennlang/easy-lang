import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useCallback, useEffect, useState } from "react";
import { createI18nTool } from "easy-lang";

type LangStoreProps = {
    currentLang?: string | undefined;
    changeLang: (s: string) => void;
};

// 状态管理
export const useLangStore = create<LangStoreProps>()(
    persist(
        (set) => ({
            currentLang: undefined,
            changeLang: (lang: string) => {
                set((state) => ({ currentLang: lang }));
            },
        }),
        {
            name: "lang-storage",
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// 创建react翻译工具
export function createReactI18nTool<
    T extends Record<string, Record<string, Record<string, string>>>,
    L extends string
>(i18n: ReturnType<typeof createI18nTool<T, L>>) {
    const {
        $t: _$t,
        changeLang: _changeLang,
        getCurrentLang,
        untranslatedList,
        langs,
        defaultLang,
    } = i18n;

    type Lang = (typeof langs)[number];
    // 生成新的
    const memoizedT = (currentLang: Lang) =>
        useCallback(() => {
            return function (...args: Parameters<typeof _$t>) {
                return _$t(args[0], args[1], currentLang);
            };
        }, [currentLang]);

    function useTranslate() {
        const { currentLang = defaultLang } = useLangStore();
        const memoGetT = memoizedT(currentLang as Lang);
        // 获取翻译函数
        const getT = () => memoGetT;
        // 生成新的，触发渲染
        const [$t, setT] = useState<typeof _$t>(getT());

        function changeLang(lang: Lang) {
            useLangStore.getState().changeLang(lang);
            _changeLang(lang);
        }

        useEffect(() => {
            setT(getT());
        }, [currentLang]);

        return {
            $t,
            langs,
            currentLang,
            changeLang,
        };
    }

    return {
        langs,
        untranslatedList,
        getCurrentLang,
        $t: _$t,
        changeLang: _changeLang,
        useTranslate,
    };
}
