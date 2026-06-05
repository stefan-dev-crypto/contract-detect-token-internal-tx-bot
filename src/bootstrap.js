import { configureWindowsConsole } from './win-console.js';

const result = configureWindowsConsole();

if (result.applied) {
  if (result.quickEditDisabled) {
    console.log(
      '[console] Disabled Windows Quick Edit mode to prevent accidental pause ' +
        '(clicking the console window no longer freezes the bot).',
    );
  }
} else if (process.platform === 'win32' && !result.skipped) {
  console.warn(
    '[console] Could not disable Quick Edit automatically. ' +
      'If the bot appears frozen until you press Enter, run: ' +
      'powershell -ExecutionPolicy Bypass -File scripts/fix-console-quick-edit.ps1',
  );
}
