# Android desktop native checks

Run from the source root on Windows:

```powershell
pnpm lint
pnpm --filter yanjiu-scrcpy build
node desktop/scripts/desktop-tests/test-native-bridge.mjs
node desktop/scripts/desktop-tests/test-five-regressions.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/desktop-tests/test-right-button.ps1 -Helper desktop/electron/resources/extra/win/desktop-window.ps1
```

The native checks use off-screen forms; they do not control the computer screen or require a phone. Android video, input, rotation and device compatibility still require device testing.

`test-five-regressions.mjs` uses mocks, without opening any windows. It checks
host-input timeout recovery, cancellation of outdated transitions, renderer retry,
clipboard event coalescing/echo suppression, and notification request coalescing.

The desktop phone mirror uses `extra/common/phone-mirror/scrcpy.png` and the
matching multiresolution `phone-mirror.ico`, independently of the application logo.
The default mirror encoder limit is 1920 pixels on the long side; a configured
device/global `--max-size` takes precedence. This does not change Android display
resolution or DPI. Hardware frame rate and foreground restoration still need
verification with a connected device.

The custom 4.1 server includes `DesktopClipboardRelay`. Each desktop/device has
one transient ADB relay, with a shared file-lock lease on Android. While a lease
exists, custom server clients skip duplicate Android-to-PC autosync callbacks;
Ctrl+V and UHID paste acknowledgements remain enabled. If the relay cannot start
or exits, the lease is released and upstream autosync resumes. There is no PC
clipboard polling, initial clipboard overwrite, APK installation, or clipboard
content logging. The relay sends text up to 256 KiB, coalescing rapid changes.

## Packaged startup regression

After preparing a Windows folder package, run:

```powershell
node desktop/scripts/desktop-tests/test-portable-startup.mjs "<folder>/Yanjiu-scrcpy.exe"
```

This starts that exact executable minimized with its local inspector, validates
production file loading and preload availability, then stops only its own child.
It creates fresh portable Data in that folder; do not include those test data in
the published ZIP. Source development uses dist-electron-dev, while production
builds use dist-electron, so a live Vite server cannot replace release main code.

## Floating controls regression

```powershell
node desktop/scripts/desktop-tests/test-floating-controls.mjs
```

Checks that fullscreen controls use a small transparent owned window instead of
cutting a black rectangle out of native video; covers drag bounds, saved side,
boss-key hiding, fullscreen exit cleanup, and minimized bubble top-order refresh
without taking keyboard focus.
