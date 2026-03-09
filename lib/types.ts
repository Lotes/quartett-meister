export type WinCondition = 'lower' | 'higher';
export type ScaleType = 'linear' | 'logarithmic';

export interface PropertyDefinition {
  id: string;
  name: string;
  unit: string;
  winCondition: WinCondition;
  min: number;
  max: number;
  scaleType: ScaleType;
}

export interface Card {
  id: string;
  quartettId: string;
  name: string;
  values: Record<string, number>; // Property ID -> Points (0 to S)
}

export interface DeckSettings {
  cardCount: number; // N
  propertyCount: number; // P
  maxPoints: number; // S
  budget: number; // B
}

export interface QuartettProject {
  settings: DeckSettings;
  properties: PropertyDefinition[];
  cards: Card[];
}
