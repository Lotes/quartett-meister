import { Card, PropertyDefinition } from './types';

export interface CardMetrics {
  siegespunkte: number;
  stichpunkte: number;
  totalWins: number;
  totalTies: number;
  totalComparisons: number;
}

/**
 * Compare card A against card B for all properties.
 * Returns wins and ties from card A's perspective.
 *
 * A wins a property if:
 *   - winCondition === 'higher' and A's value > B's value
 *   - winCondition === 'lower'  and A's value < B's value
 * A ties if both values are equal.
 */
export function comparePair(
  cardA: Card,
  cardB: Card,
  properties: PropertyDefinition[],
): { wins: number; ties: number } {
  let wins = 0;
  let ties = 0;
  for (const prop of properties) {
    const aVal = cardA.values[prop.id] ?? 0;
    const bVal = cardB.values[prop.id] ?? 0;
    if (aVal === bVal) {
      ties++;
    } else if (
      (prop.winCondition === 'higher' && aVal > bVal) ||
      (prop.winCondition === 'lower' && aVal < bVal)
    ) {
      wins++;
    }
  }
  return { wins, ties };
}
