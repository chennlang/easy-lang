# easy-lang react

React 项目的多语言翻译工具，基于 easy-lang，支持响应式国际化体验。

## 特性

- 轻松集成 React
- 支持多语言切换
- 响应式翻译
- 自动收集未翻译的 key
- 支持变量替换
- 依赖 easy-lang、react、zustand（peerDependency）

## 安装

```bash
pnpm add @easy-lang/react
# 或
npm install @easy-lang/react
# 或
yarn add @easy-lang/react
```

> 需额外安装 `react`、`zustand`、`easy-lang` 作为 peerDependency。

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

### 2. React 项目

```tsx
import translations from "./translation.json";
import { createI18nTool } from "easy-lang";
import { createReactI18nTool } from "@easy-lang/react";

const reactI18nTool = createReactI18nTool<
  typeof translations,
  "zh_CN" | "zh_HK" | "en"
>(
  createI18nTool({
    defaultLang: "zh_CN",
    langs: ["zh_CN", "zh_HK", "en"],
    translations,
  })
);

export const useTranslate = reactI18nTool.useTranslate();

function App() {
  const { $t, changeLang, currentLang } = useTranslate();
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
> 如果你的项目只用到了 useTranslate 进行翻译，请设置 autoReload: false，可实现响应式更新。

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
useTranslate().$t("欢迎", { name: "Tom" }); // => "Welcome, Tom!"
```

## 自动收集未翻译 key

未翻译的 key 会自动收集到 `untranslatedList`，便于后续补全。

## 测试

本项目使用 [vitest](https://vitest.dev/) 进行单元测试。

```bash
pnpm test
```

## 构建

```bash
pnpm build
```

## 许可证

MIT
