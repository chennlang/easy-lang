# Easy-Lang

一个易用、低侵入的多语言翻译工具，支持原生和 React 项目，适合中大型前端项目的国际化需求。

## 特性

- 简单易用，API 友好
- 支持多语言切换
- 支持 React 项目无缝集成
- 自动收集未翻译的 key，便于补全
- 支持变量替换
- 轻量无第三方依赖（React 集成需 `zustand`）

## 安装

```bash
pnpm add easy-lang
# 或
npm install easy-lang
# 或
yarn add easy-lang
```

## 快速开始

### 1. 定义翻译文件

```json
// translation.json
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
});

// 获取翻译
i18n.$t("错误"); // => "Error"

// 切换语言
i18n.changeLang("zh_CN");
```

### 3. React 项目

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
  "欢迎": {
    "en": "Welcome, {name}!"
  }
}
```

调用：

```ts
i18n.$t("欢迎", { name: "Tom" }); // => "Welcome, Tom!"
```

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
