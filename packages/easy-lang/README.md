# easy-lang

一个易用、低侵入的多语言翻译工具，适合中大型前端项目的国际化需求。

## 特性

- 简单易用，API 友好
- 支持多语言切换
- 自动收集未翻译的 key，便于补全
- 支持变量替换
- 轻量无第三方依赖

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

const i18n = createI18nTool<typeof translations, "zh_CN" | "zh_HK" | "en">({
  defaultLang: "en",
  langs: ["zh_CN", "zh_HK", "en"],
  translations,
});

// 获取翻译
i18n.$t("错误"); // => "Error"

// 切换语言
i18n.changeLang("zh_CN");
```

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
```

## 构建

```bash
pnpm build
```

## 许可证

MIT
