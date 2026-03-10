'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Settings, 
  Table as TableIcon, 
  LayoutGrid, 
  ChevronLeft, 
  Plus, 
  Trash2, 
  Save, 
  AlertCircle,
  CheckCircle2,
  Info,
  Download,
  Upload,
  FileText,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  QuartettProject, 
  PropertyDefinition, 
  Card, 
  DeckSettings, 
  WinCondition, 
  ScaleType 
} from '@/lib/types';
import { 
  exportPropertiesToCSV, 
  importPropertiesFromCSV, 
  exportCardsToCSV, 
  importCardsFromCSV, 
  downloadCSV 
} from '@/lib/csv-utils';
import RadarChart from '@/components/RadarChart';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STORAGE_KEY = 'quartett_editor_project';

const DEFAULT_SETTINGS: DeckSettings = {
  cardCount: 32,
  propertyCount: 6,
  maxPoints: 10,
  budget: 30,
  tolerance: 0,
};

const INITIAL_PROJECT: QuartettProject = {
  settings: DEFAULT_SETTINGS,
  properties: Array.from({ length: 6 }, (_, i) => ({
    id: `prop-${i}`,
    name: `Eigenschaft ${i + 1}`,
    unit: '',
    winCondition: 'higher',
    min: 0,
    max: 100,
    scaleType: 'linear',
  })),
  cards: Array.from({ length: 32 }, (_, i) => ({
    id: `card-${i}`,
    quartettId: `${Math.floor(i / 4) + 1}${String.fromCharCode(65 + (i % 4))}`,
    name: `Karte ${i + 1}`,
    values: {
      'prop-0': 50,
      'prop-1': 50,
      'prop-2': 50,
      'prop-3': 50,
      'prop-4': 50,
      'prop-5': 50,
    },
  })),
};

function valueToRawPoints(value: number, prop: PropertyDefinition, maxPoints: number): number {
  let raw: number;
  if (prop.scaleType === 'linear') {
    raw = ((value - prop.min) / (prop.max - prop.min)) * maxPoints;
  } else {
    const min = prop.min || 0.1;
    const max = prop.max || 1;
    if (value <= min) raw = 0;
    else if (value >= max) raw = maxPoints;
    else raw = (Math.log(value / min) / Math.log(max / min)) * maxPoints;
  }
  return Math.max(0, Math.min(maxPoints, Math.round(raw)));
}

function valueToPoints(value: number, prop: PropertyDefinition, maxPoints: number): number {
  const raw = valueToRawPoints(value, prop, maxPoints);
  return prop.winCondition === 'lower' ? maxPoints - raw : raw;
}

function pointsToValue(points: number, prop: PropertyDefinition, maxPoints: number): number {
  const effectivePoints = prop.winCondition === 'lower' ? maxPoints - points : points;
  if (prop.scaleType === 'linear') {
    return prop.min + (effectivePoints / maxPoints) * (prop.max - prop.min);
  } else {
    const min = prop.min || 0.1;
    const max = prop.max || 1;
    return min * Math.pow(max / min, effectivePoints / maxPoints);
  }
}

type View = 'settings' | 'properties' | 'grid' | 'detail' | 'documentation';

export default function QuartettEditor() {
  const [project, setProject] = useState<QuartettProject>(INITIAL_PROJECT);
  const [mounted, setMounted] = useState(false);
  const [currentView, setCurrentView] = useState<View>('grid');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Load from LocalStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Backward compatibility: ensure tolerance exists
        if (data?.settings && data.settings.tolerance === undefined) {
          data.settings.tolerance = 0;
        }
        setTimeout(() => setProject(data), 0);
      } catch (e) {
        // ignore
      }
    }
    setTimeout(() => setMounted(true), 0);
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (mounted && project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
  }, [project, mounted]);

  if (!mounted) return <div className="flex items-center justify-center h-screen">Lade...</div>;

  const updateSettings = (newSettings: Partial<DeckSettings>) => {
    setProject(prev => {
      if (!prev) return prev;
      const updatedSettings = { ...prev.settings, ...newSettings };
      
      // If propertyCount changed, adjust properties array
      let updatedProperties = [...prev.properties];
      if (newSettings.propertyCount !== undefined) {
        if (newSettings.propertyCount > prev.properties.length) {
          const diff = newSettings.propertyCount - prev.properties.length;
          for (let i = 0; i < diff; i++) {
            updatedProperties.push({
              id: `prop-${Date.now()}-${i}`,
              name: `Neue Eigenschaft`,
              unit: '',
              winCondition: 'higher',
              min: 0,
              max: 100,
              scaleType: 'linear',
            });
          }
        } else {
          updatedProperties = updatedProperties.slice(0, newSettings.propertyCount);
        }
      }

      // If cardCount changed, adjust cards array
      let updatedCards = [...prev.cards];
      if (newSettings.cardCount !== undefined) {
        if (newSettings.cardCount > prev.cards.length) {
          const diff = newSettings.cardCount - prev.cards.length;
          for (let i = 0; i < diff; i++) {
            const idx = prev.cards.length + i;
            updatedCards.push({
              id: `card-${Date.now()}-${i}`,
              quartettId: `${Math.floor(idx / 4) + 1}${String.fromCharCode(65 + (idx % 4))}`,
              name: `Neue Karte`,
              values: {},
            });
          }
        } else {
          updatedCards = updatedCards.slice(0, newSettings.cardCount);
        }
      }

      return {
        ...prev,
        settings: updatedSettings,
        properties: updatedProperties,
        cards: updatedCards,
      };
    });
  };

  const updateProperty = (id: string, updates: Partial<PropertyDefinition>) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        properties: prev.properties.map(p => p.id === id ? { ...p, ...updates } : p),
      };
    });
  };

  const updateCard = (id: string, updates: Partial<Card>) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cards: prev.cards.map(c => c.id === id ? { ...c, ...updates } : c),
      };
    });
  };

  const getCardBudget = (card: Card) => {
    return project.properties.reduce((sum, prop) => {
      const val = card.values[prop.id] ?? prop.min;
      return sum + valueToPoints(val, prop, project.settings.maxPoints);
    }, 0);
  };

  const isBudgetValid = (budget: number) => {
    const { budget: B, tolerance: T } = project.settings;
    return budget >= B - T && budget <= B + T;
  };

  const getBudgetRange = () => {
    const { budget: B, tolerance: T } = project.settings;
    return { min: B - T, max: B + T };
  };

  const getCardErrors = (card: Card) => {
    const errors: string[] = [];
    project.properties.forEach(prop => {
      const val = card.values[prop.id];
      if (val === undefined) {
        errors.push(`${prop.name} fehlt.`);
      } else if (val < prop.min || val > prop.max) {
        errors.push(`${prop.name} (${val}) liegt außerhalb des Bereichs [${prop.min}, ${prop.max}].`);
      }
    });
    
    const budget = getCardBudget(card);
    const { budget: B, tolerance: T } = project.settings;
    if (budget < B - T || budget > B + T) {
      errors.push(`Budget nicht ausgeglichen: ${budget}/${B}${T > 0 ? ` (Toleranz ±${T})` : ''}.`);
    }
    
    if (!card.name.trim()) errors.push('Name fehlt.');
    if (!card.quartettId.trim()) errors.push('ID fehlt.');
    
    const idUnique = project.cards.filter(c => c.quartettId === card.quartettId).length === 1;
    if (!idUnique) errors.push('ID ist nicht eindeutig.');
    
    return errors;
  };

  const isCardReady = (card: Card) => {
    return getCardErrors(card).length === 0;
  };

  const selectedCard = project.cards.find(c => c.id === selectedCardId);

  const handleExportProperties = () => {
    const csv = exportPropertiesToCSV(project.properties);
    downloadCSV(csv, 'quartett-eigenschaften.csv');
  };

  const handleImportProperties = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const csvText = event.target?.result as string;
      const imported = importPropertiesFromCSV(csvText);
      setProject(prev => prev ? { ...prev, properties: imported, settings: { ...prev.settings, propertyCount: imported.length } } : prev);
    };
    reader.readAsText(file);
  };

  const handleExportCards = () => {
    const csv = exportCardsToCSV(project.cards, project.properties);
    downloadCSV(csv, 'quartett-karten.csv');
  };

  const handleImportCards = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const csvText = event.target?.result as string;
      const imported = importCardsFromCSV(csvText, project.properties);
      setProject(prev => prev ? { ...prev, cards: imported, settings: { ...prev.settings, cardCount: imported.length } } : prev);
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans">
      {/* Navigation Rail */}
      <nav className="fixed left-0 top-0 bottom-0 w-20 bg-white border-r border-[#1a1a1a]/10 flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-12 h-12 bg-[#1a1a1a] rounded-xl flex items-center justify-center text-white mb-4">
          <span className="font-bold text-xl">Q</span>
        </div>
        
        <button 
          onClick={() => setCurrentView('settings')}
          className={cn(
            "p-3 rounded-xl transition-all",
            currentView === 'settings' ? "bg-[#1a1a1a] text-white" : "text-[#1a1a1a]/40 hover:bg-[#1a1a1a]/5"
          )}
          title="Deck-Einstellungen"
        >
          <Settings size={24} />
        </button>
        
        <button 
          onClick={() => setCurrentView('properties')}
          className={cn(
            "p-3 rounded-xl transition-all",
            currentView === 'properties' ? "bg-[#1a1a1a] text-white" : "text-[#1a1a1a]/40 hover:bg-[#1a1a1a]/5"
          )}
          title="Eigenschaften"
        >
          <TableIcon size={24} />
        </button>
        
        <button 
          onClick={() => setCurrentView('grid')}
          className={cn(
            "p-3 rounded-xl transition-all",
            currentView === 'grid' ? "bg-[#1a1a1a] text-white" : "text-[#1a1a1a]/40 hover:bg-[#1a1a1a]/5"
          )}
          title="Kartenübersicht"
        >
          <LayoutGrid size={24} />
        </button>

        <button 
          onClick={() => setCurrentView('documentation')}
          className={cn(
            "p-3 rounded-xl transition-all mt-auto",
            currentView === 'documentation' ? "bg-[#1a1a1a] text-white" : "text-[#1a1a1a]/40 hover:bg-[#1a1a1a]/5"
          )}
          title="Dokumentation"
        >
          <HelpCircle size={24} />
        </button>
      </nav>

      <main className="pl-20 min-h-screen">
        <div className="max-w-6xl mx-auto p-8">
          <AnimatePresence mode="wait">
            {currentView === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header>
                  <h1 className="text-4xl font-serif italic mb-2">Deck-Einstellungen</h1>
                  <p className="text-[#1a1a1a]/60">Konfiguriere die Grundparameter deines Quartett-Spiels.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                    <label className="block text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 mb-4">Kartenanzahl (N)</label>
                    <input 
                      type="number" 
                      value={project.settings.cardCount}
                      onChange={(e) => updateSettings({ cardCount: parseInt(e.target.value) || 0 })}
                      className="text-4xl font-serif w-full bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 pb-2"
                    />
                    <p className="mt-4 text-sm text-[#1a1a1a]/60 italic">Wie viele Karten soll das Deck insgesamt haben?</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                    <label className="block text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 mb-4">Eigenschaftsanzahl (P)</label>
                    <input 
                      type="number" 
                      value={project.settings.propertyCount}
                      onChange={(e) => updateSettings({ propertyCount: parseInt(e.target.value) || 0 })}
                      className="text-4xl font-serif w-full bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 pb-2"
                    />
                    <p className="mt-4 text-sm text-[#1a1a1a]/60 italic">Wie viele Vergleichswerte hat jede Karte?</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                    <label className="block text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 mb-4">Max. Punkte pro Eigenschaft (S)</label>
                    <input 
                      type="number" 
                      value={project.settings.maxPoints}
                      onChange={(e) => updateSettings({ maxPoints: parseInt(e.target.value) || 0 })}
                      className="text-4xl font-serif w-full bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 pb-2"
                    />
                    <p className="mt-4 text-sm text-[#1a1a1a]/60 italic">Die Skala für das Spinnennetz (0 bis S).</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <label className="block text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40">Budget (B)</label>
                      <button 
                        onClick={() => updateSettings({ budget: (project.settings.propertyCount * project.settings.maxPoints) / 2 })}
                        className="text-[10px] uppercase font-bold text-blue-600 hover:underline"
                      >
                        Reset auf Default
                      </button>
                    </div>
                    <input 
                      type="number" 
                      value={project.settings.budget}
                      onChange={(e) => updateSettings({ budget: parseInt(e.target.value) || 0 })}
                      className="text-4xl font-serif w-full bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 pb-2"
                    />
                    <p className="mt-4 text-sm text-[#1a1a1a]/60 italic">Gesamtpunkte, die auf einer Karte verteilt werden müssen.</p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                    <label className="block text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 mb-4">Toleranz (T)</label>
                    <input 
                      type="number" 
                      min={0}
                      max={project.settings.budget}
                      value={project.settings.tolerance}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        updateSettings({ tolerance: Math.max(0, Math.min(project.settings.budget, val)) });
                      }}
                      className="text-4xl font-serif w-full bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 pb-2"
                    />
                    <p className="mt-4 text-sm text-[#1a1a1a]/60 italic">Erlaubte Abweichung vom Budget (0 bis B). Das Kartenbudget muss zwischen B−T und B+T liegen.</p>
                  </div>
                </div>
              </motion.div>
            )}

            {currentView === 'properties' && (
              <motion.div 
                key="properties"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header className="flex justify-between items-end">
                  <div>
                    <h1 className="text-4xl font-serif italic mb-2">Eigenschaften</h1>
                    <p className="text-[#1a1a1a]/60">Definiere die Parameter für den Vergleich.</p>
                  </div>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold cursor-pointer hover:bg-[#1a1a1a]/5 transition-colors">
                      <Upload size={14} />
                      Import CSV
                      <input type="file" accept=".csv" onChange={handleImportProperties} className="hidden" />
                    </label>
                    <button 
                      onClick={handleExportProperties}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold hover:bg-[#1a1a1a]/5 transition-colors"
                    >
                      <Download size={14} />
                      Export CSV
                    </button>
                  </div>
                </header>

                <div className="bg-white rounded-3xl border border-[#1a1a1a]/10 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#1a1a1a]/5 text-[10px] uppercase tracking-widest font-bold text-[#1a1a1a]/40">
                          <th className="px-6 py-4">Name</th>
                          <th className="px-6 py-4">Einheit</th>
                          <th className="px-6 py-4">Siegbedingung</th>
                          <th className="px-6 py-4">Min</th>
                          <th className="px-6 py-4">Max</th>
                          <th className="px-6 py-4">Skala</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1a1a1a]/5">
                        {project.properties.map((prop) => (
                          <tr key={prop.id} className="hover:bg-[#1a1a1a]/[0.02] transition-colors">
                            <td className="px-6 py-4">
                              <input 
                                type="text"
                                value={prop.name}
                                onChange={(e) => updateProperty(prop.id, { name: e.target.value })}
                                className="bg-transparent focus:outline-none font-medium w-full"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <input 
                                type="text"
                                value={prop.unit}
                                onChange={(e) => updateProperty(prop.id, { unit: e.target.value })}
                                className="bg-transparent focus:outline-none w-20"
                                placeholder="z.B. km/h"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <select 
                                value={prop.winCondition}
                                onChange={(e) => updateProperty(prop.id, { winCondition: e.target.value as WinCondition })}
                                className="bg-transparent focus:outline-none text-sm"
                              >
                                <option value="higher">Höher gewinnt</option>
                                <option value="lower">Niedriger gewinnt</option>
                              </select>
                            </td>
                            <td className="px-6 py-4">
                              <input 
                                type="number"
                                value={prop.min}
                                onChange={(e) => updateProperty(prop.id, { min: parseFloat(e.target.value) || 0 })}
                                className="bg-transparent focus:outline-none w-20"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <input 
                                type="number"
                                value={prop.max}
                                onChange={(e) => updateProperty(prop.id, { max: parseFloat(e.target.value) || 0 })}
                                className="bg-transparent focus:outline-none w-20"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <select 
                                value={prop.scaleType}
                                onChange={(e) => updateProperty(prop.id, { scaleType: e.target.value as ScaleType })}
                                className="bg-transparent focus:outline-none text-sm"
                              >
                                <option value="linear">Linear</option>
                                <option value="logarithmic">Logarithmisch</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {currentView === 'grid' && (
              <motion.div 
                key="grid"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header className="flex justify-between items-end">
                  <div>
                    <h1 className="text-4xl font-serif italic mb-2">Kartenübersicht</h1>
                    <p className="text-[#1a1a1a]/60">{project.cards.length} Karten im Deck.</p>
                  </div>
                  <div className="flex flex-col items-end gap-4">
                    <div className="flex gap-3">
                      <label className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold cursor-pointer hover:bg-[#1a1a1a]/5 transition-colors">
                        <Upload size={14} />
                        Import CSV
                        <input type="file" accept=".csv" onChange={handleImportCards} className="hidden" />
                      </label>
                      <button 
                        onClick={handleExportCards}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold hover:bg-[#1a1a1a]/5 transition-colors"
                      >
                        <Download size={14} />
                        Export CSV
                      </button>
                    </div>
                    <div className="flex gap-4 text-xs font-bold uppercase tracking-widest">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <span>Fertig</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                        <span>In Arbeit</span>
                      </div>
                    </div>
                  </div>
                </header>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {project.cards.map((card) => {
                    const ready = isCardReady(card);
                    const budget = getCardBudget(card);
                    
                    return (
                      <motion.div 
                        key={card.id}
                        whileHover={{ y: -4 }}
                        onClick={() => {
                          setSelectedCardId(card.id);
                          setCurrentView('detail');
                        }}
                        className={cn(
                          "bg-white rounded-3xl border p-6 cursor-pointer transition-all shadow-sm group",
                          ready ? "border-green-500/30 bg-green-50/10" : "border-[#1a1a1a]/10 hover:border-[#1a1a1a]/30"
                        )}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]/40 group-hover:text-[#1a1a1a]">
                            {card.quartettId || 'N/A'}
                          </span>
                          {ready ? (
                            <CheckCircle2 size={16} className="text-green-500" />
                          ) : (
                            <AlertCircle size={16} className="text-amber-500" />
                          )}
                        </div>
                        
                        <h3 className="text-xl font-serif mb-4 truncate">{card.name || 'Unbenannt'}</h3>
                        
                        <div className="aspect-square bg-[#1a1a1a]/[0.02] rounded-2xl flex items-center justify-center mb-4">
                          <RadarChart 
                            data={project.properties.map(p => ({
                              axis: p.name,
                              value: valueToPoints(card.values[p.id] ?? p.min, p, project.settings.maxPoints)
                            }))}
                            maxValue={project.settings.maxPoints}
                            width={150}
                            height={150}
                          />
                        </div>

                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                          <span className="text-[#1a1a1a]/40">Budget</span>
                          <span className={cn(
                            isBudgetValid(budget) ? "text-green-600" : "text-amber-600"
                          )}>
                            {budget} / {project.settings.budget}
                          </span>
                        </div>
                        <div className="mt-2 h-1 bg-[#1a1a1a]/5 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              isBudgetValid(budget) ? "bg-green-500" : "bg-amber-500"
                            )}
                            style={{ width: `${Math.min(100, (budget / project.settings.budget) * 100)}%` }}
                          />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {currentView === 'detail' && selectedCard && (
              <motion.div 
                key="detail"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <button 
                  onClick={() => setCurrentView('grid')}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/40 hover:text-[#1a1a1a] transition-colors"
                >
                  <ChevronLeft size={16} />
                  Zurück zur Übersicht
                </button>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div className="space-y-8">
                    <header>
                      <div className="flex items-center gap-4 mb-4">
                        <input 
                          type="text"
                          value={selectedCard.quartettId}
                          onChange={(e) => updateCard(selectedCard.id, { quartettId: e.target.value })}
                          className="w-20 bg-white border border-[#1a1a1a]/10 rounded-xl px-3 py-2 text-sm font-bold uppercase tracking-widest focus:outline-none focus:border-[#1a1a1a]"
                          placeholder="ID"
                        />
                        <input 
                          type="text"
                          value={selectedCard.name}
                          onChange={(e) => updateCard(selectedCard.id, { name: e.target.value })}
                          className="text-4xl font-serif bg-transparent focus:outline-none border-b border-[#1a1a1a]/10 flex-1"
                          placeholder="Kartenname"
                        />
                      </div>
                    </header>

                    <div className="bg-white p-8 rounded-[40px] border border-[#1a1a1a]/10 shadow-xl flex items-center justify-center aspect-square">
                      <RadarChart 
                        data={project.properties.map(p => ({
                          axis: p.name,
                          value: valueToPoints(selectedCard.values[p.id] ?? p.min, p, project.settings.maxPoints)
                        }))}
                        maxValue={project.settings.maxPoints}
                        width={400}
                        height={400}
                        interactive
                        onValueChange={(idx, points) => {
                          const prop = project.properties[idx];
                          const val = pointsToValue(points, prop, project.settings.maxPoints);
                          updateCard(selectedCard.id, {
                            values: { ...selectedCard.values, [prop.id]: val }
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    {getCardErrors(selectedCard).length > 0 && (
                      <div className="bg-red-50 border border-red-200 p-4 rounded-2xl space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-red-600 flex items-center gap-2">
                          <AlertCircle size={14} />
                          Validierungsfehler
                        </h4>
                        <ul className="text-[10px] text-red-800 list-disc list-inside">
                          {getCardErrors(selectedCard).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                      {(() => {
                        const cardBudget = getCardBudget(selectedCard);
                        const budgetOk = isBudgetValid(cardBudget);
                        const { min: budgetMin, max: budgetMax } = getBudgetRange();
                        const hintText = project.settings.tolerance > 0
                          ? `Budget muss zwischen ${budgetMin} und ${budgetMax} Punkten liegen.`
                          : `Verteile genau ${project.settings.budget} Punkte.`;
                        return (
                          <>
                            <div className="flex justify-between items-center mb-4">
                              <h3 className="text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40">Budget-Status</h3>
                              <span className={cn("text-xl font-serif", budgetOk ? "text-green-600" : "text-amber-600")}>
                                {cardBudget} / {project.settings.budget}
                              </span>
                            </div>
                            <div className="h-2 bg-[#1a1a1a]/5 rounded-full overflow-hidden">
                              <div 
                                className={cn("h-full transition-all duration-500", budgetOk ? "bg-green-500" : "bg-amber-500")}
                                style={{ width: `${Math.min(100, (cardBudget / project.settings.budget) * 100)}%` }}
                              />
                            </div>
                            {!budgetOk && (
                              <p className="mt-4 text-xs italic text-amber-600 flex items-center gap-2">
                                <Info size={14} />
                                {hintText}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 px-2">Eigenschaften anpassen</h3>
                      {project.properties.map((prop) => {
                        const val = selectedCard.values[prop.id] ?? prop.min;
                        const points = valueToPoints(val, prop, project.settings.maxPoints);
                        const isInvalid = val < prop.min || val > prop.max;
                        // displayPos maps min→left, max→right for both win conditions (raw, no win condition inversion)
                        const displayPos = valueToRawPoints(val, prop, project.settings.maxPoints);
                        const fillPct = (displayPos / project.settings.maxPoints) * 100;
                        const sliderStyle = prop.winCondition === 'lower'
                          ? { background: `linear-gradient(to right, #e5e7eb ${fillPct}%, #1a1a1a ${fillPct}%)` }
                          : { background: `linear-gradient(to right, #1a1a1a ${fillPct}%, #e5e7eb ${fillPct}%)` };

                        return (
                          <div key={prop.id} className={cn(
                            "bg-white p-4 rounded-2xl border transition-colors",
                            isInvalid ? "border-red-500/30 bg-red-50/10" : "border-[#1a1a1a]/5 hover:border-[#1a1a1a]/10"
                          )}>
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-medium">{prop.name}</span>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number"
                                  value={val}
                                  onChange={(e) => updateCard(selectedCard.id, {
                                    values: { ...selectedCard.values, [prop.id]: parseFloat(e.target.value) || 0 }
                                  })}
                                  className="w-24 bg-transparent border-b border-[#1a1a1a]/10 focus:outline-none text-right font-serif text-sm"
                                />
                                <span className="text-sm font-serif text-[#1a1a1a]/60">{prop.unit}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <input 
                                type="range"
                                min="0"
                                max={project.settings.maxPoints}
                                step="1"
                                value={displayPos}
                                onChange={(e) => {
                                  const sliderPos = parseInt(e.target.value);
                                  // sliderPos is raw (0=min, maxPoints=max); apply win condition to get actual points
                                  const actualPoints = prop.winCondition === 'lower'
                                    ? project.settings.maxPoints - sliderPos
                                    : sliderPos;
                                  const v = pointsToValue(actualPoints, prop, project.settings.maxPoints);
                                  updateCard(selectedCard.id, {
                                    values: { ...selectedCard.values, [prop.id]: v }
                                  });
                                }}
                                className="flex-1 prop-slider"
                                style={sliderStyle}
                              />
                              <span className="text-xs font-bold w-6 text-right">{points}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {currentView === 'documentation' && (
              <motion.div 
                key="documentation"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header>
                  <h1 className="text-4xl font-serif italic mb-2">CSV Schema Dokumentation</h1>
                  <p className="text-[#1a1a1a]/60">Anleitung zum Importieren und Exportieren von Daten.</p>
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-800 flex gap-3">
                    <Info size={18} className="shrink-0" />
                    <p>
                      <strong>Tipp:</strong> Es werden sowohl Kommas (<code>,</code>) als auch Semikolons (<code>;</code>) als Trennzeichen unterstützt. Dies ist besonders hilfreich, wenn du Daten aus Excel-Versionen mit unterschiedlichen Spracheinstellungen importierst.
                    </p>
                  </div>
                </header>

                <div className="grid grid-cols-1 gap-8">
                  <section className="bg-white p-8 rounded-[40px] border border-[#1a1a1a]/10 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 text-blue-600">
                      <FileText size={24} />
                      <h2 className="text-2xl font-serif">Eigenschaften (Properties)</h2>
                    </div>
                    <p className="text-sm text-[#1a1a1a]/70">
                      Die CSV-Datei für Eigenschaften definiert die Vergleichsparameter deines Spiels.
                    </p>
                    <div className="bg-[#1a1a1a]/5 p-4 rounded-2xl font-mono text-xs overflow-x-auto">
                      id,name,unit,winCondition,min,max,scaleType
                    </div>
                    <ul className="space-y-3 text-sm">
                      <li><strong>id:</strong> Eindeutige ID (z.B. <code>prop-1</code>). Wird beim Import automatisch generiert, falls leer.</li>
                      <li><strong>name:</strong> Anzeigename der Eigenschaft.</li>
                      <li><strong>unit:</strong> Einheit (z.B. <code>km/h</code>, <code>kg</code>).</li>
                      <li><strong>winCondition:</strong> <code>higher</code> (höher gewinnt) oder <code>lower</code> (niedriger gewinnt).</li>
                      <li><strong>min / max:</strong> Der Wertebereich für die Skalierung.</li>
                      <li><strong>scaleType:</strong> <code>linear</code> oder <code>logarithmic</code>.</li>
                    </ul>
                  </section>

                  <section className="bg-white p-8 rounded-[40px] border border-[#1a1a1a]/10 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 text-green-600">
                      <LayoutGrid size={24} />
                      <h2 className="text-2xl font-serif">Karten (Cards)</h2>
                    </div>
                    <p className="text-sm text-[#1a1a1a]/70">
                      Die CSV-Datei für Karten enthält die eigentlichen Spielkarten und deren Punktewerte.
                    </p>
                    <div className="bg-[#1a1a1a]/5 p-4 rounded-2xl font-mono text-xs overflow-x-auto">
                      id,quartettId,name,[Eigenschafts-Name-1],[Eigenschafts-Name-2],...
                    </div>
                    <ul className="space-y-3 text-sm">
                      <li><strong>id:</strong> Interne ID der Karte.</li>
                      <li><strong>quartettId:</strong> Die ID im Spiel (z.B. <code>1A</code>, <code>1B</code>).</li>
                      <li><strong>name:</strong> Name der Karte/des Objekts.</li>
                      <li><strong>[Eigenschafts-Name]:</strong> Die Spaltenüberschriften müssen den <strong>Namen</strong> deiner Eigenschaften entsprechen. Die Werte sind die <strong>konkreten Skalenwerte</strong> (z.B. 150 für km/h). Die Budget-Punkte werden beim Import automatisch berechnet.</li>
                    </ul>
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex gap-3">
                      <Info size={18} className="shrink-0" />
                      <p>
                        <strong>Wichtig:</strong> Beim Import von Karten müssen die Eigenschaften bereits im System existieren (entweder manuell angelegt oder per Eigenschaften-CSV importiert), damit die Punktespalten korrekt zugeordnet werden können.
                      </p>
                    </div>
                  </section>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="fixed bottom-0 left-20 right-0 h-12 bg-white border-t border-[#1a1a1a]/10 flex items-center px-8 justify-between text-[10px] uppercase tracking-widest font-bold text-[#1a1a1a]/40 z-40">
        <div className="flex gap-6">
          <span>{project.cards.filter(isCardReady).length} / {project.cards.length} Karten fertig</span>
          <span>{project.properties.length} Eigenschaften</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span>Gespeichert in LocalStorage</span>
        </div>
      </footer>
    </div>
  );
}
