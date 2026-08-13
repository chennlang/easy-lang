# Easy-Lang

一个易用、低侵入的多语言翻译工具，支持原生和 React 项目，适合中大型前端项目的国际化需求。

## 特性

- 简单易用，API 友好
- 支持多语言切换
- 支持 React 项目无缝集成
- 自动收集未翻译的 key，便于补全
- 支持变量替换
- 支持多模块翻译，按功能模块拆分翻译文件
- 支持运行时动态配置（configure）与自定义存储
- 轻量无第三方依赖（React 集成需 `zustand`）

## 安装

```bash
pnpm add easy-lang
# 或
npm install easy-lang
# 或
yarn add easy-lang
```

## AI/Codex Skill

复制给 AI 自动安装本仓库的 Codex skill：

- 应用接入 easy-lang 国际化：`请安装 GitHub 仓库 chennlang/easy-lang 中的 Codex skill，路径为 skills/easy-lang-app-i18n，安装后使用 $easy-lang-app-i18n 帮我在应用中接入 easy-lang 国际化。`
- 配置 easy-lang-vscode 插件：`请安装 GitHub 仓库 chennlang/easy-lang 中的 Codex skill，路径为 skills/easy-lang-vscode-config，安装后使用 $easy-lang-vscode-config 帮我生成 easy-lang-vscode 插件所需的配置文件（.vscode/easy-lang.json、easyCode 设置、locales/translation.json）。`

## VSCode 插件（可选）

可选安装，配合 easy-lang 使用。安装后可在 VSCode 侧边栏自动收集和管理国际化文本，并一键调用 **Google 免费翻译** 或 **自定义大模型接口** 自动翻译。

1. 下载插件包：`packages/easy-lang-vscode/easy-lang-vscode-0.0.5.vsix.zip`
2. 解压上面的文件，得到 `easy-lang-vscode-0.0.5.vsix`
3. 打开 VSCode，按 `Cmd+Shift+P`（Windows 为 `Ctrl+Shift+P`）打开命令面板，执行 **Extensions: Install from VSIX...**，选择解压出的 `.vsix` 文件完成安装

详细配置说明见插件文档：[easy-lang-vscode/README.md](packages/easy-lang-vscode/README.md)。

## 快速开始

## 建议的目录结构

```txt
locales/
  - index.ts
  - translation.json
```

### 1. 定义翻译文件

translation.json

```json
{
  "错误": {
    "zh_CN": "错误",
    "zh_HK": "錯誤",
    "en": "Error"
  },
  "保存": {
    "zh_CN": "保存",
    "zh_HK": "保存",
    "en": "Save"
  }
}
```

### 2. TS 项目

```ts
import { createI18nTool } from "easy-lang";
import translations from "./translation.json";

const i18n = createI18nTool<typeof Transform, "zh" | "zh_HK" | "en">({
  defaultLang: "en",
  langs: ["zh_CN", "zh_HK", "en"],
  translations,
  storage: {
    getLang({ storageKey }) {
      return localStorage.getItem(storageKey) as "zh" | "zh_HK" | "en" | null;
    },
    setLang(lang, { storageKey }) {
      localStorage.setItem(storageKey, lang);
    },
  },
});

// 获取翻译
i18n.$t("错误"); // => "Error"

// 切换语言
i18n.changeLang("zh_CN");
i18n.configure({ autoReload: false, storageKey: "tenant-lang" });
```

> 默认会使用 `localStorage` 中的 `lang` 作为语言存储 key，可通过 `storageKey` 自定义。

### 3. React 项目

```shell
pnpm add @easy-lang/react
# 或
npm install @easy-lang/react
# 或
yarn add @easy-lang/react
```

> React 项目需额外安装 `zustand` 作为 peerDependency。

```tsx
import translations from "./translation.json";
import { createI18nTool } from "easy-lang";
import { createReactI18nTool } from "@easy-lang/react";

const reactI18nTool = createReactI18nTool<
  typeof Transform,
  "zh" | "zh_HK" | "en"
>(
  createI18nTool({
    defaultLang: "zh",
    langs: ["zh", "zh_HK", "en"],
    translations: Transform,
  })
);

export const useTranslate = reactI18nTool.useTranslate();

function App() {
  const { $t, changeLang, currentLang } = useTranslate;
  return (
    <div>
      <button onClick={() => changeLang("en")}>en</button>
      <button onClick={() => changeLang("zh_CN")}>中文</button>
      <div>当前语言: {currentLang}</div>
      <div>{$t("错误")}</div>
    </div>
  );
}
```

> 注意：changeLang 调用后会执行 location.reload() 刷新页面。
> 如果你的项目，只用到了 useTranslate 进行翻译，请设置 autoReload: false,可以不用刷新页面响应式更新。

## 变量替换

支持在翻译文本中使用 `{变量名}`，如：

```json
{
  "欢迎, {name}": {
    "en": "Welcome, {name}!"
  }
}
```

调用：

```ts
i18n.$t("欢迎, {name}", { name: "Tom" }); // => "Welcome, Tom!"
```

## 多模块翻译

大型应用可把翻译按功能模块拆分，便于各团队独立维护。顶层是模块名，然后是 key，再是语言：

```ts
const translations = {
  default: {
    "保存": { "zh_CN": "保存", "zh_HK": "保存", "en": "Save" }
  },
  billing: {
    "发票": { "zh_CN": "发票", "zh_HK": "發票", "en": "Invoice" },
    "合计 {amount}": { "zh_CN": "合计 {amount}", "zh_HK": "合計 {amount}", "en": "Total {amount}" }
  }
} as const;

const i18n = createI18nTool({
  defaultLang: "en",
  langs: ["zh_CN", "zh_HK", "en"],
  translations,
});

// 不带 module 参数只查 default 模块
i18n.$t("保存"); // => "Save"

// 方式一：通过 { module } 指定模块
i18n.$t("发票", { module: "billing" }); // => "Invoice"

// 方式二：$module() 生成模块专属翻译函数，更简洁
const billingT = i18n.$module("billing");
billingT("发票"); // => "Invoice"
billingT("合计 {amount}", { amount: "$42" }); // => "Total $42"
```

> 类型上：不带 `module` 的 `$t("...")` 只允许 default 模块的 key；带 `{ module: "xxx" }` 或使用 `$module("xxx")` 时只允许对应模块的 key，可享受完整的类型提示。

## 强制指定翻译语言

`$t`（以及 `$module` 生成的函数）的第三个参数可临时覆盖当前语言，用于指定场景：

```ts
i18n.$t("保存", {}, "zh_HK"); // => "保存"（强制繁体）
```

## 运行时配置 configure()

可在运行时动态调整配置，无需重建实例：

```ts
i18n.configure({
  defaultLang: "zh_CN",
  autoReload: false,        // 改为响应式更新，不刷新页面
  storageKey: "tenant-lang", // 自定义存储 key
});
```

## 自定义语言存储

默认使用 `localStorage`（key 为 `lang`）。当语言来自 query 参数、宿主应用、cookie 桥或已有设置中心时，可自定义 storage：

```ts
const i18n = createI18nTool({
  defaultLang: "en",
  langs: ["zh_CN", "zh_HK", "en"],
  translations,
  storage: {
    getLang({ defaultLang, langs, storageKey }) {
      const stored = localStorage.getItem(storageKey);
      return stored && langs.includes(stored) ? stored : defaultLang;
    },
    setLang(lang, { storageKey }) {
      localStorage.setItem(storageKey, lang);
    },
  },
});
```

> `getLang` 返回 `null` 或 `undefined` 时，会回退到 `defaultLang`。SSR 场景下（无 `window`）会自动安全降级。

## 自动收集未翻译 key

未翻译的 key 会自动收集到 `untranslatedList`，便于后续补全。

## 测试

本项目使用 [vitest](https://vitest.dev/) 进行单元测试。

```bash
pnpm test
# 或
npm run test
```

## 构建

```bash
pnpm build
# 或
npm run build
```

## 许可证

MIT
