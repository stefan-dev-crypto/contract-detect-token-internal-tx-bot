import koffi from 'koffi';

const STD_INPUT_HANDLE = -10;
const ENABLE_QUICK_EDIT_MODE = 0x0040;
const ENABLE_INSERT_MODE = 0x0020;
const ENABLE_EXTENDED_FLAGS = 0x0080;

let configured = false;

export function configureWindowsConsole() {
  if (configured || process.platform !== 'win32') {
    return {
      applied: false,
      skipped: true,
      reason: process.platform !== 'win32' ? 'not-windows' : 'already-configured',
    };
  }

  configured = true;

  try {
    const kernel32 = koffi.load('kernel32.dll');
    const GetStdHandle = kernel32.func('void* __stdcall GetStdHandle(int nStdHandle)');
    const GetConsoleMode = kernel32.func(
      'bool __stdcall GetConsoleMode(void* hConsoleHandle, _Out_ uint32_t* lpMode)',
    );
    const SetConsoleMode = kernel32.func(
      'bool __stdcall SetConsoleMode(void* hConsoleHandle, uint32_t dwMode)',
    );

    const handle = GetStdHandle(STD_INPUT_HANDLE);

    if (!handle) {
      return { applied: false, reason: 'no-console-handle' };
    }

    const mode = [0];

    if (!GetConsoleMode(handle, mode)) {
      return { applied: false, reason: 'get-console-mode-failed' };
    }

    const previousMode = mode[0];
    const newMode =
      (previousMode & ~ENABLE_QUICK_EDIT_MODE & ~ENABLE_INSERT_MODE) | ENABLE_EXTENDED_FLAGS;

    if (!SetConsoleMode(handle, newMode)) {
      return { applied: false, reason: 'set-console-mode-failed', previousMode };
    }

    return {
      applied: true,
      previousMode,
      newMode,
      quickEditDisabled: Boolean(previousMode & ENABLE_QUICK_EDIT_MODE),
    };
  } catch (error) {
    return {
      applied: false,
      reason: error.message,
    };
  }
}
