# Android desktop native checks

Run from the source root on Windows:

```powershell
pnpm lint
pnpm --filter yanjiu-scrcpy build
node desktop/scripts/desktop-tests/test-native-bridge.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/desktop-tests/test-right-button.ps1 -Helper desktop/electron/resources/extra/win/desktop-window.ps1
```

The native checks use off-screen forms; they do not control the computer screen or require a phone. Android video, input, rotation and device compatibility still require device testing.
