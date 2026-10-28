# Connect Deriv MT4 to T-IOS

The bridge is read-only. It sends an MT4 account snapshot, open market positions, and closed orders from the link start time onward. It never places, changes, or closes trades, and T-IOS never asks for the MT4 password.

## Quick setup on Windows

### 1. Create your link in T-IOS

Open **Settings & Connections**, choose **MT4**, select **Demo** or **Real**, enter the MT4 login, and create the link. The account name and server are optional; the EA verifies the server and T-IOS saves it after the first sync.

Copy the one-time **MT4 setup code** shown after the link is created. If it is lost, choose **New Key** on the linked account card to make a replacement.

### 2. Install the bridge

Download **Windows quick setup**, extract the ZIP, and double-click `Install-TIOS-MT4-Bridge.cmd`. It finds the MT4 data folder, copies the bridge, and compiles it when MetaEditor is available. It does not need administrator access or your MT4 password.

If it says the data folder is missing, open the matching Deriv MT4 account and choose **File → Open Data Folder** once, then run the installer again.

### 3. Allow and connect

In MT4, open **Tools → Options → Expert Advisors**. Add this URL to the allowed WebRequest list:

`https://tmxosoyqflmwqzjgnkez.supabase.co`

Open a chart in the same Deriv account, attach `TradersEnvironmentBridge`, and paste the setup code into **TE_Setup_Code**. Leave the other inputs at their defaults. Keep MT4 open while you want T-IOS to sync.

## Manual setup

Copy `TradersEnvironmentBridge.mq4` to the terminal's `MQL4/Experts` folder and compile it in MetaEditor with **F7**. Then follow step 3 above.

## Disconnect and reconnect

Choose **Disconnect** on the linked account card in T-IOS to stop future syncs and clear the live snapshot. Completed journal trades remain available.

Choose **Reconnect** to start a new cutoff. Orders opened before reconnection stay excluded. If you choose **New Key**, paste the replacement setup code into the EA inputs.

## What gets synced

- The EA checks the account every 30 seconds by default.
- T-IOS starts recording at the link or reconnect time; older orders are excluded.
- If MT4 stops syncing for two minutes, T-IOS marks the connection stale and hides the old live snapshot.
- The EA contains no order placement, modification, or close-trade commands.