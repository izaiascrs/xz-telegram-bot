import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_TOKEN, ALLOWED_CHAT_IDS, ADMIN_CHAT_ID } from '../utils/constants';
import { TradeService } from '../database/trade-service';

export class TelegramManager {
  private bot: TelegramBot;
  private isRunning: boolean = false;
  private startTime: Date | null = null;
  private trades: { win: number; loss: number } = { win: 0, loss: 0 };
  private balance: number = 0;

  constructor(private tradeService: TradeService) {
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
      
      if (!this.isAdminChat(msg.chat.id)) {
        this.bot.sendMessage(msg.chat.id, '⛔ Apenas o administrador pode iniciar o bot!');
        return;
      }
      
      if (!this.isRunning) {
        this.isRunning = true;
        if (!this.startTime) {
          this.startTime = new Date();
        }
        this.bot.sendMessage(msg.chat.id, '🟢 Bot iniciado com sucesso!');
        
        ALLOWED_CHAT_IDS.forEach(chatId => {
          if (chatId !== msg.chat.id) {
            this.bot.sendMessage(chatId, '🟢 Bot foi iniciado pelo administrador');
          }
        });
      } else {
        this.bot.sendMessage(msg.chat.id, '⚠️ Bot já está em execução!');
      }
    });

    this.bot.onText(/\/stop/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      if (!this.isAdminChat(msg.chat.id)) {
        this.bot.sendMessage(msg.chat.id, '⛔ Apenas o administrador pode parar o bot!');
        return;
      }
      
      if (this.isRunning) {
        this.isRunning = false;
        this.bot.sendMessage(msg.chat.id, '🔴 Bot parado com sucesso!');
        
        ALLOWED_CHAT_IDS.forEach(chatId => {
          if (chatId !== msg.chat.id) {
            this.bot.sendMessage(chatId, '🔴 Bot foi parado pelo administrador');
          }
        });
      } else {
        this.bot.sendMessage(msg.chat.id, '⚠️ Bot já está parado!');
      }
    });

    this.bot.onText(/\/reset/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      if (!this.isAdminChat(msg.chat.id)) {
        this.bot.sendMessage(msg.chat.id, '⛔ Apenas o administrador pode resetar o bot!');
        return;
      }

      const wasRunning = this.isRunning;
      
      this.isRunning = false;
      this.startTime = null;
      this.trades = { win: 0, loss: 0 };
      this.balance = 0;

      const message = '*🔄 Bot resetado com sucesso!*\n\n' +
                     'Todas as estatísticas foram zeradas.\n' +
                     'Use /start para iniciar uma nova sessão.';

      this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
      
      ALLOWED_CHAT_IDS.forEach(chatId => {
        if (chatId !== msg.chat.id) {
          this.bot.sendMessage(chatId, '🔄 Bot foi resetado pelo administrador');
        }
      });

      if (wasRunning) {
        this.bot.sendMessage(msg.chat.id, '⚠️ Bot estava em execução e foi parado. Use /start para iniciar novamente.');
      }
    });

    this.bot.onText(/\/status/, (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      const status = this.getBasicStatus();
      this.bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/stats(?:\s+(\d{4}-\d{2}-\d{2}))?/, async (msg, match) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      const date = match?.[1];
      const stats = await this.tradeService.getHourlyStats(date);
      
      if (stats.length === 0) {
        this.bot.sendMessage(msg.chat.id, '📊 Nenhuma estatística disponível' + (date ? ' para esta data.' : '.'));
        return;
      }

      let message = date 
        ? `*📊 Estatísticas do dia ${date}*\n\n`
        : '*📊 Estatísticas Detalhadas*\n\n';

      stats.forEach(stat => {
        const hourEnd = stat.hour + 2;
        const startTime = this.formatBrazilianDateTime(stat.date, stat.hour, true);
        const endTime = this.formatBrazilianDateTime(stat.date, hourEnd, false);
        
        message += `*${startTime}-${endTime}*\n` +
          `Trades: ${stat.totalTrades || 0}\n` +
          `Taxa de Acerto: ${stat.winRate?.toFixed(2) || '0.00'}%\n` +
          `Lucro Total: $${(stat.totalProfit || 0).toFixed(2)}\n` +
          `Máx. Wins Consecutivos: ${stat.maxConsecutiveWins || 0}\n` +
          `Máx. Losses Consecutivos: ${stat.maxConsecutiveLosses || 0}\n\n`;
      });

      this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/cleardb/, async (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      if (!this.isAdminChat(msg.chat.id)) {
        this.bot.sendMessage(msg.chat.id, '⛔ Apenas o administrador pode limpar o banco de dados!');
        return;
      }

      try {
        // Confirma que o bot não está rodando
        if (this.isRunning) {
          this.bot.sendMessage(msg.chat.id, '⚠️ Por favor, pare o bot antes de limpar o banco de dados.\nUse /stop primeiro.');
          return;
        }

        await this.tradeService.clearDatabase();
        
        const message = '*🗑️ Banco de dados limpo com sucesso!*\n\n' +
                       'Todas as estatísticas históricas foram removidas.\n' +
                       'O banco será recriado automaticamente na próxima operação.';

        this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
        
        // Notifica outros chats autorizados
        ALLOWED_CHAT_IDS.forEach(chatId => {
          if (chatId !== msg.chat.id) {
            this.bot.sendMessage(chatId, '🗑️ Banco de dados foi limpo pelo administrador');
          }
        });

      } catch (error) {
        console.error('Erro ao limpar banco de dados:', error);
        this.bot.sendMessage(msg.chat.id, '❌ Erro ao limpar banco de dados. Verifique os logs.');
      }
    });

    this.bot.onText(/\/sequences/, async (msg) => {
      if (!this.isAuthorizedChat(msg.chat.id)) return;
      
      const sequences = await this.tradeService.getSequenceStats();
      
      if (sequences.length === 0) {
        this.bot.sendMessage(msg.chat.id, '📊 Nenhuma sequência em andamento.');
        return;
      }

      let message = '*📊 Sequências em Andamento*\n\n';
      
      sequences.forEach(seq => {
        message += `*${seq.type === 'current' ? 'Sequência Atual' : 'Próxima Sequência'}*\n` +
          `Trades: ${seq.tradesCount}/25\n` +
          `Taxa de Acerto Atual: ${seq.winRate.toFixed(2)}%\n` +
          (seq.referenceWinRate ? 
            `Taxa de Acerto Anterior: ${seq.referenceWinRate.toFixed(2)}%\n` : '') +
          '\n';
      });

      this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    });
  }

  private isAuthorizedChat(chatId: number): boolean {
    return ALLOWED_CHAT_IDS.includes(chatId);
  }

  private isAdminChat(chatId: number): boolean {
    return chatId === ADMIN_CHAT_ID;
  }

  private getBasicStatus(): string {
    const runtime = this.startTime ? this.getRuntime() : 'Bot não iniciado';
    const winRate = this.calculateWinRate();
    
    return `*📊 Status do Bot*\n\n` +
           `*Status:* ${this.isRunning ? '🟢 Ativo' : '🔴 Parado'}\n` +
           `*Tempo em execução:* ${runtime}\n` +
           `*Trades hoje:* ${this.trades.win + this.trades.loss}\n` +
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

  private formatBrazilianDateTime(date: string, hour: number, showDate: boolean = true): string {
    // Ajusta do horário da Alemanha (UTC+1) para Brasil (UTC-3)
    // Diferença total de 4 horas
    const brazilHour = (hour - 4 + 24) % 24;
    return showDate ? 
      `${date} ${brazilHour.toString().padStart(2, '0')}:00` : 
      `${brazilHour.toString().padStart(2, '0')}:00`;
  }
} 