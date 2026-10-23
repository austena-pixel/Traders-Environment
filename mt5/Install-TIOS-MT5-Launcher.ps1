[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$LaunchUrl
)

$ErrorActionPreference = 'Stop'
$appDirectory = Join-Path $env:LOCALAPPDATA 'T-IOS\MT5Launcher'
$terminalPathFile = Join-Path $appDirectory 'terminal-path.txt'
$installedScript = Join-Path $appDirectory 'T-IOS-MT5-Launcher.ps1'

function Show-LauncherMessage {
    param([string]$Message, [string]$Title = 'T-IOS MT5 Launcher')
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}

if ($LaunchUrl) {
    try {
        $launchUri = [System.Uri]$LaunchUrl
    } catch {
        exit 2
    }

    if ($launchUri.Scheme -ne 'tios-mt5' -or $launchUri.Host -ne 'launch' -or $launchUri.AbsolutePath -notin @('', '/')) {
        exit 2
    }

    if (-not (Test-Path -LiteralPath $terminalPathFile -PathType Leaf)) {
        Show-LauncherMessage 'The local MT5 launcher is not configured. Return to T-IOS Charts and run the one-time setup.'
        exit 1
    }

    $terminalPath = (Get-Content -LiteralPath $terminalPathFile -Raw).Trim()
    if (-not (Test-Path -LiteralPath $terminalPath -PathType Leaf)) {
        Show-LauncherMessage 'The saved MT5 terminal path is no longer available. Run the one-time setup again and select terminal64.exe.'
        exit 1
    }

    $startMinimized = $launchUri.Query -match '(?:^\?|&)minimized=1(?:&|$)'
    try {
        if ($startMinimized) {
            Start-Process -FilePath $terminalPath -WindowStyle Minimized | Out-Null
        } else {
            Start-Process -FilePath $terminalPath -WindowStyle Normal | Out-Null
        }
    } catch {
        Show-LauncherMessage 'MT5 could not be started. Check that the selected terminal64.exe is still installed.'
        exit 1
    }
    exit 0
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Write-Error 'The T-IOS local launcher currently supports Windows only.'
    exit 1
}

$terminalCandidates = @(
    (Join-Path $env:ProgramFiles 'Deriv MT5\terminal64.exe'),
    (Join-Path $env:ProgramFiles 'MetaTrader 5\terminal64.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Deriv MT5\terminal64.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'MetaTrader 5\terminal64.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Deriv MT5\terminal64.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\MetaTrader 5\terminal64.exe')
)
$terminalPath = $terminalCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1

if (-not $terminalPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the installed MT5 terminal'
    $picker.Filter = 'MetaTrader terminal (terminal64.exe or terminal.exe)|terminal64.exe;terminal.exe'
    $picker.CheckFileExists = $true
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host 'Setup cancelled. No terminal path or credentials were saved.'
        exit 1
    }
    $terminalPath = $picker.FileName
}

if ([IO.Path]::GetFileName($terminalPath) -notin @('terminal64.exe', 'terminal.exe')) {
    Write-Error 'Select the MT5 terminal executable (terminal64.exe or terminal.exe).'
    exit 1
}

New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force
Set-Content -LiteralPath $terminalPathFile -Value $terminalPath -Encoding UTF8

$protocolKey = 'HKCU:\Software\Classes\tios-mt5'
$openCommandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $protocolKey -Force | Out-Null
Set-Item -Path $protocolKey -Value 'URL:T-IOS MT5 Launcher Protocol'
New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path $openCommandKey -Force | Out-Null
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$command = '"' + $powerShellPath + '" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $installedScript + '" "%1"'
Set-Item -Path $openCommandKey -Value $command

Show-LauncherMessage "Setup is complete. T-IOS can now request that this computer open MT5. The launcher saved the terminal path only; it did not read or store your MT5 login details."
