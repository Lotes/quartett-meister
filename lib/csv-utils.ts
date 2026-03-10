import * as d3 from 'd3';
import { PropertyDefinition, Card, WinCondition, ScaleType, DeckSettings } from './types';

export function exportPropertiesToCSV(properties: PropertyDefinition[]): string {
  const data = properties.map(p => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    winCondition: p.winCondition,
    min: p.min,
    max: p.max,
    scaleType: p.scaleType
  }));
  return d3.csvFormat(data);
}

function parseDSV(text: string) {
  const firstLine = text.split('\n')[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  return d3.dsvFormat(delimiter).parse(text);
}

export function importPropertiesFromCSV(csvText: string): PropertyDefinition[] {
  const parsed = parseDSV(csvText);
  return parsed.map((row: any) => ({
    id: row.id || `prop-${Date.now()}-${Math.random()}`,
    name: row.name || 'Unbenannt',
    unit: row.unit || '',
    winCondition: (row.winCondition === 'lower' ? 'lower' : 'higher') as WinCondition,
    min: parseFloat(row.min) || 0,
    max: parseFloat(row.max) || 100,
    scaleType: (row.scaleType === 'logarithmic' ? 'logarithmic' : 'linear') as ScaleType
  }));
}

export function exportCardsToCSV(cards: Card[], properties: PropertyDefinition[]): string {
  const data = cards.map(c => {
    const row: any = {
      id: c.id,
      quartettId: c.quartettId,
      name: c.name
    };
    properties.forEach(p => {
      row[p.name] = c.values[p.id] ?? p.min;
    });
    return row;
  });
  return d3.csvFormat(data);
}

export function importCardsFromCSV(csvText: string, properties: PropertyDefinition[]): Card[] {
  const parsed = parseDSV(csvText);
  return parsed.map((row: any) => {
    const values: Record<string, number> = {};
    properties.forEach(p => {
      if (row[p.name] !== undefined) {
        values[p.id] = parseFloat(row[p.name]) || 0;
      } else if (row[p.id] !== undefined) {
        // Fallback to ID if name not found (for backward compatibility)
        values[p.id] = parseFloat(row[p.id]) || 0;
      }
    });
    return {
      id: row.id || `card-${Date.now()}-${Math.random()}`,
      quartettId: row.quartettId || '',
      name: row.name || 'Unbenannt',
      values
    };
  });
}

export function exportSettingsToCSV(settings: DeckSettings): string {
  const data = [
    { setting: 'N', value: settings.cardCount },
    { setting: 'P', value: settings.propertyCount },
    { setting: 'S', value: settings.maxPoints },
    { setting: 'B', value: settings.budget },
    { setting: 'T', value: settings.tolerance },
  ];
  return d3.csvFormat(data);
}

export function importSettingsFromCSV(csvText: string): Partial<DeckSettings> {
  const parsed = parseDSV(csvText);
  const result: Partial<DeckSettings> = {};
  parsed.forEach((row: any) => {
    const key = row.setting?.trim().toUpperCase();
    const val = parseInt(row.value, 10);
    if (isNaN(val)) return;
    if (key === 'N') result.cardCount = val;
    else if (key === 'P') result.propertyCount = val;
    else if (key === 'S') result.maxPoints = val;
    else if (key === 'B') result.budget = val;
    else if (key === 'T') result.tolerance = val;
  });
  return result;
}

export function downloadCSV(csvText: string, filename: string) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
