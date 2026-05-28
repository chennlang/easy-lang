# Easy Lang Integration Patterns

Use these templates when adding easy-lang to an application. Adjust language codes to match the project.

## Framework-Agnostic TypeScript

`locales/translation.json`

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

`locales/index.ts`

```ts
import { createI18nTool } from "easy-lang";
import translations from "./translation.json";

export type AppLang = "en" | "zh-CN";

export const i18n = createI18nTool<typeof translations, AppLang>({
  defaultLang: "en",
  langs: ["en", "zh-CN"],
  translations,
  autoReload: false,
  storageKey: "app-lang",
});

export const $t = i18n.$t;
```

Usage:

```ts
import { $t, i18n } from "./locales";

$t("Save");
$t("Welcome {name}", { name: "Ada" });
i18n.changeLang("zh-CN");
i18n.getCurrentLang();
```

## React

Install:

```bash
pnpm add easy-lang @easy-lang/react zustand
```

Use module-shaped translation data for the React binding.

`locales/translation.json`

```json
{
  "default": {
    "Save": {
      "en": "Save",
      "zh-CN": "保存"
    },
    "Switch language": {
      "en": "Switch language",
      "zh-CN": "切换语言"
    },
    "Welcome {name}": {
      "en": "Welcome {name}",
      "zh-CN": "欢迎 {name}"
    }
  }
}
```

`locales/index.ts`

```ts
import { createI18nTool } from "easy-lang";
import { createReactI18nTool } from "@easy-lang/react";
import translations from "./translation.json";

export type AppLang = "en" | "zh-CN";

const reactI18n = createReactI18nTool<typeof translations, AppLang>(
  createI18nTool({
    defaultLang: "en",
    langs: ["en", "zh-CN"],
    translations,
    autoReload: false,
    storageKey: "app-lang",
  })
);

export const useTranslate = reactI18n.useTranslate();
export const i18n = reactI18n;
```

Component usage:

```tsx
import { useTranslate } from "./locales";

export function Toolbar() {
  const { $t, currentLang, changeLang } = useTranslate();

  return (
    <div>
      <span>{$t("Save")}</span>
      <button onClick={() => changeLang(currentLang === "en" ? "zh-CN" : "en")}>
        {$t("Switch language")}
      </button>
    </div>
  );
}
```

Important: call `useTranslate()` inside components. Do not write `const { $t } = useTranslate`.

## Vue or Plain UI Code

Use the framework-agnostic `i18n` instance. For reactive frameworks without an official binding, store `i18n.getCurrentLang()` in the framework's own state and call `i18n.changeLang(nextLang)` when switching.

Example:

```ts
import { i18n } from "./locales";

const label = i18n.$t("Save");

function switchToChinese() {
  i18n.changeLang("zh-CN");
  // Update the framework's own state or rerender strategy here.
}
```

Use `autoReload: true` only when the app intentionally depends on a full reload after language changes.

## Module-Based Translations

Use modules when features own their translation keys.

```ts
export const translations = {
  default: {
    "Save": {
      "en": "Save",
      "zh-CN": "保存"
    }
  },
  billing: {
    "Invoice": {
      "en": "Invoice",
      "zh-CN": "发票"
    },
    "Total {amount}": {
      "en": "Total {amount}",
      "zh-CN": "合计 {amount}"
    }
  }
} as const;
```

```ts
const billingT = i18n.$module("billing");

billingT("Invoice");
billingT("Total {amount}", { amount: "$42" });
i18n.$t("Invoice", { module: "billing" });
```

Plain `i18n.$t("Invoice")` only checks the `default` module. Use `$module` or pass `{ module: "billing" }` for feature modules.

## Custom Storage

Use custom storage when the language comes from a query string, host app, cookie bridge, or existing settings store.

```ts
const i18n = createI18nTool<typeof translations, AppLang>({
  defaultLang: "en",
  langs: ["en", "zh-CN"],
  translations,
  autoReload: false,
  storage: {
    getLang({ defaultLang, langs, storageKey }) {
      const stored = localStorage.getItem(storageKey);
      return stored && langs.includes(stored as AppLang)
        ? (stored as AppLang)
        : defaultLang;
    },
    setLang(lang, { storageKey }) {
      localStorage.setItem(storageKey, lang);
    },
  },
});
```

`getLang` may return `null` or `undefined`; easy-lang falls back to `defaultLang`.

## Common Pitfalls

- Keep language code spelling exact. `zh_CN`, `zh-CN`, and `zh` are different values.
- Pass the imported JSON value as `translations`; do not pass an undefined placeholder such as `Transform` unless that identifier exists.
- Use `typeof translations` as the generic type for JSON imports.
- In React, call `useTranslate()` and set `autoReload: false` for reactive updates.
- Use `{ module: "name" }` or `$module("name")` for non-default modules.
- Treat `untranslatedList` as a development aid; missing translations return the source key at runtime.
