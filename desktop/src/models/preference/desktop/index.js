export const fusion = {
  label: '桌面模式', field: 'fusionMode', children: {
    resize: { label: '拖动应用边框', field: 'desktopResizeMode', type: 'Select', value: 'aspect', customized: true, props: { clearable: false }, options: [{ label: '保持画面比例（等比缩放）', value: 'aspect' }, { label: '平板窗口（内容重新排版）', value: 'adaptive' }] },
    mouse: { label: '默认鼠标模式', field: 'desktopMouse', type: 'Select', value: 'sdk', customized: true, props: { clearable: false }, options: [{ label: 'SDK（绝对坐标）', value: 'sdk' }, { label: 'UHID（物理鼠标）', value: 'uhid' }, { label: '禁用', value: 'disabled' }] },
    keyboard: { label: '默认键盘模式', field: 'desktopKeyboard', type: 'Select', value: 'sdk', customized: true, props: { clearable: false }, options: [{ label: 'SDK（文本输入）', value: 'sdk' }, { label: 'UHID（物理键盘）', value: 'uhid' }, { label: '禁用', value: 'disabled' }] },
    connect: { label: '识别到设备时自动连接', field: 'fusionAutoConnect', type: 'Switch', value: false, customized: true },
    open: { label: '连接后自动打开桌面模式', field: 'fusionAutoOpen', type: 'Switch', value: false, customized: true },
    screen: { label: '打开桌面模式后手机黑屏', field: 'fusionScreenOff', type: 'Switch', value: false, customized: true },
    audioForwarding: { label: '禁用音频转发', field: 'fusionDisableAudioForwarding', type: 'Switch', value: false, customized: true, tips: '开启后停止向电脑转发音频，声音由手机播放。' },
  },
}
export default fusion
