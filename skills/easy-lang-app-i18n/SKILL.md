---
name: easy-lang-app-i18n
description: Guide agents to add application internationalization with the easy-lang package and @easy-lang/react bindings. Use when building or modifying TypeScript, JavaScript, React, Vue, or other frontend apps that need type-safe translations, language switching, translation JSON setup, React hooks via createReactI18nTool, module-based translations, variable interpolation, storage customization, or untranslated key collection with easy-lang.
---

# Easy Lang App I18n

## Core Workflow

Use `easy-lang` for framework-agnostic TypeScript/JavaScript apps. Add `@easy-lang/react` only for React components that need reactive language changes through `useTranslate()`.

Prefer this app shape:

```txt
locales/
  translation.json
  index.ts
```

Put the translation data in `translation.json`, initialize the i18n tool in `locales/index.ts`, then import only the exported `$t`, `i18n`, or `useTranslate` from application code.

For complete copy-ready templates, read `references/patterns.md`.

## Translation Data

Use the source text as the key unless the existing app already has stable message IDs. Each translation entry maps language codes to strings:

```json
{
  "Save": {
    "en": "Save",
    "zh-CN": "保存"
  },
  "Welcome {name}": {
    "en": "Welcome {name}",
    "zh-CN": "欢迎 {name}"
  }
}
```

Keep language codes consistent across `langs`, `defaultLang`, and every translation entry. In TypeScript, import the JSON and pass `typeof translations` plus a language union to `createI18nTool` for key and language checking.

## Framework-Agnostic Setup

Create one shared i18n instance:

```ts
import { createI18nTool } from "easy-lang";
import translations from "./translation.json";

export type AppLang = "en" | "zh-CN";

export const i18n = createI18nTool<typeof translations, AppLang>({
  defaultLang: "en",
  langs: ["en", "zh-CN"],
  translations,
  autoReload: false,
});

export const $t = i18n.$t;
```

Call `$t("Save")` for plain translations and `$t("Welcome {name}", { name: "Ada" })` for interpolation. Missing interpolation values are left as `{name}`. Missing translations return the original key and add it to `i18n.untranslatedList`.

Use `changeLang(lang)` to persist a new language. By default, easy-lang stores the language in `localStorage` under `lang`. Set `storageKey` or provide `storage` when the app needs custom persistence, iframe/query-string behavior, SSR-safe logic, or integration with an existing settings store.

## React Setup

Install and use both packages in React apps:

```bash
pnpm add easy-lang @easy-lang/react zustand
```

Create the React binding from the base i18n instance and export the hook:

```ts
import { createI18nTool } from "easy-lang";
import { createReactI18nTool } from "@easy-lang/react";
import translations from "./translation.json";

type AppLang = "en" | "zh-CN";

const reactI18n = createReactI18nTool<typeof translations, AppLang>(
  createI18nTool({
    defaultLang: "en",
    langs: ["en", "zh-CN"],
    translations,
    autoReload: false,
  })
);

export const useTranslate = reactI18n.useTranslate();
export const i18n = reactI18n;
```

In components, call the hook function:

```tsx
function Header() {
  const { $t, currentLang, changeLang } = useTranslate();

  return (
    <header>
      <button onClick={() => changeLang(currentLang === "en" ? "zh-CN" : "en")}>
        {$t("Switch language")}
      </button>
      <h1>{$t("Welcome {name}", { name: "Ada" })}</h1>
    </header>
  );
}
```

Set `autoReload: false` for React hook-based usage so language changes update through React state instead of forcing `location.reload()`.

Prefer module-shaped translation JSON for `@easy-lang/react`, with app-wide keys under `default`, because the current React binding type expects a module translation object:

```json
{
  "default": {
    "Switch language": {
      "en": "Switch language",
      "zh-CN": "切换语言"
    }
  }
}
```

## Modules

Use module translations for large apps or feature-owned translation files. The top-level object is module name, then key, then language:

```ts
const translations = {
  default: {
    "Save": { en: "Save", "zh-CN": "保存" }
  },
  billing: {
    "Invoice": { en: "Invoice", "zh-CN": "发票" }
  }
} as const;

const billingT = i18n.$module("billing");
billingT("Invoice");
i18n.$t("Invoice", { module: "billing" });
```

Keep shared/common keys in `default`. Use `$module("feature")` inside feature modules to avoid repeatedly passing `{ module: "feature" }`.

## Checks Before Finishing

Verify these points before handing off app code:

- `langs`, `defaultLang`, storage values, and translation JSON language keys match exactly.
- React components use `const { $t } = useTranslate();`, not `const { $t } = useTranslate`.
- React hook integrations set `autoReload: false` unless the user explicitly wants full page reloads.
- Missing keys are acceptable during development and can be read from `i18n.untranslatedList`.
- Module keys use `{ module: "name" }` or `$module("name")`; plain `$t("key")` only targets `default`.
