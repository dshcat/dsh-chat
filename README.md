# DeepChat

一个给自己用的 Android 版 DeepSeek 客户端：WebView 壳 + 纯静态前端，无后端、无账号、无埋点。
**非官方项目**，与深度求索公司无隶属关系。

- 安装包约 37 KB
- 包名 `com.dsh.deepchat`　minSdk 26（Android 8+）　targetSdk 34
- MIT 协议，可自由修改、分发

## 功能

**对话**
- 流式输出、停止生成、复制、重新生成
- 两套独立版本：提问下方 `‹ 2 / 3 ›` 切编辑前的问法，回答下方 `‹ 1 / 2 ›` 切重新生成的回答，互不干扰
- 版本无上限，编辑或重新生成都**保留**全部历史
- 每条消息带日期与时间，跨天自动插入日期分隔
- 思考强度四档：不思考 / 低 / 高 / 最高（对应 API 的 thinking 与 output_config.effort）
- 图片、文本文件、PDF/Office 附件：图片内联并在对话里显示大图，文本直读，文档走 Files API 解析
- 发图前会校验：图片是否读完、当前模型是否支持看图；接口拒图时自动退回纯文本重发
- 联网搜索 + 读链接，带工具进度、来源列表和 `[1]` 引用角标
- 会话本地保存、切换、删除，自动标题
- 置顶 / 收藏：收藏的对话受保护，需先取消收藏才能删除

**外观**
- 浅色 / 深色 / 跟随系统
- 自定义背景：8 个预设色 + 任意取色 + 相册图（原生选择器，会请求相册权限；图片压缩后只存本机）
- 背景透明度可调（20%–100%），从几乎实心到能看清图
- 界面元素全部跟随主题配色

**省钱**
- 每条回复下方列出用量明细：命中缓存 / 未命中 / 输出 / 思考 tokens + 人民币花费
- 设置里有近 15 天每日花费柱状图，点柱子看当天明细
- 底部常驻累计花费
- 费用按官方价格表估算（flash 输入 1 元/百万、缓存命中 0.02、输出 4；高峰时段 ×2），不含搜索费

**提示词**
- 4 个预设（日常助手 / 私人老师 / 工程师 / 中文编辑）
- 完全可编辑

## 安装

1. 下载 `DeepChat-2.4.2.apk`
2. 点开安装，允许一次「未知来源」
3. 打开 → 左上角 ☰ → 设置 → 填 API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）

Key 只写在本机 WebView 的 localStorage，不发往任何第三方；聊天请求直接发到 `api.deepseek.com`。

## 隐私

- 没有账号、没有统计、没有崩溃上报
- 对话、提示词、背景图都只在设备本地
- 唯一的对外请求是 DeepSeek API（以及你点开的网页链接，交给系统浏览器）
- 卸载应用会一并清除本地数据

## 数据与备份

本地优先：所有数据存在 WebView 的 localStorage。设置 → 数据 → 「导出备份」会把全部对话与设置写成
JSON 存到手机「下载」目录（不含 API Key）；「恢复备份」可从文件读回并覆盖。

**没有账号系统。** 真要做多设备同步的登录，需要一台服务器、数据库、鉴权与隐私合规，不是打包能解决的；
在那之前，导出文件 + 存网盘是最便宜可靠的防丢失方案。

## 自己编译

```bash
bash build.sh      # 产出 DeepChat-2.4.2.apk
```

依赖：JDK 17、Android build-tools 34 的 `lib/d8.jar` 与 `lib/apksigner.jar`、
`platforms/android-33/android.jar`、系统的 `aapt`。

> 为什么不用 aapt2 / Gradle：本项目在 arm64 手机上开发，Google 官方 `aapt2`、`zipalign`
> 只有 x86_64 二进制。因此资源用 arm64 的 `aapt` 打，dex 用纯 Java 的 `d8.jar`，
> 对齐用 `tools/zipalign.py` 重写 zip，签名用 `apksigner.jar`。全程不需要 Gradle。

签名：`build.sh` 会在本地生成 `release.keystore`（密码 `deepchat`）。**这个文件不要丢**，
否则后续版本无法覆盖安装。它已被 `.gitignore` 排除，不会进仓库。

## 目录

```
www/            前端：index.html / app.css / app.js（无构建步骤）
android/        壳工程：AndroidManifest.xml、res/、java/
tools/          zipalign.py（纯 Python 对齐）、server.js（本地联调假接口）
test/           jsdom 回归测试
build.sh        一键打包
```

## 已知未做

- 语音输入 / 朗读、文件与图片上传、KaTeX / Mermaid 公式图表
- 多设备同步（数据只在本机）
- 应用商店上架

## License

MIT
