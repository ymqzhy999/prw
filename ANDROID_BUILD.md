# Android 构建与发布指南

本工程的 Android 壳基于 **Capacitor 6**。Web 资源打包进 APK 的 `assets/public`，因此应用可以完全离线运行，不依赖远程服务器。

## 1. 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | ≥ 18（推荐 20 LTS） |
| JDK | **17**（AGP 8.2 要求） |
| Android Studio | Hedgehog / Iguana 或更新 |
| Android SDK Platform | API 34 |
| Android Build-Tools | 34.0.0 |
| Gradle | 使用项目自带 wrapper（8.2.1），无需单独安装 |

Android Studio 中确认：

- `Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK` 选择 **17**。
- `Settings → Languages & Frameworks → Android SDK` 安装 **Android 14 (API 34)** 与 Build-Tools 34.0.0。

## 2. 同步 Web 资源

每次修改 Web 代码后：

```bash
npm install
npm run cap:sync
```

等价于：

```bash
npm run build
npx cap sync android
```

`cap sync` 会把 `dist/` 复制到 `android/app/src/main/assets/public/`，并更新 `capacitor.config.json` 与原生插件配置。

> 仓库内已提交同步后的 Web 资源，因此 Android Studio 可以直接打开并运行；改动 Web 后请重新执行 `cap:sync`。

## 3. 用 Android Studio 打开

```bash
npx cap open android
```

或手动打开 Android Studio → **Open** → 选择 `android/` 目录。

首次 Gradle 同步会自动下载 AGP、AndroidX 依赖和 Gradle 发行版（需联网）。

## 4. 命令行构建

### Debug APK

```bash
cd android
./gradlew assembleDebug
```

输出：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Windows：

```bat
cd android
gradlew.bat assembleDebug
```

### Release APK

未配置签名时：

```bash
cd android
./gradlew assembleRelease
```

输出 `app/build/outputs/apk/release/app-release-unsigned.apk`。

配置签名后输出 `app-release.apk`。

## 5. 配置 Release 签名

1. 在项目根目录生成 keystore：

   ```bash
   keytool -genkeypair -v -keystore android/nuclear-release.jks -alias nuclear \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 复制模板：

   ```bash
   cp android/keystore.properties.example android/keystore.properties
   ```

3. 编辑 `android/keystore.properties`：

   ```properties
   storeFile=nuclear-release.jks
   storePassword=你的密码
   keyAlias=nuclear
   keyPassword=你的密码
   ```

   `storeFile` 相对于 `android/` 工程根目录解析。

4. 构建：

   ```bash
   cd android
   ./gradlew assembleRelease
   ```

`android/app/build.gradle` 会自动读取 `keystore.properties`；文件不存在时跳过签名，产出 unsigned APK。`keystore.properties`、`*.jks` 不会进入 Git。

也可以使用 Android Studio 的 **Build → Generate Signed Bundle / APK** 向导。

## 6. 原生适配说明

- **沉浸式全屏**：`MainActivity.java` 使用 `WindowCompat` + `WindowInsetsControllerCompat` 隐藏状态栏/导航栏，支持从边缘滑动临时呼出；旋转/失焦后自动恢复。
- **横竖屏**：Activity 未锁定方向，Manifest 声明 `configChanges`，Web 端 CSS 通过 `@media` 与安全区域变量响应旋转。
- **平板**：`resizeableActivity=true`，布局为自适应宽度；大屏会显示左右面板，小屏切换为抽屉。
- **触摸**：OrbitControls 配置 `ONE: ROTATE`、`TWO: DOLLY_PAN`，支持单指旋转、双指缩放和平移。
- **WebView**：Capacitor 使用 `https://localhost` scheme；`usesCleartextTraffic=false`，无远程依赖。
- **性能**：移动端自动关闭阴影和 Bloom，减少堆芯棒束与冷却塔粒子数量，并限制 devicePixelRatio。

## 7. 图标与启动页

- 自适应图标：`android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- 前景矢量：`res/drawable/ic_launcher_foreground.xml`
- 背景色：`res/values/colors.xml`（`#050B14`）
- 启动主题：`res/values/styles.xml` 中的 `AppTheme.NoActionBarLaunch`

替换 `foreground` 矢量或对应的 `mipmap-*/ic_launcher.png` 即可定制图标。

## 8. GitHub Actions 自动构建

仓库内置 [`.github/workflows/android.yml`](.github/workflows/android.yml)：

- 手动触发 `workflow_dispatch`；
- 构建 `assembleDebug` 与 `assembleRelease`；
- 上传 Debug APK 与 unsigned Release APK 两个 artifact。

下载后可直接安装 Debug APK；Release APK 需使用自己的 keystore 签名后分发。

## 9. 常见问题

**Gradle 报 “Unsupported class file major version”**
Android Studio 的 Gradle JDK 不是 17。到 Settings 中切换为 JDK 17。

**`SDK location not found`**
在 `android/local.properties` 写入：

```properties
sdk.dir=/path/to/Android/Sdk
```

或通过 `ANDROID_HOME` 环境变量指定。

**页面空白 / 旧版本**
执行 `npm run cap:sync` 后重新安装 APK。WebView 可能缓存旧资源；卸载重装或清除应用数据即可。

**构建时下载依赖很慢**
可配置 Gradle 镜像，或先在网络良好的环境完成一次 Gradle 同步。

**Debug APK 与 Release APK 能否共存？**
默认 applicationId 相同，不能同时安装。可在 `android/app/build.gradle` 的 `debug` 中增加 `applicationIdSuffix ".debug"`（当前为空字符串，可自行修改）。
