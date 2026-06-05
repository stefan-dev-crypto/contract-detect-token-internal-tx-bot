# Permanently disable Quick Edit Mode for future PowerShell/cmd consoles.
# Quick Edit pauses any running console app when you click the window to select text.
# Pressing Enter resumes it, which looks like the bot "stopped".

$consoleKey = 'HKCU:\Console'
$quickEdit = Get-ItemProperty -Path $consoleKey -Name QuickEdit -ErrorAction SilentlyContinue

if ($quickEdit -and $quickEdit.QuickEdit -eq 0) {
  Write-Host 'Quick Edit is already disabled for new console windows.'
} else {
  New-ItemProperty -Path $consoleKey -Name QuickEdit -PropertyType DWord -Value 0 -Force | Out-Null
  Write-Host 'Quick Edit disabled for new console windows.'
}

Write-Host ''
Write-Host 'Close and reopen PowerShell, then start the bot again.'
Write-Host 'Existing bot sessions are fixed automatically by src/bootstrap.js on startup.'
