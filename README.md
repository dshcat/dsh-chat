# DeepChat

一个给自己用的 Android 版 DeepSeek 客户端：WebView 壳 + 纯静态前端，无后端、无账号、无埋点。
**非官方项目**，与深度求索公司无隶属关系。

- 安装包约 37 KB
- 包名 `com.dsh.deepchat`　minSdk 26（Android 8+）　targetSdk 34
- MIT 协议，可自由修改、分发

## 功能

**对话**
- 流式输出、停止生成、复制、重新生成
- 回答多版本、无上限：重新生成或编辑提问都会**保留**旧回答，正文下方 `‹ 1 / 3 ›` 来回切，切回时提问文字也会跟着回到那一版
- 编辑已发送的提问，保存后生成新版本（旧版本不丢）
- 深度思考（可折叠），随时开关
- 联网搜索 + 读链接，带工具进度、来源列表和 `[1]` 引用角标
- 会话本地保存、切换、删除，自动标题

**外观**
- 浅色 / 深色 / 跟随系统
- 自定义背景：8 个预设色 + 任意取色 + 相册选图（压缩后只存本机）
- 界面元素全部跟随主题配色

**省钱**
- 每条回复显示 token 用量和人民币花费
- 底部常驻累计花费
- 费用按官方价格表估算（flash 输入 1 元/百万、缓存命中 0.02、输出 4；高峰时段 ×2），不含搜索费

**提示词**
- 4 个预设（日常助手 / 私人老师 / 工程师 / 中文编辑）
- 完全可编辑

## 安装

1. 下载 `DeepChat-2.1.0.apk`
2. 点开安装，允许一次「未知来源」
3. 打开 → 左上角 ☰ → 设置 → 填 API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请）

Key 只写在本机 WebView 的 localStorage，不发往任何第三方；聊天请求直接发到 `api.deepseek.com`。

## 隐私

- 没有账号、没有统计、没有崩溃上报
- 对话、提示词、背景图都只在设备本地
- 唯一的对外请求是 DeepSeek API（以及你点开的网页链接，交给系统浏览器）
- 卸载应用会一并清除本地数据

## 自己编译

```bash
bash build.sh      # 产出 DeepChat-2.1.0.apk
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
