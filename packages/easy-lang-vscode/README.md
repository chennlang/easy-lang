# Easy Lang VSCode 插件

配合 easy-lang 的 VSCode 插件，自动收集和翻译国际化文本。

## 功能特性

- 扫描项目文件，收集 $t('') 或 $("") 包裹的国际化 key
- 对比 translation.json，区分"已翻译"和"未翻译"
- 侧边栏展示两个列表，支持刷新和一键全部翻译
- 支持 .gitignore 忽略规则
- 支持模型/谷歌自动翻译

## 用法

1. 安装插件
2. 在设置中配置 translation.json 路径（默认 /locales/translation.json）
3. 选中文件，侧边栏查看和操作国际化 key
