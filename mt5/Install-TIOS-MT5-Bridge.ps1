[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeName = 'TradersEnvironmentBridge'
$allowUrl = 'https://tmxosoyqflmwqzjgnkez.supabase.co'
$sourcePath = Join-Path $PSScriptRoot ($bridgeName + '.mq5')

function Show-SetupMessage {
    param(
        [string]$Message,
        [string]$Title = 'T-IOS MT5 Quick Setup',
        [string]$Icon = 'Information'
    )

    Add-Type -AssemblyName System.Windows.Forms
    $iconValue = [Enum]::Parse([System.Windows.Forms.MessageBoxIcon], $Icon)
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $iconValue
    ) | Out-Null
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Write-Error 'This quick setup works on Windows. On macOS or Linux, use the manual setup guide.'
    exit 1
}

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    Show-SetupMessage "The bridge source file is missing from this folder:`n$sourcePath" 'Setup files missing' 'Error'
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
$terminalPath = $terminalCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1

if (-not $terminalPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the MT5 terminal'
    $picker.Filter = 'MetaTrader terminal (terminal64.exe or terminal.exe)|terminal64.exe;terminal.exe'
    $picker.CheckFileExists = $true
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        exit 1
    }
    $terminalPath = $picker.FileName
}

if ([IO.Path]::GetFileName($terminalPath) -notin @('terminal64.exe', 'terminal.exe')) {
    Show-SetupMessage 'Select the MT5 terminal file, usually named terminal64.exe.' 'MT5 terminal not selected' 'Warning'
    exit 1
}

$installDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $terminalPath)).TrimEnd('\')
$dataDirectory = $null
$portableMarker = Join-Path $installDirectory 'portable'

if (Test-Path -LiteralPath $portableMarker -PathType Leaf) {
    $dataDirectory = $installDirectory
} else {
    $dataRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
    $dataMatches = @()

    if (Test-Path -LiteralPath $dataRoot -PathType Container) {
        foreach ($folder in Get-ChildItem -LiteralPath $dataRoot -Directory -ErrorAction SilentlyContinue) {
            $originFile = Join-Path $folder.FullName 'origin.txt'
            if (-not (Test-Path -LiteralPath $originFile -PathType Leaf)) {
                continue
            }

            $origin = (Get-Content -LiteralPath $originFile -Raw -ErrorAction SilentlyContinue).Trim().Trim('"')
            if (-not $origin) {
                continue
            }

            if ([IO.Path]::GetFileName($origin) -in @('terminal64.exe', 'terminal.exe')) {
                $origin = Split-Path -Parent $origin
            }

            try {
                $originDirectory = [IO.Path]::GetFullPath($origin).TrimEnd('\')
                if ($originDirectory -ieq $installDirectory -and (Test-Path -LiteralPath (Join-Path $folder.FullName 'MQL5') -PathType Container)) {
                    $dataMatches += $folder
                }
            } catch {
                continue
            }
        }
    }

    if ($dataMatches.Count -gt 0) {
        $dataDirectory = ($dataMatches | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    }
}

if (-not $dataDirectory) {
    Show-SetupMessage "I found MT5, but not its data folder yet.`n`nOpen the Deriv MT5 account you use with T-IOS, choose File > Open Data Folder once, close that window, then run this installer again." 'Open MT5 once' 'Warning'
    exit 1
}

$expertDirectory = Join-Path $dataDirectory 'MQL5\Experts'
New-Item -ItemType Directory -Path $expertDirectory -Force | Out-Null
$targetPath = Join-Path $expertDirectory ($bridgeName + '.mq5')
$compiledPath = Join-Path $expertDirectory ($bridgeName + '.ex5')
Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force

$metaEditorCandidates = @(
    (Join-Path $installDirectory 'MetaEditor64.exe'),
    (Join-Path $installDirectory 'MetaEditor.exe')
)
$metaEditorPath = $metaEditorCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if (-not $metaEditorPath) {
    Show-SetupMessage "The bridge was copied to MT5, but MetaEditor was not found to compile it automatically.`n`nOpen TradersEnvironmentBridge.mq5 from File > Open Data Folder > MQL5 > Experts, then press F7 in MetaEditor. After it compiles, continue with the three setup steps in T-IOS." 'Compile the bridge in MetaEditor' 'Warning'
    exit 0
}

if (Test-Path -LiteralPath $compiledPath -PathType Leaf) {
    Remove-Item -LiteralPath $compiledPath -Force
}
$compileLog = Join-Path $env:TEMP 'T-IOS-MT5-Bridge-compile.log'
$compileArguments = '/compile:"{0}" /log:"{1}"' -f $targetPath, $compileLog
Start-Process -FilePath $metaEditorPath -ArgumentList $compileArguments -Wait | Out-Null

if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf)) {
    $detail = ''
    if (Test-Path -LiteralPath $compileLog -PathType Leaf) {
        $detail = (Get-Content -LiteralPath $compileLog -Tail 8 -ErrorAction SilentlyContinue) -join "`n"
    }
    Show-SetupMessage "The source was copied, but MT5 did not create the compiled EA yet.`n`nOpen the source in MetaEditor and press F7. Then continue with the setup steps in T-IOS.`n`n$detail" 'Finish compiling in MetaEditor' 'Warning'
    exit 0
}

Show-SetupMessage "The T-IOS bridge is installed and compiled.`n`nNext in MT5:`n1. Open Tools > Options > Expert Advisors and allow this URL:`n$allowUrl`n2. Attach TradersEnvironmentBridge to a chart.`n3. Paste your T-IOS setup code into TE_Setup_Code.`n`nThe installer did not access your MT5 password or T-IOS setup code." 'Bridge installed'
exit 0
