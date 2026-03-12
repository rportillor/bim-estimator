// server/compliance/rules-engine.ts
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import jsonLogic from "json-logic-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type Rule = {
  id: string;
  title: string;
  standard: "NBC"|"IBC"|"CSA"|"ASCE"|"ASTM";
  clause: string;
  logic: any;           // JSON-Logic expression
  factsNeeded: string[]; // e.g., ["fire_area_m2","sprinklered","occ_group"]
  severity?: "info"|"warn"|"fail";
};

export type ComplianceViolation = {
  ruleId: string;
  title: string;
  standard: string;
  clause: string;
  severity: "info" | "warn" | "fail";
  description: string;
  recommendation: string;
  missingFacts?: string[];
};

export function loadRulePack(pack: "NBC"|"IBC"|"CSA"|"ASCE"|"ASTM"): Rule[] {
  try {
    const file = path.join(__dirname, "rules", `${pack}.yml`);
    if (!fs.existsSync(file)) {
      console.warn(`⚠️ Rule pack ${pack}.yml not found`);
      return [];
    }
    const doc = yaml.load(fs.readFileSync(file, "utf8")) as { rules: Rule[] };
    console.log(`✅ Loaded ${doc.rules?.length || 0} rules from ${pack}`);
    return doc.rules || [];
  } catch (error) {
    console.error(`❌ Failed to load rule pack ${pack}:`, error);
    return [];
  }
}

export function loadAllRules(): Rule[] {
  const standards = ["NBC", "IBC", "CSA", "ASCE"] as const;
  let allRules: Rule[] = [];
  
  for (const standard of standards) {
    const rules = loadRulePack(standard);
    allRules = allRules.concat(rules);
  }
  
  console.log(`📋 Loaded total of ${allRules.length} compliance rules across ${standards.length} standards`);
  return allRules;
}

// Enhanced rule evaluation with detailed violation reporting
export function evaluateRules(facts: Record<string, any>, rules: Rule[]): {
  violations: ComplianceViolation[];
  passed: number;
  failed: number;
  warnings: number;
  coverage: number;
} {
  const violations: ComplianceViolation[] = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let rulesEvaluated = 0;
  
  for (const rule of rules) {
    // Check if we have all required facts
    if (!rule.factsNeeded || !Array.isArray(rule.factsNeeded)) {
      // Skip rules without factsNeeded defined
      continue;
    }
    
    const missingFacts = rule.factsNeeded.filter(fact => !(fact in facts));
    
    if (missingFacts.length > 0) {
      // Can't evaluate this rule - missing facts
      continue;
    }
    
    rulesEvaluated++;
    
    try {
      const compliant = !!jsonLogic.apply(rule.logic, facts);
      
      if (!compliant) {
        const severity = rule.severity || "fail";
        
        if (severity === "fail") failed++;
        else if (severity === "warn") warnings++;
        
        violations.push({
          ruleId: rule.id,
          title: rule.title,
          standard: rule.standard,
          clause: rule.clause,
          severity,
          description: generateViolationDescription(rule, facts),
          recommendation: generateRecommendation(rule, facts)
        });
      } else {
        passed++;
      }
    } catch (error: any) {
      console.error(`Error evaluating rule ${rule.id}:`, error);
      violations.push({
        ruleId: rule.id,
        title: rule.title,
        standard: rule.standard,
        clause: rule.clause,
        severity: "warn",
        description: `Failed to evaluate rule: ${error?.message || "Unknown error"}`,
        recommendation: "Review the building data for this compliance check"
      });
      warnings++;
    }
  }
  
  const coverage = rules.length > 0 ? (rulesEvaluated / rules.length) * 100 : 0;
  
  return {
    violations,
    passed,
    failed,
    warnings,
    coverage
  };
}

function generateViolationDescription(rule: Rule, facts: Record<string, any>): string {
  // Generate specific violation descriptions based on rule type
  const descriptions: Record<string, (r: Rule, f: Record<string, any>) => string> = {
    "nbc_3.2.5.12": (r, f) => `Automatic sprinkler system required. Building has fire area of ${f.fire_area_m2}m² (exceeds 2000m² limit) and height of ${f.building_height_m}m.`,
    "nbc_3.4.2.1": (r, f) => `Insufficient exits. Building has occupant load of ${f.occupant_load} but only ${f.number_of_exits} exit(s).`,
    "nbc_3.8.3.3": (r, f) => `Barrier-free path width of ${f.barrier_free_path_width_mm}mm is below minimum 920mm requirement.`,
    "ibc_903.2": (r, f) => `Automatic sprinkler system required for ${f.occupancy_group} occupancy with ${f.fire_area_sqft} sq.ft. fire area.`,
    "ibc_1006.2": (r, f) => `Building with occupant load of ${f.occupant_load} requires ${f.occupant_load > 1000 ? 4 : f.occupant_load > 500 ? 3 : 2} exits, but only has ${f.number_of_exits}.`,
    "csa_a23.1_6.2": (r, f) => `Concrete strength of ${f.concrete_fc_MPa}MPa insufficient for ${f.exposure_class} exposure class.`,
    "asce7_26.5": (r, f) => `Design wind speed of ${f.basic_wind_speed_mph}mph is below required ${f.location_wind_speed_mph}mph for this location.`
  };
  
  const generator = descriptions[rule.id];
  if (generator) {
    return generator(rule, facts);
  }
  
  // Generic description
  return `Non-compliance detected: ${rule.title} (${rule.standard} ${rule.clause})`;
}

function generateRecommendation(rule: Rule, facts: Record<string, any>): string {
  // Generate specific recommendations based on rule type
  const recommendations: Record<string, string> = {
    "nbc_3.2.5.12": "Install automatic sprinkler system throughout the building per NFPA 13 standards.",
    "nbc_3.4.2.1": "Add additional exit(s) to meet minimum requirements for the occupant load.",
    "nbc_3.8.3.3": "Widen barrier-free paths to minimum 920mm clear width.",
    "ibc_903.2": "Design and install NFPA 13 compliant automatic sprinkler system.",
    "ibc_1006.2": "Provide additional means of egress to meet code requirements.",
    "csa_a23.1_6.2": "Specify higher strength concrete mix to meet exposure class requirements.",
    "asce7_26.5": "Revise structural design for higher wind loads per local requirements."
  };
  
  return recommendations[rule.id] || `Review and update design to comply with ${rule.standard} ${rule.clause}.`;
}