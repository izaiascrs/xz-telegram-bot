import "dotenv/config";
import { RealMoneyManager } from "./money-management";
import { MoneyManagement } from "./money-management/types";
import apiManager from "./ws";
import { TicksStreamResponse } from "@deriv/api-types";
import { DERIV_TOKEN } from "./utils/constants";
import { TelegramManager } from "./telegram";
import { TradeService } from "./database/trade-service";
import { initDatabase } from "./database/schema";

type TSymbol = (typeof symbols)[number];
const symbols = ["R_10"] as const;

const BALANCE_TO_START_TRADING = 10_000;

const config: MoneyManagement = {
  type: "fixed",
  initialStake: 0.35,
  profitPercent: 22,
  maxStake: 200,
  maxLoss: 10_000,
  sorosLevel: 3,
  enableSoros: true,
  sorosPercent: 50,
  winsBeforeRecovery: 3,
  initialBalance: BALANCE_TO_START_TRADING
};

let isAuthorized = false;
let isTrading = false;
let waitingVirtualLoss = false;
let tickCount = 0;
let consecutiveWins = 0;

let subscriptions: {
  ticks?: any;
  contracts?: any;
} = {};

// Adicionar um array para controlar todas as subscrições ativas
let activeSubscriptions: any[] = [];

// Inicializar o banco de dados
const database = initDatabase();
const tradeService = new TradeService(database);
const telegramManager = new TelegramManager(tradeService);
const moneyManager = new RealMoneyManager(config, BALANCE_TO_START_TRADING);

const ticksMap = new Map<TSymbol, number[]>([]);

const checkStakeAndBalance = (stake: number) => {
  if (stake < 0.35 || moneyManager.getCurrentBalance() < 0.35) {
    telegramManager.sendMessage(
      "🚨 *ALERTA CRÍTICO*\n\n" +
        "❌ Bot finalizado automaticamente!\n" +
        "💰 Saldo ou stake chegou a zero\n" +
        `💵 Saldo final: $${moneyManager.getCurrentBalance().toFixed(2)}`
    );
    stopBot();
    return false;
  }
  return true;
};

const clearSubscriptions = async () => {
  try {
    // Limpar todas as subscrições ativas
    for (const subscription of activeSubscriptions) {
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          console.error("Erro ao limpar subscrição:", error);
        }
      }
    }
    
    // Limpar array de subscrições
    activeSubscriptions = [];
    
    // Limpar objeto de subscrições
    subscriptions = {};

    // Resetar todos os estados
    isTrading = false;
    waitingVirtualLoss = false;
    tickCount = 0;
    ticksMap.clear();
    
  } catch (error) {
    console.error("Erro ao limpar subscrições:", error);
  }
};

const startBot = async () => {
  updateActivityTimestamp(); // Atualizar timestamp ao iniciar o bot
  await clearSubscriptions();

  if (!isAuthorized) {
    await authorize();
  }

  try {
    subscriptions.ticks = subscribeToTicks("R_10");
    subscriptions.contracts = subscribeToOpenOrders();
    
    if (!subscriptions.ticks || !subscriptions.contracts) {
      throw new Error("Falha ao criar subscrições");
    }

    telegramManager.sendMessage("🤖 Bot iniciado e conectado aos serviços Deriv");
  } catch (error) {
    console.error("Erro ao iniciar bot:", error);
    telegramManager.sendMessage("❌ Erro ao iniciar o bot. Tentando parar e limpar as conexões...");
    await stopBot();
  }
};

const stopBot = async () => {
  updateActivityTimestamp(); // Atualizar timestamp ao parar o bot
  await clearSubscriptions();
  telegramManager.sendMessage("🛑 Bot parado e desconectado dos serviços Deriv");
};

const subscribeToTicks = (symbol: TSymbol) => {
  const ticksStream = apiManager.augmentedSubscribe("ticks_history", {
    ticks_history: symbol,
    end: "latest",
    count: 21 as unknown as undefined,
  });

  const subscription = ticksStream.subscribe((data) => {
    updateActivityTimestamp(); // Atualizar timestamp ao receber ticks

    if (!telegramManager.isRunningBot()) {
      subscription.unsubscribe();
      const index = activeSubscriptions.indexOf(subscription);
      if (index > -1) {
        activeSubscriptions.splice(index, 1);
      }
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
          updateActivityTimestamp(); // Atualizar timestamp ao processar loss virtual
          const isWin = lastTick > 1;

          if (!isWin) {
            waitingVirtualLoss = false;
            telegramManager.sendMessage("⚠️ Loss virtual confirmado");
          }

          isTrading = false;
          tickCount = 0;
        }
      }
    } else {
      if (lastTick === 3) {
        updateActivityTimestamp(); // Atualizar timestamp ao identificar sinal
        if (!waitingVirtualLoss) {
          let amount = moneyManager.calculateNextStake();
          // const loss = +moneyManager.getCurrentBalance().toFixed(2) - 100;

          // if (loss < 0 && consecutiveWins === 3) {
          //   amount = calculateRecoveryStake(Math.abs(loss), 22);
          //   amount = +amount.toFixed(2);
          //   if (amount < 0.35 && moneyManager.getCurrentBalance() >= 0.35) {
          //     amount = 0.35;
          //   }
          //   moneyManager.setStake(amount);
          // }

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
          })
        } else {
          telegramManager.sendMessage(
            "⏳ Aguardando confirmação de loss virtual"
          );
        }
        isTrading = true;
        tickCount = 0;
      }
    }
  });

  activeSubscriptions.push(subscription);
  return ticksStream;
};

const subscribeToOpenOrders = () => {
  const contractSub = apiManager.augmentedSubscribe("proposal_open_contract");
  
  const subscription = contractSub.subscribe((data) => {
    updateActivityTimestamp();

    if (!telegramManager.isRunningBot()) {
      subscription.unsubscribe();
      const index = activeSubscriptions.indexOf(subscription);
      if (index > -1) {
        activeSubscriptions.splice(index, 1);
      }
      return;
    }

    const contract = data.proposal_open_contract;
    const status = contract?.status;
    const profit = contract?.profit ?? 0;
    const stake = contract?.buy_price || 0;

    if (!contract || !status) return;

    if (status !== "open") {
      updateActivityTimestamp();
      const isWin = status === "won";
      
      // Calcular novo saldo baseado no resultado
      const currentBalance = moneyManager.getCurrentBalance();
      let newBalance = currentBalance;
      
      if (isWin) {
        newBalance = currentBalance + profit;
      } else {
        newBalance = currentBalance - stake;
      }
      
      moneyManager.updateBalance(Number(newBalance.toFixed(2)));
      moneyManager.updateLastTrade(isWin, stake);
      telegramManager.updateTradeResult(isWin, moneyManager.getCurrentBalance());

      const resultMessage = isWin ? "✅ Trade ganho!" : "❌ Trade perdido!";
      telegramManager.sendMessage(
        `${resultMessage}\n` +
        `💰 ${isWin ? 'Lucro' : 'Prejuízo'}: $${isWin ? profit : stake}\n` +
        `💵 Saldo: $${moneyManager.getCurrentBalance().toFixed(2)}`
      );

      isTrading = false;
      tickCount = 0;
      // waitingVirtualLoss = !isWin;

      if (isWin) {
        consecutiveWins++;
      } else {
        consecutiveWins = 0;
      }

      // Salvar trade no banco
      tradeService.saveTrade({
        isWin,
        stake,
        profit: isWin ? profit : -stake,
        balanceAfter: newBalance
      }).catch(err => console.error('Erro ao salvar trade:', err));
    }
  });

  activeSubscriptions.push(subscription);
  return contractSub;
};

const authorize = async () => {
  try {
    await apiManager.authorize(DERIV_TOKEN);
    isAuthorized = true;
    telegramManager.sendMessage("🔐 Bot autorizado com sucesso na Deriv");
    return true;
  } catch (err) {
    isAuthorized = false;
    telegramManager.sendMessage("❌ Erro ao autorizar bot na Deriv");
    return false;
  }
};

// Adicionar verificação periódica do estado do bot
setInterval(() => {
  if (telegramManager.isRunningBot() && !isTrading && !waitingVirtualLoss) {
    // Verificar se o bot está "travado"
    const lastActivity = Date.now() - lastActivityTimestamp;
    if (lastActivity > 180_000) { // 180 segundos sem atividade
      console.log("Detectado possível travamento do bot, resetando estados...");
      isTrading = false;
      waitingVirtualLoss = false;
      tickCount = 0;
      lastActivityTimestamp = Date.now();
    }
  }
}, 10000);

// Adicionar timestamp da última atividade
let lastActivityTimestamp = Date.now();

// Atualizar o timestamp em momentos importantes
const updateActivityTimestamp = () => {
  lastActivityTimestamp = Date.now();
};

function main() {
  apiManager.connection.addEventListener("open", async () => {
    telegramManager.sendMessage("🌐 Conexão WebSocket estabelecida");
    authorize();
  });

  apiManager.connection.addEventListener("close", async () => {
    isAuthorized = false;
    await clearSubscriptions();
    telegramManager.sendMessage("⚠️ Conexão WebSocket fechada");
  });

  // Observadores do estado do bot do Telegram
  setInterval(async () => {
    if (telegramManager.isRunningBot() && !subscriptions.ticks) {
      await startBot();
    } else if (
      !telegramManager.isRunningBot() &&
      (subscriptions.ticks || subscriptions.contracts)
    ) {
      await stopBot();
    }
  }, 1000);
}

main();
