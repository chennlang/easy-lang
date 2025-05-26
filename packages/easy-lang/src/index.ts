interface I18nManagerProps<T, L> {
    defaultLang: L;
    langs: L[];
    translations: T;
    // 改变语言自动更新页面
    autoReload?: boolean;
  }
  
  // 创建翻译工具
  export function createI18nTool<T extends Record<string, Record<string, string>>, L extends string>(options: I18nManagerProps<T, L>): {
      $t: (text: keyof T, params?: Record<string, any>, currentLang?: L) => string;
      changeLang: (lang: L) => void;
      untranslatedList: string[];
      langs: L[];
      defaultLang: L;
      getCurrentLang: () => L,
  } {
      const { defaultLang, langs, translations, autoReload = true } = options;
  
      const untranslatedList: string[] = [];
  
      function getCurrentLang() {
          if (typeof window !== 'undefined') {
              return localStorage.getItem('lang') as L || defaultLang
          } else {
            return defaultLang
          }
      }
  
      function _$t (text: keyof T, params: Record<string, any> = {}, setLang?: L): string {
          const lang = setLang || getCurrentLang()
          
          const translatedText = translations?.[text]?.[lang]
      
          // 没有找到翻译
          if (!translatedText) {
              if (!untranslatedList.includes(text as string)) untranslatedList.push(text as string)
              // console.info(`ui18n[${lang}]: [${text}] undefined`)
              // 添加到window对象中，方便排查
              // @ts-ignore
              // window.untranslatedList = Array.from(new Set(untranslatedList))
              return text as string
          }
      
          // 替换变量
          return translatedText.replace(/\{([^}]+)\}/g, (_, p1: string) => {
              return params[p1]
          })
      }
  
      function changeLang(lang: L) {
          if (typeof window !== 'undefined') {
              localStorage.setItem('lang', lang)
          }
          autoReload && location.reload()
      }
  
      return {
          langs,
          untranslatedList,
          defaultLang,
          getCurrentLang,
          $t: _$t,
          changeLang,
      }
  }
  