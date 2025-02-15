import { loadHistoricalData } from "../utils/load-data";
import { runBackTest } from "./run-backtest";
import { ThreeAboveOneStrategy } from "./strategies/above-one";
import { CompleteBackTestResult } from "./types";

export async function getBackTestResults() {
  const results: CompleteBackTestResult[] = [];

  try {
    const data = await loadHistoricalData({
      symbol: 'R_10',
      count: 1000,  // 30 ticks = 1 minute - 43200 ticks = 24 hours
      format: 'digits'
    }) as number[];
    const backTestResults = runBackTest(data, ThreeAboveOneStrategy, 100);
    results.push(backTestResults);
  } catch (error) {
    console.error('Erro ao executar backtest:', error);
  } 

  return results;
}