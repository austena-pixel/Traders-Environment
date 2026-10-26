# Connect Deriv MT5 to T-IOS

The bridge is read-only. It sends your account snapshot and trading activity from the connection start time onward. It never places, changes, or closes trades, and T-IOS never asks for your MT5 password.

## Quick setup on Windows

### 1. Create your link in T-IOS

Open **Settings & Connections**. Choose **Demo** or **Real**, enter your MT5 login, and create the link. The account name is optional; T-IOS detects the MT5 server automatically.

Copy the one-time **MT5 setup code** shown after the link is created. It is private to this connection. If you lose it, choose **New Key** on the linked account card to make a replacement.

### 2. Install the bridge once

Download **Windows quick setup**, extract the ZIP, and double-click `Install-TIOS-MT5-Bridge.cmd`. It finds your MT5 data folder, copies the bridge, and compiles it when MetaEditor is available. It does not need administrator access or your MT5 password.

If it says the data folder is missing, open the matching Deriv MT5 account, choose **File → Open Data Folder** once, then run the installer again.

### 3. Allow and connect

In MT5, open **Tools → Options → Expert Advisors**. Allow the T-IOS URL shown in Settings; use **Copy URL for MT5** to copy it.

Open a chart in the same Deriv account, attach `TradersEnvironmentBridge`, and paste the setup code into **TE_Setup_Code**. Leave the other inputs at their defaults. Keep MT5 open while you want T-IOS to sync.

## Manual setup

If you prefer not to use the installer, download `TradersEnvironmentBridge.mq5`, copy it into the terminal's `MQL5/Experts` folder, and compile it in MetaEditor with **F7**. Then follow step 3 above.

## Disconnect and reconnect

Choose **Disconnect** on the linked account card in T-IOS to stop future syncs and clear the displayed live snapshot. Completed journal trades already saved in T-IOS remain available.

Choose **Reconnect** to start a new cutoff. Activity from before reconnection stays excluded. If you choose **New Key**, paste the replacement setup code into the EA inputs.

## What gets synced

- The EA checks the account every 30 seconds by default and sends recent deals in small batches.
- T-IOS starts recording from the link or reconnect time; older MT5 history is excluded.
- If MT5 stops syncing for two minutes, T-IOS marks the connection stale and hides the old live snapshot.
- The EA has no order placement, modification, or close-trade commands.
