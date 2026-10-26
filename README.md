# Yanjiu-scrcpy

基于 Escrcpy 和 scrcpy 开发的 Android 桌面与融合模式工具，支持 Windows 11，通过 USB 或无线 ADB 连接手机。

## 下载使用

在 [Releases](https://github.com/Xiao-Yanjiu/Yanjiu-scrcpy/releases) 下载 Windows x64 文件夹免安装版，完整解压后双击 `Yanjiu-scrcpy.exe`。

- 不需要安装 Node.js，也不需要下载源码依赖。
- `scrcpy` 为独立文件夹；升级时使用同版本的 Windows x64 官方发行文件完整替换其中的客户端、DLL 和 `scrcpy-server`。
- 免安装版首次运行在程序目录生成 `Data`，保存该版本的配置和缓存。
- 连接手机时需在手机上开启并允许 USB 调试。

## 主要功能

- 桌面模式和融合模式，支持手机镜像及独立应用窗口。
- 每个应用保存窗口位置、大小、分辨率、DPI、布局和输入设置。
- 全屏控制、标题栏锁定、右键返回、老板键隐藏与恢复。
- 任务栏固定应用与排序、通知中心及通知提示。
- 深色/浅色主题、透明度、壁纸及设备黑屏设置。
- 可分别禁用桌面模式、融合模式的音频转发，让声音留在手机。

功能兼容性取决于 Android 版本、手机系统和应用对多显示器的支持。

## 从源码运行

使用 Node.js 24.12 和 pnpm 10.29.2：

```sh
corepack enable
pnpm install
pnpm --filter "./packages/*" run build
pnpm --filter yanjiu-scrcpy dev
```

Windows 也可以在准备依赖后双击根目录的 `启动源码.cmd`。它优先使用本地可选的 `build-tools/node.exe`，否则使用系统 Node.js。配置保存在源码目录的 `user-data`，不会提交到 Git。

```sh
pnpm lint
pnpm --filter yanjiu-scrcpy build
```

源码目录：`desktop/src`（主界面）、`desktop/pages/desktop`（桌面和融合模式）、`desktop/electron`（原生功能）、`packages`（本地依赖模块）。详细信息见 [源码运行说明](源码运行说明.md)。

仓库不包含个人配置、缓存、`node_modules`、本机 Node/npm 工具或签名密钥。依赖锁定文件、构建脚本和所需资源保留。历史上游工作流作为 `.github/upstream-workflows-reference` 中的参考文件保留，不会自动执行，发布包通过 Release 提供。

## 开源来源

本项目基于 [Escrcpy](https://github.com/viarotel-org/escrcpy)（viarotel 及贡献者）修改，底层镜像能力来自 [scrcpy](https://github.com/Genymobile/scrcpy)。原作者版权及 Apache-2.0 许可证保留，参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
