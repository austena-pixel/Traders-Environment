#property strict
#property version   "1.00"
#property description "Read-only Deriv MT4 account and trade-history sync for T-IOS."

input string TE_Function_URL = "https://tmxosoyqflmwqzjgnkez.supabase.co/functions/v1/mt4-sync";
input string TE_Setup_Code = "";
input int    TE_Sync_Interval_Seconds = 30;
input int    TE_Max_Orders_Per_Request = 50;
input int    TE_Timeout_Milliseconds = 10000;

string TE_Connection_ID = "";
string TE_Bridge_Key = "";

struct HistoryOrder
  {
   int      ticket;
   int      type;
   datetime open_time;
   datetime close_time;
   string   symbol;
   double   lots;
   double   open_price;
   double   close_price;
   double   stop_loss;
   double   take_profit;
   double   profit;
   double   commission;
   double   swap;
   double   initial_stop_loss;
   double   risk_amount;
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

string KeyPrefix()
  {
   return "TIOS4_" + IntegerToString(AccountNumber()) + "_" +
          StringSubstr(TE_Connection_ID, 0, 8);
  }

string StartKey()
  {
   return KeyPrefix() + "_start";
  }

string OffsetKey()
  {
   return KeyPrefix() + "_offset";
  }

string LastCloseKey()
  {
   return KeyPrefix() + "_lastclose";
  }

string InitialStopKey(const int ticket)
  {
   return KeyPrefix() + "_sl_" + IntegerToString(ticket);
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

double InitialStopForTicket(const int ticket, const double currentStop, const bool remember)
  {
   const string key = InitialStopKey(ticket);
   if(GlobalVariableCheck(key))
      return GlobalVariableGet(key);

   if(remember && currentStop > 0)
      GlobalVariableSet(key, currentStop);

   return currentStop;
  }

double RiskAtStop(
   const string symbol,
   const double entry,
   const double stop,
   const double lots
)
  {
   if(entry <= 0 || stop <= 0 || lots <= 0 || entry == stop)
      return 0;

   double point = MarketInfo(symbol, MODE_POINT);
   double tickSizePoints = MarketInfo(symbol, MODE_TICKSIZE);
   double tickValue = MarketInfo(symbol, MODE_TICKVALUE);

   if(point <= 0 || tickValue <= 0)
      return 0;
   if(tickSizePoints <= 0)
      tickSizePoints = 1;

   const double pricePerTick = point * tickSizePoints;
   if(pricePerTick <= 0)
      return 0;

   return MathAbs(entry - stop) / pricePerTick * tickValue * lots;
  }

string OrderDirection(const int type)
  {
   return type == OP_SELL ? "Sell" : "Buy";
  }

bool IsMarketOrder(const int type)
  {
   return type == OP_BUY || type == OP_SELL;
  }

int BuildPositionsJson(string &positionsJson)
  {
   positionsJson = "[";
   int count = 0;

   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      const int type = OrderType();
      if(!IsMarketOrder(type))
         continue;

      const int ticket = OrderTicket();
      const string symbol = OrderSymbol();
      const double lots = OrderLots();
      const double entry = OrderOpenPrice();
      const double currentStop = OrderStopLoss();
      const double initialStop = InitialStopForTicket(ticket, currentStop, true);
      const double risk = RiskAtStop(symbol, entry, initialStop, lots);

      if(count > 0)
         positionsJson += ",";
      positionsJson += "{";
      positionsJson += "\"ticket\":\"" + IntegerToString(ticket) + "\"";
      positionsJson += ",\"symbol\":\"" + JsonEscape(symbol) + "\"";
      positionsJson += ",\"direction\":\"" + OrderDirection(type) + "\"";
      positionsJson += ",\"open_time\":" + IntegerToString((long)OrderOpenTime());
      positionsJson += ",\"entry_price\":" + JsonNumber(entry);
      positionsJson += ",\"stop_loss\":" + JsonNumber(currentStop);
      positionsJson += ",\"initial_stop_loss\":" + JsonNumber(initialStop);
      positionsJson += ",\"take_profit\":" + JsonNumber(OrderTakeProfit());
      positionsJson += ",\"volume\":" + JsonNumber(lots);
      positionsJson += ",\"risk_amount\":" + JsonNumber(risk);
      positionsJson += "}";
      count++;
     }

   positionsJson += "]";
   return count;
  }

string BuildAccountJson(const int openPositions)
  {
   const double margin = AccountMargin();
   const double marginLevel = margin > 0 ? AccountEquity() / margin * 100.0 : 0;
   string accountType = IsDemo() ? "demo" : "real";

   string account = "{";
   account += "\"login\":\"" + IntegerToString(AccountNumber()) + "\"";
   account += ",\"server\":\"" + JsonEscape(AccountServer()) + "\"";
   account += ",\"company\":\"" + JsonEscape(AccountCompany()) + "\"";
   account += ",\"account_type\":\"" + accountType + "\"";
   account += ",\"currency\":\"" + JsonEscape(AccountCurrency()) + "\"";
   account += ",\"terminal_server_time_msc\":" + IntegerToString((long)TimeCurrent() * 1000);
   account += ",\"balance\":" + JsonNumber(AccountBalance());
   account += ",\"equity\":" + JsonNumber(AccountEquity());
   account += ",\"floating_pnl\":" + JsonNumber(AccountProfit());
   account += ",\"margin\":" + JsonNumber(margin);
   account += ",\"free_margin\":" + JsonNumber(AccountFreeMargin());
   account += ",\"margin_level\":" + JsonNumber(marginLevel);
   account += ",\"open_positions\":" + IntegerToString(openPositions);
   account += "}";
   return account;
  }

string BuildPayload(
   const string eventName,
   const string account,
   const string positionsJson,
   const string ordersJson
)
  {
   return "{\"event\":\"" + eventName + "\",\"account\":" + account +
          ",\"positions\":" + positionsJson + ",\"orders\":" + ordersJson + "}";
  }

bool PostSync(const string payload, string &response)
  {
   char data[];
   char result[];
   string resultHeaders = "";
   string headers = "Content-Type: application/json\r\n";
   headers += "x-te-connection-id: " + TE_Connection_ID + "\r\n";
   headers += "x-te-bridge-key: " + TE_Bridge_Key + "\r\n";

   const int chars = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(chars <= 1)
     {
      Print("T-IOS bridge could not encode the sync request.");
      return false;
     }
   ArrayResize(data, chars - 1);

   const int status = WebRequest(
      "POST",
      TE_Function_URL,
      headers,
      TE_Timeout_Milliseconds,
      data,
      result,
      resultHeaders
   );

   if(status == -1)
     {
      Print("T-IOS WebRequest failed. Allow https://tmxosoyqflmwqzjgnkez.supabase.co in MT4 Options > Expert Advisors. Error: ",
            GetLastError());
      return false;
     }

   response = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
     {
      Print("T-IOS bridge returned HTTP ", status, ": ", response);
      return false;
     }

   if(StringFind(response, "\"ok\":true") < 0)
     {
      Print("T-IOS bridge did not accept the sync: ", response);
      return false;
     }

   return true;
  }

bool IsBefore(const HistoryOrder &left, const HistoryOrder &right)
  {
   if(left.close_time != right.close_time)
      return left.close_time < right.close_time;
   return left.ticket < right.ticket;
  }

void SortHistory(HistoryOrder &items[], const int left, const int right)
  {
   int i = left;
   int j = right;
   HistoryOrder pivot = items[(left + right) / 2];

   while(i <= j)
     {
      while(IsBefore(items[i], pivot)) i++;
      while(IsBefore(pivot, items[j])) j--;
      if(i <= j)
        {
         HistoryOrder swap = items[i];
         items[i] = items[j];
         items[j] = swap;
         i++;
         j--;
        }
     }

   if(left < j) SortHistory(items, left, j);
   if(i < right) SortHistory(items, i, right);
  }

string BuildOrderJson(const HistoryOrder &item)
  {
   string row = "{";
   row += "\"ticket\":\"" + IntegerToString(item.ticket) + "\"";
   row += ",\"symbol\":\"" + JsonEscape(item.symbol) + "\"";
   row += ",\"direction\":\"" + OrderDirection(item.type) + "\"";
   row += ",\"open_time\":" + IntegerToString((long)item.open_time);
   row += ",\"close_time\":" + IntegerToString((long)item.close_time);
   row += ",\"entry_price\":" + JsonNumber(item.open_price);
   row += ",\"exit_price\":" + JsonNumber(item.close_price);
   row += ",\"stop_loss\":" + JsonNumber(item.stop_loss);
   row += ",\"initial_stop_loss\":" + JsonNumber(item.initial_stop_loss);
   row += ",\"take_profit\":" + JsonNumber(item.take_profit);
   row += ",\"volume\":" + JsonNumber(item.lots);
   row += ",\"profit\":" + JsonNumber(item.profit);
   row += ",\"commission\":" + JsonNumber(item.commission);
   row += ",\"swap\":" + JsonNumber(item.swap);
   row += ",\"fee\":0";
   row += ",\"risk_amount\":" + JsonNumber(item.risk_amount);
   row += "}";
   return row;
  }

void UpdateServerMetadata(const string response)
  {
   const long startMs = JsonLongField(response, "sync_started_at_msc");
   const long offsetMs = JsonLongField(response, "server_to_utc_offset_ms");
   if(startMs <= 0)
      return;

   const long previousStart = SavedLong(StartKey());
   GlobalVariableSet(StartKey(), (double)startMs);
   GlobalVariableSet(OffsetKey(), (double)offsetMs);

   if(previousStart != startMs)
     {
      const long cutoffServerSeconds = (startMs - offsetMs) / 1000;
      GlobalVariableSet(LastCloseKey(), (double)(cutoffServerSeconds - 1));
     }
  }

bool Handshake()
  {
   string emptyArray = "[]";
   string response = "";
   string currentPositions = "[]";
   const int openCount = BuildPositionsJson(currentPositions);
   const string account = BuildAccountJson(openCount);
   const string payload = BuildPayload("snapshot", account, emptyArray, emptyArray);

   if(!PostSync(payload, response))
      return false;

   UpdateServerMetadata(response);
   if(SavedLong(StartKey()) <= 0)
     {
      Print("T-IOS did not return a sync cutoff. Check the account link in Settings.");
      return false;
     }

   Print("T-IOS MT4 bridge handshake complete. No orders older than the linked cutoff will be imported.");
   return true;
  }

int CollectHistory(HistoryOrder &items[])
  {
   ArrayResize(items, 0);
   const long startMs = SavedLong(StartKey());
   const long offsetMs = SavedLong(OffsetKey());
   const long cutoffServerSeconds = startMs > 0 ? (startMs - offsetMs) / 1000 : 0;
   long lastClose = SavedLong(LastCloseKey());

   if(cutoffServerSeconds > 0 && lastClose < cutoffServerSeconds - 1)
      lastClose = cutoffServerSeconds - 1;

   int count = 0;
   for(int i = 0; i < OrdersHistoryTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(!IsMarketOrder(OrderType()))
         continue;

      const datetime opened = OrderOpenTime();
      const datetime closed = OrderCloseTime();
      const int ticket = OrderTicket();
      if(opened <= 0 || closed <= 0 || ticket <= 0)
         continue;
      if((long)opened < cutoffServerSeconds)
         continue;
      // Resend the last second as an idempotent overlap so same-second closes
      // cannot be skipped if the terminal history changes between polls.
      if((long)closed < lastClose - 1)
         continue;

      const string symbol = OrderSymbol();
      const double currentStop = OrderStopLoss();
      const double initialStop = InitialStopForTicket(ticket, currentStop, false);

      if(count >= ArraySize(items))
         ArrayResize(items, count + 1);

      items[count].ticket = ticket;
      items[count].type = OrderType();
      items[count].open_time = opened;
      items[count].close_time = closed;
      items[count].symbol = symbol;
      items[count].lots = OrderLots();
      items[count].open_price = OrderOpenPrice();
      items[count].close_price = OrderClosePrice();
      items[count].stop_loss = currentStop;
      items[count].take_profit = OrderTakeProfit();
      items[count].profit = OrderProfit();
      items[count].commission = OrderCommission();
      items[count].swap = OrderSwap();
      items[count].initial_stop_loss = initialStop;
      items[count].risk_amount = RiskAtStop(symbol, OrderOpenPrice(), initialStop, OrderLots());
      count++;
     }

   ArrayResize(items, count);
   if(count > 1)
      SortHistory(items, 0, count - 1);
   return count;
  }

long MaximumCloseTime(const HistoryOrder &items[], const int first, const int count)
  {
   long latest = 0;
   for(int i = first; i < first + count; i++)
      if((long)items[i].close_time > latest)
         latest = (long)items[i].close_time;
   return latest;
  }

void SendReadOnlySync()
  {
   if(!IsConnected())
     {
      Print("T-IOS bridge is waiting for the MT4 terminal to connect.");
      return;
     }

   if(!GlobalVariableCheck(StartKey()))
     {
      Handshake();
      return;
     }

   string positionsJson = "";
   const int openCount = BuildPositionsJson(positionsJson);
   const string account = BuildAccountJson(openCount);

   HistoryOrder history[];
   const int historyCount = CollectHistory(history);
   int batchSize = TE_Max_Orders_Per_Request;
   if(batchSize < 1) batchSize = 1;
   if(batchSize > 100) batchSize = 100;

   const int batches = historyCount > 0 ? (historyCount + batchSize - 1) / batchSize : 1;
   for(int batch = 0; batch < batches; batch++)
     {
      const int first = batch * batchSize;
      int count = historyCount - first;
      if(count > batchSize) count = batchSize;

      string ordersJson = "[";
      for(int j = 0; j < count; j++)
        {
         if(j > 0) ordersJson += ",";
         ordersJson += BuildOrderJson(history[first + j]);
        }
      ordersJson += "]";

      const string payload = BuildPayload("sync", account, positionsJson, ordersJson);
      string response = "";
      if(!PostSync(payload, response))
         return;

      UpdateServerMetadata(response);
      if(count > 0)
        {
         const long latest = MaximumCloseTime(history, first, count);
         if(latest > SavedLong(LastCloseKey()))
            GlobalVariableSet(LastCloseKey(), (double)latest);
        }
     }
  }

int OnInit()
  {
   if(TE_Function_URL == "" || !ParseSetupCode())
     {
      Print("Paste the one-time setup code from T-IOS into the TE_Setup_Code input.");
      return INIT_PARAMETERS_INCORRECT;
     }

   if(StringFind(TE_Function_URL, "https://") != 0 ||
      StringFind(TE_Function_URL, "/mt4-sync") < 0)
     {
      Print("The T-IOS URL must point to the secure mt4-sync function.");
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