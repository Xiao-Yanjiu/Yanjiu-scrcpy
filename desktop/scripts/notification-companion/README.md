# 通知助手

安装：电脑设置中的“手机实时通知”卡片，选择手机后点击“安装／设置通知助手”。APK 从 `electron/resources/extra/common/notification-companion.apk` 通过 ADB 安装；用户需在手机手动授予通知使用权。安装与授权不自动提权。

通知服务由 Android 自动绑定，正常连接不打开 Activity；仅安装／授权按钮打开手机设置。若用户强行停止助手、撤销权限，或系统限制后台服务，电脑回退每 4 秒读取通知。实时通道可用后停用定时读取。后台不存在轮询、心跳或云端通信。

通道：`adb forward tcp:0 localabstract:yanjiu-notifications-v1`，每台 ADB 设备共享一个连接；Unix socket 校验对端 UID 为 shell/adbd，不向其他手机应用或网络公开通知。断开后清理转发。只在通知变化及新电脑连接时发送快照，不持久化通知内容。

构建：运行 `build.ps1 -JdkHome <JDK17> -AndroidJar <AndroidSDK/android.jar> -BuildTools <AndroidSDK/build-tools/35.0.0> -KeyStore <private-signing-key.p12>`。保留首次签名密钥，后续更新必须使用同一密钥；密钥不要提交公开仓库。编译依赖仅用于开发，不随桌面程序分发。

验证限制：需要实体 Android 设备确认通知使用权、各厂商后台管理及 USB/Wi-Fi ADB 的实际通知推送。
