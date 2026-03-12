# ESTIMATORPRO — QS LEVEL 5 PROCESS IMPLEMENTATION GUIDE
## Gap Analysis: Ricardo's QS Methodology vs Current Codebase
### For Implementation in Next Session

**Document Version:** 1.0 | **Date:** February 28, 2026  
**Source Document:** QS_Level5_Estimate_Process_and_Basis_of_Estimate.docx (Ricardo Portillo)  
**Codebase Baseline:** estimate-engine.ts v8 (1,401 lines, 212 rates, 216/216 tests)

---

## EXECUTIVE SUMMARY

The estimate-engine.ts has a **strong foundation at the direct-cost / QTO layer** — 212 CSI-coded rates with full labor/material/equipment breakdown, floor grouping, regional factors, and a professional classification chain. However, Ricardo's QS Level 5 methodology defines **8 phases** of which the engine currently covers only portions of Phases 0, 3, and 4.

**The engine builds the house but has no roof, no insulation, and no finishes.**

### Scorecard: QS Level 5 Process Compliance

| Phase | Description | Status | Gap Severity |
|-------|-------------|--------|-------------|
| 0 | Orienting Framework (AACE, NRM, UNIFORMAT) | ⚠️ PARTIAL | HIGH |
| 1 | Mobilization & Document Intake | ❌ MISSING | HIGH |
| 2 | Codes & Standards Implementation | ❌ MISSING | HIGH |
| 3 | Quantity Takeoff (QTO) | ✅ STRONG | LOW |
| 4 | Pricing Development | ⚠️ PARTIAL | HIGH |
| 5 | Risk, Uncertainty & Contingency | ❌ MISSING | CRITICAL |
| 6 | Budget Structure, Markups & Commercials | ❌ MISSING | CRITICAL |
| 7 | Validation & Quality Assurance | ❌ MISSING | MEDIUM |
| 8 | Finalization | ❌ MISSING | MEDIUM |

---

## PHASE-BY-PHASE GAP ANALYSIS

### PHASE 0 — ORIENTING FRAMEWORK

**What Ricardo's Process Requires:**
- AACE estimate classification system (Class 5 → Class 1) based on scope maturity
- Measurement per RICS NRM2 (detailed) / NRM1 (cost planning)
- CSI MasterFormat for trade-based pricing
- UNIFORMAT II for elemental management/VE analysis
- Element ↔ Division cross-walk

**What the Codebase Has:**
- ✅ CSI MasterFormat: 34 divisions, 212 rates, full classification chain
- ✅ Methodology flag: `methodology: 'CIQS'` in output
- ⚠️ UNIFORMAT: one reference in cost-estimation-engine.ts (`measurementMethod` field) but no mapping
- ❌ AACE classification: no estimate class system
- ❌ NRM1/NRM2: no measurement rules, no elemental cost planning structure
- ❌ Element ↔ Division cross-walk: no reconciliation between elemental and trade views

**Implementation Required:**

```
Priority: HIGH
Effort: ~8 hours

1. AACE Estimate Class System
   - Add `estimateClass` field to EstimateSummary: 1-5 with AACE definitions
   - Add `scopeMaturity` percentage field (0-100%)
   - Auto-classify based on data completeness (% of elements with real dimensions vs estimated)
   - The `dataQuality` field (already flagging 'estimated') feeds directly into this

2. UNIFORMAT II Elemental Mapping
   - Create UNIFORMAT_MAP: Record<string, { uniformatCode, uniformatName }>
   - Map each CSI division to UNIFORMAT Level 3 elements:
     - A: Substructure (Div 31 earthwork, Div 03 foundations)
     - B: Shell (Div 03 superstructure, Div 04-05, Div 07 envelope)
     - C: Interiors (Div 06, Div 09)
     - D: Services (Div 21-28)
     - E: Equipment & Furnishings (Div 10-14)
     - F: Special Construction (Div 13)
     - G: Building Sitework (Div 31-35)
   - Generate dual summary: by CSI Division AND by UNIFORMAT element
   - Reconciliation check: Division total must equal Element total

3. NRM1/NRM2 Measurement Notes
   - Add `measurementBasis` to each rate entry: 'gross'|'net'|'centerline'|'internal'
   - Add `nrm2Rule` reference string (e.g., "NRM2 15.1.1" for wall finishes)
   - Store measurement notes per line item for audit trail

4. Cross-Walk Table
   - Exportable table mapping every CSI code to UNIFORMAT element
   - Enables both trade-based and element-based cost reports from same data
```

---

### PHASE 1 — MOBILIZATION & DOCUMENT INTAKE

**What Ricardo's Process Requires:**
- Estimate Plan and BoE shell (target class, deliverables, coding, review gates)
- Codes & Standards Register (model codes, ASTM, fire/life safety, energy, accessibility)
- WBS/CBS structure aligned to CSI and cross-referenced to NRM and Schedule of Values
- Scope/RFI sweep: drawings vs specs vs SOW, log assumptions, issue clarifications

**What the Codebase Has:**
- ✅ Document management system (49 documents for Cameron Lake)
- ✅ PDF extraction service and BIM integration
- ⚠️ WBS: referenced in cost-estimation-engine.ts and routes.ts but not in estimate-engine.ts
- ❌ BoE shell generator: no Basis of Estimate document
- ❌ Codes & Standards Register: no structured code compliance tracking
- ❌ RFI logging: missing data tracker designed but not wired (15 lines gap identified in Session 2)

**Implementation Required:**

```
Priority: HIGH
Effort: ~12 hours

1. Basis of Estimate (BoE) Generator
   - New module: `boe-generator.ts`
   - Auto-populate from estimate output:
     * Executive Summary: class, purpose, headline total
     * Project Overview: from project record
     * Documents Used: from document management system (rev dates)
     * Methodology: CIQS measurement, CSI pricing, L/M/E sources
     * Assumptions & Qualifications: from missing data tracker flags
     * Exclusions: from skippedElements array
     * Estimate Summaries: by Division, by Element (UNIFORMAT)
   - Export as structured JSON or formatted document

2. Codes & Standards Register
   - New interface: CodesStandardsEntry { code, edition, requirement, costImpact, csiDivision }
   - Pre-populated template for Canadian projects:
     * NBC/OBC (building code)
     * CSA standards (structural, electrical, plumbing, gas)
     * ASHRAE 90.1 / NECB (energy)
     * OBC Part 9/Part 3 fire separations
     * AODA (accessibility)
   - Cost impact tracking: each code requirement links to affected line items
   - This feeds directly into Phase 2

3. WBS/CBS Integration
   - Add WBS code field to EstimateLineItem
   - Default WBS structure from CSI divisions
   - Allow project-specific WBS overlay
   - Cross-reference to Schedule of Values structure

4. Wire Missing Data Tracker → RFI Generation
   - The 15-line integration gap from Session 2
   - MissingDataTracker flags → structured RFI log
   - Each assumption logged in BoE automatically
```

---

### PHASE 2 — CODES & STANDARDS IMPLEMENTATION

**What Ricardo's Process Requires:**
- Translate code requirements into quantities and pricing (fire ratings, seismic, energy, accessibility)
- Map work items to governing standards/specs (ASTM families, ASCE/SEI loads)
- Include QA/QC testing and special inspections in preliminaries
- Include permitting/inspection fees as soft costs

**What the Codebase Has:**
- ✅ QA-TEST rate (014000-QA-TEST: $115/hr) for testing/inspection
- ❌ No code-requirement-to-cost mapping
- ❌ No fire rating / seismic / energy code adders
- ❌ No permitting fee structure
- ❌ No special inspection line items

**Implementation Required:**

```
Priority: HIGH
Effort: ~10 hours

1. Code-Driven Cost Adders
   - New structure: CodeAdder { code, requirement, affectedCSI[], costMultiplier | flatCost }
   - Examples:
     * Fire rating: 1-hr assembly adds 15-25% to Div 07/09 assemblies
     * Seismic Category D+: adds 8-15% to Div 03/05 structural
     * NECB energy compliance: adds to Div 07 insulation, Div 08 glazing performance
     * AODA accessibility: adds to Div 14 (elevators), Div 10 (signage), Div 32 (site)
   - Adders applied AFTER base QTO, tracked separately for transparency

2. Permitting & Inspection Fees
   - Add to Div 01 (General Requirements):
     * Building permit: typically 1-1.5% of construction value
     * Plan review: 65-100% of permit fee
     * Development charges: municipality-specific
     * Special inspections: structural, fire, energy code
   - Configurable by jurisdiction (Ontario municipalities differ)

3. QA/QC Testing Requirements
   - Code-driven testing line items:
     * Concrete testing (1 per 75m³ minimum)
     * Steel inspection (structural connections)
     * Air barrier testing (ASTM E2357)
     * Commissioning (ASHRAE Guideline 0)
   - Auto-generate from code register + building scope
```

---

### PHASE 3 — QUANTITY TAKEOFF (QTO)

**What Ricardo's Process Requires:**
- Measure to NRM2 rules with measurement notes and drawing/model references
- Structure by CSI Division for trade alignment
- Maintain elemental (NRM1/UNIFORMAT) view for management
- Dual-person review (maker-checker), change log, benchmark cross-checks

**What the Codebase Has:**
- ✅ CSI Division structure: 34 divisions, 212 rates, 226 classification paths
- ✅ Floor-by-floor grouping with line items
- ✅ Element IDs and evidence refs per line item (audit trail)
- ✅ Data quality flags ('estimated' tag when dimensions missing)
- ✅ Full L/M/E decomposition per line item
- ⚠️ Quantities from BIM model elements (areas, volumes, lengths)
- ❌ NRM2 measurement notes: no rule references per item
- ❌ Dual-person review workflow: no maker-checker system
- ❌ Change log: no drawing revision tracking in estimate

**THIS IS THE ENGINE'S STRONGEST AREA — minor enhancements needed:**

```
Priority: LOW (core is solid)
Effort: ~4 hours

1. Add measurementNote field to EstimateLineItem
   - Populated from classification logic (e.g., "gross wall area less openings >1m²")
   - Per NRM2 measurement rules

2. Add drawingRef field to EstimateLineItem
   - Already have elementIds and evidenceRefs
   - Link to document management system (sheet number, detail reference)

3. Waste Factors (CRITICAL missing piece)
   - Add wastePercent to each RateEntry or by material category:
     * Concrete: 5%
     * Rebar: 3%
     * Masonry: 5%
     * Drywall: 10%
     * Tile: 15%
     * Flooring: 10%
     * Paint: 5%
     * Insulation: 8%
     * Roofing: 7%
     * Lumber: 10%
   - Apply AFTER quantity calculation: adjustedQty = baseQty × (1 + wastePercent)
   - Show waste separately in line item for transparency
```

---

### PHASE 4 — PRICING DEVELOPMENT

**What Ricardo's Process Requires:**
- Direct Costs: firm vendor quotes for major items, budgetary for secondary
- Labor: unit rates by trade (base + fringes + productivity + differentials)
- Equipment/Plant: internal rates or rentals with fuel, standby, mob/demob
- Preliminaries/General Conditions: Div 01 structure
- Subcontractor bid packages by division
- Escalation from price-date to estimate base date to mid-point of construction

**What the Codebase Has:**
- ✅ Labor rates: 212 entries with trade-specific rates
- ✅ Material rates: 212 entries
- ✅ Equipment rates: 212 entries
- ✅ Crew sizes and productivity rates per trade
- ✅ Regional factor (provincial adjustment): implemented
- ⚠️ Escalation: 4 references in code (basic factor), not date-driven
- ⚠️ Div 01 Preliminaries: 5 rates exist but no project-duration-based calculation
- ❌ Vendor quote tracking: no system for attaching quotes to line items
- ❌ Labor burden/fringe: not broken out from base rate
- ❌ Sub bid packages: no trade package structuring
- ❌ Price date management: no base date or escalation timeline

**Implementation Required:**

```
Priority: HIGH
Effort: ~10 hours

1. Escalation Module
   - New structure: EscalationConfig {
       priceBaseDate: Date,
       estimateBaseDate: Date,
       constructionMidPoint: Date,
       annualEscalationRate: number, // default 3% for Canadian construction
       materialEscalation: number,   // may differ from labor
       laborEscalation: number
     }
   - Calculate compound escalation factor between dates
   - Apply per line item (materials escalate differently than labor)
   - Document in BoE: "Escalated from Q1 2026 to Q3 2027 midpoint at 3.0% p.a."

2. Preliminaries / General Conditions Calculator
   - Duration-based calculation for Div 01 items:
     * Site supervision: $X/month × project duration
     * Temporary facilities: $X/month × duration
     * HSE: $X/month × duration
     * Temporary utilities: $X/month × duration
     * Hoarding/security: $X/month × duration
     * Clean-up: % of direct cost
   - Input: project duration (months), number of trades on site
   - Typically 8-15% of direct cost — must be calculated, not assumed

3. Vendor Quote Attachment
   - New interface: VendorQuote {
       lineItemCode: string,
       vendor: string,
       quoteDate: Date,
       validityDays: number,
       quotedAmount: number,
       isBinding: boolean,
       scopeNotes: string
     }
   - Override rate table with actual vendor price when available
   - Track quote validity — flag expired quotes

4. Labor Burden Breakdown
   - Extend rate structure: baseRate + fringes + benefits + insurance
   - Canadian context: CPP, EI, WSIB, vacation pay, benefits
   - Typically 30-40% burden on base wages
   - Show in BoE methodology section
```

---

### PHASE 5 — RISK, UNCERTAINTY & CONTINGENCY ⚠️ CRITICAL GAP

**What Ricardo's Process Requires:**
- Confirm estimate class and expected accuracy
- Quantified risk analysis (range/Monte Carlo) to derive contingency
- Distinguish contingency (known-unknowns) from management reserve (unknown-unknowns)
- Price code-driven risks explicitly (firestopping, energy details, special inspections)

**What the Codebase Has:**
- ⚠️ cost-estimation-engine.ts has contingency ranges per AACE class (3-30%)
- ❌ estimate-engine.ts: ZERO contingency, risk, or uncertainty handling
- ❌ No Monte Carlo or range estimating
- ❌ No risk register
- ❌ No distinction between contingency and management reserve

**Implementation Required:**

```
Priority: CRITICAL
Effort: ~12 hours

1. AACE-Based Contingency System
   - Contingency ranges by estimate class:
     * Class 1 (Level 5): 3-7%
     * Class 2 (Level 4): 5-15%
     * Class 3 (Level 3): 10-20%
     * Class 4 (Level 2): 15-25%
     * Class 5 (Level 1): 20-30%
   - Auto-select range based on scopeMaturity percentage
   - Apply to direct cost subtotal

2. Risk Register Integration
   - New interface: RiskItem {
       id: string,
       description: string,
       category: 'scope'|'design'|'market'|'schedule'|'regulatory',
       probability: number,  // 0-1
       impactLow: number,    // $ value
       impactHigh: number,
       expectedValue: number, // probability × (low+high)/2
       mitigationNotes: string,
       affectedCSI: string[]
     }
   - Risk register feeds into contingency calculation
   - Code-driven risks auto-populated from Codes Register

3. Contingency vs Management Reserve
   - Contingency: sum of risk expected values + class-based percentage
   - Management Reserve: separate line, typically 3-5%, owner-controlled
   - Both visible in budget structure but distinct

4. Range Estimating (Future: Monte Carlo)
   - Each line item gets low/likely/high quantity and rate estimates
   - P50 (base), P80 (contingency target), P90 (management reserve)
   - Phase 1: deterministic ranges; Phase 2: Monte Carlo simulation
```

---

### PHASE 6 — BUDGET STRUCTURE, MARKUPS & COMMERCIALS ⚠️ CRITICAL GAP

**What Ricardo's Process Requires:**
8 layers:
1. Base Construction Cost (directs + indirects)
2. General Conditions / Preliminaries
3. Design/Consultant Fees
4. Defined Allowances
5. Contingency
6. Escalation/Inflation
7. Permits/Fees/Inspections
8. Overheads & Profit

**What the Codebase Has:**
- ✅ Layer 1 PARTIAL: Direct costs (L+M+E) — the engine's core strength
- ⚠️ estimates.ts accepts `overheadProfit` and `taxRate` as API params (15% default)
- ❌ Layers 2-8: ALL MISSING from estimate-engine.ts

**The engine currently outputs a "naked" direct cost. A professional estimate has 7 more layers above it.**

**Implementation Required:**

```
Priority: CRITICAL
Effort: ~8 hours

1. Budget Layer Structure
   - New interface: BudgetStructure {
       directCost: {
         material: number,
         labor: number,
         equipment: number,
         subtotal: number
       },
       generalConditions: {
         siteManagement: number,
         temporaryWorks: number,
         HSE: number,
         QA_QC: number,
         logistics: number,
         subtotal: number,
         percentOfDirect: number    // typically 8-15%
       },
       designFees: {
         architectural: number,
         structural: number,
         MEP: number,
         other: number,
         subtotal: number,
         percentOfConstruction: number  // typically 8-12%
       },
       allowances: AllowanceItem[],  // scoped, not provisional sums
       contingency: {
         designContingency: number,    // known-unknowns
         constructionContingency: number,
         totalContingency: number,
         percentOfBase: number
       },
       escalation: {
         amount: number,
         fromDate: string,
         toDate: string,
         annualRate: number
       },
       permitsFees: {
         buildingPermit: number,
         developmentCharges: number,
         planReview: number,
         inspections: number,
         subtotal: number
       },
       overheadProfit: {
         homeOfficeOverhead: number,   // typically 5-8%
         profit: number,               // typically 5-10%
         bondInsurance: number,        // typically 2-3%
         subtotal: number
       },
       taxes: {
         HST: number,                  // Ontario 13%
         subtotal: number
       },
       GRAND_TOTAL: number
     }

2. Defined Allowances (not provisional sums)
   - AllowanceItem { description, scope, amount, basis, linkedCSI[] }
   - Examples: furniture allowance, IT/AV allowance, landscaping allowance
   - Each must have defined scope to avoid disputes (per Ricardo's process)

3. Output Formatting
   - Summary at every level: by CSI Division, by UNIFORMAT Element, by Budget Layer
   - Schedule of Values generator: trade-by-trade breakdown for contractor billing
```

---

### PHASE 7 — VALIDATION & QUALITY ASSURANCE

**What Ricardo's Process Requires:**
- Internal peer review and independent estimate check
- Element ↔ Division reconciliation (totals must match)
- Historical benchmarking
- Code/standards cost audit

**What the Codebase Has:**
- ✅ 216-test QA suite (engine integrity)
- ❌ No cost-per-m² benchmarking
- ❌ No element ↔ division reconciliation
- ❌ No code/standards cost audit trail

**Implementation Required:**

```
Priority: MEDIUM
Effort: ~6 hours

1. Benchmark Module
   - Cost/m² (GFA) comparison against database:
     * Residential: $2,800-4,500/m² (Canada 2025)
     * Commercial office: $3,200-5,500/m²
     * Industrial: $1,800-3,200/m²
     * Institutional: $4,500-7,500/m²
   - Flag estimate if outside expected range (±15%)
   - Historical project database (future: populate from completed projects)

2. Element ↔ Division Reconciliation
   - After UNIFORMAT mapping is implemented
   - Auto-check: sum(UNIFORMAT elements) === sum(CSI divisions)
   - Report any discrepancies

3. Completeness Check
   - Auto-audit: are all expected divisions present for building type?
   - Missing division flagging (e.g., residential without Div 14 = OK; commercial without Div 14 = flag)
   - Percentage of line items with 'estimated' dataQuality flag
```

---

### PHASE 8 — FINALIZATION

**What Ricardo's Process Requires:**
- Freeze Class 1 estimate; issue BoE, Schedule of Values, alternates, exclusions
- Tender reconciliation plan and bid-leveling sheets by CSI Division

**What the Codebase Has:**
- ❌ No Schedule of Values generator
- ❌ No bid-leveling tools
- ❌ No estimate freezing/versioning
- ❌ No alternate/option pricing

**Implementation Required:**

```
Priority: MEDIUM
Effort: ~8 hours

1. Schedule of Values Generator
   - Output: CSV/XLSX with trade-by-trade breakdown
   - Columns: Item#, CSI Division, Description, Value, % of Total
   - Suitable for contractor progress billing

2. Estimate Versioning
   - Snapshot current estimate as baseline
   - Track changes between versions (the create-baseline-snapshot.ts file exists!)
   - Version control: Draft → Under Review → Approved → Frozen

3. Alternate/Option Pricing
   - New interface: AlternatePrice {
       id, description, baseItems: string[], // CSI codes affected
       addDeductAmount: number,
       type: 'add'|'deduct'
     }
   - Common: VE options, material substitutions, scope reductions
```

---

## IMPLEMENTATION PRIORITY MATRIX

| Priority | Phase | Module | Effort | Impact |
|----------|-------|--------|--------|--------|
| **1** | 6 | Budget Layer Structure (8 layers above direct cost) | 8h | CRITICAL — without this the output isn't a professional estimate |
| **2** | 5 | Risk/Contingency/AACE classification | 12h | CRITICAL — every professional estimate needs contingency |
| **3** | 4 | Escalation module + preliminaries calculator | 10h | HIGH — direct cost without escalation is incomplete |
| **4** | 0 | UNIFORMAT mapping + element↔division cross-walk | 8h | HIGH — required for management reporting |
| **5** | 3 | Waste factors (simple multiplier per material) | 2h | HIGH — quick win, significant accuracy improvement |
| **6** | 2 | Code-driven cost adders + permitting fees | 10h | HIGH — regulatory costs are real costs |
| **7** | 1 | BoE generator + codes register | 12h | HIGH — professional deliverable requirement |
| **8** | 7 | Benchmarking + reconciliation checks | 6h | MEDIUM — validation layer |
| **9** | 8 | Schedule of Values + estimate versioning | 8h | MEDIUM — finalization tools |
| **10** | 4 | Vendor quote attachment + labor burden | 6h | LOW — refinement layer |

**Total Estimated Effort: ~82 hours (10-12 working days)**

---

## WHAT THE ENGINE DOES WELL (Keep & Build On)

These are **solid foundations** that align with Ricardo's process:

1. **212 CSI-coded rates** across all 34 MasterFormat divisions — ✅ Phase 0, 3
2. **Full L/M/E decomposition** per line item — ✅ Phase 4
3. **Classification chain** (226 keyword paths) — ✅ Phase 3
4. **Floor-by-floor grouping** with subtotals — ✅ Phase 3
5. **Data quality flags** ('estimated' when dimensions missing) — feeds Phase 0 (AACE class)
6. **Element IDs & evidence refs** per line item — ✅ Phase 3 audit trail
7. **Regional factors** (provincial adjustment) — ✅ Phase 4
8. **216-test QA suite** across 12 levels — ✅ Phase 7

The architecture is right. The QTO engine is professional grade. What's missing is everything ABOVE the direct cost line: the budget layers, risk/contingency, escalation, markups, BoE generation, UNIFORMAT mapping, and validation/benchmarking that turn raw QTO output into a professional Level 5 estimate.

---

## RECOMMENDED IMPLEMENTATION ORDER (Next 3 Sessions)

**Session 9: Budget Layers + Quick Wins (~4-6 hours)**
1. Waste factors (2h) — immediate accuracy gain
2. Budget Layer structure with 8 tiers (4h)
3. Basic contingency by AACE class

**Session 10: Risk/Escalation/Preliminaries (~6-8 hours)**
1. AACE classification system
2. Escalation module (date-driven)
3. Preliminaries calculator (duration-based)
4. Contingency system (class-based + risk register)

**Session 11: UNIFORMAT + BoE + Finalization (~6-8 hours)**
1. UNIFORMAT II mapping + cross-walk
2. BoE generator (auto-populated)
3. Codes & Standards Register template
4. Benchmark module
5. Schedule of Values generator

---

## REFERENCES

- AACE RP 18R-97 / 17R-97: Cost Estimate Classification System
- AACE RP 34R-05: Basis of Estimate
- RICS NRM1: Order of Cost Estimating and Cost Planning
- RICS NRM2: Detailed Measurement for Building Works
- CSI MasterFormat 2018
- ASTM E1557: UNIFORMAT II Classification
- ASTM E1804: Practice for Performing and Reporting Cost Analysis During Design
- NBC 2020 / OBC 2024 (Canadian/Ontario building codes)

---

*End of Implementation Guide v1.0*  
*QS Level 5 Process → EstimatorPro Codebase Gap Analysis*  
*82 hours estimated across 10 implementation priorities*
