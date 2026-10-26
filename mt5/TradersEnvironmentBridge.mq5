#property strict
#property version   "1.01"
#property description "Read-only Deriv MT5 account and trade-history sync for T-IOS."

input string TE_Function_URL = "https://tmxosoyqflmwqzjgnkez.supabase.co/functions/v1/mt5-sync";
input string TE_Setup_Code = "";
input int    TE_Sync_Interval_Seconds = 30;
input int    TE_Max_Deals_Per_Request = 50;
input int    TE_Timeout_Milliseconds = 10000;

string TE_Connection_ID = "";
string TE_Bridge_Key = "";

struct DealTicketTime
  {
   long  time_msc;
   ulong ticket;
  };

bool ParseSetupCode()
  {
   const int separator = StringFind(TE_Setup_Code, ".");
   if(separator <= 0 || separator >= StringLen(TE_Setup_Code) - 1)
      return false;

   TE_Connection_ID = StringSubstr(TE_Setup_Code, 0, separator);
   TE_Bridge_Key = StringSubstr(TE_Setup_Code, separator + 1);

   return StringLen(TE_Connection_ID) == 36 &&
          StringLen(TE_Bridge_Key) == 67 &&
          StringFind(TE_Bridge_Key, "te_") == 0;
  }

string CursorKey()
  {
   const string login = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   const string id_part = StringSubstr(TE_Connection_ID, 0, 8);
   return "TE_DERIV_" + login + "_" + id_part;
  }

long SavedLong(const string key)
  {
   if(!GlobalVariableCheck(key))
      return 0;
   return (long)GlobalVariableGet(key);
  }

string JsonEscape(string value)
  {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
  }

string JsonNumber(const double value)
  {
   if(!MathIsValidNumber(value))
      return "0";
   return DoubleToString(value, 8);
  }

string IsoDateString(const datetime value)
  {
   string date = TimeToString(value, TIME_DATE);
   StringReplace(date, ".", "-");
   return date;
  }

long JsonLongField(const string body, const string field)
  {
   const string marker = "\"" + field + "\":";
   int start = StringFind(body, marker);
   if(start < 0)
      return 0;
   start += StringLen(marker);

   while(start < StringLen(body))
     {
      const ushort ch = StringGetCharacter(body, start);
      if(ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n')
         break;
      start++;
     }

   int finish = start;
   while(finish < StringLen(body))
     {
      const ushort ch = StringGetCharacter(body, finish);
      if((ch < '0' || ch > '9') && ch != '-')
         break;
      finish++;
     }

   if(finish == start)
      return 0;
   return (long)StringToInteger(StringSubstr(body, start, finish - start));
  }

bool IsBefore(const DealTicketTime &left, const DealTicketTime &right)
  {
   if(left.time_msc != right.time_msc)
      return left.time_msc < right.time_msc;
   return left.ticket < right.ticket;
  }

void SortDealTickets(DealTicketTime &items[], const int left, const int right)
  {
   int i = left;
   int j = right;
   DealTicketTime pivot = items[(left + right) / 2];

   while(i <= j)
     {
      while(IsBefore(items[i], pivot)) i++;
      while(IsBefore(pivot, items[j])) j--;
      if(i <= j)
        {
         DealTicketTime swap = items[i];
         items[i] = items[j];
         items[j] = swap;
         i++;
         j--;
        }
     }

   if(left < j) SortDealTickets(items, left, j);
   if(i < right) SortDealTickets(items, i, right);
  }

double RiskAtStop(const string symbol, const double entry, const double stop, const double volume)
  {
   if(entry <= 0 || stop <= 0 || volume <= 0 || entry == stop)
      return 0;

   double tick_size = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tick_value = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tick_value <= 0)
      tick_value = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tick_size <= 0 || tick_value <= 0)
      return 0;

   return MathAbs(entry - stop) / tick_size * tick_value * volume;
  }

string EntryTypeName(const long entry)
  {
   if(entry == DEAL_ENTRY_IN) return "in";
   if(entry == DEAL_ENTRY_OUT) return "out";
   if(entry == DEAL_ENTRY_OUT_BY) return "out_by";
   if(entry == DEAL_ENTRY_INOUT) return "inout";
   return "";
  }

string BuildPositions(const long sync_started_at_msc, const long server_to_utc_offset_ms)
  {
   string json = "[";
   int added = 0;
   const int total = PositionsTotal();

   for(int i = 0; i < total && added < 500; i++)
     {
      const ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      const long open_time_msc = PositionGetInteger(POSITION_TIME_MSC);
      const long open_time_utc_msc = open_time_msc + server_to_utc_offset_ms;
      const long position_id = PositionGetInteger(POSITION_IDENTIFIER);
      const string symbol = PositionGetString(POSITION_SYMBOL);
      if(position_id <= 0 || open_time_msc <= 0 || open_time_utc_msc < sync_started_at_msc || symbol == "")
         continue;

      const long type = PositionGetInteger(POSITION_TYPE);
      const string direction = type == POSITION_TYPE_SELL ? "Sell" : "Buy";
      const double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      const double stop = PositionGetDouble(POSITION_SL);
      const double volume = PositionGetDouble(POSITION_VOLUME);
      const double take_profit = PositionGetDouble(POSITION_TP);
      const datetime open_time = (datetime)(open_time_utc_msc / 1000);

      if(added > 0) json += ",";
      json += "{\"position_id\":\"" + IntegerToString(position_id) + "\"";
      json += ",\"symbol\":\"" + JsonEscape(symbol) + "\"";
      json += ",\"direction\":\"" + direction + "\"";
      json += ",\"entry_price\":" + JsonNumber(entry);
      json += ",\"stop_loss\":" + JsonNumber(stop);
      json += ",\"take_profit\":" + JsonNumber(take_profit);
      json += ",\"volume\":" + JsonNumber(volume);
      json += ",\"open_time_msc\":" + IntegerToString(open_time_msc);
      json += ",\"open_time\":" + IntegerToString((long)open_time);
      json += ",\"trade_date\":\"" + IsoDateString(open_time) + "\"";
      json += ",\"risk_amount\":" + JsonNumber(RiskAtStop(symbol, entry, stop, volume));
      json += "}";
      added++;
     }

   return json + "]";
  }

string BuildDealJson(const ulong ticket, const long server_to_utc_offset_ms)
  {
   const long time_msc = HistoryDealGetInteger(ticket, DEAL_TIME_MSC);
   const datetime time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
   const long position_id = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
   const long deal_type = HistoryDealGetInteger(ticket, DEAL_TYPE);
   const long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
   const string entry_name = EntryTypeName(entry);
   const string side = deal_type == DEAL_TYPE_SELL ? "sell" : "buy";
   const string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
   const double volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   const double price = HistoryDealGetDouble(ticket, DEAL_PRICE);
   const double stop = HistoryDealGetDouble(ticket, DEAL_SL);
   const double take_profit = HistoryDealGetDouble(ticket, DEAL_TP);
   const double risk = (entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
      ? RiskAtStop(symbol, price, stop, volume)
      : 0;

   string json = "{\"deal_id\":\"" + IntegerToString((long)ticket) + "\"";
   json += ",\"position_id\":\"" + IntegerToString(position_id) + "\"";
   json += ",\"entry_type\":\"" + entry_name + "\"";
   json += ",\"side\":\"" + side + "\"";
   json += ",\"symbol\":\"" + JsonEscape(symbol) + "\"";
   json += ",\"volume\":" + JsonNumber(volume);
   json += ",\"price\":" + JsonNumber(price);
   json += ",\"stop_loss\":" + JsonNumber(stop);
   json += ",\"take_profit\":" + JsonNumber(take_profit);
   json += ",\"risk_amount\":" + JsonNumber(risk);
   json += ",\"profit\":" + JsonNumber(HistoryDealGetDouble(ticket, DEAL_PROFIT));
   json += ",\"commission\":" + JsonNumber(HistoryDealGetDouble(ticket, DEAL_COMMISSION));
   json += ",\"swap\":" + JsonNumber(HistoryDealGetDouble(ticket, DEAL_SWAP));
   json += ",\"fee\":" + JsonNumber(HistoryDealGetDouble(ticket, DEAL_FEE));
   json += ",\"deal_time_msc\":" + IntegerToString(time_msc);
   json += ",\"deal_time\":" + IntegerToString((long)time);
   const datetime utc_time = (datetime)((time_msc + server_to_utc_offset_ms) / 1000);
   json += ",\"trade_date\":\"" + IsoDateString(utc_time) + "\"}";
   return json;
  }

string BuildDeals(
   const long sync_started_at_msc,
   const long cursor_time_msc,
   const long cursor_ticket,
   const long server_to_utc_offset_ms,
   long &batch_last_time_msc,
   long &batch_last_ticket,
   int &batch_count
)
  {
   batch_last_time_msc = cursor_time_msc;
   batch_last_ticket = cursor_ticket;
   batch_count = 0;
   string json = "[";

   if(sync_started_at_msc <= 0)
      return json + "]";

   const long server_cutoff_msc = sync_started_at_msc - server_to_utc_offset_ms;
   const datetime from_time = server_cutoff_msc > 0
      ? (datetime)(server_cutoff_msc / 1000)
      : 0;
   if(!HistorySelect(from_time, TimeCurrent()))
      return json + "]";

   DealTicketTime items[];
   const int history_count = HistoryDealsTotal();
   for(int i = 0; i < history_count; i++)
     {
      const ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      const long server_time_msc = HistoryDealGetInteger(ticket, DEAL_TIME_MSC);
      const long deal_type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      const long time_msc = server_time_msc + server_to_utc_offset_ms;
      if(time_msc < sync_started_at_msc || server_time_msc <= 0)
         continue;
      if(deal_type != DEAL_TYPE_BUY && deal_type != DEAL_TYPE_SELL)
         continue;
      if(time_msc < cursor_time_msc || (time_msc == cursor_time_msc && (long)ticket <= cursor_ticket))
         continue;

      const int count = ArraySize(items);
      ArrayResize(items, count + 1);
      items[count].time_msc = time_msc;
      items[count].ticket = ticket;
     }

   const int available = ArraySize(items);
   if(available <= 0)
      return json + "]";
   if(available > 1)
      SortDealTickets(items, 0, available - 1);

   int maximum = TE_Max_Deals_Per_Request;
   if(maximum < 1) maximum = 1;
   if(maximum > 100) maximum = 100;
   const int count_to_send = MathMin(available, maximum);

   for(int i = 0; i < count_to_send; i++)
     {
      const string row = BuildDealJson(items[i].ticket, server_to_utc_offset_ms);
      if(batch_count > 0) json += ",";
      json += row;
      batch_last_time_msc = items[i].time_msc;
      batch_last_ticket = (long)items[i].ticket;
      batch_count++;
     }

   return json + "]";
  }

bool PostSync(const string payload, string &response)
  {
   char data[];
   char result[];
   string response_headers;
   const int chars = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(chars <= 1)
      return false;
   ArrayResize(data, chars - 1);

   string headers = "Content-Type: application/json\r\n";
   headers += "x-te-connection-id: " + TE_Connection_ID + "\r\n";
   headers += "x-te-bridge-key: " + TE_Bridge_Key + "\r\n";

   ResetLastError();
   const int status = WebRequest(
      "POST",
      TE_Function_URL,
      headers,
      TE_Timeout_Milliseconds,
      data,
      result,
      response_headers
   );

   if(status == -1)
     {
      Print("T-IOS bridge request failed. MT5 error ", GetLastError(),
            ". Check the WebRequest URL allowlist and network connection.");
      return false;
     }

   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(status < 200 || status >= 300 || StringFind(response, "\"ok\":true") < 0)
     {
      Print("T-IOS bridge sync was rejected. HTTP status ", status,
            ". Check the connection ID, key, account type, login and server.");
      return false;
     }

   return true;
  }

void SendReadOnlySync()
  {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      return;

   const long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string account_type = "";
   if(account_mode == ACCOUNT_TRADE_MODE_DEMO)
      account_type = "demo";
   else if(account_mode == ACCOUNT_TRADE_MODE_REAL)
      account_type = "real";
   else
     {
      Print("T-IOS bridge supports Deriv demo or real MT5 accounts only.");
      return;
     }

   const string start_key = CursorKey() + "_start";
   const string time_key = CursorKey() + "_time";
   const string ticket_key = CursorKey() + "_ticket";
   const string offset_key = CursorKey() + "_offset";
   const long sync_started_at_msc = SavedLong(start_key);
   const long cursor_time_msc = SavedLong(time_key);
   const long cursor_ticket = SavedLong(ticket_key);
   const long server_to_utc_offset_ms = SavedLong(offset_key);

   long batch_last_time_msc = cursor_time_msc;
   long batch_last_ticket = cursor_ticket;
   int batch_count = 0;
   const string deals_json = BuildDeals(
      sync_started_at_msc,
      cursor_time_msc,
      cursor_ticket,
      server_to_utc_offset_ms,
      batch_last_time_msc,
      batch_last_ticket,
      batch_count
   );

   string positions_json = "[]";
   if(sync_started_at_msc > 0)
      positions_json = BuildPositions(sync_started_at_msc, server_to_utc_offset_ms);

   const long latest_quote_time = (long)TimeCurrent();
   const long estimated_server_time = (long)TimeTradeServer();
   long terminal_server_time = estimated_server_time;
   if(latest_quote_time > 0 && estimated_server_time >= latest_quote_time &&
      estimated_server_time - latest_quote_time <= 120)
      terminal_server_time = latest_quote_time;
   if(terminal_server_time <= 0)
     {
      Print("T-IOS bridge cannot read the MT5 server clock yet.");
      return;
     }

   string payload = "{\"event\":\"sync\",\"account\":{";
   payload += "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"";
   payload += ",\"server\":\"" + JsonEscape(AccountInfoString(ACCOUNT_SERVER)) + "\"";
   payload += ",\"terminal_server_time_msc\":" + IntegerToString(terminal_server_time * 1000);
   payload += ",\"company\":\"" + JsonEscape(AccountInfoString(ACCOUNT_COMPANY)) + "\"";
   payload += ",\"account_type\":\"" + account_type + "\"";
   payload += ",\"currency\":\"" + JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)) + "\"";
   payload += ",\"balance\":" + JsonNumber(AccountInfoDouble(ACCOUNT_BALANCE));
   payload += ",\"equity\":" + JsonNumber(AccountInfoDouble(ACCOUNT_EQUITY));
   payload += ",\"floating_pnl\":" + JsonNumber(AccountInfoDouble(ACCOUNT_PROFIT));
   payload += ",\"margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN));
   payload += ",\"free_margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_FREE));
   payload += ",\"margin_level\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL));
   payload += ",\"open_positions\":" + IntegerToString(PositionsTotal()) + "}";
   payload += ",\"positions\":" + positions_json;
   payload += ",\"deals\":" + deals_json + "}";

   string response = "";
   if(!PostSync(payload, response))
      return;

   const long server_cutoff = JsonLongField(response, "sync_started_at_msc");
   if(server_cutoff > 0)
      GlobalVariableSet(start_key, (double)server_cutoff);

   const long server_offset = JsonLongField(response, "server_to_utc_offset_ms");
   GlobalVariableSet(offset_key, (double)server_offset);

   if(batch_count > 0)
     {
      GlobalVariableSet(time_key, (double)batch_last_time_msc);
      GlobalVariableSet(ticket_key, (double)batch_last_ticket);
     }
  }

int OnInit()
  {
   if(TE_Function_URL == "" || !ParseSetupCode())
     {
      Print("Paste the one-time setup code from T-IOS into the TE_Setup_Code input.");
      return INIT_PARAMETERS_INCORRECT;
     }

   if(StringFind(TE_Function_URL, "https://") != 0 || StringFind(TE_Function_URL, "/mt5-sync") < 0)
     {
      Print("The T-IOS URL must point to the secure mt5-sync function.");
      return INIT_PARAMETERS_INCORRECT;
     }

   int interval = TE_Sync_Interval_Seconds;
   if(interval < 15) interval = 15;
   if(interval > 300) interval = 300;

   EventSetTimer(interval);
   SendReadOnlySync();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   SendReadOnlySync();
  }
