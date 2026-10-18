(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TIOSPersonalIntelligenceEngine=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  function finite(value){
    if(value===null||value===undefined||value==='')return null;
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  function numberFrom(value){
    if(typeof value==='number')return finite(value);
    if(typeof value!=='string')return null;
    const match=value.replace(/,/g,'').match(/[-+]?\d+(?:\.\d+)?/);
    return match?finite(match[0]):null;
  }

  function compactEvidenceSignature(context,candidateType){
    const evidence=context?.evidence||{};
    const summary=context?.summary||{};
    return {
      candidateType,
      from:evidence.periodStart||context?.period||'',
      to:evidence.periodEnd||'',
      totalTrades:Number(evidence.totalTrades)||0,
      trades:(evidence.trades||[]).map(trade=>[
        trade.reference,trade.date,trade.pnl,trade.setup,trade.journalNote,
        trade.playbookVersion?.name,trade.playbookVersion?.version,
        trade.playbook?.scorePct,(trade.playbook?.checks||[]).map(check=>[check.criterion,check.complied]),
        trade.execution?.scorePct,(trade.execution?.checks||[]).map(check=>[check.criterion,check.complied])
      ]),
      netPnl:summary.netPnl||'',
      winRate:summary.winRate||'',
      averageProfit:summary.averageProfit||'',
      averageLoss:summary.averageLoss||'',
      edge:evidence.edge||null,
      execution:evidence.execution||null
    };
  }

  function stableHash(value){
    const text=typeof value==='string'?value:JSON.stringify(value);
    let a=2166136261,b=2246822519;
    for(let i=0;i<text.length;i++){
      const code=text.charCodeAt(i);
      a=Math.imul(a^code,16777619);
      b=Math.imul(b^code,3266489917);
    }
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }

  function makeCandidate(context,type,title,priority,text,evidenceRefs=[]){
    const signature=compactEvidenceSignature(context,type);
    return {type,title,priority,text,evidenceRefs,observationKey:type+':'+stableHash(signature)};
  }

  function detectObservations(context,settings={}){
    if(!context||settings.proactive_enabled!==true)return [];
    const summary=context.summary||{},evidence=context.evidence||{};
    const focus=settings.investigation_focus||'both';
    const includeEdge=focus==='both'||focus==='edge';
    const includeExecution=focus==='both'||focus==='execution';
    const totalTrades=Math.max(0,Number(evidence.totalTrades)||0);
    const candidates=[];
    const netPnl=numberFrom(summary.netPnl);
    const winRate=numberFrom(summary.winRate);
    const averageProfit=numberFrom(summary.averageProfit);
    const averageLoss=numberFrom(summary.averageLoss);

    if(includeEdge&&totalTrades>=8&&netPnl!==null&&netPnl>0&&winRate!==null&&winRate<50&&averageProfit!==null&&averageLoss!==null&&averageProfit>Math.abs(averageLoss)){
      candidates.push(makeCandidate(context,'positive_return_low_win_rate','Low win rate with positive return',2,
        `Your selected period shows a ${summary.winRate} win rate with positive net P&L (${summary.netPnl}). The recorded average win is larger than the average loss. This describes the outcome mix, not proof of a durable edge. Would you like to check whether the result is spread across trades or concentrated in a few larger winners?`,
        (evidence.trades||[]).slice(0,8).map(trade=>trade.reference).filter(Boolean)));
    }

    const edge=evidence.edge||{},execution=evidence.execution||{};
    const edgeAdherence=finite(edge.adherencePct),executionAdherence=finite(execution.adherencePct);
    if(includeEdge&&Number(edge.reviewedTrades)>=3&&edgeAdherence!==null&&edgeAdherence<=65){
      const priority=Number(edge.reviewedTrades)>=6&&edgeAdherence<=50?3:2;
      candidates.push(makeCandidate(context,'edge_review_weakness','Playbook review pattern',priority,
        `Across ${edge.reviewedTrades} Playbook-reviewed trades in this period, the recorded adherence measure is ${edgeAdherence.toFixed(1)}%. This is a review pattern, not a conclusion about profitability. Would you like to inspect the specific rules and the trades where the reviews differ?`,
        edge.references||[]));
    }

    if(includeExecution&&Number(execution.reviewedTrades)>=3&&executionAdherence!==null&&executionAdherence<=65){
      const priority=Number(execution.reviewedTrades)>=6&&executionAdherence<=50?3:2;
      candidates.push(makeCandidate(context,'execution_review_weakness','Execution review pattern',priority,
        `Across ${execution.reviewedTrades} reviewed trades in this period, Execution Quality records ${executionAdherence.toFixed(1)}% adherence to the checked criteria. Would you like to inspect the specific checks and compare them with the trade outcomes? The comparison cannot establish causation by itself.`,
        execution.references||[]));
    }

    if(includeEdge&&includeExecution&&Number(edge.reviewedTrades)>=3&&Number(execution.reviewedTrades)>=3&&edgeAdherence!==null&&executionAdherence!==null&&edgeAdherence>=85&&executionAdherence<=65){
      candidates.push(makeCandidate(context,'edge_execution_gap','Edge and execution comparison',3,
        `The selected period shows ${edgeAdherence.toFixed(1)}% Playbook adherence across ${edge.reviewedTrades} reviewed trades and ${executionAdherence.toFixed(1)}% Execution Quality adherence across ${execution.reviewedTrades} reviewed trades. These measures use separate reviews. Would you like to compare the records side by side before deciding what the difference means?`,
        [...(edge.references||[]),...(execution.references||[])].slice(0,12)));
    }

    const selectedReviewed=focus==='edge'?Number(edge.reviewedTrades)||0:focus==='execution'?Number(execution.reviewedTrades)||0:Math.min(Number(edge.reviewedTrades)||0,Number(execution.reviewedTrades)||0);
    if(totalTrades>=10&&selectedReviewed<3){
      const system=focus==='edge'?'Playbook':focus==='execution'?'Execution Quality':'Playbook and Execution Quality';
      candidates.push(makeCandidate(context,'evidence_gap','Evidence coverage',1,
        `There are ${totalTrades} closed trades in the selected period, but fewer than three comparable ${system} reviews. T-IOS does not have enough reviewed process evidence to explain what drove the results. Would you like to choose a recent trade to review?`,[]));
    }

    candidates.sort((a,b)=>b.priority-a.priority||a.type.localeCompare(b.type));
    return candidates.slice(0,1);
  }

  function cooldownMs(frequency){
    if(frequency==='important')return 7*24*60*60*1000;
    if(frequency==='frequent')return 12*60*60*1000;
    return 48*60*60*1000;
  }

  function frequencyAllows(candidate,frequency){
    if(!candidate)return false;
    if(frequency==='important')return candidate.priority>=3;
    if(frequency==='frequent')return candidate.priority>=1;
    return candidate.priority>=2;
  }

  function classifyTopic(message){
    const value=String(message||'').toLowerCase();
    if(/execution|discipline|rule violation|follow my plan|slippage|entry timing/.test(value))return 'execution';
    if(/playbook|strategy|setup|edge|methodology|rule|profit factor/.test(value))return 'edge';
    if(/psych|emotion|fear|confidence|stress|revenge|fomo|mindset/.test(value))return 'psychology';
    if(/win rate|return|equity|p\/?l|statistics|profit|loss|drawdown/.test(value))return 'statistics';
    return 'general';
  }

  return {detectObservations,stableHash,cooldownMs,frequencyAllows,classifyTopic,numberFrom};
});
