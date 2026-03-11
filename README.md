# Quartett-Meister

A web-based editor for creating and balancing [Quartett](https://en.wikipedia.org/wiki/Top_Trumps) (Top Trumps) card decks. Configure properties, assign budgets, visualize cards with radar charts, and export everything as CSV or ZIP.

## Installation & Getting Started

**Prerequisites:** Node.js (v18 or later)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

Other scripts:
- `npm run build` – Build for production
- `npm run start` – Start the production server
- `npm run lint` – Run the ESLint linter

## File Structure

| File / Folder | Role |
|---|---|
| `app/layout.tsx` | Root Next.js layout – sets browser title and global metadata |
| `app/page.tsx` | Main application page – the complete Quartett editor UI |
| `app/globals.css` | Global Tailwind CSS styles |
| `components/RadarChart.tsx` | D3.js radar/spider chart component for card visualization |
| `hooks/use-mobile.ts` | Custom React hook for responsive mobile detection |
| `lib/types.ts` | Core TypeScript type definitions (`Card`, `PropertyDefinition`, `DeckSettings`, `QuartettProject`) |
| `lib/csv-utils.ts` | CSV and ZIP import/export utilities |
| `lib/utils.ts` | General helper utilities (e.g., Tailwind class merging) |
| `next.config.ts` | Next.js configuration (standalone output, webpack tuning) |
| `metadata.json` | App metadata for AI Studio integration |
| `LICENSE` | MIT License |

## Application Architecture

Quartett-Meister is a **Next.js 15** application using the App Router with **React 19** and **Tailwind CSS 4**. All editing logic lives in a single client-side component (`app/page.tsx`) that manages state for:

1. **Settings** – Configure the deck: number of cards (N), number of properties (P), points scale (S), budget (B), and tolerance (T).
2. **Properties** – Define each property's name, unit, value range (min/max), win condition (higher/lower wins), and scale type (linear/logarithmic).
3. **Cards** – Edit each card by distributing a fixed point budget across properties using sliders. A radar chart provides live visual feedback.
4. **Table / Grid view** – Review all cards at a glance.
5. **Documentation** – Built-in guide explaining the CSV schema and app workflow.
6. **Import / Export** – Save and load work via CSV files (settings, properties, cards separately) or as a single ZIP archive. Projects can also be shared as a URL-encoded link.

The **budget system** ensures balance: every card must spend between `B - T` and `B + T` points total across all its properties, keeping all cards equally powerful while still allowing strategic trade-offs.

Radar charts are rendered with **D3.js** and allow interactive editing directly on the chart.

## License

This project is licensed under the [MIT License](LICENSE) – © Markus Rudolph.
