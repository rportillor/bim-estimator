// server/estimator/ontario-mep-rates.ts
// =============================================================================
// ONTARIO MEP UNIT RATES — DIVISIONS 21 / 22 / 23 / 26 / 27 / 28
// =============================================================================
//
// Purpose:
//   Production-grade Ontario ICI market unit rates for MEP cost estimation.
//   All rates in CAD. Rates are supply + install (labour + material + small tools).
//   Equipment (cranes, aerial lifts, scaffolding) billed separately via
//   equipment-factor — see EQUIPMENT_FACTOR below.
//
// Currency: CAD (Canadian dollars)
// Base region: Ontario — GTA / ICI market
// Calibration: Q1 2026 (effective January 2026)
//
// ─── Labour Rate Basis ──────────────────────────────────────────────────────
//
//  Division 21/22 (Plumbing & Fire Suppression):
//    UA Local 46 (Plumbers, Toronto) All-In Journeyperson: ~$98.40/hr
//    UA Local 524 (Oshawa/Peterborough) All-In: ~$93.80/hr
//    UA Local 401 Zone 12 West (Kawartha Lakes) All-In: ~$87.00/hr
//    Source: UA Canada 2025 collective agreement schedules
//
//  Division 23 (HVAC / Sheet Metal / Refrigeration):
//    UA Local 787 (HVACR, Toronto) Sheet Metal Journeyperson All-In: ~$102.50/hr
//    SMWIA Local 285 (Hamilton) All-In: ~$97.20/hr
//    Refrigeration mechanics (ORM Local 787): ~$99.10/hr
//    Source: UA Local 787 ICI collective agreement 2025–2027
//
//  Division 26/27/28 (Electrical / Communications / Electronic Safety):
//    IBEW Local 353 (Toronto) Electrician All-In Journeyperson: ~$109.85/hr
//    IBEW Local 636 (Oshawa) All-In: ~$104.20/hr
//    IBEW Local 586 (Kingston/Peterborough) All-In: ~$99.60/hr
//    Source: IBEW Canada 2025 ICI collective agreement schedules
//
//  Productivity factors (hrs/unit) calibrated per:
//    CIQS Labour & Material Standards (2024 edition)
//    Mechanical Contractors Association of Ontario (MCAO) productivity norms
//    Electrical Contractors Association of Ontario (ECAO) 2025 benchmarks
//
// ─── Material Price Basis ────────────────────────────────────────────────────
//
//  Copper pipe/fittings:  Index vs Q4 2024 +4.2% (Statistics Canada, Div 22)
//  HVAC equipment:        +3.4% YoY Q4 2025 (Statistics Canada, Div 23)
//  Electrical materials:  -1.7% Q4 2025 (alternate sourcing / import relief)
//  Conduit (steel EMT):   Stable (+0.5% Q4 2025)
//  Wire/cable:            Copper component tracked; see note below
//
//  NOTE ON COPPER: Wire rates include a copper surcharge adjustment at 2025 average
//  LME copper ~USD 4.10/lb. Projects >$500K electrical content should request
//  current supplier quotes and re-price if LME moves >±10%.
//
// ─── Overhead & Profit ───────────────────────────────────────────────────────
//
//  Rates below are DIRECT COST only (labour + material + small tools).
//  Mechanical/Electrical contractor overhead & profit (typically 15–22% on MEP
//  contracts) is applied by the estimate engine via OHP layer — NOT embedded here.
//  See server/estimator/ohp-configuration.ts for Ontario ICI MEP O&P factors.
//
// ─── Unit conventions ────────────────────────────────────────────────────────
//  lm  = linear metre
//  m2  = square metre
//  m3  = cubic metre
//  ea  = each
//  ls  = lump sum (indicated where quantity is 1 per system)
//
// =============================================================================

export interface MEPRateItem {
  csiCode:      string;   // Full CSI MasterFormat 2018 subdivision (e.g., '22 11 13.13')
  description:  string;   // Trade description
  unit:         string;   // lm | m2 | ea | ls
  materialCAD:  number;   // Material cost per unit (CAD)
  labourCAD:    number;   // Labour cost per unit (CAD)
  totalCAD:     number;   // materialCAD + labourCAD
  labourHrs:    number;   // Journeyperson hours per unit (for resource levelling)
  notes?:       string;   // Calibration note or caveat
}

// ─── DIVISION 21: FIRE SUPPRESSION ──────────────────────────────────────────

export const DIV_21_FIRE_SUPPRESSION: MEPRateItem[] = [

  // 21 05 00 — Common Work Results for Fire Suppression
  {
    csiCode: '21 05 29.10', description: 'Hanger, clevis, 25mm pipe',
    unit: 'ea', materialCAD: 18.50, labourCAD: 22.00, totalCAD: 40.50, labourHrs: 0.25,
  },
  {
    csiCode: '21 05 29.20', description: 'Hanger, clevis, 50mm pipe',
    unit: 'ea', materialCAD: 24.00, labourCAD: 28.50, totalCAD: 52.50, labourHrs: 0.30,
  },

  // 21 13 00 — Wet-Pipe Sprinkler Systems
  {
    csiCode: '21 13 13.10', description: 'Sprinkler head, standard pendant, 15mm orifice — supply + install',
    unit: 'ea', materialCAD: 14.50, labourCAD: 38.00, totalCAD: 52.50, labourHrs: 0.43,
    notes: 'Tyco/Viking/Victaulic standard. Includes trim ring.',
  },
  {
    csiCode: '21 13 13.11', description: 'Sprinkler head, concealed pendant (escutcheon) — supply + install',
    unit: 'ea', materialCAD: 42.00, labourCAD: 45.00, totalCAD: 87.00, labourHrs: 0.52,
  },
  {
    csiCode: '21 13 13.12', description: 'Sprinkler head, upright pendent — supply + install',
    unit: 'ea', materialCAD: 13.50, labourCAD: 36.00, totalCAD: 49.50, labourHrs: 0.41,
  },
  {
    csiCode: '21 13 13.20', description: 'Black steel Schedule 40 pipe 25mm (1") — supply + install',
    unit: 'lm', materialCAD: 16.50, labourCAD: 32.00, totalCAD: 48.50, labourHrs: 0.37,
  },
  {
    csiCode: '21 13 13.21', description: 'Black steel Schedule 40 pipe 40mm (1½") — supply + install',
    unit: 'lm', materialCAD: 24.00, labourCAD: 38.00, totalCAD: 62.00, labourHrs: 0.44,
  },
  {
    csiCode: '21 13 13.22', description: 'Black steel Schedule 40 pipe 50mm (2") — supply + install',
    unit: 'lm', materialCAD: 34.00, labourCAD: 46.00, totalCAD: 80.00, labourHrs: 0.53,
  },
  {
    csiCode: '21 13 13.23', description: 'Black steel Schedule 40 pipe 75mm (3") — supply + install',
    unit: 'lm', materialCAD: 62.00, labourCAD: 60.00, totalCAD: 122.00, labourHrs: 0.69,
  },
  {
    csiCode: '21 13 13.24', description: 'Black steel Schedule 40 pipe 100mm (4") — supply + install',
    unit: 'lm', materialCAD: 98.00, labourCAD: 75.00, totalCAD: 173.00, labourHrs: 0.86,
  },
  {
    csiCode: '21 13 13.30', description: 'Grooved mechanical coupling 50mm — supply + install',
    unit: 'ea', materialCAD: 32.00, labourCAD: 28.00, totalCAD: 60.00, labourHrs: 0.32,
  },
  {
    csiCode: '21 13 13.31', description: 'Grooved mechanical coupling 100mm — supply + install',
    unit: 'ea', materialCAD: 68.00, labourCAD: 42.00, totalCAD: 110.00, labourHrs: 0.48,
  },
  {
    csiCode: '21 13 13.40', description: 'Sprinkler system — wet pipe, residential (per m² GFA, turnkey)',
    unit: 'm2', materialCAD: 12.50, labourCAD: 10.50, totalCAD: 23.00, labourHrs: 0.12,
    notes: 'Bulk rate for preliminary budgeting Part 9 residential. Excludes riser.',
  },
  {
    csiCode: '21 13 13.41', description: 'Sprinkler system — wet pipe, commercial/ICI (per m² GFA, turnkey)',
    unit: 'm2', materialCAD: 18.00, labourCAD: 14.00, totalCAD: 32.00, labourHrs: 0.16,
    notes: 'Bulk rate for preliminary budgeting ICI. Excludes riser/backflow preventer.',
  },
  {
    csiCode: '21 13 13.50', description: 'Sprinkler riser assembly complete (valve, drain, alarm check)',
    unit: 'ea', materialCAD: 2800.00, labourCAD: 1400.00, totalCAD: 4200.00, labourHrs: 16.00,
  },
  {
    csiCode: '21 13 13.51', description: 'Backflow preventer, RPBP 50mm — supply + install',
    unit: 'ea', materialCAD: 1450.00, labourCAD: 480.00, totalCAD: 1930.00, labourHrs: 5.50,
  },
  {
    csiCode: '21 13 13.52', description: 'Backflow preventer, RPBP 100mm — supply + install',
    unit: 'ea', materialCAD: 3200.00, labourCAD: 720.00, totalCAD: 3920.00, labourHrs: 8.25,
  },

  // 21 22 00 — Clean-Agent Fire Extinguishing
  {
    csiCode: '21 22 00.10', description: 'Pre-engineered clean-agent system (server room, per m²)',
    unit: 'm2', materialCAD: 220.00, labourCAD: 120.00, totalCAD: 340.00, labourHrs: 1.38,
    notes: 'FM-200 or Novec 1230. Includes cylinder, nozzles, control panel, detection.',
  },
];

// ─── DIVISION 22: PLUMBING ───────────────────────────────────────────────────

export const DIV_22_PLUMBING: MEPRateItem[] = [

  // 22 05 00 — Common Work Results
  {
    csiCode: '22 05 13.10', description: 'Isolation valve, ball, 15mm — supply + install',
    unit: 'ea', materialCAD: 18.00, labourCAD: 32.00, totalCAD: 50.00, labourHrs: 0.34,
  },
  {
    csiCode: '22 05 13.11', description: 'Isolation valve, ball, 25mm — supply + install',
    unit: 'ea', materialCAD: 28.00, labourCAD: 38.00, totalCAD: 66.00, labourHrs: 0.40,
  },
  {
    csiCode: '22 05 13.12', description: 'Gate valve, 50mm — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 68.00, totalCAD: 163.00, labourHrs: 0.72,
  },
  {
    csiCode: '22 05 13.13', description: 'Gate valve, 100mm — supply + install',
    unit: 'ea', materialCAD: 285.00, labourCAD: 130.00, totalCAD: 415.00, labourHrs: 1.38,
  },
  {
    csiCode: '22 05 29.10', description: 'Pipe hanger, clevis, 15–25mm',
    unit: 'ea', materialCAD: 12.00, labourCAD: 20.00, totalCAD: 32.00, labourHrs: 0.22,
  },
  {
    csiCode: '22 05 29.11', description: 'Pipe hanger, clevis, 50–75mm',
    unit: 'ea', materialCAD: 22.00, labourCAD: 26.00, totalCAD: 48.00, labourHrs: 0.28,
  },
  {
    csiCode: '22 05 53.10', description: 'Pipe insulation, fiberglass, 25mm pipe 25mm thick — supply + install',
    unit: 'lm', materialCAD: 8.50, labourCAD: 12.00, totalCAD: 20.50, labourHrs: 0.14,
  },
  {
    csiCode: '22 05 53.11', description: 'Pipe insulation, fiberglass, 50mm pipe 25mm thick — supply + install',
    unit: 'lm', materialCAD: 11.00, labourCAD: 14.00, totalCAD: 25.00, labourHrs: 0.16,
  },
  {
    csiCode: '22 05 53.12', description: 'Pipe insulation, fiberglass, 100mm pipe 38mm thick — supply + install',
    unit: 'lm', materialCAD: 24.00, labourCAD: 22.00, totalCAD: 46.00, labourHrs: 0.25,
  },

  // 22 11 00 — Facility Water Distribution (Domestic Cold Water)
  {
    csiCode: '22 11 16.10', description: 'Copper Type L pipe 12mm — supply + install',
    unit: 'lm', materialCAD: 8.50, labourCAD: 22.00, totalCAD: 30.50, labourHrs: 0.23,
  },
  {
    csiCode: '22 11 16.11', description: 'Copper Type L pipe 19mm — supply + install',
    unit: 'lm', materialCAD: 12.50, labourCAD: 26.00, totalCAD: 38.50, labourHrs: 0.27,
  },
  {
    csiCode: '22 11 16.12', description: 'Copper Type L pipe 25mm — supply + install',
    unit: 'lm', materialCAD: 19.00, labourCAD: 32.00, totalCAD: 51.00, labourHrs: 0.34,
  },
  {
    csiCode: '22 11 16.13', description: 'Copper Type L pipe 32mm — supply + install',
    unit: 'lm', materialCAD: 28.00, labourCAD: 38.00, totalCAD: 66.00, labourHrs: 0.41,
  },
  {
    csiCode: '22 11 16.14', description: 'Copper Type L pipe 50mm — supply + install',
    unit: 'lm', materialCAD: 52.00, labourCAD: 48.00, totalCAD: 100.00, labourHrs: 0.52,
    notes: 'Copper surcharge at LME ~USD 4.10/lb (2025 average). Re-price if copper moves ±10%.',
  },
  {
    csiCode: '22 11 16.15', description: 'Copper Type L pipe 75mm — supply + install',
    unit: 'lm', materialCAD: 112.00, labourCAD: 68.00, totalCAD: 180.00, labourHrs: 0.74,
    notes: 'Copper surcharge — see above.',
  },
  {
    csiCode: '22 11 16.20', description: 'uPVC Schedule 40 pipe 50mm — supply + install',
    unit: 'lm', materialCAD: 10.50, labourCAD: 28.00, totalCAD: 38.50, labourHrs: 0.30,
  },
  {
    csiCode: '22 11 16.21', description: 'uPVC Schedule 40 pipe 100mm — supply + install',
    unit: 'lm', materialCAD: 22.00, labourCAD: 40.00, totalCAD: 62.00, labourHrs: 0.43,
  },
  {
    csiCode: '22 11 16.30', description: 'CPVC pipe 19mm (hot water) — supply + install',
    unit: 'lm', materialCAD: 14.00, labourCAD: 28.00, totalCAD: 42.00, labourHrs: 0.30,
  },
  {
    csiCode: '22 11 16.31', description: 'PEX-A pipe 19mm (radiant/domestic) — supply + install',
    unit: 'lm', materialCAD: 6.50, labourCAD: 18.00, totalCAD: 24.50, labourHrs: 0.19,
  },
  {
    csiCode: '22 11 16.32', description: 'PEX-A pipe 25mm (radiant/domestic) — supply + install',
    unit: 'lm', materialCAD: 9.00, labourCAD: 22.00, totalCAD: 31.00, labourHrs: 0.23,
  },

  // 22 13 00 — Facility Sanitary Sewerage
  {
    csiCode: '22 13 16.10', description: 'Cast iron soil pipe 50mm (hub & spigot) — supply + install',
    unit: 'lm', materialCAD: 38.00, labourCAD: 55.00, totalCAD: 93.00, labourHrs: 0.63,
  },
  {
    csiCode: '22 13 16.11', description: 'Cast iron soil pipe 100mm (hub & spigot) — supply + install',
    unit: 'lm', materialCAD: 72.00, labourCAD: 75.00, totalCAD: 147.00, labourHrs: 0.86,
  },
  {
    csiCode: '22 13 16.12', description: 'Cast iron soil pipe 150mm (no-hub) — supply + install',
    unit: 'lm', materialCAD: 110.00, labourCAD: 95.00, totalCAD: 205.00, labourHrs: 1.09,
  },
  {
    csiCode: '22 13 16.20', description: 'ABS DWV pipe 50mm — supply + install',
    unit: 'lm', materialCAD: 8.50, labourCAD: 24.00, totalCAD: 32.50, labourHrs: 0.26,
  },
  {
    csiCode: '22 13 16.21', description: 'ABS DWV pipe 100mm — supply + install',
    unit: 'lm', materialCAD: 16.00, labourCAD: 36.00, totalCAD: 52.00, labourHrs: 0.39,
  },
  {
    csiCode: '22 13 16.22', description: 'ABS DWV pipe 150mm — supply + install',
    unit: 'lm', materialCAD: 30.00, labourCAD: 50.00, totalCAD: 80.00, labourHrs: 0.57,
  },

  // 22 30 00 — Plumbing Fixtures
  {
    csiCode: '22 42 01.10', description: 'Water closet (toilet), floor-mounted, vitreous china — supply + install',
    unit: 'ea', materialCAD: 480.00, labourCAD: 380.00, totalCAD: 860.00, labourHrs: 4.10,
    notes: 'American Standard/Kohler commercial grade. Includes wax ring, supply line, seat.',
  },
  {
    csiCode: '22 42 01.11', description: 'Water closet, wall-hung with in-wall carrier — supply + install',
    unit: 'ea', materialCAD: 950.00, labourCAD: 520.00, totalCAD: 1470.00, labourHrs: 5.60,
  },
  {
    csiCode: '22 42 02.10', description: 'Lavatory, drop-in, 508×406mm with faucet — supply + install',
    unit: 'ea', materialCAD: 320.00, labourCAD: 280.00, totalCAD: 600.00, labourHrs: 3.00,
  },
  {
    csiCode: '22 42 02.11', description: 'Lavatory, wall-hung, vitreous china with faucet — supply + install',
    unit: 'ea', materialCAD: 420.00, labourCAD: 320.00, totalCAD: 740.00, labourHrs: 3.45,
  },
  {
    csiCode: '22 42 03.10', description: 'Bathtub, enamelled steel 1524mm — supply + install',
    unit: 'ea', materialCAD: 550.00, labourCAD: 480.00, totalCAD: 1030.00, labourHrs: 5.17,
  },
  {
    csiCode: '22 42 03.11', description: 'Bathtub, soaker/freestanding — supply + install',
    unit: 'ea', materialCAD: 1200.00, labourCAD: 580.00, totalCAD: 1780.00, labourHrs: 6.25,
  },
  {
    csiCode: '22 42 04.10', description: 'Shower receptor, 915×915mm fibreglass — supply + install',
    unit: 'ea', materialCAD: 480.00, labourCAD: 350.00, totalCAD: 830.00, labourHrs: 3.77,
  },
  {
    csiCode: '22 42 05.10', description: 'Kitchen sink, stainless steel double 813×533mm with faucet — supply + install',
    unit: 'ea', materialCAD: 420.00, labourCAD: 280.00, totalCAD: 700.00, labourHrs: 3.01,
  },
  {
    csiCode: '22 42 06.10', description: 'Floor drain, cast iron 100mm — supply + install',
    unit: 'ea', materialCAD: 85.00, labourCAD: 160.00, totalCAD: 245.00, labourHrs: 1.72,
  },
  {
    csiCode: '22 42 07.10', description: 'Hose bib / exterior tap — supply + install',
    unit: 'ea', materialCAD: 42.00, labourCAD: 95.00, totalCAD: 137.00, labourHrs: 1.02,
  },

  // 22 33 00 — Electric Domestic Water Heaters
  {
    csiCode: '22 33 30.10', description: 'Electric water heater 150L (40 USG), 4.5kW — supply + install',
    unit: 'ea', materialCAD: 780.00, labourCAD: 420.00, totalCAD: 1200.00, labourHrs: 4.52,
  },
  {
    csiCode: '22 33 30.11', description: 'Electric water heater 270L (72 USG), 9kW — supply + install',
    unit: 'ea', materialCAD: 1350.00, labourCAD: 520.00, totalCAD: 1870.00, labourHrs: 5.60,
  },
  {
    csiCode: '22 33 30.12', description: 'Gas water heater 150L (40 USG), power vent — supply + install',
    unit: 'ea', materialCAD: 1100.00, labourCAD: 580.00, totalCAD: 1680.00, labourHrs: 6.25,
    notes: 'Includes pressure/temp relief valve, venting to 4.5m. Gas connection separate.',
  },
  {
    csiCode: '22 33 30.20', description: 'High-efficiency condensing water heater 45kW — supply + install',
    unit: 'ea', materialCAD: 8500.00, labourCAD: 2200.00, totalCAD: 10700.00, labourHrs: 23.70,
    notes: 'Commercial booster. Includes PVC flue, condensate drain, gas train.',
  },

  // 22 11 23 — Domestic Water Pumps
  {
    csiCode: '22 11 23.10', description: 'Circulation pump, in-line, 25mm, 0.37kW — supply + install',
    unit: 'ea', materialCAD: 620.00, labourCAD: 420.00, totalCAD: 1040.00, labourHrs: 4.52,
  },
  {
    csiCode: '22 11 23.11', description: 'Booster pump set, 50–100mm, variable speed — supply + install',
    unit: 'ea', materialCAD: 9500.00, labourCAD: 3200.00, totalCAD: 12700.00, labourHrs: 34.48,
    notes: 'Multi-story residential or commercial. Includes VFD, pressure vessel, controls.',
  },
];

// ─── DIVISION 23: HVAC ────────────────────────────────────────────────────────

export const DIV_23_HVAC: MEPRateItem[] = [

  // 23 07 00 — HVAC Insulation
  {
    csiCode: '23 07 13.10', description: 'Duct insulation, flexible fiberglass 38mm, external — supply + install',
    unit: 'm2', materialCAD: 12.00, labourCAD: 14.00, totalCAD: 26.00, labourHrs: 0.14,
  },
  {
    csiCode: '23 07 13.11', description: 'Duct insulation, rigid fiberglass 50mm, external — supply + install',
    unit: 'm2', materialCAD: 16.00, labourCAD: 18.00, totalCAD: 34.00, labourHrs: 0.18,
  },
  {
    csiCode: '23 07 16.10', description: 'HVAC pipe insulation, fiberglass 25mm pipe 25mm thick — supply + install',
    unit: 'lm', materialCAD: 10.00, labourCAD: 14.00, totalCAD: 24.00, labourHrs: 0.14,
  },

  // 23 09 00 — Instrumentation and Control
  {
    csiCode: '23 09 23.10', description: 'VAV box, pressure-independent, 150mm, DDC — supply + install',
    unit: 'ea', materialCAD: 1250.00, labourCAD: 680.00, totalCAD: 1930.00, labourHrs: 6.63,
    notes: 'Trane/Price/Greenheck. Excludes BAS integration wire; see Div 27.',
  },
  {
    csiCode: '23 09 23.11', description: 'VAV box, pressure-independent, 250mm, DDC — supply + install',
    unit: 'ea', materialCAD: 1850.00, labourCAD: 820.00, totalCAD: 2670.00, labourHrs: 7.99,
  },
  {
    csiCode: '23 09 23.20', description: 'Room thermostat, low-voltage, programmable — supply + install',
    unit: 'ea', materialCAD: 185.00, labourCAD: 120.00, totalCAD: 305.00, labourHrs: 1.17,
  },

  // 23 11 00 — Facility Fuel Systems (Natural Gas)
  {
    csiCode: '23 11 23.10', description: 'Gas piping, black steel 20mm — supply + install',
    unit: 'lm', materialCAD: 14.00, labourCAD: 32.00, totalCAD: 46.00, labourHrs: 0.34,
  },
  {
    csiCode: '23 11 23.11', description: 'Gas piping, black steel 32mm — supply + install',
    unit: 'lm', materialCAD: 22.00, labourCAD: 42.00, totalCAD: 64.00, labourHrs: 0.45,
  },
  {
    csiCode: '23 11 23.12', description: 'Gas piping, black steel 50mm — supply + install',
    unit: 'lm', materialCAD: 38.00, labourCAD: 55.00, totalCAD: 93.00, labourHrs: 0.59,
  },
  {
    csiCode: '23 11 23.13', description: 'Gas shut-off valve, 20mm — supply + install',
    unit: 'ea', materialCAD: 48.00, labourCAD: 55.00, totalCAD: 103.00, labourHrs: 0.59,
  },

  // 23 21 00 — Hydronic Piping and Pumps
  {
    csiCode: '23 21 13.10', description: 'Hydronic pipe, black steel 25mm — supply + install',
    unit: 'lm', materialCAD: 18.00, labourCAD: 38.00, totalCAD: 56.00, labourHrs: 0.41,
  },
  {
    csiCode: '23 21 13.11', description: 'Hydronic pipe, black steel 40mm — supply + install',
    unit: 'lm', materialCAD: 28.00, labourCAD: 48.00, totalCAD: 76.00, labourHrs: 0.52,
  },
  {
    csiCode: '23 21 13.12', description: 'Hydronic pipe, black steel 65mm — supply + install',
    unit: 'lm', materialCAD: 55.00, labourCAD: 68.00, totalCAD: 123.00, labourHrs: 0.66,
  },
  {
    csiCode: '23 21 13.13', description: 'Hydronic pipe, black steel 100mm — supply + install',
    unit: 'lm', materialCAD: 95.00, labourCAD: 88.00, totalCAD: 183.00, labourHrs: 0.86,
  },
  {
    csiCode: '23 21 23.10', description: 'Heating hot water pump, close-coupled, 25mm, 0.55kW — supply + install',
    unit: 'ea', materialCAD: 980.00, labourCAD: 520.00, totalCAD: 1500.00, labourHrs: 5.07,
  },

  // 23 22 00 — Steam and Condensate Piping
  {
    csiCode: '23 22 13.10', description: 'Steam pipe, black steel 25mm — supply + install',
    unit: 'lm', materialCAD: 22.00, labourCAD: 46.00, totalCAD: 68.00, labourHrs: 0.50,
  },

  // 23 31 00 — HVAC Ducts and Casing
  {
    csiCode: '23 31 13.10', description: 'Galvanized rectangular ductwork ≤0.15m² cross-section — supply + install',
    unit: 'lm', materialCAD: 42.00, labourCAD: 65.00, totalCAD: 107.00, labourHrs: 0.63,
  },
  {
    csiCode: '23 31 13.11', description: 'Galvanized rectangular ductwork 0.15–0.37m² cross-section — supply + install',
    unit: 'lm', materialCAD: 78.00, labourCAD: 95.00, totalCAD: 173.00, labourHrs: 0.93,
  },
  {
    csiCode: '23 31 13.12', description: 'Galvanized rectangular ductwork >0.37m² cross-section — supply + install',
    unit: 'lm', materialCAD: 140.00, labourCAD: 145.00, totalCAD: 285.00, labourHrs: 1.41,
    notes: 'SMACNA HVAC Duct Construction Standards. UA Local 787 SMWIA sheet metal.',
  },
  {
    csiCode: '23 31 13.20', description: 'Galvanized round duct 150mm dia — supply + install',
    unit: 'lm', materialCAD: 22.00, labourCAD: 32.00, totalCAD: 54.00, labourHrs: 0.31,
  },
  {
    csiCode: '23 31 13.21', description: 'Galvanized round duct 250mm dia — supply + install',
    unit: 'lm', materialCAD: 38.00, labourCAD: 48.00, totalCAD: 86.00, labourHrs: 0.47,
  },
  {
    csiCode: '23 31 13.22', description: 'Galvanized round duct 400mm dia — supply + install',
    unit: 'lm', materialCAD: 68.00, labourCAD: 72.00, totalCAD: 140.00, labourHrs: 0.70,
  },
  {
    csiCode: '23 31 13.30', description: 'Flexible duct, insulated, 150mm — supply + install',
    unit: 'lm', materialCAD: 9.50, labourCAD: 16.00, totalCAD: 25.50, labourHrs: 0.16,
  },
  {
    csiCode: '23 31 13.40', description: 'Ductwork, low-pressure (Class 1), budget rate per kg',
    unit: 'kg', materialCAD: 5.80, labourCAD: 7.20, totalCAD: 13.00, labourHrs: 0.07,
    notes: 'Alternate takeoff basis for preliminary estimates. Average mass ~ 5–6 kg/m duct.',
  },

  // 23 33 00 — Air Duct Accessories
  {
    csiCode: '23 33 13.10', description: 'Damper, volume control, manual, 300×150mm — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 85.00, totalCAD: 180.00, labourHrs: 0.83,
  },
  {
    csiCode: '23 33 13.11', description: 'Damper, motorized, 600×400mm — supply + install',
    unit: 'ea', materialCAD: 680.00, labourCAD: 320.00, totalCAD: 1000.00, labourHrs: 3.12,
  },
  {
    csiCode: '23 33 13.20', description: 'Fire damper, curtain, UL555, 300×300mm — supply + install',
    unit: 'ea', materialCAD: 220.00, labourCAD: 180.00, totalCAD: 400.00, labourHrs: 1.75,
  },

  // 23 36 00 — Air Terminal Units (Diffusers, Grilles)
  {
    csiCode: '23 37 13.10', description: 'Supply diffuser, ceiling, 600×600mm, aluminium — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 75.00, totalCAD: 170.00, labourHrs: 0.73,
  },
  {
    csiCode: '23 37 13.11', description: 'Return air grille, 600×300mm, aluminium — supply + install',
    unit: 'ea', materialCAD: 52.00, labourCAD: 55.00, totalCAD: 107.00, labourHrs: 0.54,
  },
  {
    csiCode: '23 37 13.12', description: 'Linear diffuser slot, 1800mm, 2-slot — supply + install',
    unit: 'ea', materialCAD: 280.00, labourCAD: 150.00, totalCAD: 430.00, labourHrs: 1.46,
  },

  // 23 41 00 — Particulate Air Filtration
  {
    csiCode: '23 41 13.10', description: 'Filter bank, 2" MERV-8, 600×600mm — supply + install',
    unit: 'ea', materialCAD: 38.00, labourCAD: 25.00, totalCAD: 63.00, labourHrs: 0.24,
  },
  {
    csiCode: '23 41 13.11', description: 'Filter bank, 4" MERV-13 — supply + install',
    unit: 'ea', materialCAD: 72.00, labourCAD: 30.00, totalCAD: 102.00, labourHrs: 0.29,
  },

  // 23 52 00 — Heating Boilers
  {
    csiCode: '23 52 33.10', description: 'Condensing gas boiler, 70kW, modulating — supply + install',
    unit: 'ea', materialCAD: 8500.00, labourCAD: 3200.00, totalCAD: 11700.00, labourHrs: 31.22,
    notes: 'Lochinvar/Navien. Includes flue piping, gas train, expansion tank, controls. Excludes hydronic piping.',
  },
  {
    csiCode: '23 52 33.11', description: 'Condensing gas boiler, 175kW — supply + install',
    unit: 'ea', materialCAD: 18500.00, labourCAD: 6200.00, totalCAD: 24700.00, labourHrs: 60.49,
  },
  {
    csiCode: '23 52 33.12', description: 'Condensing gas boiler, 350kW — supply + install',
    unit: 'ea', materialCAD: 32000.00, labourCAD: 9500.00, totalCAD: 41500.00, labourHrs: 92.68,
  },

  // 23 57 00 — Heat Exchangers
  {
    csiCode: '23 57 00.10', description: 'Plate heat exchanger, hydronic, 50kW — supply + install',
    unit: 'ea', materialCAD: 3200.00, labourCAD: 1800.00, totalCAD: 5000.00, labourHrs: 17.56,
  },

  // 23 64 00 — Packaged Compressor and Condenser Units (DX)
  {
    csiCode: '23 64 16.10', description: 'Air-cooled condenser, remote, 14kW — supply + install',
    unit: 'ea', materialCAD: 3500.00, labourCAD: 1800.00, totalCAD: 5300.00, labourHrs: 17.56,
  },
  {
    csiCode: '23 64 16.11', description: 'Air-cooled condenser, remote, 35kW — supply + install',
    unit: 'ea', materialCAD: 7200.00, labourCAD: 2800.00, totalCAD: 10000.00, labourHrs: 27.32,
  },

  // 23 73 00 — Indoor Central Station Air-Handling Units
  {
    csiCode: '23 73 13.10', description: 'AHU, vertical draw-through, 2000 L/s, DX cooling — supply + install',
    unit: 'ea', materialCAD: 22000.00, labourCAD: 8500.00, totalCAD: 30500.00, labourHrs: 82.93,
    notes: 'Excludes ductwork, chilled water piping, controls. Lennox/Daikin/Carrier.',
  },
  {
    csiCode: '23 73 13.11', description: 'AHU, vertical draw-through, 5000 L/s, DX cooling — supply + install',
    unit: 'ea', materialCAD: 48000.00, labourCAD: 16000.00, totalCAD: 64000.00, labourHrs: 156.10,
  },

  // 23 74 00 — Packaged Outdoor HVAC Equipment (RTU)
  {
    csiCode: '23 74 13.10', description: 'Rooftop unit (RTU), gas heat/DX cool, 14kW — supply + install',
    unit: 'ea', materialCAD: 9500.00, labourCAD: 4200.00, totalCAD: 13700.00, labourHrs: 40.98,
    notes: 'Includes curb, disconnect. Ductwork measured separately.',
  },
  {
    csiCode: '23 74 13.11', description: 'Rooftop unit (RTU), gas heat/DX cool, 35kW — supply + install',
    unit: 'ea', materialCAD: 18500.00, labourCAD: 6800.00, totalCAD: 25300.00, labourHrs: 66.34,
  },
  {
    csiCode: '23 74 13.12', description: 'Rooftop unit (RTU), gas heat/DX cool, 70kW — supply + install',
    unit: 'ea', materialCAD: 32000.00, labourCAD: 10500.00, totalCAD: 42500.00, labourHrs: 102.44,
  },

  // 23 81 00 — Decentralized Unitary HVAC Equipment
  {
    csiCode: '23 81 26.10', description: 'Split system heat pump, 7kW, 1-phase — supply + install',
    unit: 'ea', materialCAD: 4200.00, labourCAD: 2200.00, totalCAD: 6400.00, labourHrs: 21.46,
    notes: 'Mitsubishi/Fujitsu/Daikin. Includes lineset 6m, drain, 1-zone control.',
  },
  {
    csiCode: '23 81 26.11', description: 'Multi-split heat pump, outdoor unit 14kW, 3 zones — supply + install',
    unit: 'ea', materialCAD: 8500.00, labourCAD: 4200.00, totalCAD: 12700.00, labourHrs: 40.98,
    notes: 'Includes 3 indoor heads, linesets, drain, controls.',
  },
  {
    csiCode: '23 81 46.10', description: 'Fan coil unit, 2-pipe, 3.5kW — supply + install',
    unit: 'ea', materialCAD: 1400.00, labourCAD: 850.00, totalCAD: 2250.00, labourHrs: 8.29,
  },
  {
    csiCode: '23 81 46.11', description: 'Fan coil unit, 4-pipe, 7kW — supply + install',
    unit: 'ea', materialCAD: 2400.00, labourCAD: 1200.00, totalCAD: 3600.00, labourHrs: 11.71,
  },

  // 23 82 00 — Convection Heating and Cooling Units
  {
    csiCode: '23 82 16.10', description: 'Electric baseboard heater, 1000W, 1219mm — supply + install',
    unit: 'ea', materialCAD: 145.00, labourCAD: 95.00, totalCAD: 240.00, labourHrs: 0.93,
  },
  {
    csiCode: '23 82 16.11', description: 'Electric baseboard heater, 2000W, 2134mm — supply + install',
    unit: 'ea', materialCAD: 220.00, labourCAD: 115.00, totalCAD: 335.00, labourHrs: 1.12,
  },
  {
    csiCode: '23 82 19.10', description: 'Unit heater, gas-fired, 14kW, ceiling mount — supply + install',
    unit: 'ea', materialCAD: 1350.00, labourCAD: 720.00, totalCAD: 2070.00, labourHrs: 7.02,
  },

  // 23 84 00 — Humidity Control Equipment
  {
    csiCode: '23 84 13.10', description: 'Steam humidifier, 4.5 kg/hr, in-duct — supply + install',
    unit: 'ea', materialCAD: 2200.00, labourCAD: 1100.00, totalCAD: 3300.00, labourHrs: 10.73,
  },
];

// ─── DIVISION 26: ELECTRICAL ─────────────────────────────────────────────────

export const DIV_26_ELECTRICAL: MEPRateItem[] = [

  // 26 05 00 — Common Work Results for Electrical
  {
    csiCode: '26 05 19.10', description: 'Conductors, THHN/THWN, #12 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 1.85, labourCAD: 3.20, totalCAD: 5.05, labourHrs: 0.029,
    notes: 'Copper wire index at LME ~USD 4.10/lb 2025 avg. Re-price if ±10% shift.',
  },
  {
    csiCode: '26 05 19.11', description: 'Conductors, THHN/THWN, #10 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 2.80, labourCAD: 3.50, totalCAD: 6.30, labourHrs: 0.032,
  },
  {
    csiCode: '26 05 19.12', description: 'Conductors, THHN/THWN, #8 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 4.50, labourCAD: 3.80, totalCAD: 8.30, labourHrs: 0.035,
  },
  {
    csiCode: '26 05 19.13', description: 'Conductors, THHN/THWN, #6 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 7.20, labourCAD: 4.20, totalCAD: 11.40, labourHrs: 0.039,
  },
  {
    csiCode: '26 05 19.14', description: 'Conductors, THHN/THWN, #4 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 11.00, labourCAD: 4.80, totalCAD: 15.80, labourHrs: 0.044,
  },
  {
    csiCode: '26 05 19.15', description: 'Conductors, THHN/THWN, #2 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 17.50, labourCAD: 5.50, totalCAD: 23.00, labourHrs: 0.050,
  },
  {
    csiCode: '26 05 19.16', description: 'Conductors, THHN/THWN, #1/0 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 28.00, labourCAD: 6.50, totalCAD: 34.50, labourHrs: 0.059,
  },
  {
    csiCode: '26 05 19.17', description: 'Conductors, THHN/THWN, #3/0 AWG, copper — supply + install',
    unit: 'lm', materialCAD: 44.00, labourCAD: 8.20, totalCAD: 52.20, labourHrs: 0.075,
  },
  {
    csiCode: '26 05 19.18', description: 'Conductors, THHN/THWN, 250 kcmil, copper — supply + install',
    unit: 'lm', materialCAD: 64.00, labourCAD: 10.50, totalCAD: 74.50, labourHrs: 0.096,
  },
  {
    csiCode: '26 05 19.20', description: 'NMD-90 cable 14/2 — supply + install (residential)',
    unit: 'lm', materialCAD: 2.20, labourCAD: 2.80, totalCAD: 5.00, labourHrs: 0.026,
  },
  {
    csiCode: '26 05 19.21', description: 'NMD-90 cable 12/2 — supply + install (residential)',
    unit: 'lm', materialCAD: 3.20, labourCAD: 3.00, totalCAD: 6.20, labourHrs: 0.027,
  },

  // 26 05 33 — Raceways and Conduit
  {
    csiCode: '26 05 33.10', description: 'EMT conduit 19mm — supply + install',
    unit: 'lm', materialCAD: 4.80, labourCAD: 9.50, totalCAD: 14.30, labourHrs: 0.087,
  },
  {
    csiCode: '26 05 33.11', description: 'EMT conduit 25mm — supply + install',
    unit: 'lm', materialCAD: 6.50, labourCAD: 11.00, totalCAD: 17.50, labourHrs: 0.100,
  },
  {
    csiCode: '26 05 33.12', description: 'EMT conduit 38mm — supply + install',
    unit: 'lm', materialCAD: 10.50, labourCAD: 14.00, totalCAD: 24.50, labourHrs: 0.127,
  },
  {
    csiCode: '26 05 33.13', description: 'EMT conduit 53mm — supply + install',
    unit: 'lm', materialCAD: 15.00, labourCAD: 17.50, totalCAD: 32.50, labourHrs: 0.159,
  },
  {
    csiCode: '26 05 33.14', description: 'RGS conduit 38mm — supply + install',
    unit: 'lm', materialCAD: 18.00, labourCAD: 22.00, totalCAD: 40.00, labourHrs: 0.200,
  },
  {
    csiCode: '26 05 33.15', description: 'RGS conduit 53mm — supply + install',
    unit: 'lm', materialCAD: 26.00, labourCAD: 26.00, totalCAD: 52.00, labourHrs: 0.237,
  },
  {
    csiCode: '26 05 33.20', description: 'PVC conduit 25mm — supply + install',
    unit: 'lm', materialCAD: 3.50, labourCAD: 7.50, totalCAD: 11.00, labourHrs: 0.068,
  },
  {
    csiCode: '26 05 33.21', description: 'PVC conduit 53mm — supply + install',
    unit: 'lm', materialCAD: 8.50, labourCAD: 13.00, totalCAD: 21.50, labourHrs: 0.118,
  },
  {
    csiCode: '26 05 36.10', description: 'Cable tray, ladder type, 600mm wide — supply + install',
    unit: 'lm', materialCAD: 95.00, labourCAD: 55.00, totalCAD: 150.00, labourHrs: 0.50,
  },
  {
    csiCode: '26 05 36.11', description: 'Cable tray, ladder type, 900mm wide — supply + install',
    unit: 'lm', materialCAD: 140.00, labourCAD: 70.00, totalCAD: 210.00, labourHrs: 0.64,
  },

  // 26 05 26 — Grounding and Bonding
  {
    csiCode: '26 05 26.10', description: 'Ground rod, copper-clad, 19mm×2400mm — supply + install',
    unit: 'ea', materialCAD: 28.00, labourCAD: 65.00, totalCAD: 93.00, labourHrs: 0.59,
  },
  {
    csiCode: '26 05 26.11', description: 'Grounding conductor bare copper #2 AWG — supply + install',
    unit: 'lm', materialCAD: 6.50, labourCAD: 4.50, totalCAD: 11.00, labourHrs: 0.041,
  },

  // 26 22 00 — Low-Voltage Transformers
  {
    csiCode: '26 22 13.10', description: 'Dry-type transformer, 15kVA, 600V–120/208V, wall mount — supply + install',
    unit: 'ea', materialCAD: 2800.00, labourCAD: 1800.00, totalCAD: 4600.00, labourHrs: 16.38,
  },
  {
    csiCode: '26 22 13.11', description: 'Dry-type transformer, 45kVA, 600V–120/208V — supply + install',
    unit: 'ea', materialCAD: 5200.00, labourCAD: 2800.00, totalCAD: 8000.00, labourHrs: 25.49,
  },
  {
    csiCode: '26 22 13.12', description: 'Dry-type transformer, 112.5kVA, 600V–120/208V — supply + install',
    unit: 'ea', materialCAD: 9500.00, labourCAD: 4200.00, totalCAD: 13700.00, labourHrs: 38.23,
  },

  // 26 24 00 — Switchboards and Panelboards
  {
    csiCode: '26 24 13.10', description: 'Main service entrance, 400A, 120/208V, 3Φ — supply + install',
    unit: 'ea', materialCAD: 6500.00, labourCAD: 3800.00, totalCAD: 10300.00, labourHrs: 34.60,
    notes: 'Includes main breaker, bus, metering ready. Excludes hydro connection.',
  },
  {
    csiCode: '26 24 13.11', description: 'Main service entrance, 800A, 120/208V, 3Φ — supply + install',
    unit: 'ea', materialCAD: 12500.00, labourCAD: 6200.00, totalCAD: 18700.00, labourHrs: 56.47,
  },
  {
    csiCode: '26 24 16.10', description: 'Panelboard, 100A, 120/240V, 1Φ, 24-circuit — supply + install',
    unit: 'ea', materialCAD: 850.00, labourCAD: 580.00, totalCAD: 1430.00, labourHrs: 5.28,
  },
  {
    csiCode: '26 24 16.11', description: 'Panelboard, 200A, 120/208V, 3Φ, 42-circuit — supply + install',
    unit: 'ea', materialCAD: 1850.00, labourCAD: 1200.00, totalCAD: 3050.00, labourHrs: 10.92,
  },
  {
    csiCode: '26 24 16.12', description: 'Panelboard, 400A, 120/208V, 3Φ, 42-circuit — supply + install',
    unit: 'ea', materialCAD: 3800.00, labourCAD: 2200.00, totalCAD: 6000.00, labourHrs: 20.03,
  },
  {
    csiCode: '26 24 16.20', description: 'Circuit breaker add-on, 1-pole, 15–30A',
    unit: 'ea', materialCAD: 38.00, labourCAD: 55.00, totalCAD: 93.00, labourHrs: 0.50,
  },
  {
    csiCode: '26 24 16.21', description: 'Circuit breaker add-on, 2-pole, 40–60A',
    unit: 'ea', materialCAD: 85.00, labourCAD: 65.00, totalCAD: 150.00, labourHrs: 0.59,
  },

  // 26 27 00 — Low-Voltage Distribution Equipment
  {
    csiCode: '26 27 26.10', description: 'Disconnect switch, 60A, 600V, NEMA 3R — supply + install',
    unit: 'ea', materialCAD: 280.00, labourCAD: 220.00, totalCAD: 500.00, labourHrs: 2.00,
  },
  {
    csiCode: '26 27 26.11', description: 'Disconnect switch, 200A, 600V, NEMA 1 — supply + install',
    unit: 'ea', materialCAD: 680.00, labourCAD: 380.00, totalCAD: 1060.00, labourHrs: 3.46,
  },
  {
    csiCode: '26 27 23.10', description: 'Motor starter, manual, 115V, 2HP max — supply + install',
    unit: 'ea', materialCAD: 185.00, labourCAD: 180.00, totalCAD: 365.00, labourHrs: 1.64,
  },

  // 26 51 00 — Lighting Interior
  {
    csiCode: '26 51 13.10', description: 'LED troffer, 600×600mm, 4000K, 38W — supply + install',
    unit: 'ea', materialCAD: 145.00, labourCAD: 95.00, totalCAD: 240.00, labourHrs: 0.87,
    notes: 'Lithonia/Cooper. Includes box, whip, fixture trim. Excludes ceiling grid.',
  },
  {
    csiCode: '26 51 13.11', description: 'LED troffer, 300×1200mm, 4000K, 30W — supply + install',
    unit: 'ea', materialCAD: 120.00, labourCAD: 85.00, totalCAD: 205.00, labourHrs: 0.77,
  },
  {
    csiCode: '26 51 13.12', description: 'LED recessed downlight, 100mm dia, 15W — supply + install',
    unit: 'ea', materialCAD: 82.00, labourCAD: 75.00, totalCAD: 157.00, labourHrs: 0.68,
  },
  {
    csiCode: '26 51 13.13', description: 'LED pot light, 150mm dia, IC-rated, 12W — supply + install',
    unit: 'ea', materialCAD: 65.00, labourCAD: 70.00, totalCAD: 135.00, labourHrs: 0.64,
  },
  {
    csiCode: '26 51 13.20', description: 'Emergency exit sign, LED, single face — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 90.00, totalCAD: 185.00, labourHrs: 0.82,
  },
  {
    csiCode: '26 51 13.21', description: 'Emergency egress light, LED, twin head — supply + install',
    unit: 'ea', materialCAD: 145.00, labourCAD: 110.00, totalCAD: 255.00, labourHrs: 1.00,
  },
  {
    csiCode: '26 51 13.30', description: 'LED wall pack, 50W, 5000K, exterior — supply + install',
    unit: 'ea', materialCAD: 280.00, labourCAD: 180.00, totalCAD: 460.00, labourHrs: 1.64,
  },
  {
    csiCode: '26 51 13.31', description: 'LED parking lot pole light, 150W, 9m pole — supply + install',
    unit: 'ea', materialCAD: 2200.00, labourCAD: 980.00, totalCAD: 3180.00, labourHrs: 8.92,
    notes: 'Includes anchor bolts, direct-buried base (concrete by Div 03).',
  },
  {
    csiCode: '26 51 13.40', description: 'Residential wiring rough-in, per suite 100m² (typical branch circuits)',
    unit: 'ea', materialCAD: 2200.00, labourCAD: 1800.00, totalCAD: 4000.00, labourHrs: 16.38,
    notes: 'Budget rate. Includes wiring, boxes, plates. Excludes fixtures and panel.',
  },

  // 26 56 00 — Exterior Lighting
  {
    csiCode: '26 56 13.10', description: 'LED flood light, 100W, pole top 4.5m — supply + install',
    unit: 'ea', materialCAD: 850.00, labourCAD: 420.00, totalCAD: 1270.00, labourHrs: 3.82,
  },

  // 26 05 00 — Wiring Devices
  {
    csiCode: '26 27 16.10', description: 'Duplex receptacle, 15A/125V, in-wall, with box and plate — supply + install',
    unit: 'ea', materialCAD: 18.00, labourCAD: 45.00, totalCAD: 63.00, labourHrs: 0.41,
  },
  {
    csiCode: '26 27 16.11', description: 'GFCI receptacle, 15A/125V, with box and plate — supply + install',
    unit: 'ea', materialCAD: 35.00, labourCAD: 50.00, totalCAD: 85.00, labourHrs: 0.46,
  },
  {
    csiCode: '26 27 16.12', description: 'Single-pole switch, 15A, with box and plate — supply + install',
    unit: 'ea', materialCAD: 14.00, labourCAD: 42.00, totalCAD: 56.00, labourHrs: 0.38,
  },
  {
    csiCode: '26 27 16.13', description: '3-way switch, 15A, with box and plate — supply + install',
    unit: 'ea', materialCAD: 22.00, labourCAD: 50.00, totalCAD: 72.00, labourHrs: 0.46,
  },

  // 26 35 00 — Power Filters and Conditioners
  {
    csiCode: '26 35 33.10', description: 'UPS, 6kVA online, 208V, rack-mount — supply + install',
    unit: 'ea', materialCAD: 4500.00, labourCAD: 1800.00, totalCAD: 6300.00, labourHrs: 16.38,
  },
];

// ─── DIVISION 27: COMMUNICATIONS ─────────────────────────────────────────────

export const DIV_27_COMMUNICATIONS: MEPRateItem[] = [

  // 27 05 00 — Common Work Results
  {
    csiCode: '27 05 28.10', description: 'Firestop, sleeve seal, 50mm conduit — supply + install',
    unit: 'ea', materialCAD: 32.00, labourCAD: 38.00, totalCAD: 70.00, labourHrs: 0.35,
  },

  // 27 11 00 — Communications Equipment Room Fittings
  {
    csiCode: '27 11 00.10', description: 'IDF rack, 19", 12U, wall-mount — supply + install',
    unit: 'ea', materialCAD: 420.00, labourCAD: 220.00, totalCAD: 640.00, labourHrs: 2.00,
  },
  {
    csiCode: '27 11 00.11', description: 'MDF rack, 19", 42U, floor-standing — supply + install',
    unit: 'ea', materialCAD: 950.00, labourCAD: 420.00, totalCAD: 1370.00, labourHrs: 3.82,
  },
  {
    csiCode: '27 11 00.20', description: 'Patch panel, Cat6, 24-port — supply + install',
    unit: 'ea', materialCAD: 185.00, labourCAD: 120.00, totalCAD: 305.00, labourHrs: 1.09,
  },
  {
    csiCode: '27 11 00.21', description: 'Patch panel, fibre, 12-port LC duplex — supply + install',
    unit: 'ea', materialCAD: 420.00, labourCAD: 180.00, totalCAD: 600.00, labourHrs: 1.64,
  },

  // 27 15 00 — Communications Horizontal Cabling
  {
    csiCode: '27 15 01.10', description: 'Cat6 UTP cable — supply + install',
    unit: 'lm', materialCAD: 1.85, labourCAD: 3.20, totalCAD: 5.05, labourHrs: 0.029,
  },
  {
    csiCode: '27 15 01.11', description: 'Cat6A U/FTP cable — supply + install',
    unit: 'lm', materialCAD: 4.20, labourCAD: 4.50, totalCAD: 8.70, labourHrs: 0.041,
  },
  {
    csiCode: '27 15 01.20', description: 'Voice/data outlet, Cat6, 2-port, with box — supply + install',
    unit: 'ea', materialCAD: 48.00, labourCAD: 65.00, totalCAD: 113.00, labourHrs: 0.59,
  },
  {
    csiCode: '27 15 01.30', description: 'Single-mode fibre cable 6-strand OS2 — supply + install',
    unit: 'lm', materialCAD: 3.80, labourCAD: 5.20, totalCAD: 9.00, labourHrs: 0.047,
  },

  // 27 53 00 — Distributed Audio-Video Communications
  {
    csiCode: '27 51 13.10', description: 'IP telephone rough-in (outlet, box, Cat6 run) — supply + install',
    unit: 'ea', materialCAD: 38.00, labourCAD: 55.00, totalCAD: 93.00, labourHrs: 0.50,
  },
];

// ─── DIVISION 28: ELECTRONIC SAFETY & SECURITY ───────────────────────────────

export const DIV_28_ELECTRONIC_SAFETY: MEPRateItem[] = [

  // 28 16 00 — Intrusion Detection
  {
    csiCode: '28 16 11.10', description: 'Motion sensor, PIR, ceiling mount — supply + install',
    unit: 'ea', materialCAD: 85.00, labourCAD: 90.00, totalCAD: 175.00, labourHrs: 0.82,
  },
  {
    csiCode: '28 16 11.11', description: 'Door/window contact, surface mount — supply + install',
    unit: 'ea', materialCAD: 28.00, labourCAD: 55.00, totalCAD: 83.00, labourHrs: 0.50,
  },
  {
    csiCode: '28 16 11.20', description: 'Intrusion alarm panel, 8-zone — supply + install',
    unit: 'ea', materialCAD: 480.00, labourCAD: 420.00, totalCAD: 900.00, labourHrs: 3.82,
  },

  // 28 23 00 — Video Surveillance
  {
    csiCode: '28 23 11.10', description: 'IP camera, fixed dome, 4MP indoor — supply + install',
    unit: 'ea', materialCAD: 320.00, labourCAD: 220.00, totalCAD: 540.00, labourHrs: 2.00,
  },
  {
    csiCode: '28 23 11.11', description: 'IP camera, PTZ, 4MP outdoor, IR — supply + install',
    unit: 'ea', materialCAD: 850.00, labourCAD: 380.00, totalCAD: 1230.00, labourHrs: 3.46,
  },
  {
    csiCode: '28 23 11.20', description: 'NVR, 16-channel, 8TB — supply + install',
    unit: 'ea', materialCAD: 1800.00, labourCAD: 580.00, totalCAD: 2380.00, labourHrs: 5.28,
  },

  // 28 31 00 — Fire Detection and Alarm
  {
    csiCode: '28 31 11.10', description: 'Smoke detector, photoelectric, ceiling — supply + install',
    unit: 'ea', materialCAD: 62.00, labourCAD: 85.00, totalCAD: 147.00, labourHrs: 0.77,
  },
  {
    csiCode: '28 31 11.11', description: 'Heat detector, fixed temp, ceiling — supply + install',
    unit: 'ea', materialCAD: 48.00, labourCAD: 80.00, totalCAD: 128.00, labourHrs: 0.73,
  },
  {
    csiCode: '28 31 11.12', description: 'Combination smoke/CO detector, interconnectable — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 90.00, totalCAD: 185.00, labourHrs: 0.82,
    notes: 'Required by OBC Div. B 9.10.19 in Part 9 residential suite.',
  },
  {
    csiCode: '28 31 11.20', description: 'Manual pull station, double-action — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 110.00, totalCAD: 205.00, labourHrs: 1.00,
  },
  {
    csiCode: '28 31 11.21', description: 'Horn/strobe, wall, indoor — supply + install',
    unit: 'ea', materialCAD: 120.00, labourCAD: 110.00, totalCAD: 230.00, labourHrs: 1.00,
  },
  {
    csiCode: '28 31 11.22', description: 'Strobe only, wall, indoor (ADA) — supply + install',
    unit: 'ea', materialCAD: 95.00, labourCAD: 100.00, totalCAD: 195.00, labourHrs: 0.91,
  },
  {
    csiCode: '28 31 11.30', description: 'FACP, addressable, 2-loop, 250 pts — supply + install',
    unit: 'ea', materialCAD: 5800.00, labourCAD: 3200.00, totalCAD: 9000.00, labourHrs: 29.13,
    notes: 'Simplex/Edwards/Siemens. Excludes monitoring service.',
  },
  {
    csiCode: '28 31 11.31', description: 'FACP, addressable, 5-loop, 1000 pts — supply + install',
    unit: 'ea', materialCAD: 12500.00, labourCAD: 5800.00, totalCAD: 18300.00, labourHrs: 52.80,
  },
  {
    csiCode: '28 31 11.40', description: 'Fire alarm wiring, 2-conductor shielded (per circuit metre) — supply + install',
    unit: 'lm', materialCAD: 1.20, labourCAD: 2.80, totalCAD: 4.00, labourHrs: 0.025,
  },

  // 28 46 00 — Fire Detection and Alarm — Preliminary Budget Rate
  {
    csiCode: '28 31 11.99', description: 'Fire alarm system — Part 9 residential (per m² GFA, complete turnkey)',
    unit: 'm2', materialCAD: 16.00, labourCAD: 12.00, totalCAD: 28.00, labourHrs: 0.11,
    notes: 'Budget rate for preliminary. Includes FACP, detectors, horn/strobes, pulls, wiring.',
  },
  {
    csiCode: '28 31 12.99', description: 'Fire alarm system — commercial/ICI (per m² GFA, complete turnkey)',
    unit: 'm2', materialCAD: 24.00, labourCAD: 18.00, totalCAD: 42.00, labourHrs: 0.16,
  },
];

// ─── EQUIPMENT FACTOR ────────────────────────────────────────────────────────
//
// Major equipment (cranes, aerial work platforms, scaffolding) is NOT embedded
// in per-unit rates above. Apply the following equipment factor to total MEP
// direct labour cost per floor:
//
//  Floors 1–3:   3.5% of labour cost (AWP, material handling)
//  Floors 4–8:   5.5% of labour cost (AWP + hoisting)
//  Floors 9–15:  7.5% of labour cost (cranes + AWP)
//  Floors 16+:   9.5% of labour cost (tower crane + AWP)
//
// Source: MCAO/ECAO project cost models 2024–2025.

export const MEP_EQUIPMENT_FACTOR: {
  maxFloor: number;
  factor: number;
  description: string;
}[] = [
  { maxFloor: 3,  factor: 0.035, description: 'AWP and material handling, floors 1–3' },
  { maxFloor: 8,  factor: 0.055, description: 'AWP + hoisting, floors 4–8' },
  { maxFloor: 15, factor: 0.075, description: 'Crane + AWP, floors 9–15' },
  { maxFloor: 999, factor: 0.095, description: 'Tower crane + AWP, floors 16+' },
];

export function getMepEquipmentFactor(floorNumber: number): number {
  return MEP_EQUIPMENT_FACTOR.find(f => floorNumber <= f.maxFloor)?.factor ?? 0.095;
}

// ─── MASTER INDEX ─────────────────────────────────────────────────────────────

/**
 * Unified lookup map: csiCode → MEPRateItem.
 * Pre-built at module init for O(1) runtime lookups.
 */
export const MEP_RATE_INDEX: Map<string, MEPRateItem> = new Map<string, MEPRateItem>([
  ...DIV_21_FIRE_SUPPRESSION,
  ...DIV_22_PLUMBING,
  ...DIV_23_HVAC,
  ...DIV_26_ELECTRICAL,
  ...DIV_27_COMMUNICATIONS,
  ...DIV_28_ELECTRONIC_SAFETY,
].map(item => [item.csiCode, item]));

/**
 * Look up an MEP rate item by CSI code. Returns null if not found.
 * Callers must NOT use a fallback default — raise an RFI if not found.
 */
export function getMepRate(csiCode: string): MEPRateItem | null {
  return MEP_RATE_INDEX.get(csiCode) ?? null;
}

/**
 * Get all items in a CSI division (first 2 digits, e.g. '22').
 */
export function getMepRatesByDivision(division: string): MEPRateItem[] {
  return [...MEP_RATE_INDEX.values()].filter(
    item => item.csiCode.startsWith(division + ' ') || item.csiCode.startsWith(division)
  );
}

/**
 * Return total CAD rate (material + labour) for a CSI code, or null.
 * Callers must check for null — never fall back silently.
 */
export function getMepUnitRate(csiCode: string): number | null {
  return MEP_RATE_INDEX.get(csiCode)?.totalCAD ?? null;
}

// ─── Data currency ────────────────────────────────────────────────────────────
//
// Calibrated against:
//   UA Canada 2025 collective agreement schedules (Locals 46, 401, 524, 787)
//   IBEW Canada ICI collective agreements 2025 (Locals 353, 586, 636)
//   MCAO / ECAO Ontario labour productivity benchmarks 2024–2025
//   Statistics Canada BCPI Q4 2025 (material price indices)
//   LME copper USD 4.10/lb 2025 average (wire/pipe surcharge basis)
//   RSMeans Canadian Construction Cost Data 2025 (cross-reference)
//
// Next recommended review: Q3 2026
// For projects with >$500K MEP content: obtain current trade quotes.
// For copper-intensive projects (>100 circuit metres #6 AWG+): re-price if
//   LME copper moves more than ±10% from USD 4.10/lb.
//
// =============================================================================
