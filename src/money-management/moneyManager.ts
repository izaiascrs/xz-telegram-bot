import { MoneyManagementV2, TradeResult } from "./types";

export class MoneyManager {
  private currentBalance: number;
  private currentStake: number;
  private consecutiveLosses: number = 0;
  private consecutiveWins: number = 0;
  private sorosLevel: number = 0;
  private lastTrade: TradeResult | null = null;
  private accumulatedLoss: number = 0;
  private recoveryMode: boolean = false;

  constructor(
    private config: MoneyManagementV2,
    initialBalance: number
  ) {
    this.currentBalance = initialBalance;
    this.currentStake = config.initialStake;
  }

  calculateNextStake(): number {
    if (this.currentBalance <= 0) {
      console.warn('Saldo insuficiente');
      return 0;
    }

    if (!this.lastTrade) {
      return Math.min(
        this.config.initialStake,
        this.currentBalance
      );
    }

    let nextStake = 0;

    switch (this.config.type) {
      case 'fixed':
        nextStake = this.calculateFixedStake();
        break;
      case 'martingale':
        nextStake = this.calculateMartingaleStake();
        break;
      case 'soros':
        nextStake = this.calculateSorosStake();
        break;
      case 'martingale-soros':
        nextStake = this.calculateMartingaleSorosStake();
        break;
      default:
        nextStake = this.config.initialStake;
    }

    // Verifica limites
    if (nextStake > this.currentBalance) {
      console.warn('Stake maior que saldo disponível');
      return 0;
    }

    if (nextStake > (this.config.maxStake || Infinity)) {
      console.warn('Stake maior que limite máximo');
      return 0;
    }

    this.currentStake = nextStake;
    return nextStake;
  }

  updateLastTrade(success: boolean) {
    const stake = this.currentStake;
    const profit = success 
      ? stake * (this.config.profitPercent / 100)
      : -stake;
    
    this.currentBalance += profit;
    
    this.lastTrade = {
      success,
      stake,
      profit,
      balance: this.currentBalance,
      type: success ? 'win' : 'loss'
    };

    // Atualiza contadores
    if (success) {
      this.consecutiveLosses = 0;
      // Não precisa mais verificar se recuperou as perdas
      // Apenas reseta os contadores após um win
      if (this.recoveryMode) {
        this.recoveryMode = false;
        this.accumulatedLoss = 0;
        this.consecutiveWins = 0;
      }
    } else {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;
      this.sorosLevel = 0;
    }
  }

  private calculateFixedStake(): number {
    return this.config.initialStake;
  }

  private calculateMartingaleStake(): number {
    if (this.lastTrade?.type === 'win') {
      this.consecutiveLosses = 0;
      // Após win com martingale, próxima stake é lucro + entrada inicial
      const profit = this.lastTrade.stake * (this.config.profitPercent / 100);
      return this.config.initialStake + profit;
    }

    if (this.config.maxLoss && this.consecutiveLosses >= this.config.maxLoss) {
      console.warn('Limite máximo de losses atingido');
      this.consecutiveLosses = 0;
      return this.config.initialStake;
    }

    // Corrigido cálculo do martingale
    const lastStake = this.lastTrade?.stake || this.config.initialStake;
    const profitRate = this.config.profitPercent / 100;
    const nextStake = (lastStake + this.config.initialStake) / profitRate;
        
    return Math.min(
      nextStake,
      this.config.maxStake || Infinity,
      this.currentBalance
    );
  }

  private calculateSorosStake(): number {
    if (this.lastTrade?.type === 'loss') {
      this.sorosLevel = 0;
      return this.config.initialStake;
    }

    this.sorosLevel++;
    if (this.sorosLevel > (this.config.sorosLevel || 1)) {
      this.sorosLevel = 0;
      return this.config.initialStake;
    }

    // No soros, após vitória, adiciona o lucro da última operação à stake inicial
    const lastProfit = this.lastTrade?.profit || 0;
    return this.config.initialStake + lastProfit;
  }

  private calculateMartingaleSorosStake(): number {
    if (this.lastTrade?.type === 'win') {
      // Se estava em modo de recuperação
      if (this.recoveryMode) {
        this.consecutiveWins++;
        
        // Verifica se atingiu wins necessários para martingale (1 win)
        if (this.consecutiveWins >= 1) {
          // Calcula stake para recuperar perdas + stake inicial
          const neededProfit = this.accumulatedLoss + this.config.initialStake;
          const profitRate = this.config.profitPercent / 100;
          const recoveryStake = neededProfit / profitRate;

          const finalStake = Math.min(
            recoveryStake,
            this.config.maxStake || Infinity,
            this.currentBalance
          );

          // Após usar martingale, reseta o modo de recuperação
          this.recoveryMode = false;
          this.consecutiveWins = 0;
          this.accumulatedLoss = 0;
          
          return finalStake;
        }
        return this.config.initialStake;
      }
      
      // Se não estava em recovery, aplica soros normal
      return this.calculateSorosStake();
    }
    
    // Se perdeu
    if (this.lastTrade?.type === 'loss') {
      this.recoveryMode = true;
      this.consecutiveWins = 0;
      this.sorosLevel = 0;
      this.accumulatedLoss += Math.abs(this.lastTrade.profit);
      
      // Volta para stake inicial em loss
      return this.config.initialStake;
    }
    
    return this.config.initialStake;
  }

  getCurrentBalance(): number {
    return this.currentBalance;
  }

  getLastTrade(): TradeResult | null {
    return this.lastTrade;
  }

  getStats() {
    return {
      currentBalance: this.currentBalance,
      consecutiveLosses: this.consecutiveLosses,
      sorosLevel: this.sorosLevel,
      lastStake: this.lastTrade?.stake || 0,
      lastProfit: this.lastTrade?.profit || 0
    };
  }
} 