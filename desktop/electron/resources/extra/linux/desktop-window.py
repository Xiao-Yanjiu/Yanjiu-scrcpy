#!/usr/bin/env python3
"""X11 native-window bridge. JSON lines on stdin/stdout; no shell commands."""
import ctypes as C
import ctypes.util
import json
import math
import os
import select
import sys

Window = C.c_ulong
Display = C.c_void_p


class Rectangle(C.Structure):
    _fields_ = [('x', C.c_short), ('y', C.c_short), ('width', C.c_ushort), ('height', C.c_ushort)]


class ButtonEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', Display), ('window', Window), ('root', Window), ('subwindow', Window), ('time', C.c_ulong), ('x', C.c_int), ('y', C.c_int), ('x_root', C.c_int), ('y_root', C.c_int), ('state', C.c_uint), ('button', C.c_uint), ('same_screen', C.c_int)]


class ClientData(C.Union):
    _fields_ = [('l', C.c_long * 5)]


class ClientMessage(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', Display), ('window', Window), ('message_type', C.c_ulong), ('format', C.c_int), ('data', ClientData)]


class Event(C.Union):
    _fields_ = [('type', C.c_int), ('button', ButtonEvent), ('client', ClientMessage), ('pad', C.c_long * 24)]


def rounded_rectangles(x, y, width, height, radius):
    width, height = max(0, int(width)), max(0, int(height))
    radius = max(0, min(int(radius), width // 2, height // 2))
    if not width or not height:
        return []
    if not radius:
        return [(int(x), int(y), width, height)]
    rows = []
    for row in range(height):
        edge = min(row, height - row - 1)
        inset = 0
        if edge < radius:
            dy = radius - edge - 0.5
            inset = max(0, int(math.ceil(radius - math.sqrt(radius * radius - dy * dy) - 0.5)))
        rows.append((int(x) + inset, int(y) + row, width - inset * 2, 1))
    return rows


class Bridge:
    def __init__(self, parent):
        self.x = C.CDLL(C.util.find_library('X11') or 'libX11.so.6')
        self.ext = C.CDLL(C.util.find_library('Xext') or 'libXext.so.6')
        signatures = {
            'XOpenDisplay': ([C.c_char_p], Display),
            'XDefaultRootWindow': ([Display], Window),
            'XConnectionNumber': ([Display], C.c_int),
            'XInternAtom': ([Display, C.c_char_p, C.c_int], C.c_ulong),
            'XQueryTree': ([Display, Window, C.POINTER(Window), C.POINTER(Window), C.POINTER(C.POINTER(Window)), C.POINTER(C.c_uint)], C.c_int),
            'XGetWindowProperty': ([Display, Window, C.c_ulong, C.c_long, C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ubyte))], C.c_int),
            'XFetchName': ([Display, Window, C.POINTER(C.c_char_p)], C.c_int),
            'XFree': ([C.c_void_p], C.c_int),
            'XReparentWindow': ([Display, Window, Window, C.c_int, C.c_int], C.c_int),
            'XMoveResizeWindow': ([Display, Window, C.c_int, C.c_int, C.c_uint, C.c_uint], C.c_int),
            'XMapWindow': ([Display, Window], C.c_int),
            'XUnmapWindow': ([Display, Window], C.c_int),
            'XSendEvent': ([Display, Window, C.c_int, C.c_long, C.POINTER(Event)], C.c_int),
            'XRaiseWindow': ([Display, Window], C.c_int),
            'XLowerWindow': ([Display, Window], C.c_int),
            'XSetInputFocus': ([Display, Window, C.c_int, C.c_ulong], C.c_int),
            'XGetInputFocus': ([Display, C.POINTER(Window), C.POINTER(C.c_int)], C.c_int),
            'XFlush': ([Display], C.c_int),
            'XSync': ([Display, C.c_int], C.c_int),
            'XPending': ([Display], C.c_int),
            'XNextEvent': ([Display, C.POINTER(Event)], C.c_int),
            'XGrabButton': ([Display, C.c_uint, C.c_uint, Window, C.c_int, C.c_uint, C.c_int, C.c_int, Window, C.c_ulong], C.c_int),
            'XUngrabButton': ([Display, C.c_uint, C.c_uint, Window], C.c_int),
            'XChangeProperty': ([Display, Window, C.c_ulong, C.c_ulong, C.c_int, C.c_int, C.c_void_p, C.c_int], C.c_int),
        }
        for name, (args, result) in signatures.items():
            method = getattr(self.x, name)
            method.argtypes, method.restype = args, result
        self.ext.XShapeCombineRectangles.argtypes = [Display, Window, C.c_int, C.c_int, C.c_int, C.POINTER(Rectangle), C.c_int, C.c_int, C.c_int]
        self.error = 0
        self.error_callback = C.CFUNCTYPE(C.c_int, Display, C.c_void_p)(self.on_error)
        self.x.XSetErrorHandler.argtypes = [C.c_void_p]
        self.x.XSetErrorHandler(self.error_callback)
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError('无法连接 X11 显示服务。请使用 X11 桌面会话，并从桌面启动程序。')
        self.root = self.x.XDefaultRootWindow(self.display)
        self.parent = int(parent)
        self.windows = {}
        self.background = set()
        self.hidden = {}
        self.right = set()
        self.last_focus = ''
        self.host_input = False
        self.floating = set()

    def skip_switcher(self, handle):
        if handle in self.floating:
            return
        event = Event()
        event.client.type = 33
        event.client.display = self.display
        event.client.window = handle
        event.client.message_type = self.atom('_NET_WM_STATE')
        event.client.format = 32
        event.client.data.l[0] = 1
        event.client.data.l[1] = self.atom('_NET_WM_STATE_SKIP_TASKBAR')
        event.client.data.l[2] = self.atom('_NET_WM_STATE_SKIP_PAGER')
        event.client.data.l[3] = 1
        self.x.XSendEvent(self.display, self.root, False, (1 << 20) | (1 << 19), C.byref(event))
        self.floating.add(handle)

    def on_error(self, _display, _event):
        self.error += 1
        return 0

    def atom(self, name):
        return self.x.XInternAtom(self.display, name.encode(), False)

    def property(self, window, name):
        kind, bits, count, remaining = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong()
        data = C.POINTER(C.c_ubyte)()
        result = self.x.XGetWindowProperty(self.display, window, self.atom(name), 0, 4096, False, 0, C.byref(kind), C.byref(bits), C.byref(count), C.byref(remaining), C.byref(data))
        if result or not data:
            return None
        try:
            if bits.value == 32:
                values = C.cast(data, C.POINTER(C.c_ulong))
                return [values[i] for i in range(count.value)]
            return C.string_at(data, count.value * max(1, bits.value // 8))
        finally:
            self.x.XFree(data)

    def children(self, window):
        root, parent, count = Window(), Window(), C.c_uint()
        values = C.POINTER(Window)()
        if not self.x.XQueryTree(self.display, window, C.byref(root), C.byref(parent), C.byref(values), C.byref(count)):
            return []
        try:
            return [values[i] for i in range(min(count.value, 10000))]
        finally:
            if values:
                self.x.XFree(values)

    def find(self, pid, title):
        # Exact process ID + exact UTF-8 title; never touch unrelated windows.
        todo = self.children(self.root)
        visited = set()
        while todo and len(visited) < 20000:
            window = todo.pop()
            if window in visited:
                continue
            visited.add(window)
            process = self.property(window, '_NET_WM_PID')
            if process and process[0] == int(pid):
                name = self.property(window, '_NET_WM_NAME') or self.property(window, 'WM_NAME')
                if isinstance(name, bytes) and name.rstrip(b'\0').decode('utf-8', 'replace') == title:
                    return window
            todo.extend(self.children(window))
        return 0

    def active(self):
        window, revert = Window(), C.c_int()
        self.x.XGetInputFocus(self.display, C.byref(window), C.byref(revert))
        current = window.value
        for _ in range(24):
            for app, handle in self.windows.items():
                if current == handle:
                    return app
            if current in (0, 1, self.root, self.parent):
                break
            root, parent, count = Window(), Window(), C.c_uint()
            values = C.POINTER(Window)()
            if not self.x.XQueryTree(self.display, current, C.byref(root), C.byref(parent), C.byref(values), C.byref(count)):
                break
            if values:
                self.x.XFree(values)
            current = parent.value
        return ''

    def shape(self, handle, rectangles, operation=0):
        array = (Rectangle * len(rectangles))(*(Rectangle(*rect) for rect in rectangles))
        self.ext.XShapeCombineRectangles(self.display, handle, 0, 0, 0, array, len(rectangles), operation, 0)

    def focus(self, handle):
        self.x.XRaiseWindow(self.display, self.parent)
        self.x.XRaiseWindow(self.display, handle)
        self.x.XSetInputFocus(self.display, handle, 2, 0)
        return True

    def request(self, message):
        command = message['command']
        if command == 'register-external':
            handle = self.find(message['pid'], message['title'])
            if handle:
                self.windows[message['appId']] = handle
            return bool(handle)
        if command == 'attach':
            handle = self.find(message['pid'], message['title'])
            if not handle:
                return False
            app = message['appId']
            self.x.XUnmapWindow(self.display, handle)
            self.x.XReparentWindow(self.display, handle, self.parent, 0, 0)
            self.windows[app] = handle
            self.x.XSync(self.display, False)
            return True
        if command == 'sync':
            for item in message.get('windows', [])[:13]:
                app = item['id']
                handle = self.windows.get(app)
                if not handle:
                    continue
                x, y = int(item['x']), int(item['y'])
                width, height = int(item['width']), int(item['height'])
                if not item.get('visible') or width < 2 or height < 2:
                    self.x.XUnmapWindow(self.display, handle)
                    continue
                self.x.XMoveResizeWindow(self.display, handle, x, y, width, height)
                self.shape(handle, rounded_rectangles(0, 0, width, height, item.get('radius', 0)))
                for clip in item.get('clips', [])[:40]:
                    self.shape(handle, rounded_rectangles(clip['x'] - x, clip['y'] - y, clip['width'], clip['height'], clip.get('radius', 0)), 3)
                self.x.XMapWindow(self.display, handle)
                if app in self.background:
                    self.x.XLowerWindow(self.display, handle)
                else:
                    self.x.XRaiseWindow(self.display, handle)
            return True
        if command == 'active':
            app = self.active()
            if app != self.last_focus and app:
                self.host_input = False
                output({'event': 'pointer-down', 'appId': app})
            self.last_focus = app
            return app
        if command == 'focus':
            handle = self.windows.get(message['appId'])
            return self.focus(handle) if handle else False
        if command == 'host-input':
            self.host_input = bool(message.get('active'))
            if self.host_input:
                self.x.XSetInputFocus(self.display, self.parent, 2, 0)
            return True
        if command == 'background':
            self.background.add(message['appId'])
            handle = self.windows.get(message['appId'])
            if handle:
                self.x.XLowerWindow(self.display, handle)
            return True
        if command == 'right-button':
            app = message['appId']
            handle = self.windows.get(app)
            if not handle:
                return False
            self.x.XUngrabButton(self.display, 3, 32768, handle)
            self.right.discard(app)
            if message.get('enabled'):
                errors = self.error
                self.x.XGrabButton(self.display, 3, 32768, handle, False, 4 | 8, 1, 1, 0, 0)
                self.x.XSync(self.display, False)
                if self.error != errors:
                    raise RuntimeError('当前 X11 服务不能注册此窗口的右键返回')
                self.right.add(app)
            return True
        if command == 'forget':
            app = message['appId']
            handle = self.windows.pop(app, None)
            if handle:
                self.x.XUngrabButton(self.display, 3, 32768, handle)
            self.background.discard(app)
            self.right.discard(app)
            return True
        if command == 'mirror-floating':
            handle = self.find(message['pid'], message['title'])
            if not handle:
                return 'missing'
            self.skip_switcher(handle)
            state = self.property(handle, 'WM_STATE')
            if state and state[0] == 3:
                return 'minimized'
            if handle in self.hidden:
                return 'hidden'
            return 'visible'
        if command == 'popup-tray':
            self.skip_switcher(self.parent)
            return True  # Electron owns the Linux tray and skipTaskbar state.
        if command in ('mirror-focus', 'mirror-visibility'):
            handle = self.find(message['pid'], message['title'])
            if not handle:
                return False
            if command == 'mirror-focus':
                self.x.XMapWindow(self.display, handle)
                self.x.XRaiseWindow(self.display, handle)
                self.x.XSetInputFocus(self.display, handle, 2, 0)
            elif message.get('hidden'):
                if handle not in self.hidden:
                    state = self.property(handle, 'WM_STATE')
                    self.hidden[handle] = not state or state[0] == 1
                    if self.hidden[handle]:
                        self.x.XUnmapWindow(self.display, handle)
            elif self.hidden.pop(handle, False):
                self.x.XMapWindow(self.display, handle)
            return True
        if command == 'fusion-anchor':
            return None  # Use Electron's display work area on UKUI panels.
        if command == 'popup-taskbar':
            return {'taskbarRegistered': True, 'toolWindow': False, 'appWindow': True}
        raise ValueError('Unsupported desktop command: ' + command)

    def events(self):
        while self.x.XPending(self.display):
            event = Event()
            self.x.XNextEvent(self.display, C.byref(event))
            if event.type == 4 and event.button.button == 3:
                for app, handle in self.windows.items():
                    if handle == event.button.window and app in self.right:
                        if self.active() != app:
                            self.focus(handle)
                        output({'event': 'right-back', 'appId': app})
                        break


def output(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    bridge = Bridge(int(sys.argv[1]))
    output({'ready': True, 'mouseAvailable': True})
    data = b''
    stdin = sys.stdin.fileno()
    xfd = bridge.x.XConnectionNumber(bridge.display)
    while True:
        bridge.events()
        inputs, _, _ = select.select([stdin, xfd], [], [], 0.1)
        if stdin not in inputs:
            continue
        chunk = os.read(stdin, 65536)
        if not chunk:
            return
        data += chunk
        while b'\n' in data:
            line, data = data.split(b'\n', 1)
            message = {}
            try:
                message = json.loads(line.decode('utf-8'))
                result = bridge.request(message)
                bridge.x.XFlush(bridge.display)
                output({'id': message.get('id'), 'result': result})
            except Exception as error:
                output({'id': message.get('id'), 'error': str(error)})


if __name__ == '__main__':
    try:
        main()
    except Exception as failure:
        print(str(failure), file=sys.stderr, flush=True)
        sys.exit(1)
