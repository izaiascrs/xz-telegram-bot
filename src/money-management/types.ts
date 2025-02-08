export type ManagementType = 'fixed' | 'martingale' | 'soros' | 'martingale-soros';

export interface MoneyManagement {
  type: ManagementType;
  initialStake: number;
  profitPercent: number; // Exemplo: 95 para 95%
  maxStake?: number; // Limite máximo de entrada
  maxLoss?: number; // Limite máximo de loss consecutivo (para martingale)
  sorosLevel?: number; // Quantos níveis de soros aplicar
}

export interface TradeResult {
  success: boolean;
  stake: number;
  profit: number;
  balance: number; 
  type: 'win' | 'loss';
}
