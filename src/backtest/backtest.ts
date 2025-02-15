import { BackTestAnalysis, Strategy, TradeSignal, } from './types';

export class Backtest {
  constructor(private strategy: Strategy) {}

  runTest(digits: number[]): BackTestAnalysis[] {
    const results: BackTestAnalysis[] = [];
    
    for (let ticks = this.strategy.minTicks; ticks <= 10; ticks++) {
      let totalTrades = 0;
      let skippedTrades = 0;
      let possibleTrades = 0;
      let wins = 0;
      let losses = 0;
      let consecutiveWins = 0;
      let consecutiveLosses = 0;
      let maxConsecutiveWins = 0;
      let maxConsecutiveLosses = 0;
      const trades: TradeSignal[] = [];
      
      let virtualLossCount = 0;
      let isWaitingVirtualLoss = false;
      let lastEntryIndex = -ticks;
      
      const isManagementTick = ticks === this.strategy.moneyManagement.targetTick;
      let waitingForResult = false;

      for (let i = 0; i < digits.length - ticks; i++) {
        const result = this.strategy.execute(digits, i, ticks);
        
        if (result !== null) {
          possibleTrades++;
          
          if (isManagementTick) {
            if (waitingForResult && i < lastEntryIndex + ticks) {
              skippedTrades++;
              continue;
            }
            
            if (isWaitingVirtualLoss) {
              skippedTrades++;
              virtualLossCount++;
              if (virtualLossCount >= this.strategy.virtualLoss) {
                isWaitingVirtualLoss = false;
                virtualLossCount = 0;
                waitingForResult = false;
              }
              continue;
            }
          }

          totalTrades++;
          trades.push({ success: result, position: i });
          
          if (isManagementTick) {
            lastEntryIndex = i;
            waitingForResult = true;
          }
          
          if (result) {
            wins++;
            consecutiveWins++;
            consecutiveLosses = 0;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
          } else {
            losses++;
            consecutiveLosses++;
            consecutiveWins = 0;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
            
            if (isManagementTick && this.strategy.virtualLoss > 0) {
              isWaitingVirtualLoss = true;
              virtualLossCount = 0;
            }
          }
        }
      }

      results.push({
        ticks,
        totalTrades,
        wins,
        losses,
        winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
        lossRate: totalTrades > 0 ? (losses / totalTrades) * 100 : 0,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        trades,
        skippedTrades,
        possibleTrades
      });
    }

    return results;
  }
} 