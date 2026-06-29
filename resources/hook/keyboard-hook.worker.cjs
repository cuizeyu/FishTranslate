// Windows 低级键盘钩子 worker（WH_KEYBOARD_LL）
// 在独立线程运行自己的消息循环，在按键分发给其他应用前拦截并吞掉目标组合键，
// 从而"抢占"该快捷键，让其他应用注册的同名快捷键失效。
/* eslint-disable */
const { workerData, parentPort } = require('worker_threads')
const koffi = require(workerData.koffiPath)

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' })
const MSG = koffi.struct('MSG', {
  hwnd: 'void *',
  message: 'uint32',
  wParam: 'uintptr_t',
  lParam: 'intptr_t',
  time: 'uint32',
  pt: POINT
})

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t'
})

// __stdcall 在 x64 上等价于默认调用约定，这里写明以便兼容
const HOOKPROC = koffi.proto('intptr_t __stdcall HOOKPROC(int nCode, uintptr_t wParam, void *lParam)')

const SetWindowsHookExW = user32.func('void *SetWindowsHookExW(int idHook, void *lpfn, void *hMod, uint32 dwThreadId)')
const UnhookWindowsHookEx = user32.func('int __stdcall UnhookWindowsHookEx(void *hhk)')
const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)')
const GetMessageW = user32.func('int __stdcall GetMessageW(void *lpMsg, void *hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax)')
const PeekMessageW = user32.func('int __stdcall PeekMessageW(void *lpMsg, void *hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax, uint32 wRemoveMsg)')
const TranslateMessage = user32.func('int __stdcall TranslateMessage(void *lpMsg)')
const DispatchMessageW = user32.func('intptr_t __stdcall DispatchMessageW(void *lpMsg)')
const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)')
const GetModuleHandleW = kernel32.func('void *GetModuleHandleW(void *lpModuleName)')
const SetTimer = user32.func('uintptr_t __stdcall SetTimer(void *hWnd, uintptr_t nIDEvent, uint32 uElapse, void *lpTimerFunc)')
const KillTimer = user32.func('int __stdcall KillTimer(void *hWnd, uintptr_t uIDEvent)')

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_SYSKEYDOWN = 0x0104
const WM_KEYUP = 0x0101
const WM_SYSKEYUP = 0x0105
const WM_TIMER = 0x0113
const PM_REMOVE = 0x0001
const REHOOK_INTERVAL_MS = 2000

const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const VK_MENU = 0x12 // Alt

const NAMED_KEYS = {
  space: 0x20,
  return: 0x0d,
  enter: 0x0d,
  tab: 0x09,
  backspace: 0x08,
  insert: 0x2d,
  delete: 0x2e,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28
}

function keyToVk(key) {
  if (!key) return 0
  const k = key.toLowerCase()
  if (/^[a-z]$/.test(k)) return k.charCodeAt(0) - 32 // 'a' -> 0x41
  if (/^[0-9]$/.test(k)) return k.charCodeAt(0) // '0' -> 0x30
  const fMatch = k.match(/^f([1-9]|1[0-9]|2[0-4])$/)
  if (fMatch) return 0x6f + parseInt(fMatch[1], 10) // F1 -> 0x70
  return NAMED_KEYS[k] || 0
}

function parseAccel(acc) {
  const parts = acc.split('+').map((s) => s.trim().toLowerCase())
  let needCtrl = false
  let needAlt = false
  let needShift = false
  let mainKey = null
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') needCtrl = true
    else if (p === 'cmd' || p === 'command' || p === 'commandorcontrol' || p === 'cmdorctrl') needCtrl = true
    else if (p === 'alt' || p === 'option') needAlt = true
    else if (p === 'shift') needShift = true
    else mainKey = p
  }
  return { needCtrl, needAlt, needShift, vk: keyToVk(mainKey) }
}

let config = parseAccel(workerData.accelerator || '')
let suppressNextUp = false

const onHook = koffi.register((nCode, wParam, lParam) => {
  if (nCode >= 0 && config.vk !== 0) {
    const isDown = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN
    const isUp = wParam === WM_KEYUP || wParam === WM_SYSKEYUP
    if (isDown || isUp) {
      const info = koffi.decode(lParam, KBDLLHOOKSTRUCT)
      if (info.vkCode === config.vk) {
        const ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) !== 0
        const altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) !== 0
        const shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) !== 0
        if (
          ctrlDown === config.needCtrl &&
          altDown === config.needAlt &&
          shiftDown === config.needShift
        ) {
          if (isDown) {
            suppressNextUp = true
            parentPort.postMessage({ type: 'trigger' })
            return 1 // 吞掉按键，不传递给其他应用
          }
          if (isUp && suppressNextUp) {
            suppressNextUp = false
            return 1
          }
        }
      }
    }
  }
  return CallNextHookEx(null, nCode, wParam, lParam)
}, koffi.pointer(HOOKPROC))

const hMod = GetModuleHandleW(null)
let hHook = SetWindowsHookExW(WH_KEYBOARD_LL, onHook, hMod, 0)

// 周期性重装钩子，让自己始终位于钩子链顶部（最近安装的先被调用），
// 这样即使别的应用（如有道云）也装了低级键盘钩子，我们也会先于它们拦截并吞掉按键。
function rehook() {
  const newHook = SetWindowsHookExW(WH_KEYBOARD_LL, onHook, hMod, 0)
  if (newHook) {
    if (hHook) UnhookWindowsHookEx(hHook)
    hHook = newHook
  }
}

if (!hHook) {
  parentPort.postMessage({ type: 'ready', ok: false, error: 'SetWindowsHookEx 失败' })
} else {
  parentPort.postMessage({ type: 'ready', ok: true })
}

// 接收主进程发来的快捷键更新（实时生效）
parentPort.on('message', (msg) => {
  if (msg && msg.type === 'update' && typeof msg.accelerator === 'string') {
    config = parseAccel(msg.accelerator)
  }
})

// 用 setInterval + PeekMessage 轮询消息，而不是阻塞的 GetMessage。
// 这样 Node 的 libuv 事件循环能正常 tick，parentPort 的更新消息才能被处理（换键实时生效）。
const msgBuf = koffi.alloc(MSG, 1)
const pumpInterval = setInterval(() => {
  while (PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE) > 0) {
    TranslateMessage(msgBuf)
    DispatchMessageW(msgBuf)
  }
}, 8)

// 周期性重装钩子，保持在链顶
const rehookInterval = setInterval(rehook, REHOOK_INTERVAL_MS)

// 保持 worker 不退出
process.on('exit', () => {
  clearInterval(pumpInterval)
  clearInterval(rehookInterval)
  if (hHook) UnhookWindowsHookEx(hHook)
})
