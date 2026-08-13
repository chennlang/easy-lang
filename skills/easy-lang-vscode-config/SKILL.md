---
name: easy-lang-vscode-config
description: Guide agents to generate the configuration files the easy-lang-vscode plugin needs, so the Easy Lang sidebar can collect $t() keys and auto-translate them. Use when a project needs to set up or re-configure the Easy Lang VSCode extension: creating .vscode/easy-lang.json, easyCode.* workspace settings, an initial locales/translation.json, or aligning target languages.
---

# Easy Lang VSCode Config

## Core Workflow

Generate the three files the easy-lang-vscode plugin reads, then verify they agree with each other.

Prefer this file shape:

```txt
.vscode/
  easy-lang.json
  settings.json
locales/
  translation.json
```

1. Inspect the workspace for existing `.vscode/easy-lang.json`, `.vscode/settings.json`, and `locales/translation.json`. Merge rather than clobber.
2. Ask the user (or infer from existing code) for: translation.json path, target languages, translate mode, and model credentials when the mode is `model`.
3. Write the files.
4. Verify `targetLangs`, `translationPath`, and every language key inside `translation.json` match exactly.

## The Three Files

### 1. `.vscode/easy-lang.json` — project config

This is the canonical project-level config. The sidebar and the settings page read it.

```json
{
  "translationPath": "locales/translation.json",
  "translateMode": "google",
  "targetLangs": ["en", "zh_CN", "zh_HK"],
  "model": {
    "endpoint": "",
    "model": "",
    "apiKey": ""
  }
}
```

- `translationPath`: relative to the workspace root. Default `locales/translation.json`.
- `translateMode`: `google` or `model`.
- `targetLangs`: the languages the "全部翻译" command writes into `translation.json`.
- `model`: only needed when `translateMode` is `model`.

### 2. `.vscode/settings.json` — easyCode.* settings

The `translateAll` command also reads `easyCode.*` from VSCode settings. `translateMode` and `model.*` are read from here; `targetLangs` falls back to here when `easy-lang.json` has none.

```json
{
  "easyCode.translateMode": "google",
  "easyCode.targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

For model mode, add:

```json
{
  "easyCode.translateMode": "model",
  "easyCode.model.endpoint": "https://api.example.com/translate",
  "easyCode.model.model": "gpt-4",
  "easyCode.model.apiKey": "your-api-key",
  "easyCode.targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

### 3. `locales/translation.json` — translation data

Each entry maps a key (the source text) to language codes. Keys come from `$t('...')` / `$("...")` calls in js/jsx/ts/tsx/vue files. The plugin translates from `zh-CN` to each target language.

```json
{
  "欢迎使用 Easy Lang": {
    "zh_CN": "欢迎使用 Easy Lang",
    "zh_HK": "歡迎使用 Easy Lang",
    "en": "Welcome to Easy Lang"
  }
}
```

If no keys exist yet, write an empty object `{}` — the plugin fills it on first translate.

## Code-Side Usage

The plugin only collects keys written as `$t('key')` or `$("key")`. Dynamic keys like `$t(foo)` are not collected. A minimal example:

```ts
$t("欢迎使用 Easy Lang");
```

## Checks Before Finishing

- `translationPath` in `easy-lang.json` points to an existing or creatable file.
- `translateMode` agrees across `easy-lang.json`, `settings.json`, and the settings page.
- Language codes in `targetLangs` exactly match the keys inside `translation.json` (`zh_CN` and `zh-HK` are different values).
- Existing keys in `translation.json` are preserved when editing; never rewrite the user's model API key.
- For copy-ready full templates, read `references/patterns.md`.
