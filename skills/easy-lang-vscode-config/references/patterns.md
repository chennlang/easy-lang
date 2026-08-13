# Easy Lang VSCode Configuration Patterns

Copy-ready templates. Adjust paths and language codes to match the project.

## Google Translate Mode (default)

`.vscode/easy-lang.json`

```json
{
  "translationPath": "locales/translation.json",
  "translateMode": "google",
  "targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

`.vscode/settings.json`

```json
{
  "easyCode.translateMode": "google",
  "easyCode.targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

`locales/translation.json`

```json
{
  "欢迎使用 Easy Lang": {
    "zh_CN": "欢迎使用 Easy Lang",
    "zh_HK": "歡迎使用 Easy Lang",
    "en": "Welcome to Easy Lang"
  }
}
```

## Model Translate Mode

`.vscode/easy-lang.json`

```json
{
  "translationPath": "locales/translation.json",
  "translateMode": "model",
  "targetLangs": ["en", "ja"],
  "model": {
    "endpoint": "https://api.example.com/translate",
    "model": "gpt-4",
    "apiKey": "your-api-key"
  }
}
```

`.vscode/settings.json`

```json
{
  "easyCode.translateMode": "model",
  "easyCode.model.endpoint": "https://api.example.com/translate",
  "easyCode.model.model": "gpt-4",
  "easyCode.model.apiKey": "your-api-key",
  "easyCode.targetLangs": ["en", "ja"]
}
```

`locales/translation.json`

```json
{
  "欢迎使用 Easy Lang": {
    "zh_CN": "欢迎使用 Easy Lang",
    "zh_HK": "歡迎使用 Easy Lang",
    "en": "Welcome to Easy Lang"
  }
}
```

## Custom Translation Path

When `translation.json` lives under `src`:

`.vscode/easy-lang.json`

```json
{
  "translationPath": "src/locales/translation.json",
  "translateMode": "google",
  "targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

`.vscode/settings.json`

```json
{
  "easyCode.translateMode": "google",
  "easyCode.targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

## Merging Into Existing Config

If `.vscode/easy-lang.json` or `.vscode/settings.json` already exists, read it first and add only the easy-lang fields, preserving everything else. Never rewrite the user's model API key or unrelated settings.

Existing `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true
}
```

Merged result:

```json
{
  "editor.formatOnSave": true,
  "easyCode.translateMode": "google",
  "easyCode.targetLangs": ["en", "zh_CN", "zh_HK"]
}
```

## Common Pitfalls

- `zh_CN`, `zh-HK`, and `zh` are different language codes. Keep `targetLangs` and the language keys inside `translation.json` in exact agreement.
- `translationPath` is relative to the workspace root, not to `.vscode/`.
- In model mode all of endpoint/model/apiKey are required; the plugin POSTs `{ text, from, to, model, apiKey }` as a JSON body and expects `{ translation }` back.
- `translateMode` and `model.*` are read from `easyCode.*` settings, not from `easy-lang.json`. Keep the two files in sync so the settings page and the translate command agree.
- The plugin only scans `$t('key')` / `$("key")` in js/jsx/ts/tsx/vue files; dynamic keys (`$t(foo)`) are not collected.
