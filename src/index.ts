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
  type: "martingale-soros",
  initialStake: 0.35,
  profitPercent: 22,
  maxStake: 100,
  maxLoss: 10,
  sorosLevel: 10,
};

let isAuthorized = false;
let isTrading = false;
let waitingVirtualLoss = false;
let tickCount = 0;
let activeSymbolSubscription: any = null;
let activeContractSubscription: any = null;

const moneyManager = new RealMoneyManager(config, 1000);
const telegramManager = new TelegramManager();

const ticksMap = new Map<TSymbol, number[]>([]);

const checkStakeAndBalance = (stake: number) => {
  if (stake <= 0 || moneyManager.getCurrentBalance() <= 0) {
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

const startBot = async () => {
  if (!isAuthorized) {
    await authorize();
  }
  activeSymbolSubscription = subscribeToTicks("R_10");
  activeContractSubscription = subscribeToOpenOrders();
  telegramManager.sendMessage('🤖 Bot iniciado e conectado aos serviços Deriv');
};

const stopBot = () => {
  if (activeSymbolSubscription) {
    activeSymbolSubscription.unsubscribe();
    activeSymbolSubscription = null;
  }
  if (activeContractSubscription) {
    activeContractSubscription.unsubscribe();
    activeContractSubscription = null;
  }
  isTrading = false;
  waitingVirtualLoss = false;
  tickCount = 0;
  telegramManager.sendMessage('🛑 Bot parado e desconectado dos serviços Deriv');
}; 

const subscribeToTicks = (symbol: TSymbol) => {
  const ticksStream = apiManager.augmentedSubscribe("ticks_history", {
    ticks_history: symbol,
    end: "latest",
    count: 21 as unknown as undefined,
  });

  ticksStream.subscribe((data) => {
    if (!telegramManager.isRunningBot()) return;

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
          const amount = moneyManager.calculateNextStake();
          
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
  contractSub.subscribe((data) => {
    const contract = data.proposal_open_contract;
    const status = contract?.status;
    const profit = contract?.profit;
    if (status && status !== "open") {
      const isWin = status === "won";
      moneyManager.updateLastTrade(isWin);
      
      if (!checkStakeAndBalance(moneyManager.calculateNextStake())) {
        return;
      }
      
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
      
      if (!isWin) {
        waitingVirtualLoss = true;
        telegramManager.sendMessage('🔄 Ativando verificação de loss virtual');
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
  apiManager.connection.addEventListener("open", () => {
    telegramManager.sendMessage('🌐 Conexão WebSocket estabelecida');
    authorize();
  });

  apiManager.connection.addEventListener("close", () => {
    isAuthorized = false;
    telegramManager.sendMessage('⚠️ Conexão WebSocket fechada');
  });

  // Observadores do estado do bot do Telegram
  setInterval(() => {
    if (telegramManager.isRunningBot() && !activeSymbolSubscription) {
      startBot();
    } else if (!telegramManager.isRunningBot() && activeSymbolSubscription) {
      stopBot();
    }
  }, 1000);
}

main();
