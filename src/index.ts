import "dotenv/config";
import { MoneyManagementV2 } from "./money-management/types";
import { TradeService } from "./database/trade-service";
import { initDatabase } from "./database/schema";
import { MoneyManager } from "./money-management/moneyManager";
import { getBackTestResults } from "./backtest";
import { schedule } from 'node-cron';
import { ContractStatus, TicksStreamResponse } from "@deriv/api-types";
import { TelegramManager } from "./telegram";
import apiManager from "./ws";
import { DERIV_TOKEN } from "./utils/constants";

type TSymbol = (typeof symbols)[number];
const symbols = ["R_10"] as const;

const BALANCE_TO_START_TRADING = 100;
const CONTRACT_SECONDS = 2;
let CONTRACT_TICKS = 8;
let NEXT_CONTRACT_TICKS: number | undefined = undefined;

const config: MoneyManagementV2 = {
  type: "martingale-soros",
  initialStake: 0.35,
  profitPercent: 22,
  maxStake: 100,
  maxLoss: 7,
  sorosLevel: 20,
  winsBeforeMartingale: 3,
  initialBalance: BALANCE_TO_START_TRADING,
  targetProfit: 1,
};

let isAuthorized = false;
let isTrading = false;
let waitingVirtualLoss = false;
let tickCount = 0;
let consecutiveWins = 0;
let lastContractId: number | undefined = undefined;
let lastContractIntervalId: NodeJS.Timeout | null = null;
let signalDigit = 3;

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
const moneyManager = new MoneyManager(config, config.initialBalance);

// Configura callback para quando atingir o lucro alvo
moneyManager.setOnTargetReached((profit, balance) => {
  const message = `🎯 Lucro alvo atingido!\n\n` +
    `💰 Lucro: $${profit.toFixed(2)}\n` +
    `🎯 Meta: $${config.targetProfit}\n` +
    `💵 Saldo: $${balance.toFixed(2)}\n\n` +
    `✨ Reiniciando sessão com saldo inicial de $${config.initialBalance.toFixed(2)}`;

  telegramManager.sendMessage(message);
});

const ticksMap = new Map<TSymbol, number[]>([]);

const task = schedule('0 21 * * *', () => {
  telegramManager.sendMessage("⏳ Iniciando backtest...");
  getBackTestResults().then((results) => {
    const bestResult = results.length > 0 ? results[0] : null;

    if(!bestResult) return;  
    const backtest = bestResult.backtest;
    const digit = bestResult.digit;
    const { winRate, ticks } = backtest;
    if(isTrading) {
      NEXT_CONTRACT_TICKS = ticks;
    } else {
      CONTRACT_TICKS = ticks;
      NEXT_CONTRACT_TICKS = undefined;
    }
    signalDigit = digit;
    telegramManager.sendMessage(
      `✅ Backtest finalizado com sucesso!\n` +
      `🔢 Digito: ${digit}\n` +
      `🔄 Ticks: ${ticks}\n` +
      `💰 Win Rate: ${winRate.toFixed(2)}%`
    );
  });
},  {
  scheduled: false,
  timezone: "America/Sao_Paulo"
});

function createTradeTimeout() {
  lastContractIntervalId = setInterval(() => {
    if(lastContractId) {
      getLastTradeResult(lastContractId);
    }
  }, ((CONTRACT_TICKS * CONTRACT_SECONDS) * 1000) * 2);
}

function clearTradeTimeout() {
  if(lastContractIntervalId) {
    clearInterval(lastContractIntervalId);
    lastContractIntervalId = null;
  }
}

function handleTradeResult({
  profit,
  stake,
  status
}: {
  profit: number;
  stake: number;
  status: ContractStatus;
}) {

  if(status === "open") return;
  updateActivityTimestamp();
  const isWin = status === "won";
  
  // Calcular novo saldo baseado no resultado
  const currentBalance = moneyManager.getCurrentBalance();
  let newBalance = currentBalance;

  isTrading = false;
  tickCount = 0;
  lastContractId = undefined;
  waitingVirtualLoss = false;
  
  if (isWin) {
    newBalance = currentBalance + profit;
    consecutiveWins++;
  } else {
    newBalance = currentBalance - stake;
    consecutiveWins = 0;
  }
  
  // moneyManager.updateBalance(Number(newBalance.toFixed(2)));
  moneyManager.updateLastTrade(isWin);
  telegramManager.updateTradeResult(isWin, moneyManager.getCurrentBalance());

  const resultMessage = isWin ? "✅ Trade ganho!" : "❌ Trade perdido!";
  telegramManager.sendMessage(
    `${resultMessage}\n` +
    `💰 ${isWin ? 'Lucro' : 'Prejuízo'}: $${isWin ? profit : stake}\n` +
    `💵 Saldo: $${moneyManager.getCurrentBalance().toFixed(2)}`
  );  

  // Salvar trade no banco
  tradeService.saveTrade({
    isWin,
    stake,
    profit: isWin ? profit : -stake,
    balanceAfter: newBalance
  }).catch(err => console.error('Erro ao salvar trade:', err));

  clearTradeTimeout();
}

async function getLastTradeResult(contractId: number | undefined) {
  if(!contractId) return;

  const data = await apiManager.augmentedSend('proposal_open_contract', { contract_id: contractId })
  const contract = data.proposal_open_contract;
  const profit = contract?.profit ?? 0;
  const stake = contract?.buy_price ?? 0;
  const status = contract?.status;
  handleTradeResult({
    profit,
    stake,
    status: status ?? "open"
  });
}

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
    isAuthorized = false;
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
        if (tickCount === CONTRACT_TICKS) {
          updateActivityTimestamp(); // Atualizar timestamp ao processar loss virtual
          const isWin = lastTick > signalDigit;

          // Atualizar ticks do próximo contrato
          if(NEXT_CONTRACT_TICKS) {
            CONTRACT_TICKS = NEXT_CONTRACT_TICKS;
            NEXT_CONTRACT_TICKS = undefined;
          }

          if (!isWin) {
            waitingVirtualLoss = false;
            telegramManager.sendMessage("⚠️ Loss virtual confirmado");
          }

          isTrading = false;
          tickCount = 0;
        }
      }
    } else {
      if (lastTick === signalDigit) {
        updateActivityTimestamp(); // Atualizar timestamp ao identificar sinal
        if (!waitingVirtualLoss) {
          let amount = moneyManager.calculateNextStake();

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
              duration: CONTRACT_TICKS,
              duration_unit: "t",
              amount: Number(amount.toFixed(2)),
              contract_type: "DIGITOVER",
              barrier: "1",
            },
          }).then(async (data) => {
            const contractId = data.buy?.contract_id;
            lastContractId = contractId;
            createTradeTimeout();
          });
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

    handleTradeResult({
      profit,
      stake,
      status: status ?? "open"
    });

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
setInterval(async () => {
  if (telegramManager.isRunningBot() && !isTrading && !waitingVirtualLoss && moneyManager.getCurrentBalance() > 0) {
    // Verificar se o bot está "travado"
    const lastActivity = Date.now() - lastActivityTimestamp;
    if (lastActivity > (60_000 * 2)) { // 2 minutos sem atividade
      console.log("Detectado possível travamento do bot, resetando estados...");
      isTrading = false;
      waitingVirtualLoss = false;
      tickCount = 0;
      lastActivityTimestamp = Date.now();
      await clearSubscriptions();
    }
  }
}, (30_000)); // 30 segundos

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

  apiManager.connection.addEventListener("error", async (event) => {
    console.error("Erro na conexão:", event);
    telegramManager.sendMessage("❌ Erro na conexão com o servidor Deriv");
    await clearSubscriptions();
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
  }, 10_000);
}

main();

// task.start();
