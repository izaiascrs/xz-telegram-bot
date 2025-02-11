import "dotenv/config";
import { RealMoneyManager } from "./money-management";
import { MoneyManagement } from "./money-management/types";
import apiManager from "./ws";
import { TicksStreamResponse } from "@deriv/api-types";
import { DERIV_TOKEN } from "./utils/constants";
import { TelegramManager } from './telegram';

type TSymbol = (typeof symbols)[number];
const symbols = ["R_10"] as const;

const config: MoneyManagement = {
  type: "fixed",
  initialStake: 0.35,
  profitPercent: 22,
  maxStake: 200,
  maxLoss: 5000,
  sorosLevel: 5,
};

let isAuthorized = false;
let isTrading = false;
let waitingVirtualLoss = false;
let tickCount = 0;
let activeSymbolSubscription: any = null;
let activeContractSubscription: any = null;
let consecutiveWins = 0;

let subscriptions: {
  ticks?: any;
  contracts?: any;
} = {};

const moneyManager = new RealMoneyManager(config, 100);
const telegramManager = new TelegramManager();

const ticksMap = new Map<TSymbol, number[]>([]);

function calcularStakeRecuperacao(valorRecuperar: number, pagamentoPercentual: number): number {
    if (pagamentoPercentual <= 0) {
        throw new Error("O pagamento percentual deve ser maior que 0.");
    }
    return valorRecuperar * 100 / pagamentoPercentual;
}

const checkStakeAndBalance = (stake: number) => {
  if (stake < 0.35 || moneyManager.getCurrentBalance() < 0.35) { // moneyManager.getCurrentBalance() <= 0
    telegramManager.sendMessage('🚨 *ALERTA CRÍTICO*\n\n' +
      '❌ Bot finalizado automaticamente!\n' +
      '💰 Saldo ou stake chegou a zero\n' +
      `💵 Saldo final: $${moneyManager.getCurrentBalance().toFixed(2)}`
    );
    stopBot();
    return false;
  }
  return true;
};

const clearSubscriptions = async () => {
  // Limpar todas as subscrições existentes
  if (subscriptions.ticks) {
    try {
      await subscriptions.ticks.complete();
      subscriptions.ticks.unsubscribe();
    } catch (error) {
      console.error('Erro ao limpar subscrição de ticks:', error);
    }
  }

  if (subscriptions.contracts) {
    try {
      await subscriptions.contracts.complete();
      subscriptions.contracts.unsubscribe();
    } catch (error) {
      console.error('Erro ao limpar subscrição de contratos:', error);
    }
  }

  // Resetar objeto de subscrições
  subscriptions = {};
  
  // Resetar estado do bot
  isTrading = false;
  waitingVirtualLoss = false;
  tickCount = 0;
  ticksMap.clear();
};

const startBot = async () => {
  // Garantir que todas as subscrições antigas sejam limpas
  await clearSubscriptions();

  if (!isAuthorized) {
    await authorize();
  }

  try {
    // Criar novas subscrições
    subscriptions.ticks = subscribeToTicks("R_10");
    subscriptions.contracts = subscribeToOpenOrders();
    telegramManager.sendMessage('🤖 Bot iniciado e conectado aos serviços Deriv');
  } catch (error) {
    telegramManager.sendMessage('❌ Erro ao iniciar o bot. Tentando parar e limpar as conexões...');
    await stopBot();
  }
};

const stopBot = async () => {
  await clearSubscriptions();
  telegramManager.sendMessage('🛑 Bot parado e desconectado dos serviços Deriv');
};

const subscribeToTicks = (symbol: TSymbol) => {
  const ticksStream = apiManager.augmentedSubscribe("ticks_history", {
    ticks_history: symbol,
    end: "latest",
    count: 21 as unknown as undefined,
  });

  const subscription = ticksStream.subscribe((data) => {
    if (!telegramManager.isRunningBot()) {
      subscription.unsubscribe();
      return;
    }

    if (data.msg_type === "history") {
      const ticksPrices = data.history?.prices || [];
      const digits = ticksPrices.map((price) => {
        return +price.toFixed(data?.pip_size).slice(-1);
      });
      ticksMap.set(symbol, digits);
    }

    if (data.msg_type === "tick") {
      const tickData = data as TicksStreamResponse;
      const currentPrice = +(tickData.tick?.quote || 0)
        .toFixed(tickData.tick?.pip_size)
        .slice(-1);

      const prevTicks = ticksMap.get(symbol) || [];
      if (prevTicks.length >= 5) {
        prevTicks.shift();
        prevTicks.push(currentPrice);
        ticksMap.set(symbol, prevTicks);
      }
    }

    const currentDigits = ticksMap.get(symbol) || [];
    const lastTick = currentDigits[currentDigits.length - 1];

    if (!isAuthorized || !telegramManager.isRunningBot()) return;

    if (isTrading) {
      if (waitingVirtualLoss) {
        tickCount++;
        if (tickCount === 8) {
          const isWin = lastTick > 1;

          if (!isWin) {
            waitingVirtualLoss = false;
            telegramManager.sendMessage('⚠️ Loss virtual confirmado');
          }

          isTrading = false;
          tickCount = 0;
        }
      }
    } else {
      if (lastTick === 3) {
        if (!waitingVirtualLoss) {
          let amount = moneyManager.calculateNextStake();
          const loss = +(moneyManager.getCurrentBalance().toFixed(2)) - 100;
          
          if(loss < 0 && consecutiveWins === 3){
            amount = calcularStakeRecuperacao(Math.abs(loss), 22);
            amount = +(amount.toFixed(2));
            if(amount < 0.35 && moneyManager.getCurrentBalance() >= 0.35) {
              amount = 0.35;
            }
            moneyManager.setStake(amount);
          }
          
          if (!checkStakeAndBalance(amount)) {
            return;
          }

          telegramManager.sendMessage(
            `🎯 Sinal identificado!\n` +
            `💰 Valor da entrada: $${amount.toFixed(2)}`
          );

          apiManager.augmentedSend("buy", {
            buy: "1",
            price: 100,
            parameters: {
              symbol,
              currency: "USD",
              basis: "stake",
              duration: 8,
              duration_unit: "t",
              amount: Number(amount.toFixed(2)),
              contract_type: "DIGITOVER",
              barrier: "1",
            },
          });
        } else {
          telegramManager.sendMessage('⏳ Aguardando confirmação de loss virtual');
        }
        isTrading = true;
        tickCount = 0;
      }
    }
  });

  return ticksStream;
};

const subscribeToOpenOrders = () => {
  const contractSub = apiManager.augmentedSubscribe("proposal_open_contract");
  const subscription = contractSub.subscribe((data) => {
    if (!telegramManager.isRunningBot()) {
      subscription.unsubscribe();
      return;
    }
    const contract = data.proposal_open_contract;
    const status = contract?.status;
    const profit = contract?.profit;
    if (status && status !== "open") {
      const isWin = status === "won";
      moneyManager.updateLastTrade(isWin);
      
      telegramManager.updateTradeResult(isWin, moneyManager.getCurrentBalance());
      
      const resultMessage = isWin ? 
        '✅ Trade ganho!' : 
        '❌ Trade perdido!';
      telegramManager.sendMessage(
        `${resultMessage}\n` +
        `💰 Lucro: $${profit}\n` +
        `💵 Saldo: $${moneyManager.getCurrentBalance().toFixed(2)}`
      );

      isTrading = false;

      if(isWin) {
        consecutiveWins++;
      }
      
      if (!isWin) {
        consecutiveWins = 0;
        // waitingVirtualLoss = true;
        // telegramManager.sendMessage('🔄 Ativando verificação de loss virtual');
      }
    }
  });

  return contractSub;
};

const authorize = async () => {
  try {
    await apiManager.authorize(DERIV_TOKEN);
    isAuthorized = true;
    telegramManager.sendMessage('🔐 Bot autorizado com sucesso na Deriv');
    return true;
  } catch (err) {
    isAuthorized = false;
    telegramManager.sendMessage('❌ Erro ao autorizar bot na Deriv');
    return false;
  }
};

function main() {
  apiManager.connection.addEventListener("open", async () => {
    telegramManager.sendMessage('🌐 Conexão WebSocket estabelecida');
    authorize();
  });

  apiManager.connection.addEventListener("close", async () => {
    isAuthorized = false;
    await clearSubscriptions();
    telegramManager.sendMessage('⚠️ Conexão WebSocket fechada');
  });

  // Observadores do estado do bot do Telegram
  setInterval(async () => {
    if (telegramManager.isRunningBot() && !subscriptions.ticks) {
      await startBot();
    } else if (!telegramManager.isRunningBot() && (subscriptions.ticks || subscriptions.contracts)) {
      await stopBot();
    }
  }, 1000);
}

main();
