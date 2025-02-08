import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_TOKEN, ALLOWED_CHAT_IDS } from '../utils/constants';

export class TelegramManager {
  private bot: TelegramBot;
  private isRunning: boolean = false;
  private startTime: Date | null = null;
  private trades: { win: number; loss: number } = { win: 0, loss: 0 };
  private balance: number = 0;

  constructor() {
    this.bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    this.setupCommands();
    
    // Adicionar este listener temporário para mostrar IDs
    this.bot.on('message', (msg) => {
      console.log(`Mensagem recebida de: Chat ID: ${msg.chat.id}, User ID: ${msg.from?.id}`);
      if (msg.text === '/myid') {
        this.bot.sendMessage(msg.chat.id, 
          `🆔 Suas informações:\nChat ID: ${msg.chat.id}\nUser ID: ${msg.from?.id}`
        );
      }
    });
  }

  private setupCommands() {
    this.bot.onText(/\/start/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      if (!this.isRunning) {
        this.isRunning = true;
        this.startTime = new Date();
        this.bot.sendMessage(msg.chat.id, '🟢 Bot iniciado com sucesso!');
      } else {
        this.bot.sendMessage(msg.chat.id, '⚠️ Bot já está em execução!');
      }
    });

    this.bot.onText(/\/stop/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      if (this.isRunning) {
        this.isRunning = false;
        this.bot.sendMessage(msg.chat.id, '🔴 Bot parado com sucesso!');
      } else {
        this.bot.sendMessage(msg.chat.id, '⚠️ Bot já está parado!');
      }
    });

    this.bot.onText(/\/status/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      const status = this.getStatus();
      this.bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
    });
  }

  private isAuthorizedChat(chatId: number): boolean {
    return ALLOWED_CHAT_IDS.includes(chatId);
  }

  private getStatus(): string {
    const runtime = this.startTime ? this.getRuntime() : 'Bot não iniciado';
    const winRate = this.calculateWinRate();
    
    return `*📊 Estatísticas do Bot*\n\n` +
           `*Status:* ${this.isRunning ? '🟢 Ativo' : '🔴 Parado'}\n` +
           `*Tempo em execução:* ${runtime}\n` +
           `*Trades realizados:* ${this.trades.win + this.trades.loss}\n` +
           `*Vitórias:* ${this.trades.win}\n` +
           `*Derrotas:* ${this.trades.loss}\n` +
           `*Taxa de acerto:* ${winRate}%\n` +
           `*Saldo atual:* $${this.balance.toFixed(2)}`;
  }

  private getRuntime(): string {
    if (!this.startTime) return '0m';
    const diff = new Date().getTime() - this.startTime.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }

  private calculateWinRate(): string {
    const total = this.trades.win + this.trades.loss;
    if (total === 0) return '0.00';
    return ((this.trades.win / total) * 100).toFixed(2);
  }

  public updateTradeResult(isWin: boolean, currentBalance: number) {
    if (isWin) {
      this.trades.win++;
    } else {
      this.trades.loss++;
    }
    this.balance = currentBalance;
  }

  public isRunningBot(): boolean {
    return this.isRunning;
  }

  public sendMessage(message: string) {
    ALLOWED_CHAT_IDS.forEach(chatId => {
      this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }
} 