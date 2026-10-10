// Read-only candle companion. Attach on a SECOND chart alongside the trade bridge.
// No order placement, modification, close, account-password, or trade-row commands.
#property strict
#property version "1.00"
input string TE_MarketDataURL = "https://tmxosoyqflmwqzjgnkez.supabase.co/functions/v1/mt5-market-data";
input string TE_ConnectionID = "";
input string TE_BridgeKey = "";
input int PollSeconds = 10;
// REQUIRED: confirm the broker candle clock against UTC before setting this.
// 99999 means unconfirmed. Historical offsets must be correct for the chosen date.
input int BrokerCandleUTCOffsetMinutes = 99999;
string retry_id="";
int history_attempts=0;
string Escape(string s) {
   StringReplace(s,"\\","\\\\"); StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r"," "); StringReplace(s,"\n"," "); StringReplace(s,"\t"," "); return s;
}
string AccountJson() {
   ENUM_ACCOUNT_TRADE_MODE mode=(ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string kind=mode==ACCOUNT_TRADE_MODE_DEMO?"demo":mode==ACCOUNT_TRADE_MODE_REAL?"real":"contest";
   return StringFormat("\"account\":{\"login\":\"%I64d\",\"server\":\"%s\",\"account_type\":\"%s\"}",AccountInfoInteger(ACCOUNT_LOGIN),Escape(AccountInfoString(ACCOUNT_SERVER)),kind);
}
bool Supported(string s) {
   string stems[2]={"Volatility 75 (1s) Index","Volatility 75 Index"};
   for(int j=0;j<2;j++) {
      if(s==stems[j])return true;
      if(StringFind(s,stems[j])!=0)continue;
      string tail=StringSubstr(s,StringLen(stems[j]));
      if(StringLen(tail)<1||StringLen(tail)>16)continue;
      ushort first=StringGetCharacter(tail,0);
      if(first!='.'&&first!='_'&&first!='#'&&first!='-')continue;
      bool valid=true;
      for(int i=0;i<StringLen(tail);i++) {
         ushort c=StringGetCharacter(tail,i);
         if(!((c>='0'&&c<='9')||(c>='a'&&c<='z')||(c>='A'&&c<='Z')||c=='.'||c=='_'||c=='#'||c=='-'))valid=false;
      }
      if(valid)return true;
   }
   return false;
}
string Catalogue() {
   string json="["; int count=0;
   for(int i=0;i<SymbolsTotal(false)&&count<50;i++) {
      string symbol=SymbolName(i,false); if(!Supported(symbol))continue;
      if(count>0)json+=",";
      json+=StringFormat("{\"symbol\":\"%s\",\"digits\":%d,\"point\":%s,\"description\":\"%s\"}",Escape(symbol),(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS),DoubleToString(SymbolInfoDouble(symbol,SYMBOL_POINT),12),Escape(SymbolInfoString(symbol,SYMBOL_DESCRIPTION)));
      count++;
   }
   return json+"]";
}
int Post(string body,string &response) {
   char data[],result[]; string headers_out;
   int n=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8); if(n>0)ArrayResize(data,n-1);
   string headers="Content-Type: application/json\r\nx-te-connection-id: "+TE_ConnectionID+"\r\nx-te-bridge-key: "+TE_BridgeKey+"\r\n";
   int code=WebRequest("POST",TE_MarketDataURL,headers,10000,data,result,headers_out);
   response=CharArrayToString(result,0,-1,CP_UTF8);
   // Log status only. Never print headers, bridge key, account payload, or errors.
   if(code<200||code>=300)Print("T-IOS market data: HTTP status ",code," (check WebRequest permissions and connection)");
   return code;
}
int ValueStart(string json,string key) {
   int p=StringFind(json,"\""+key+"\""); if(p<0)return -1;
   p=StringFind(json,":",p); if(p<0)return -1; p++;
   while(p<StringLen(json)&&StringGetCharacter(json,p)<=32)p++;
   return p;
}
string ReadString(string json,string key) {
   int p=ValueStart(json,key); if(p<0||StringGetCharacter(json,p)!='\"')return "";
   int end=StringFind(json,"\"",p+1); if(end<0)return "";
   return StringSubstr(json,p+1,end-p-1);
}
long ReadLong(string json,string key) {
   int p=ValueStart(json,key); if(p<0)return 0; int end=p;
   while(end<StringLen(json)&&StringGetCharacter(json,end)>='0'&&StringGetCharacter(json,end)<='9')end++;
   return StringToInteger(StringSubstr(json,p,end-p));
}
void Unavailable(string id,string reason) {
   string response;
   Post("{"+AccountJson()+",\"action\":\"result\",\"request_id\":\""+id+"\",\"unavailable\":true,\"reason\":\""+reason+"\"}",response);
}
void OnTimer() {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))return;
   string response;
   if(Post("{"+AccountJson()+",\"action\":\"poll\",\"symbols\":"+Catalogue()+"}",response)!=200)return;
   string id=ReadString(response,"request_id"); if(id=="")return;
   string symbol=ReadString(response,"symbol"),tf=ReadString(response,"timeframe");
   long utc_open=ReadLong(response,"open_epoch");
   if(StringLen(id)!=36||utc_open<=0||!Supported(symbol))return;
   if(BrokerCandleUTCOffsetMinutes < -840||BrokerCandleUTCOffsetMinutes>840) {Unavailable(id,"clock_unconfirmed");return;}
   if(!SymbolSelect(symbol,true)) {Unavailable(id,"symbol_unavailable");return;}
   ENUM_TIMEFRAMES period;
   if(tf=="H4")period=PERIOD_H4; else if(tf=="H1")period=PERIOD_H1; else if(tf=="M5")period=PERIOD_M5; else return;
   long offset=BrokerCandleUTCOffsetMinutes*60;
   datetime raw_open=(datetime)(utc_open+offset);
   MqlRates rates[];
   int copied=CopyRates(symbol,period,raw_open,raw_open,rates);
   if(copied<1) {
      if(retry_id!=id){retry_id=id;history_attempts=0;} history_attempts++;
      // CopyRates may start downloading history. Give it three poll cycles.
      if(history_attempts>=3)Unavailable(id,"history_unavailable"); return;
   }
   if((long)rates[0].time!=(long)raw_open) {Unavailable(id,"timestamp_not_found");return;}
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   string body="{"+AccountJson()+StringFormat(
      ",\"action\":\"result\",\"request_id\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"open_epoch\":%I64d,\"utc_offset_seconds\":%I64d,\"clock_confirmed\":true,\"retrieved_epoch\":%I64d,\"ohlc\":{\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s},\"tick_volume\":%I64d,\"spread_points\":%d}",
      id,Escape(symbol),tf,(long)rates[0].time,offset,(long)TimeGMT(),DoubleToString(rates[0].open,digits),DoubleToString(rates[0].high,digits),DoubleToString(rates[0].low,digits),DoubleToString(rates[0].close,digits),(long)rates[0].tick_volume,rates[0].spread);
   Post(body,response);
}
int OnInit() {
   if(TE_MarketDataURL!="https://tmxosoyqflmwqzjgnkez.supabase.co/functions/v1/mt5-market-data"||StringLen(TE_ConnectionID)!=36||StringLen(TE_BridgeKey)<20)return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(MathMax(5,PollSeconds));
   Print("T-IOS read-only market data companion started. Confirm candle UTC offset before retrieval.");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) {EventKillTimer();}
