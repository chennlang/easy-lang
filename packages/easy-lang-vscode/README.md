# Easy Lang VSCode 插件

配合 easy-lang 的 VSCode 插件，自动收集和翻译国际化文本。

## 主要功能

- **一键扫描**：自动扫描项目中的 js/ts/vue 文件，提取 `$t('')` 或 `$("")` 包裹的国际化 key。
- **国际化管理**：读取 translation.json，区分已翻译和未翻译 key，侧边栏 TreeView 展示所有 key。
- **批量翻译**：支持一键全部自动翻译，支持 Google 免费翻译和自定义模型翻译。
- **多语言支持**：支持多目标语言配置，满足多地区国际化需求。
- **自定义配置**：支持自定义 translation.json 路径、目标语言、翻译模式、模型参数等。

## 演示截图

![侧边栏展示](media/sidebar-demo.png)
![一键翻译](media/translate-all-demo.png)

## 配置说明

在 VSCode 设置中搜索 `Easy Lang`，或在 `settings.json` 中添加如下配置项：

| 配置项                     | 类型   | 默认值                       | 说明                                          |
| -------------------------- | ------ | ---------------------------- | --------------------------------------------- |
| `easyCode.translationPath` | string | `locales/translation.json`   | translation.json 文件路径（相对工作区根目录） |
| `easyCode.translateMode`   | string | `google`                     | 自动翻译模式：`google` 或 `model`             |
| `easyCode.model.endpoint`  | string | 空                           | 自定义模型翻译接口地址                        |
| `easyCode.model.model`     | string | 空                           | 自定义模型名称                                |
| `easyCode.model.apiKey`    | string | 空                           | 自定义模型 API Key                            |
| `easyCode.targetLangs`     | array  | `[ "en", "zh_CN", "zh_HK" ]` | 目标语言列表                                  |

### 示例配置

```json
{
  "easyCode.translationPath": "src/locales/translation.json",
  "easyCode.translateMode": "google",
  "easyCode.targetLangs": ["en", "ja"],
  "easyCode.model.endpoint": "https://api.example.com/translate",
  "easyCode.model.model": "gpt-4",
  "easyCode.model.apiKey": "your-api-key"
}
```

## 贡献与反馈

欢迎提交 issue 和 PR，帮助我们完善插件功能！

- 仓库地址：[https://github.com/chennlang/easy-lang](https://github.com/chennlang/easy-lang)

---

如需进一步补充（如详细命令说明、开发指南等），可随时告知！
