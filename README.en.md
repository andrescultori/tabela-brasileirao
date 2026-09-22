[🇧🇷 Português](README.md) | 🇺🇸 English

# 📊 Brasileirão League Table — Apps Script

A Google Sheet for Brazil's top football division (Série A) that keeps itself up to date: fixtures, results, standings, and title / continental-spot / relegation probabilities — no manual work.

A Google Apps Script that turns a Google Sheet into an automated dashboard for the **Brazilian Série A championship**: it populates the season's fixture list, updates match results daily, and computes the standings, a points projection, and probabilities (title / continental qualification / relegation) via Monte Carlo simulation.

Data source: [football-data.org](https://www.football-data.org/) (free tier, API v4, competition `BSA`).

**[→ See it live](https://docs.google.com/spreadsheets/d/1ZZVtyysMpz62xIB6whuDV7FEAt12zvLaVvxH41BKzh8/edit?gid=1262484430#gid=1262484430)**

> This repository is a **backup and history** of the code. The script runs directly inside the Apps Script project bound to the sheet — there's no automatic sync between this repo and Apps Script (no clasp). Updates are manual: copy the contents of `src/Codigo.gs` and paste them into the Apps Script editor.

## The original problem

Before this script, keeping a spreadsheet in sync with the league meant typing in every score by hand, recomputing the standings with brittle formulas that broke every matchday, and having no real sense of who still had a shot at the title or was in relegation danger without doing the math separately. Any end-of-season projection was pure guesswork.

## The solution

```
football-data.org (API v4, competition BSA)
        ↓
popularTabela() → full season schedule written to the Tabela sheet
        ↓
atualizarResultados() → runs daily via trigger, fills in scores
        ↓
calcularClassificacao() → points, goal difference, win rate, points projection
        ↓
calcularProbabilidades() → Monte Carlo simulation (1,000 runs), on demand
        ↓
atualizarPerfilTime() → position, zone and match history per team, via dropdown
```

In practice: open the sheet, the **Brasileirão** menu is already there, run "Popular tabela" once, and everything else takes care of itself — no formulas to touch, no scores to copy from anywhere.

## The dashboard itself

- **Populate the table**: fetches the full season schedule (380 matches) and writes it to the `Tabela` sheet
- **Update results**: fetches finished matches and fills in the scores — runs manually or via a daily automatic trigger
- **Standings** (auto-generated sheet): points, goal difference, win rate, gap to the leader and to the relegation zone, last 5 results, next 5 fixtures + strength of the upcoming run
- **Predicted Final Points**: a deterministic projection based on a strength index (win rate + goal difference per match) for each team
- **Monte Carlo probabilities**: simulates the rest of the season 1,000 times, computing % chance of title, continental qualification (top 6) and relegation (bottom 4)
- **Team Profile** (auto-generated sheet): a dropdown to pick a team and see its current position + zone (Leader/Continental/South American/Relegation), home vs. away stats, and the full match history with the result (W/D/L) from that team's perspective — refreshes automatically when you change the dropdown

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Google Apps Script (V8) |
| Interface | Google Sheets (custom menu + dropdown) |
| Data | football-data.org API v4 (REST, free tier) |
| Credentials | `PropertiesService` (Script Properties, never hardcoded) |
| Simulation | Monte Carlo (1,000 runs) implemented in plain JS |

### Why no clasp

The repository doesn't use [clasp](https://github.com/google/clasp) to sync with Apps Script — a deliberate choice: for a personal, single-sheet script, a manual copy/paste flow (see "Keeping this repo updated" below) is simpler than maintaining OAuth authentication and a `.clasp.json` setup just for this. The repo works as a backup and history of the code running in the sheet, not as a deploy pipeline.

## Repository structure

```
.
├── src/
│   ├── Codigo.gs         → all the script's code
│   └── appsscript.json   → the Apps Script project manifest
└── README.md
```

## Running it (how to import)

1. Create (or open) the Google Sheet where the data will live
2. **Extensions → Apps Script**
3. Delete the default content and paste in the contents of [`src/Codigo.gs`](src/Codigo.gs)
4. Save

### Initial setup (one-time)

1. Set `CONFIG.SHEET_NAME` in `Codigo.gs` to match the real name of your fixtures sheet (default: `'Tabela'`)
2. Create a free account at [football-data.org](https://www.football-data.org/client/register) and copy the token (X-Auth-Token) you receive by email
3. In the Apps Script editor → **gear icon** (Project Settings) → **Script Properties** → add a property named `FOOTBALL_API_TOKEN` with your token as the value

   *(Alternative: run the `configurarToken` function from the **Brasileirão** menu inside the sheet — this only works when called from the menu, not from the editor's ▶ Run button)*

4. Go back to the sheet and reload the page — the **Brasileirão** menu will appear
5. Run **Popular tabela (novo campeonato)**
6. Run **Ativar atualização automática diária** (runs daily around 8am by default — adjustable via `CONFIG.DAILY_TRIGGER_HOUR`)

From there, everything runs on its own: the daily trigger updates the scores and automatically recalculates the standings, the points projection, and the Team Profile (if a team is already selected). The Monte Carlo probabilities only run on demand, from the menu (**Calcular probabilidades**), so they don't slow down the daily run.

## Expected sheet format

`Tabela` sheet (header on row 1, data starting row 2):

| Matchday | Home Team | Home Goals | Away Goals | Away Team |
|---|---|---|---|---|

The `Classificação` and `PERFIL DE TIME` sheets are created and kept up to date automatically by the script — no need to create them by hand.

## Menu available in the sheet

- Popular tabela (novo campeonato) — Populate table (new season)
- Atualizar resultados agora — Update results now
- Recalcular classificação — Recalculate standings
- Calcular probabilidades (Monte Carlo) — Calculate probabilities
- Atualizar Perfil de Time — Update Team Profile
- Ativar atualização automática diária — Enable daily auto-update
- Configurar token da API — Configure API token

## Keeping this repo updated

Whenever the code in Apps Script changes, copy the updated contents into `src/Codigo.gs` here and commit — this keeps the repository an accurate history of what's actually running in the sheet.

---

*The probabilities and predicted points are statistical estimates based on each team's current performance — not a guaranteed forecast of the championship.*

---

Built by [André Scultori](https://github.com/andrescultori) · © 2026 · [GitHub](https://github.com/andrescultori/tabela-brasileirao)
