import { loadHistoricalData } from "../utils/load-data";
import { runBackTest } from "./run-backtest";
import { ThreeAboveStrategy } from "./strategies/above-one";
import { BackTestResult } from "./types";

export async function getBackTestResults() {
  const results: { digit: number; backtest: BackTestResult }[] = [];
  const zeroAboveOne = new ThreeAboveStrategy({ entryDigit: 0, compareDigit: 1 });
  const oneAboveOne = new ThreeAboveStrategy({ entryDigit: 1, compareDigit: 1 });
  const twoAboveOne = new ThreeAboveStrategy({ entryDigit: 2, compareDigit: 1 });
  const threeAboveOne = new ThreeAboveStrategy({ entryDigit: 3, compareDigit: 1 });
  const fourAboveOne = new ThreeAboveStrategy({ entryDigit: 4, compareDigit: 1 });
  const fiveAboveOne = new ThreeAboveStrategy({ entryDigit: 5, compareDigit: 1 });
  const sixAboveOne = new ThreeAboveStrategy({ entryDigit: 6, compareDigit: 1 });
  const sevenAboveOne = new ThreeAboveStrategy({ entryDigit: 7, compareDigit: 1 });
  const eightAboveOne = new ThreeAboveStrategy({ entryDigit: 8, compareDigit: 1 });
  const nineAboveOne = new ThreeAboveStrategy({ entryDigit: 9, compareDigit: 1 });

  try {
    const data = await loadHistoricalData({
      symbol: 'R_10',
      count: 43_200,  // 30 ticks = 1 minute - 43200 ticks = 24 hours
      format: 'digits'
    }) as number[];
    
    const backTestResultsZero = runBackTest(data, zeroAboveOne, 100);
    const backTestResultsOne = runBackTest(data, oneAboveOne, 100);
    const backTestResultsTwo = runBackTest(data, twoAboveOne, 100);
    const backTestResultsThree = runBackTest(data, threeAboveOne, 100);
    const backTestResultsFour = runBackTest(data, fourAboveOne, 100);
    const backTestResultsFive = runBackTest(data, fiveAboveOne, 100);
    const backTestResultsSix = runBackTest(data, sixAboveOne, 100);
    const backTestResultsSeven = runBackTest(data, sevenAboveOne, 100);
    const backTestResultsEight = runBackTest(data, eightAboveOne, 100);
    const backTestResultsNine = runBackTest(data, nineAboveOne, 100);

    const allResults = [
      { digit: 0, backtest: backTestResultsZero.backtest },
      { digit: 1, backtest: backTestResultsOne.backtest },
      { digit: 2, backtest: backTestResultsTwo.backtest },
      { digit: 3, backtest: backTestResultsThree.backtest },
      { digit: 4, backtest: backTestResultsFour.backtest },
      { digit: 5, backtest: backTestResultsFive.backtest },
      { digit: 6, backtest: backTestResultsSix.backtest },
      { digit: 7, backtest: backTestResultsSeven.backtest },
      { digit: 8, backtest: backTestResultsEight.backtest },
      { digit: 9, backtest: backTestResultsNine.backtest },
    ].map(result => {
      // Encontra o melhor tick para cada dígito
      const bestTick = result.backtest.reduce((best, current) => {
        // Peso para taxa de vitória (70%)
        const currentWinScore = current.winRate * 0.7;
        const bestWinScore = best.winRate * 0.7;
  
        // Peso para perdas consecutivas (30%)
        // Quanto menor o número de perdas consecutivas, melhor
        const currentLossScore = (10 - current.maxConsecutiveLosses) * 3;
        const bestLossScore = (10 - best.maxConsecutiveLosses) * 3;
  
        // Score total
        const currentScore = currentWinScore + currentLossScore;
        const bestScore = bestWinScore + bestLossScore;
  
        return currentScore > bestScore ? current : best;
      }, result.backtest[0]);
  
      return {
        digit: result.digit,
        backtest: bestTick,
        score: (bestTick.winRate * 0.7) + ((10 - bestTick.maxConsecutiveLosses) * 3)
      };
    });

    // const zeroBestTickWinRate = backTestResultsZero.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsZero.backtest[0]);

    // const oneBestTickWinRate = backTestResultsOne.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsOne.backtest[0]);

    // const twoBestTickWinRate = backTestResultsTwo.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsTwo.backtest[0]);

    // const threeBestTickWinRate = backTestResultsThree.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsThree.backtest[0]);

    // const fourBestTickWinRate = backTestResultsFour.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsFour.backtest[0]);

    // const fiveBestTickWinRate = backTestResultsFive.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsFive.backtest[0]);
    
    // const sixBestTickWinRate = backTestResultsSix.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsSix.backtest[0]);

    // const sevenBestTickWinRate = backTestResultsSeven.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsSeven.backtest[0]);

    // const eightBestTickWinRate =  backTestResultsEight.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsEight.backtest[0]);

    // const nineBestTickWinRate = backTestResultsNine.backtest.reduce((best, current) => {
    //   return current.winRate > best.winRate ? current : best;
    // }, backTestResultsNine.backtest[0]);

    // const bestTickWinRates = [
    //   { digit: 0, backtest: zeroBestTickWinRate },
    //   { digit: 1, backtest: oneBestTickWinRate },
    //   { digit: 2, backtest: twoBestTickWinRate },
    //   { digit: 3, backtest: threeBestTickWinRate },
    //   { digit: 4, backtest: fourBestTickWinRate },
    //   { digit: 5, backtest: fiveBestTickWinRate },
    //   { digit: 6, backtest: sixBestTickWinRate },
    //   { digit: 7, backtest: sevenBestTickWinRate },
    //   { digit: 8, backtest: eightBestTickWinRate },
    //   { digit: 9, backtest: nineBestTickWinRate }
    // ];

    // const bestTickWinRate = bestTickWinRates.reduce((best, current) => {
    //   return current.backtest.winRate > best.backtest.winRate ? current : best;
    // }, bestTickWinRates[0]);

    const bestResult = allResults.reduce((best, current) => {
      return current.score > best.score ? current : best;
    }, allResults[0]);
    results.push(bestResult);
  } catch (error) {
    console.error('Erro ao executar backtest:', error);
  } 

  return results;
}