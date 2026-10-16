# ⚠️ 非官方二次开发版本

本仓库是 [read-cat/read-cat](https://github.com/read-cat/read-cat) 的**非官方分支**，由第三方基于 GPL-3.0 自行修改，**与原作者及官方项目无关**。

**请不要把本分支的问题反馈到官方仓库。** 官方仓库的 issue / discussion 与本项目无关。

> 上游项目地址：<https://github.com/read-cat/read-cat>

---

<p align="center">
  <a href="https://github.com/Huizz021/Readcat-lite/">
    <img src="public/icons/512x512.png" alt="Logo" width="80" height="80">
  </a>
  <h3 align="center" style="color: #1E78EB;">ReadCat Lite</h3>
  <p align="center">
    一款<span style="color: #1E78EB;">免费</span>、<span style="color: #1E78EB;">开源</span>、<span style="color: #1E78EB;">简洁</span>、<span style="color: #1E78EB;">纯净</span>、<span style="color: #1E78EB;">无广告</span>的小说阅读器
  </p>
  <div align="center">
    <a href="https://github.com/Huizz021/Readcat-lite/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/Huizz021/Readcat-lite" alt="License" />
    </a>
    <a href="https://github.com/Huizz021/Readcat-lite/issues">
      <img src="https://img.shields.io/github/issues/Huizz021/Readcat-lite" alt="Issues" />
    </a>
  </div>
</p>

## 这是什么

ReadCat 是一个基于 Electron + Vue 3 的桌面小说阅读器，支持导入书源插件在线搜书，也支持导入本地书籍。

**本分支（ReadCat Lite）在上游基础上做了两处调整：**

| 改动 | 说明 |
|---|---|
| ➕ **新增 EPUB 支持** | 除 txt 外，现在可以直接导入 `.epub` 电子书。自动解析书名、作者、简介、封面与章节目录，书内插图会一并提取 |
| ➖ **移除「书城」** | 去掉了书城页面及对应的插件类型。界面聚焦在「书架」与「搜索」两条路径上 |

> 需要书城功能的话，请使用 [上游官方版本](https://github.com/read-cat/read-cat)。

## 下载

安装包发布在本仓库的 [Releases](https://github.com/Huizz021/Readcat-lite/releases) 页面。

> ⚠️ **不要从上游的 `read-cat.github.io/insiders` 下载** —— 那是官方内测版，不含本分支的任何改动。

## 上手指南

本软件不携带插件。首次使用且未导入书源插件时，无法获取任何在线书本内容。

导入方式：**设置 → 插件 → 导入插件**，选择插件 `.js` 文件即可。

> 插件导入的详细说明可参考[上游文档](https://docs.qq.com/doc/DRmlncEFkbElZYmFJ)（该文档由上游维护，内容对本分支同样适用）。

如果你只想看本地书籍，跳过插件导入，直接点书架页的「导入」按钮选择 `txt` 或 `epub` 文件即可。

## 功能

- **书源插件** —— 导入书源插件后可在线搜书、追更
- **书架** —— 在线书籍与本地书籍（txt / epub）统一管理
- **搜索** —— 跨书源聚合搜索
- **阅读** —— 翻页、字号、背景主题、阅读进度
- **书签** —— 记录阅读位置与摘录
- **朗读** —— 内置 Edge TTS，可选发音人与语速
- **深色模式** —— 跟随系统或手动切换

## 版权说明

本项目签署了 GPL-3.0 授权许可，详情请参阅 [LICENSE](./LICENSE)。

原作者：**Moomew**（[read-cat/read-cat](https://github.com/read-cat/read-cat)）。

## 修改说明

本仓库是 [read-cat/read-cat](https://github.com/read-cat/read-cat) 的非官方二次开发版本，基于上游 `main` 分支提交 `da008dc`（2024-11-09）。

自 2026-10-15 起相对上游做了以下修改：

- **新增** EPUB 本地书籍导入（`src/core/book/epub-parser/`），导入对话框与拖拽均放开 `.epub` 扩展名
- **新增** 导入窗口显示书籍自带封面（上游为固定占位图）
- **移除** 「书城」功能：书城页面、`BookStore` 插件类型及其校验、`PluginType.BOOK_STORE`、`settings.bookStore` 配置、`/bookstore` 路由与顶栏导航入口
- **新增** 兜底路由，未知路径统一回到书架

以上修改同样以 GPL-3.0 授权发布。分发本项目的二进制版本时，请一并提供对应的完整源码。
