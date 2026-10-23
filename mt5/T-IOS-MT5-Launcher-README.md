# T-IOS local MT5 launcher (Windows)

This small, user-level launcher lets a user request that their own Windows computer open its installed MT5 terminal from T-IOS Charts. It does not install MT5, log in to Deriv, or send orders. MT5 opens as a separate desktop window while the T-IOS browser page stays open.

## One-time setup

1. Install Deriv MT5 from [Deriv's official download page](https://deriv.com/trading-platforms/mt5/download) and sign in inside MT5. T-IOS never asks for the MT5 password.
2. Download `Install-TIOS-MT5-Launcher.ps1` from T-IOS Charts. Review the script, then run it on the same Windows computer where MT5 is installed. If it cannot find the terminal, select `terminal64.exe` in the file picker.
3. Return to T-IOS Charts and choose **Open MT5 on this computer**. Allow the browser to open the T-IOS MT5 launcher if prompted. Use the **Start minimized** checkbox to choose whether the terminal starts minimized.

The setup does not require administrator access. It stores the terminal executable path under the current Windows user and registers the `tios-mt5:` URL handler for that user. It does not read or store MT5 credentials. The installed handler accepts only the `tios-mt5://launch` command and ignores other URL paths.

## Scope and current limitation

This is a Windows launcher only. macOS and Linux users can install and open MT5 manually, but this companion does not launch it for them.

Launching MT5 does not establish live trade synchronization. The current repository contains a separate read-only candle-data companion, but it does not contain a T-IOS trade-sync EA or a verified trade-update connection. T-IOS must not display the terminal as connected or treat account trades as synchronized until that bridge is implemented and validated.

The user must keep their own computer and MT5 running for any later local bridge to send updates. No real-money order execution is initiated by this launcher.
