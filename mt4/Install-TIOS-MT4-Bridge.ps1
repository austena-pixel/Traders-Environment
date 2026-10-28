[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeName = 'TradersEnvironmentBridge'
$allowUrl = 'https://tmxosoyqflmwqzjgnkez.supabase.co'
$sourcePath = Join-Path $PSScriptRoot ($bridgeName + '.mq4')

function Show-SetupMessage {
    param(
        [string]$Message,
        [string]$Title = 'T-IOS MT4 Quick Setup',
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
    (Join-Path $env:ProgramFiles 'Deriv MT4\terminal.exe'),
    (Join-Path $env:ProgramFiles 'MetaTrader 4\terminal.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Deriv MT4\terminal.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'MetaTrader 4\terminal.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Deriv MT4\terminal.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\MetaTrader 4\terminal.exe')
)

$terminalPath = $terminalCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1

if (-not $terminalPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = 'Select the MT4 terminal'
    $picker.Filter = 'MetaTrader 4 terminal (terminal.exe)|terminal.exe'
    $picker.CheckFileExists = $true
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        exit 1
    }
    $terminalPath = $picker.FileName
}

if ([IO.Path]::GetFileName($terminalPath) -ine 'terminal.exe') {
    Show-SetupMessage 'Select the MT4 terminal file named terminal.exe.' 'MT4 terminal not selected' 'Warning'
    exit 1
}

$installDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $terminalPath)).TrimEnd('\')
$dataDirectory = $null

if (Test-Path -LiteralPath (Join-Path $installDirectory 'portable') -PathType Leaf) {
    $portableMql4 = Join-Path $installDirectory 'MQL4'
    if (Test-Path -LiteralPath $portableMql4 -PathType Container) {
        $dataDirectory = $installDirectory
    }
} else {
    $dataRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
    $dataMatches = @()

    if (Test-Path -LiteralPath $dataRoot -PathType Container) {
        foreach ($folder in Get-ChildItem -LiteralPath $dataRoot -Directory -ErrorAction SilentlyContinue) {
            $originFile = Join-Path $folder.FullName 'origin.txt'
            $mql4Directory = Join-Path $folder.FullName 'MQL4'
            if (-not (Test-Path -LiteralPath $originFile -PathType Leaf) -or
                -not (Test-Path -LiteralPath $mql4Directory -PathType Container)) {
                continue
            }

            $origin = (Get-Content -LiteralPath $originFile -Raw -ErrorAction SilentlyContinue).Trim().Trim('"')
            if (-not $origin) {
                continue
            }

            if ([IO.Path]::GetFileName($origin) -ieq 'terminal.exe') {
                $origin = Split-Path -Parent $origin
            }

            try {
                $originDirectory = [IO.Path]::GetFullPath($origin).TrimEnd('\')
                if ($originDirectory -ieq $installDirectory) {
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
    Show-SetupMessage "I found MT4, but not its data folder yet.`n`nOpen the matching Deriv MT4 account, choose File > Open Data Folder once, close that window, then run this installer again." 'Open MT4 once' 'Warning'
    exit 1
}

$expertDirectory = Join-Path $dataDirectory 'MQL4\Experts'
New-Item -ItemType Directory -Path $expertDirectory -Force | Out-Null
$targetPath = Join-Path $expertDirectory ($bridgeName + '.mq4')
$compiledPath = Join-Path $expertDirectory ($bridgeName + '.ex4')
Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force

$metaEditorCandidates = @(
    (Join-Path $installDirectory 'metaeditor.exe'),
    (Join-Path $installDirectory 'MetaEditor.exe')
)
$metaEditorPath = $metaEditorCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if (-not $metaEditorPath) {
    Show-SetupMessage "The bridge source was copied to MT4, but MetaEditor was not found to compile it automatically.`n`nOpen TradersEnvironmentBridge.mq4 from File > Open Data Folder > MQL4 > Experts, then press F7 in MetaEditor. After it compiles, follow the steps in T-IOS." 'Compile in MetaEditor' 'Warning'
    exit 0
}

if (Test-Path -LiteralPath $compiledPath -PathType Leaf) {
    Remove-Item -LiteralPath $compiledPath -Force
}
$compileLog = Join-Path $env:TEMP 'T-IOS-MT4-Bridge-compile.log'
$compileArguments = "/compile:`"$targetPath`" /log:`"$compileLog`""
Start-Process -FilePath $metaEditorPath -ArgumentList $compileArguments -Wait | Out-Null

if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf)) {
    $detail = ''
    if (Test-Path -LiteralPath $compileLog -PathType Leaf) {
        $detail = (Get-Content -LiteralPath $compileLog -Tail 8 -ErrorAction SilentlyContinue) -join "`n"
    }
    Show-SetupMessage "The source was copied, but MT4 did not create the compiled EA yet.`n`nOpen the source in MetaEditor and press F7, then continue with the setup steps in T-IOS.`n`n$detail" 'Finish compiling in MetaEditor' 'Warning'
    exit 0
}

Show-SetupMessage "The T-IOS MT4 bridge is installed and compiled.`n`nNext in MT4:`n1. Open Tools > Options > Expert Advisors and allow this URL:`n$allowUrl`n2. Attach TradersEnvironmentBridge to a chart.`n3. Paste your T-IOS setup code into TE_Setup_Code.`n`nThe installer did not access your MT4 password or setup code." 'Bridge installed'
exit 0