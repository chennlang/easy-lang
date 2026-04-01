# Easy Lang 现代化的国际化解决方案

Easy Lang 是一个低侵入性的、简单的、类型安全的多语言翻译工具。它本质上与框架无关，是一个纯 TypeScript 工具，可以在 Vue、React、Angular 等支持原生 JS/TS 的项目中使用。

## 特性

- 🎯 完整的 TypeScript 类型支持
- 🔄 支持扁平和模块化两种翻译模式
- 🌍 灵活的多语言切换
- 🔍 自动收集未翻译的文本
- 🎨 支持变量替换
- 📦 轻量无第三方依赖

## 安装

```bash
pnpm add easy-lang
# 或
npm install easy-lang
# 或
yarn add easy-lang
```

## 使用模式

Easy Lang 支持两种使用模式：扁平模式和模块化模式。你可以根据项目规模和需求选择合适的模式。

### 1. 扁平模式

适用于小型项目或翻译文件较少的场景。

```typescript
// 定义翻译文件
const translations = {
  '你好': {
    "zh-CN": "你好",
    "en-US": "Hello",
  },
  '再见': {
    "zh-CN": "再见",
    "en-US": "Goodbye",
  },
  '你好 {name}': {
    "zh-CN": "你好 {name}",
    "en-US": "Hello {name}",
  },
} as const;

// 创建翻译工具
const i18n = createI18nTool<typeof translations, "zh-CN" | "en-US">({
  defaultLang: "zh-CN",
  langs: ["zh-CN", "en-US"],
  translations,
  autoReload: false, // 切换语言时是否自动刷新页面
});

// 使用翻译
i18n.$t('你好');                    // => "你好"

// 变量翻译
i18n.$t('你好 {name}', { name: 'Ell' }); // => 你好 Ell
```

### 2. 模块化模式

适用于大型项目或需要按模块组织翻译的场景。

```typescript
// 定义模块化翻译文件
const translations = {
  default: {
    '你好': {
      "zh-CN": "你好",
      "en-US": "Hello",
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
  },
} as const;

// 创建翻译工具
const i18n = createI18nTool<typeof translations, "zh-CN" | "en-US">({
  defaultLang: "zh-CN",
  langs: ["zh-CN", "en-US"],
  translations,
});

// 方式一：直接使用带模块的翻译
i18n.$t('欢迎 {name}', { name: '张三', module: 'custom' }); // => "欢迎 张三"
i18n.$t('测试', { module: 'custom' });            // => "测试"

// 方式二：创建模块专用的翻译函数
const $t_custom = i18n.$module('custom');
$t_custom('测试');                                         // => "测试"
$t_custom('欢迎 {name}', { name: 'John' });      // => "欢迎 John"
```

## API 参考

### createI18nTool

创建翻译工具的核心方法，返回一个包含以下方法和属性的对象：

```typescript
interface I18nTool<T, L> {
  // 核心翻译方法
  $t: (text: string, contexts?: Record<string, any>, currentLang?: L) => string;
  
  // 创建模块专用翻译函数
  $module: <M extends keyof T>(module: M) => (text: string, contexts?: Record<string, any>, currentLang?: L) => string;
  
  // 切换语言
  changeLang: (lang: L) => void;

  // 更新运行时配置
  configure: (config: I18nConfigureProps<L>) => void;
  
  // 获取未翻译的文本列表
  untranslatedList: string[];
  
  // 支持的语言列表
  langs: L[];
  
  // 默认语言
  defaultLang: L;
  
  // 获取当前语言
  getCurrentLang: () => L;
}
```

### 配置选项

```typescript
interface I18nCreateProps<T, L> {
  // 默认语言
  defaultLang: L;
  
  // 支持的语言列表
  langs: L[];
  
  // 翻译对象
  translations: T;
  
  // 切换语言时是否自动刷新页面
  autoReload?: boolean;
  
  // 自定义 localstorage 存储的 key，默认值为 "lang"
  storageKey?: string;

  // 自定义语言存储策略，不传时默认使用 localStorage
  storage?: I18nStorage<L>;
}

interface I18nStorage<L> {
  getLang: (context: {
    defaultLang: L;
    langs: L[];
    storageKey: string;
  }) => L | null | undefined;
  setLang?: (
    lang: L,
    context: {
      defaultLang: L;
      langs: L[];
      storageKey: string;
    }
  ) => void;
}

interface I18nConfigureProps<L> {
  defaultLang?: L;
  autoReload?: boolean;
  storageKey?: string;
  storage?: I18nStorage<L>;
}
```

## 高级特性

### 1. 自动收集未翻译文本

Easy Lang 会自动收集未翻译的文本，你可以通过 `untranslatedList` 获取：

```typescript
console.log(i18n.untranslatedList); // 显示所有未翻译的文本列表
```

### 2. 语言切换与持久化

Easy Lang 默认会将当前语言保存在 localStorage 中，key 为 `lang`：

```typescript
// 切换语言（会自动保存到 localStorage）
i18n.changeLang("en-US");

// 获取当前语言
const currentLang = i18n.getCurrentLang(); // 优先从 localStorage 读取
```

### 3. 自定义语言存储策略

可以通过 `storage` 自定义语言读取和写入逻辑：

```typescript
const i18n = createI18nTool({
  defaultLang: "zh-CN",
  langs: ["zh-CN", "en-US"],
  translations,
  storage: {
    getLang({ defaultLang, langs, storageKey }) {
      const isValidLang = (lang?: string | null): lang is "zh-CN" | "en-US" =>
        !!lang && langs.includes(lang as "zh-CN" | "en-US");

      const urlLang = new URLSearchParams(location.search).get("lang");
      const storageLang = localStorage.getItem(storageKey);

      if (window.self !== window.top) {
        return isValidLang(urlLang)
          ? urlLang
          : isValidLang(storageLang)
            ? storageLang
            : defaultLang;
      }

      return isValidLang(storageLang) ? storageLang : defaultLang;
    },
    setLang(lang, { storageKey }) {
      localStorage.setItem(storageKey, lang);
    },
  },
});
```

### 4. 运行时更新配置

如果语言策略需要在实例创建后再注入，可以通过 `configure` 更新运行时配置：

```typescript
i18n.configure({
  autoReload: false,
  storageKey: "tenant-lang",
  defaultLang: "en-US",
  storage: {
    getLang() {
      return "en-US";
    },
    setLang(lang) {
      console.log("set lang", lang);
    },
  },
});
```

### 5. 自动页面刷新

可以配置在切换语言时自动刷新页面：

```typescript
const i18n = createI18nTool({
  // ...其他配置
  autoReload: true, // 切换语言时自动刷新页面
});
```

## 许可证

MIT
