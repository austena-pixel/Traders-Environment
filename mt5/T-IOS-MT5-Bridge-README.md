# T-IOS Deriv MT5 read-only bridge

The bridge sends account status, qualifying open positions, and deal history from the link start time onward. It does not import deals or positions from before that cutoff. The EA has no order placement, order modification, or position close calls, and T-IOS never asks for the MT5 password.

## Link an account

1. In T-IOS, open **Settings & Connections** and create a Deriv MT5 link. Enter the same MT5 login and account type that are open in the terminal. The server can be left blank for the first sync; the EA reports it and T-IOS saves it for later identity checks.
2. Save the function URL, connection ID, and bridge key shown after the link is created. The raw bridge key is only shown once. If it is lost, use **New Key** in T-IOS.
3. Download `TradersEnvironmentBridge.mq5` and copy it to the terminal's `MQL5/Experts` folder. Open the file in MetaEditor and compile it.
4. In MT5, open **Tools → Options → Expert Advisors** and allow WebRequest for:

   `https://tmxosoyqflmwqzjgnkez.supabase.co`

5. Attach **TradersEnvironmentBridge** to any chart in the matching Deriv MT5 account. In the EA inputs, enter the function URL, connection ID, and bridge key from T-IOS. Keep the terminal open for ongoing sync.

If you also use `TradersEnvironmentMarketData.mq5` for broker candles, attach it to a second chart in the same terminal and use the same connection ID and bridge key.

MT5 requires this URL allowlist for an EA to make HTTPS requests. The bridge checks the account login, server, and demo/real type on the server before it accepts a sync. A mismatched account is rejected.

## Disconnect or reconnect

Choose **Disconnect** on the linked account card in T-IOS. The server immediately rejects future sync requests and clears the live balance, equity, margin, position count, and last-sync snapshot. Completed journal trades already saved in T-IOS remain available.

Choose **Reconnect** to start a new cutoff. Trades and positions from before that reconnection remain excluded. If the bridge key was rotated, enter the new key in the EA inputs.

## Sync details

- The EA checks the account every 30 seconds by default and sends deals in batches of up to 50. Successful batches advance a terminal-local cursor; failed batches are retried.
- The first handshake supplies the server-set link cutoff and the current MT5-to-UTC clock offset. Trade times are normalized before they are saved.
- T-IOS labels the connection stale/offline after two minutes without a successful sync and hides the old live account snapshot until sync resumes.
- The bridge only posts account snapshots and MT5 trade data over HTTPS. It contains no trading API or order execution code.
