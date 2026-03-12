'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import NextLink from 'next/link';
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
  HelpCircle,
  FolderSync,
  Link,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
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
import { comparePair, CardMetrics } from '@/lib/metrics';
import { 
  exportPropertiesToCSV, 
  importPropertiesFromCSV, 
  exportCardsToCSV, 
  importCardsFromCSV, 
  exportSettingsToCSV,
  importSettingsFromCSV,
  downloadCSV,
  downloadProjectAsZip,
  exportProjectToBase64Zip,
  importProjectFromZip,
  importProjectFromBase64Zip,
  importProjectFromUrl,
} from '@/lib/csv-utils';
import RadarChart from '@/components/RadarChart';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STORAGE_KEY = 'quartett_editor_project';
const LINUX_SAMPLE_PATH = 'samples/linux.zip';

const DEFAULT_SETTINGS: DeckSettings = {
  cardCount: 32,
  propertyCount: 6,
  maxPoints: 10,
  budget: 30,
  tolerance: 0,
};

function defaultCardValue(prop: PropertyDefinition): number {
  return prop.winCondition === 'higher' ? prop.min : prop.max;
}

const INITIAL_PROPERTIES: PropertyDefinition[] = Array.from({ length: 6 }, (_, i) => ({
  id: `prop-${i}`,
  name: `Eigenschaft ${i + 1}`,
  unit: '',
  winCondition: 'higher' as const,
  min: 0,
  max: 100,
  scaleType: 'linear' as const,
}));

const INITIAL_PROJECT: QuartettProject = {
  settings: DEFAULT_SETTINGS,
  properties: INITIAL_PROPERTIES,
  cards: Array.from({ length: 32 }, (_, i) => ({
    id: `card-${i}`,
    quartettId: `${Math.floor(i / 4) + 1}${String.fromCharCode(65 + (i % 4))}`,
    name: `Karte ${i + 1}`,
    values: Object.fromEntries(INITIAL_PROPERTIES.map(p => [p.id, defaultCardValue(p)])),
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

type View = 'settings' | 'properties' | 'grid' | 'detail' | 'documentation' | 'import-export';
type SortBy = 'quartettId' | 'name' | 'budget' | 'siegespunkte' | 'stichpunkte' | 'fertig';
type SortDir = 'asc' | 'desc';

/**
 * Pure (non-closure) version of the card-ready check used inside useMemo.
 * Mirrors the logic of getCardErrors / isCardReady in the component.
 */
function isCardReadyPure(card: Card, project: QuartettProject): boolean {
  for (const prop of project.properties) {
    const val = card.values[prop.id];
    if (val === undefined || val < prop.min || val > prop.max) return false;
  }
  const budget = project.properties.reduce((sum, prop) => {
    const val = card.values[prop.id] ?? prop.min;
    return sum + valueToPoints(val, prop, project.settings.maxPoints);
  }, 0);
  const { budget: B, tolerance: T } = project.settings;
  if (budget < B - T || budget > B + T) return false;
  if (!card.name.trim() || !card.quartettId.trim()) return false;
  const idCount = project.cards.filter(c => c.quartettId === card.quartettId).length;
  if (idCount !== 1) return false;
  return true;
}

export default function QuartettEditor() {
  const [project, setProject] = useState<QuartettProject>(INITIAL_PROJECT);
  const [mounted, setMounted] = useState(false);
  const [currentView, setCurrentView] = useState<View>('grid');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [pendingZipParam, setPendingZipParam] = useState<string | null>(null);
  const [pendingPathParam, setPendingPathParam] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [zipParamError, setZipParamError] = useState(false);
  const [pathParamError, setPathParamError] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('quartettId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const linkCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pairwise cache for incremental Siegespunkte / Stichpunkte computation.
  // Outer key: card A id, inner key: card B id → wins and ties for A vs B.
  // Nested Map allows O(1) removal of all pairs for a single card.
  const pairwiseCacheRef = useRef<Map<string, Map<string, { wins: number; ties: number }>>>(new Map());
  // Previous ready-card map (id → card) used to detect which cards changed.
  // React's state-update pattern (spread + map) preserves object references for
  // unchanged cards, so a reference-equality check on card.values is sufficient.
  const prevReadyMapRef = useRef<Map<string, Card>>(new Map());
  // Signature of the properties array used to detect property changes.
  const prevPropSigRef = useRef<string>('');

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
    // Check for zip query parameter in URL
    const searchParams = new URLSearchParams(window.location.search);
    const zipParam = searchParams.get('zip');
    if (zipParam) {
      setPendingZipParam(zipParam);
    }
    const pathParam = searchParams.get('path');
    if (pathParam && /^[a-zA-Z0-9._/\-]+\.zip$/.test(pathParam)) {
      setPendingPathParam(pathParam);
    }
    setTimeout(() => setMounted(true), 0);
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (mounted && project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
  }, [project, mounted]);

  /**
   * Incrementally compute Siegespunkte and Stichpunkte for every ready card.
   *
   * Uses isCardReadyPure (a module-level pure function) so this hook can be
   * placed before the early return and still obey the Rules of Hooks.
   *
   * When project changes, only the pairs involving cards whose values or
   * ready-status changed are recomputed (O(N×P) per changed card instead of
   * O(N²×P) for a full rebuild).
   */
  const cardMetrics = useMemo((): Map<string, CardMetrics> => {
    const readyCards = project.cards.filter(c => isCardReadyPure(c, project));
    const pairwise = pairwiseCacheRef.current;
    const prevReadyMap = prevReadyMapRef.current;

    // When property definitions change (win-condition, id, etc.) the cached
    // comparison results are no longer valid — clear everything.
    const propSig = project.properties.map(p => `${p.id}:${p.winCondition}`).join(',');
    if (propSig !== prevPropSigRef.current) {
      pairwise.clear();
      prevReadyMap.clear();
      prevPropSigRef.current = propSig;
    }

    const currReadyMap = new Map(readyCards.map(c => [c.id, c]));

    // Collect IDs of cards whose pairs need to be (re-)computed:
    //   • cards that were ready before but are no longer ready
    //   • cards that are now ready but weren't before, or whose values changed
    const changedIds = new Set<string>();
    for (const [id] of prevReadyMap) {
      if (!currReadyMap.has(id)) changedIds.add(id);
    }
    for (const card of readyCards) {
      const prev = prevReadyMap.get(card.id);
      if (!prev || prev.values !== card.values) changedIds.add(card.id);
    }

    // Remove stale pairs and recompute fresh ones for every changed card.
    // Using the nested Map structure, invalidating all pairs for a card is O(1)
    // for the card's own row, plus O(N) to remove it from each other card's row.
    for (const changedId of changedIds) {
      pairwise.delete(changedId); // O(1): removes all A→B pairs for this card
      for (const [, bMap] of pairwise) {
        bMap.delete(changedId);   // O(1) per entry: removes B→A pairs
      }

      const changedCard = currReadyMap.get(changedId);
      if (!changedCard) continue; // card is no longer ready — pairs already removed

      const aMap = new Map<string, { wins: number; ties: number }>();
      pairwise.set(changedId, aMap);

      for (const [otherId, otherCard] of currReadyMap) {
        if (otherId === changedId) continue;
        if (aMap.has(otherId)) continue; // symmetric entry already populated

        const { wins, ties } = comparePair(changedCard, otherCard, project.properties);
        aMap.set(otherId, { wins, ties });

        // Store the symmetric direction: B vs A = (losses of A, same ties)
        let bMap = pairwise.get(otherId);
        if (!bMap) {
          bMap = new Map();
          pairwise.set(otherId, bMap);
        }
        bMap.set(changedId, {
          wins: project.properties.length - wins - ties,
          ties,
        });
      }
    }

    prevReadyMapRef.current = currReadyMap;

    // Aggregate per-card totals and convert to percentage scores.
    const N = readyCards.length;
    const P = project.properties.length;
    const totalComparisons = P * (N - 1);
    const metrics = new Map<string, CardMetrics>();

    if (totalComparisons <= 0) {
      for (const card of readyCards) {
        metrics.set(card.id, { siegespunkte: 0, stichpunkte: 0, totalWins: 0, totalTies: 0, totalComparisons: 0 });
      }
      return metrics;
    }

    for (const [cardId] of currReadyMap) {
      let totalWins = 0;
      let totalTies = 0;
      const cardPairs = pairwise.get(cardId);
      if (cardPairs) {
        for (const [otherId, pair] of cardPairs) {
          if (currReadyMap.has(otherId)) {
            totalWins += pair.wins;
            totalTies += pair.ties;
          }
        }
      }
      metrics.set(cardId, {
        siegespunkte: Math.ceil(100 * totalWins / totalComparisons),
        stichpunkte: Math.ceil(100 * totalTies / totalComparisons),
        totalWins,
        totalTies,
        totalComparisons,
      });
    }

    return metrics;
  }, [project]); // comparePair / isCardReadyPure / project.properties are pure functions of project

  const sortedCards = useMemo(() => {
    const cards = [...project.cards];
    const dir = sortDir === 'asc' ? 1 : -1;

    // Pre-compute per-card values used by comparators to avoid redundant work
    // inside the sort callback (O(n×m) pre-computation instead of O(n²×m)).
    const budgetMap = new Map<string, number>(
      cards.map(card => [
        card.id,
        project.properties.reduce((sum, prop) => {
          const val = card.values[prop.id] ?? prop.min;
          return sum + valueToPoints(val, prop, project.settings.maxPoints);
        }, 0),
      ])
    );
    const readyMap = new Map<string, boolean>(
      cards.map(card => [card.id, isCardReadyPure(card, project)])
    );

    cards.sort((a, b) => {
      switch (sortBy) {
        case 'quartettId':
          return dir * a.quartettId.localeCompare(b.quartettId, undefined, { numeric: true, sensitivity: 'base' });
        case 'name':
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        case 'budget':
          return dir * ((budgetMap.get(a.id) ?? 0) - (budgetMap.get(b.id) ?? 0));
        case 'siegespunkte': {
          const mA = cardMetrics.get(a.id)?.siegespunkte ?? -1;
          const mB = cardMetrics.get(b.id)?.siegespunkte ?? -1;
          return dir * (mA - mB);
        }
        case 'stichpunkte': {
          const mA = cardMetrics.get(a.id)?.stichpunkte ?? -1;
          const mB = cardMetrics.get(b.id)?.stichpunkte ?? -1;
          return dir * (mA - mB);
        }
        case 'fertig':
          return dir * ((readyMap.get(a.id) ? 1 : 0) - (readyMap.get(b.id) ? 1 : 0));
        default:
          return 0;
      }
    });
    return cards;
  }, [project, sortBy, sortDir, cardMetrics]);

  if (!mounted) return <div className="flex items-center justify-center h-screen">Lade...</div>;

  const updateSettings = (newSettings: Partial<DeckSettings>) => {
    setProject(prev => {
      if (!prev) return prev;
      const updatedSettings = { ...prev.settings, ...newSettings };
      
      // If propertyCount changed, adjust properties array
      let updatedProperties = [...prev.properties];
      let updatedCards = [...prev.cards];
      if (newSettings.propertyCount !== undefined) {
        if (newSettings.propertyCount > prev.properties.length) {
          const diff = newSettings.propertyCount - prev.properties.length;
          for (let i = 0; i < diff; i++) {
            const newProp: PropertyDefinition = {
              id: `prop-${Date.now()}-${i}`,
              name: `Neue Eigenschaft`,
              unit: '',
              winCondition: 'higher',
              min: 0,
              max: 100,
              scaleType: 'linear',
            };
            updatedProperties.push(newProp);
            updatedCards = updatedCards.map(c => ({
              ...c,
              values: { ...c.values, [newProp.id]: defaultCardValue(newProp) },
            }));
          }
        } else {
          updatedProperties = updatedProperties.slice(0, newSettings.propertyCount);
        }
      }

      // If cardCount changed, adjust cards array
      if (newSettings.cardCount !== undefined) {
        if (newSettings.cardCount > prev.cards.length) {
          const diff = newSettings.cardCount - prev.cards.length;
          for (let i = 0; i < diff; i++) {
            const idx = prev.cards.length + i;
            updatedCards.push({
              id: `card-${Date.now()}-${i}`,
              quartettId: `${Math.floor(idx / 4) + 1}${String.fromCharCode(65 + (idx % 4))}`,
              name: `Neue Karte`,
              values: Object.fromEntries(updatedProperties.map(p => [p.id, defaultCardValue(p)])),
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
    downloadCSV(csv, 'eigenschaften.csv');
  };

  const handleImportProperties = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      e.target.value = '';
      try {
        const csvText = event.target?.result as string;
        const imported = importPropertiesFromCSV(csvText);
        setProject(prev => prev ? { ...prev, properties: imported, settings: { ...prev.settings, propertyCount: imported.length } } : prev);
      } catch (err) {
        setImportError(`Eigenschaften konnten nicht importiert werden: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.onerror = () => {
      e.target.value = '';
      setImportError('Die Eigenschaften-Datei konnte nicht gelesen werden.');
    };
    reader.readAsText(file);
  };

  const handleExportCards = () => {
    const csv = exportCardsToCSV(project.cards, project.properties);
    downloadCSV(csv, 'karten.csv');
  };

  const handleImportCards = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      e.target.value = '';
      try {
        const csvText = event.target?.result as string;
        const imported = importCardsFromCSV(csvText, project.properties);
        setProject(prev => prev ? { ...prev, cards: imported, settings: { ...prev.settings, cardCount: imported.length } } : prev);
      } catch (err) {
        setImportError(`Karten konnten nicht importiert werden: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.onerror = () => {
      e.target.value = '';
      setImportError('Die Karten-Datei konnte nicht gelesen werden.');
    };
    reader.readAsText(file);
  };

  const handleExportSettings = () => {
    const csv = exportSettingsToCSV(project.settings);
    downloadCSV(csv, 'parameter.csv');
  };

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      e.target.value = '';
      try {
        const csvText = event.target?.result as string;
        const imported = importSettingsFromCSV(csvText);
        setProject(prev => prev ? { ...prev, settings: { ...prev.settings, ...imported } } : prev);
      } catch (err) {
        setImportError(`Parameter konnten nicht importiert werden: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.onerror = () => {
      e.target.value = '';
      setImportError('Die Parameter-Datei konnte nicht gelesen werden.');
    };
    reader.readAsText(file);
  };

  const handleDownloadZip = async () => {
    await downloadProjectAsZip(project);
  };

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importProjectFromZip(file, project.properties);
      setProject(prev => {
        if (!prev) return prev;
        const newSettings = imported.settings ? { ...prev.settings, ...imported.settings } : prev.settings;
        const newProperties = imported.properties ?? prev.properties;
        const newCards = imported.cards ?? prev.cards;
        return {
          ...prev,
          settings: {
            ...newSettings,
            propertyCount: newProperties.length,
            cardCount: newCards.length,
          },
          properties: newProperties,
          cards: newCards,
        };
      });
    } catch (err) {
      setImportError(`ZIP-Datei konnte nicht importiert werden: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleCopyLink = async () => {
    const base64 = await exportProjectToBase64Zip(project);
    const url = new URL(window.location.href);
    url.searchParams.set('zip', base64);
    await navigator.clipboard.writeText(url.toString());
    if (linkCopiedTimerRef.current !== null) {
      clearTimeout(linkCopiedTimerRef.current);
    }
    setLinkCopied(true);
    linkCopiedTimerRef.current = setTimeout(() => {
      setLinkCopied(false);
      linkCopiedTimerRef.current = null;
    }, 2000);
  };

  const applyImportedProject = (imported: Partial<QuartettProject>) => {
    setProject(prev => {
      if (!prev) return prev;
      const newSettings = imported.settings ? { ...prev.settings, ...imported.settings } : prev.settings;
      const newProperties = imported.properties ?? prev.properties;
      const newCards = imported.cards ?? prev.cards;
      return {
        ...prev,
        settings: {
          ...newSettings,
          propertyCount: newProperties.length,
          cardCount: newCards.length,
        },
        properties: newProperties,
        cards: newCards,
      };
    });
  };

  const removeZipParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('zip');
    window.history.replaceState({}, '', url.toString());
    setPendingZipParam(null);
    setZipParamError(false);
  };

  const handleConfirmLoadZipParam = async () => {
    if (!pendingZipParam) return;
    try {
      const imported = await importProjectFromBase64Zip(pendingZipParam, project.properties);
      applyImportedProject(imported);
      removeZipParam();
    } catch (e) {
      setZipParamError(true);
    }
  };

  const removePathParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('path');
    window.history.replaceState({}, '', url.toString());
    setPendingPathParam(null);
    setPathParamError(false);
  };

  const handleConfirmLoadPathParam = async () => {
    if (!pendingPathParam) return;
    try {
      const imported = await importProjectFromUrl(pendingPathParam, project.properties);
      applyImportedProject(imported);
      removePathParam();
    } catch (e) {
      setPathParamError(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans">
      {/* Zip-from-URL confirmation dialog */}
      {pendingZipParam && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle size={24} />
              <h2 className="text-2xl font-serif">Projekt aus Link laden?</h2>
            </div>
            <p className="text-sm text-[#1a1a1a]/70">
              Der aufgerufene Link enthält ein eingebettetes Quartett-Projekt.
              Wenn du es lädst, wird das <strong>aktuelle Projekt überschrieben</strong>.
              Stelle sicher, dass du keine ungesicherten Änderungen verlieren möchtest.
            </p>
            {zipParamError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>Der Link ist ungültig oder beschädigt. Das Projekt konnte nicht geladen werden.</span>
              </div>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={removeZipParam}
                className="px-5 py-2 rounded-xl border border-[#1a1a1a]/20 text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/5 transition-colors"
              >
                Abbrechen
              </button>
              {!zipParamError && (
                <button
                  onClick={handleConfirmLoadZipParam}
                  className="px-5 py-2 rounded-xl bg-[#1a1a1a] text-white text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/80 transition-colors"
                >
                  Projekt laden
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Path-from-URL confirmation dialog */}
      {pendingPathParam && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle size={24} />
              <h2 className="text-2xl font-serif">Projekt aus Link laden?</h2>
            </div>
            <p className="text-sm text-[#1a1a1a]/70">
              Der aufgerufene Link verweist auf eine Projektdatei (<code className="text-xs bg-[#1a1a1a]/10 px-1 rounded">{pendingPathParam}</code>).
              Wenn du sie lädst, wird das <strong>aktuelle Projekt überschrieben</strong>.
              Stelle sicher, dass du keine ungesicherten Änderungen verlieren möchtest.
            </p>
            {pathParamError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>Die Datei konnte nicht geladen werden. Bitte überprüfe den Link.</span>
              </div>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={removePathParam}
                className="px-5 py-2 rounded-xl border border-[#1a1a1a]/20 text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/5 transition-colors"
              >
                Abbrechen
              </button>
              {!pathParamError && (
                <button
                  onClick={handleConfirmLoadPathParam}
                  className="px-5 py-2 rounded-xl bg-[#1a1a1a] text-white text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/80 transition-colors"
                >
                  Projekt laden
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Import error notification */}
      {importError && (
        <div className="fixed top-4 left-24 right-4 z-[150] flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl p-4 shadow-lg text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span className="flex-1">{importError}</span>
          <button
            onClick={() => setImportError(null)}
            className="shrink-0 text-red-400 hover:text-red-700 transition-colors"
            aria-label="Schließen"
          >
            <X size={16} />
          </button>
        </div>
      )}
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
          onClick={() => setCurrentView('import-export')}
          className={cn(
            "p-3 rounded-xl transition-all",
            currentView === 'import-export' ? "bg-[#1a1a1a] text-white" : "text-[#1a1a1a]/40 hover:bg-[#1a1a1a]/5"
          )}
          title="Import / Export"
        >
          <FolderSync size={24} />
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
                <header className="flex justify-between items-end">
                  <div>
                    <h1 className="text-4xl font-serif italic mb-2">Deck-Einstellungen</h1>
                    <p className="text-[#1a1a1a]/60">Konfiguriere die Grundparameter deines Quartett-Spiels.</p>
                  </div>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold cursor-pointer hover:bg-[#1a1a1a]/5 transition-colors">
                      <Upload size={14} />
                      Import CSV
                      <input type="file" accept=".csv" onChange={handleImportSettings} className="hidden" />
                    </label>
                    <button 
                      onClick={handleExportSettings}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-[#1a1a1a]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold hover:bg-[#1a1a1a]/5 transition-colors"
                    >
                      <Download size={14} />
                      Export CSV
                    </button>
                  </div>
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

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]/40 flex items-center gap-1">
                    <ArrowUpDown size={12} />
                    Sortieren:
                  </span>
                  {(
                    [
                      { key: 'quartettId', label: 'Quartett-ID' },
                      { key: 'name', label: 'Name' },
                      { key: 'budget', label: 'Budget' },
                      { key: 'siegespunkte', label: 'Siegespunkte' },
                      { key: 'stichpunkte', label: 'Stichpunkte' },
                      { key: 'fertig', label: 'Fertig-Status' },
                    ] as { key: SortBy; label: string }[]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (sortBy === key) {
                          setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortBy(key);
                          setSortDir('asc');
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] uppercase tracking-widest font-bold border transition-colors",
                        sortBy === key
                          ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                          : "bg-white text-[#1a1a1a]/60 border-[#1a1a1a]/10 hover:bg-[#1a1a1a]/5"
                      )}
                    >
                      {label}
                      {sortBy === key && (
                        sortDir === 'asc'
                          ? <ArrowUp size={10} />
                          : <ArrowDown size={10} />
                      )}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {sortedCards.map((card) => {
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
                        {ready && (() => {
                          const m = cardMetrics.get(card.id);
                          if (!m) return null;
                          return (
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <div className="bg-blue-50 rounded-xl px-2 py-1.5 text-center">
                                <div className="text-[9px] font-bold uppercase tracking-widest text-blue-400">Siege</div>
                                <div className="text-sm font-serif text-blue-700">{m.siegespunkte}</div>
                                <div className="text-[9px] text-blue-400/70">{m.totalWins}&thinsp;/&thinsp;{m.totalComparisons}</div>
                              </div>
                              <div className="bg-purple-50 rounded-xl px-2 py-1.5 text-center">
                                <div className="text-[9px] font-bold uppercase tracking-widest text-purple-400">Stiche</div>
                                <div className="text-sm font-serif text-purple-700">{m.stichpunkte}</div>
                                <div className="text-[9px] text-purple-400/70">{m.totalTies}&thinsp;/&thinsp;{m.totalComparisons}</div>
                              </div>
                            </div>
                          );
                        })()}
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
                    {(() => {
                      const m = cardMetrics.get(selectedCard.id);
                      if (!m) return null;
                      const niederlagenpunkte = Math.max(0, 100 - m.siegespunkte - m.stichpunkte);
                      return (
                        <div className="bg-white p-6 rounded-3xl border border-[#1a1a1a]/10 shadow-sm">
                          <h3 className="text-xs uppercase tracking-widest font-bold text-[#1a1a1a]/40 mb-4">Vergleichsstatistik</h3>
                          <div className="h-2 rounded-full overflow-hidden flex bg-[#1a1a1a]/5">
                            <div
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${m.siegespunkte}%` }}
                            />
                            <div
                              className="h-full bg-purple-400 transition-all duration-500"
                              style={{ width: `${m.stichpunkte}%` }}
                            />
                            <div
                              className="h-full bg-red-400/60 transition-all duration-500"
                              style={{ width: `${niederlagenpunkte}%` }}
                            />
                          </div>
                          <div className="mt-2 text-[10px] text-[#1a1a1a]/40 text-center">
                            <span className="text-blue-500">Siege</span>
                            {' / '}
                            <span className="text-purple-400">Stiche</span>
                            {' / '}
                            <span className="text-red-400/80">Niederlagen</span>
                          </div>
                        </div>
                      );
                    })()}
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
                  <h1 className="text-4xl font-serif italic mb-2">Dokumentation</h1>
                  <p className="text-[#1a1a1a]/60">Erklärung zur App und Anleitung zum Importieren und Exportieren von Daten.</p>
                  <div className="mt-3 text-xs text-[#1a1a1a]/50">
                    Quellcode:{' '}
                    <a
                      href="https://github.com/Lotes/quartett-meister"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-[#1a1a1a]/80"
                    >
                      github.com/Lotes/quartett-meister
                    </a>
                  </div>
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-800 flex gap-3">
                    <Info size={18} className="shrink-0" />
                    <p>
                      <strong>Tipp:</strong> Es werden sowohl Kommas (<code>,</code>) als auch Semikolons (<code>;</code>) als Trennzeichen unterstützt. Dies ist besonders hilfreich, wenn du Daten aus Excel-Versionen mit unterschiedlichen Spracheinstellungen importierst.
                    </p>
                  </div>
                </header>

                <section className="bg-white p-8 rounded-[40px] border border-[#1a1a1a]/10 shadow-sm space-y-6">
                  <div className="flex items-center gap-3 text-orange-600">
                    <Info size={24} />
                    <h2 className="text-2xl font-serif">Wie funktioniert Quartett-Meister?</h2>
                  </div>
                  <p className="text-sm text-[#1a1a1a]/70">
                    Quartett-Meister ist ein Editor für Quartett-Kartenspiele (auch bekannt als Top Trumps). Hier kannst du
                    ein vollständiges Kartenset erstellen, ausbalancieren und exportieren.
                  </p>
                  <ol className="space-y-4 text-sm list-none">
                    <li>
                      <strong>1. Kartenzahl N einstellen.</strong>{' '}
                      In den Deck-Einstellungen legst du fest, wie viele Karten <em>N</em> das Deck enthält.
                    </li>
                    <li>
                      <strong>2. Eigenschaftsanzahl P festlegen.</strong>{' '}
                      Du bestimmst, wie viele Eigenschaften <em>P</em> jede Karte besitzt. Alle Karten teilen dieselben
                      Eigenschaften; jede Eigenschaft hat pro Karte einen individuellen Wert. Wie beim klassischen Quartett
                      wird der Wert einer Eigenschaft mit dem entsprechenden Wert der gegnerischen Karte verglichen –
                      normalerweise gewinnt der höhere Wert. Die Siegbedingung kann jedoch invertiert werden, sodass der
                      niedrigere Wert gewinnt.
                    </li>
                    <li>
                      <strong>3. Eigenschaften benennen und konfigurieren.</strong>{' '}
                      Auf der Eigenschaftsseite kann jede Eigenschaft mit einem Namen und einer Einheit versehen werden
                      (z.B. <em>Geschwindigkeit</em> in <em>km/h</em>). Außerdem definierst du einen Minimal- und einen
                      Maximalwert. Zwischen diesen Grenzen wird die Werteskala aufgespannt – wahlweise <em>linear</em> oder{' '}
                      <em>logarithmisch</em>. Der Unterschied zwischen den Skalierungen zeigt sich besonders deutlich bei
                      der Budgetverteilung.
                    </li>
                    <li>
                      <strong>4. Punkteskala S festlegen.</strong>{' '}
                      Pro Eigenschaft kann man maximal <em>S</em> Punkte vergeben. Die Punkteskala reicht stets von 0 bis
                      S und ist immer linear – unabhängig von der Werteskala der Eigenschaft. Die Punkte dienen der
                      Visualisierung im Radar-Chart. Typische Werte für S sind 10 oder 100; je höher, desto feiner sind
                      die Einstellmöglichkeiten.
                    </li>
                    <li>
                      <strong>5. Budget B festlegen.</strong>{' '}
                      Pro Karte muss ein Eigenschaftsbudget <em>B</em> ausgegeben werden. Der Standardwert ist{' '}
                      <em>P × S / 2</em> (die Hälfte der Maximalpunkte). Das feste Budget soll sicherstellen, dass alle
                      Karten gleich stark ausbalanciert sind – jede Karte kann in einer Eigenschaft brillieren, ist dafür
                      aber in einer anderen schwächer.
                    </li>
                    <li>
                      <strong>6. Toleranz T angeben.</strong>{' '}
                      Mit der Toleranz <em>T</em> (0 ≤ T ≤ B) legst du fest, wie genau das Budget eingehalten werden
                      muss. Eine Karte gilt als fertig, wenn das ausgegebene Budget zwischen <em>B − T</em> und{' '}
                      <em>B + T</em> liegt. Bei T = 0 muss das Budget exakt verteilt werden.
                    </li>
                    <li>
                      <strong>7. Karten konfigurieren.</strong>{' '}
                      Zum Schluss werden die Karten Stück für Stück konfiguriert: Mit Schiebereglern verteilst du Punkte
                      auf die einzelnen Eigenschaften. Ein Radar-Chart zeigt live, wie die Karte aussieht. Ist das Budget
                      innerhalb der Toleranz verbraucht, ist die Karte fertig.
                    </li>
                    <li>
                      <strong>8. Exportieren &amp; Teilen.</strong>{' '}
                      Sind alle Karten fertig, kannst du das Deck als CSV-Dateien oder als ZIP-Archiv exportieren. Das
                      Projekt lässt sich außerdem als Link teilen.
                    </li>
                  </ol>
                </section>

                <div className="grid grid-cols-1 gap-8">
                  <section className="bg-white p-8 rounded-[40px] border border-[#1a1a1a]/10 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 text-purple-600">
                      <Settings size={24} />
                      <h2 className="text-2xl font-serif">Startparameter (Settings)</h2>
                    </div>
                    <p className="text-sm text-[#1a1a1a]/70">
                      Die CSV-Datei für Startparameter definiert die Grundkonfiguration des Quartett-Decks. Sie kann im Bereich <strong>Deck-Einstellungen</strong> importiert und exportiert werden.
                    </p>
                    <div className="bg-[#1a1a1a]/5 p-4 rounded-2xl font-mono text-xs overflow-x-auto">
                      setting,value<br />
                      N,32<br />
                      P,6<br />
                      S,10<br />
                      B,30<br />
                      T,0
                    </div>
                    <ul className="space-y-3 text-sm">
                      <li><strong>N</strong> – <em>Kartenanzahl</em>: Wie viele Karten das Deck insgesamt enthält (z.B. <code>32</code>).</li>
                      <li><strong>P</strong> – <em>Eigenschaftsanzahl</em>: Wie viele Vergleichseigenschaften jede Karte hat (z.B. <code>6</code>).</li>
                      <li><strong>S</strong> – <em>Max. Punkte pro Eigenschaft</em>: Die Obergrenze der Punkteskala für das Radar-Diagramm (z.B. <code>10</code>). Eine Eigenschaft kann zwischen 0 und S Punkten haben.</li>
                      <li><strong>B</strong> – <em>Budget</em>: Die Gesamtpunktezahl, die auf einer Karte über alle Eigenschaften verteilt werden muss (z.B. <code>30</code>). Standardwert: P × S / 2.</li>
                      <li><strong>T</strong> – <em>Toleranz</em>: Die erlaubte Abweichung vom Budget (0 ≤ T ≤ B). Das Kartenbudget muss zwischen B−T und B+T liegen (z.B. <code>0</code> für exaktes Budget).</li>
                    </ul>
                  </section>

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
            {currentView === 'import-export' && (
              <motion.div
                key="import-export"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <header>
                  <h1 className="text-4xl font-serif italic mb-2">Import / Export</h1>
                  <p className="text-[#1a1a1a]/60">Lade das gesamte Projekt als ZIP-Datei herunter oder lade ein gespeichertes Projekt hoch.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Download ZIP */}
                  <div className="bg-white p-8 rounded-3xl border border-[#1a1a1a]/10 shadow-sm space-y-4 flex flex-col">
                    <div className="flex items-center gap-3 text-green-600">
                      <Download size={24} />
                      <h2 className="text-2xl font-serif">Download</h2>
                    </div>
                    <p className="text-sm text-[#1a1a1a]/70 flex-1">
                      Exportiert alle drei CSV-Dateien (<code>parameter.csv</code>, <code>eigenschaften.csv</code>, <code>karten.csv</code>) gebündelt als <strong>quartett.zip</strong>.
                    </p>
                    <button
                      onClick={handleDownloadZip}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1a1a] text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/80 transition-colors"
                    >
                      <Download size={16} />
                      quartett.zip herunterladen
                    </button>
                  </div>

                  {/* Upload ZIP */}
                  <div className="bg-white p-8 rounded-3xl border border-[#1a1a1a]/10 shadow-sm space-y-4 flex flex-col">
                    <div className="flex items-center gap-3 text-blue-600">
                      <Upload size={24} />
                      <h2 className="text-2xl font-serif">Upload</h2>
                    </div>
                    <p className="text-sm text-[#1a1a1a]/70 flex-1">
                      Importiert ein zuvor gespeichertes Projekt aus einer <strong>quartett.zip</strong>. Die Datei muss <code>parameter.csv</code>, <code>eigenschaften.csv</code> und/oder <code>karten.csv</code> enthalten.
                    </p>
                    <label className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1a1a] text-white rounded-xl text-sm font-bold uppercase tracking-widest cursor-pointer hover:bg-[#1a1a1a]/80 transition-colors">
                      <Upload size={16} />
                      quartett.zip hochladen
                      <input type="file" accept=".zip" onChange={handleUploadZip} className="hidden" />
                    </label>
                  </div>
                </div>

                {/* Copy Link */}
                <div className="bg-white p-8 rounded-3xl border border-[#1a1a1a]/10 shadow-sm space-y-4">
                  <div className="flex items-center gap-3 text-purple-600">
                    <Link size={24} />
                    <h2 className="text-2xl font-serif">Link kopieren</h2>
                  </div>
                  <p className="text-sm text-[#1a1a1a]/70">
                    Erzeugt einen Link, der das gesamte Projekt als eingebettete ZIP-Datei enthält. Über diesen Link kann das Projekt direkt in einem Browser geöffnet werden.
                  </p>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1a1a] text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/80 transition-colors"
                  >
                    {linkCopied ? <Check size={16} /> : <Link size={16} />}
                    {linkCopied ? 'Link kopiert!' : 'Link in Zwischenablage kopieren'}
                  </button>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex gap-3">
                  <Info size={18} className="shrink-0" />
                  <p>
                    <strong>Hinweis:</strong> Beim Upload wird das aktuelle Projekt vollständig ersetzt. Stelle sicher, dass du eine Sicherungskopie hast, bevor du ein neues Projekt hochlädst.
                  </p>
                </div>

                {/* Linux Sample */}
                <div className="bg-white p-8 rounded-3xl border border-[#1a1a1a]/10 shadow-sm space-y-4">
                  <div className="flex items-center gap-3 text-teal-600">
                    <FolderSync size={24} />
                    <h2 className="text-2xl font-serif">Beispiel: Linux-Quartett</h2>
                  </div>
                  <p className="text-sm text-[#1a1a1a]/70">
                    Lade das fertige Linux-Quartett als Beispielprojekt. Es enthält 30 Linux-Distributionen mit 6 Eigenschaften
                    (Alter, ISO-Größe, Bewertung, Ladezeit, Pakete, Versionen).
                  </p>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex gap-2">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>Quelle:</strong> Die Daten stammen aus dem{' '}
                      <a
                        href="https://www.tutonaut.de/linux-quartett/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-blue-600"
                      >
                        Linux-Quartett von tutonaut.de
                      </a>
                      . Nutzung gemäß den Lizenzbedingungen der Ursprungsseite.
                    </span>
                  </div>
                  <NextLink
                    href={`/?path=${LINUX_SAMPLE_PATH}`}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1a1a] text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-[#1a1a1a]/80 transition-colors"
                  >
                    <Download size={16} />
                    Linux-Beispiel laden
                  </NextLink>
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
