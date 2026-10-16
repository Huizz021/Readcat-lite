# ⚠️ 非官方二次开发版本

本仓库是 [read-cat/read-cat](https://github.com/read-cat/read-cat) 的**非官方分支**，由第三方基于 GPL-3.0 自行修改，**与原作者及官方项目无关**。

**请不要把本分支的问题反馈到官方仓库。** 官方仓库的 issue / discussion 与本项目无关。

相对上游的改动：新增 EPUB 本地书籍导入、移除「书城」功能。详见文末[修改说明](#修改说明)。

> 上游项目地址：<https://github.com/read-cat/read-cat>

---

<p align="center">
  <a href="https://github.com/Huizz021/Readcat-lite/">
    <img src="public/icons/512x512.png" alt="Logo" width="80" height="80">
  </a>
  <h3 align="center" style="color: #1E78EB;">ReadCat</h3>
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

# 内测
<p>由于诸多功能尚未实现，将暂时不在Github上发布Release版本</p>
<p>若想提前体验ReadCat，请<a href="https://read-cat.github.io/insiders">下载内测版本</a></p>
<p>欢迎您加入内测交流群，您有任何问题、建议等等，可在该群交流</p>
<p>QQ群号：<strong>903473975</strong></p>
<p>QQ群号1：<strong>959115174</strong></p>
<p>QQ群号2：<strong>974942893</strong></p>
<p>QQ群号3：<strong>817944882</strong></p>
<p>QQ群号4：<strong>192080442</strong></p>

## 上手指南
ReadCat不携带插件，若您首次使用ReadCat且未导入书源插件，将无法获取任何在线书本内容
<a href="https://docs.qq.com/doc/DRmlncEFkbElZYmFJ">点击查看插件导入方法</a>

## 功能
- 插件
    - [x] 朗读
    - [x] 书源
- [搜索](#搜索)
- [书架](#书架)
    - [x] 在线书本
    - [x] 本地书本(txt/epub)
- [书签](#书签)
- [朗读](#朗读)
- [深色模式](#深色模式)

#### 搜索
<div>
  <img width="50%" height="50%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/search.png" alt="Search" />
</div>



#### 书架
<div>
  <img width="50%" height="50%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/bookshelf.png" alt="Bookshelf" />
</div>


#### 书签
<div>
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/read-bookmark.png" alt="Bookmark" />
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/bookmark-content.png" alt="BookmarkContent" />
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/bookmark-list.png" alt="BookmarkList" />
</div>



#### 朗读

<div>
  <img width="50%" height="50%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/read-aloud.gif" alt="ReadAloud" />
</div>




#### 深色模式
<div>
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/settings-dark.png" alt="SettingsDark" />
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/bookshelf-dark.png" alt="BookmarkDark" />
  <img width="45%" height="45%" src="https://raw.githubusercontent.com/read-cat/read-cat.github.io/refs/heads/main/public/image/read-dark.png" alt="ReadDark" />
</div>



## 版权说明

该项目签署了GPL-3.0 授权许可，详情请参阅 [LICENSE](https://github.com/read-cat/read-cat/blob/main/LICENSE)

## 修改说明

本项目是 [read-cat/read-cat](https://github.com/read-cat/read-cat) 的二次开发版本，基于上游 `main` 分支提交 `da008dc`（2024-11-09），原作者 Moomew。

自 2026-10-15 起相对上游做了以下修改：

- **新增** EPUB 本地书籍导入（`src/core/book/epub-parser/`），导入对话框与拖拽均放开 `.epub` 扩展名
- **新增** 导入窗口显示书籍自带封面（上游为固定占位图）
- **移除** 「书城」功能：书城页面、`BookStore` 插件类型及其校验、`PluginType.BOOK_STORE`、`settings.bookStore` 配置、`/bookstore` 路由与顶栏导航入口
- **新增** 兜底路由，未知路径统一回到书架

以上修改同样以 GPL-3.0 授权发布。分发本项目的二进制版本时，请一并提供对应的完整源码。
