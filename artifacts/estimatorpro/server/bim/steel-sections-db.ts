/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STEEL SECTIONS DATABASE — Standard structural steel profile lookup
 *  Maps section designations (W, HSS, L, C, etc.) to real cross-section
 *  dimensions for accurate 3D geometry and quantity take-off.
 *
 *  All dimensions stored in metres internally.
 *  Source data derived from AISC Steel Construction Manual and CISC Handbook.
 *
 *  Usage:
 *    const section = lookupSteelSection('W10x49');
 *    if (section) {
 *      // section.depth, section.flangeWidth, etc. — all in metres
 *    }
 *
 *  The database is extensible: call registerSteelSection() to add custom
 *  or regional sections at runtime.
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SectionShape = 'w-section' | 'hss-rect' | 'hss-round' | 'channel' | 'angle' | 'pipe' | 'tube';

export interface SteelSectionData {
  /** Canonical designation, e.g. "W10X49" (upper-cased, no spaces) */
  designation: string;
  /** Shape family */
  shape: SectionShape;
  /** Overall depth (metres) */
  depth: number;
  /** Flange width (metres) — for W, C, L shapes */
  flangeWidth: number;
  /** Web thickness (metres) */
  webThickness: number;
  /** Flange thickness (metres) */
  flangeThickness: number;
  /** Unit weight (kg/m) */
  weightPerMetre: number;
  /** Cross-section area (m²) */
  area: number;
  /** Outer width for HSS/pipe (metres) — equals flangeWidth for W sections */
  outerWidth?: number;
  /** Wall thickness for HSS/pipe (metres) */
  wallThickness?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UNIT CONVERSION HELPERS — keep raw data in imperial, convert on load
// ═══════════════════════════════════════════════════════════════════════════════

const IN_TO_M = 0.0254;            // inches → metres
const LB_PER_FT_TO_KG_PER_M = 1.48816;  // lb/ft → kg/m
const IN2_TO_M2 = IN_TO_M * IN_TO_M;

/** Build a W-section entry from imperial catalog values */
function w(
  designation: string,
  depthIn: number, flangeWidthIn: number, webThicknessIn: number,
  flangeThicknessIn: number, weightLbFt: number, areaIn2: number,
): SteelSectionData {
  return {
    designation: designation.toUpperCase().replace(/\s+/g, ''),
    shape: 'w-section',
    depth: depthIn * IN_TO_M,
    flangeWidth: flangeWidthIn * IN_TO_M,
    webThickness: webThicknessIn * IN_TO_M,
    flangeThickness: flangeThicknessIn * IN_TO_M,
    weightPerMetre: weightLbFt * LB_PER_FT_TO_KG_PER_M,
    area: areaIn2 * IN2_TO_M2,
  };
}

/** Build an HSS rectangular entry from imperial catalog values */
function hssRect(
  designation: string, depthIn: number, widthIn: number,
  wallIn: number, weightLbFt: number, areaIn2: number,
): SteelSectionData {
  return {
    designation: designation.toUpperCase().replace(/\s+/g, ''),
    shape: 'hss-rect',
    depth: depthIn * IN_TO_M,
    flangeWidth: widthIn * IN_TO_M,
    webThickness: wallIn * IN_TO_M,
    flangeThickness: wallIn * IN_TO_M,
    weightPerMetre: weightLbFt * LB_PER_FT_TO_KG_PER_M,
    area: areaIn2 * IN2_TO_M2,
    outerWidth: widthIn * IN_TO_M,
    wallThickness: wallIn * IN_TO_M,
  };
}

/** Build an HSS round / pipe entry from imperial catalog values */
function hssRound(
  designation: string, outerDiaIn: number, wallIn: number,
  weightLbFt: number, areaIn2: number,
): SteelSectionData {
  return {
    designation: designation.toUpperCase().replace(/\s+/g, ''),
    shape: 'hss-round',
    depth: outerDiaIn * IN_TO_M,
    flangeWidth: outerDiaIn * IN_TO_M,
    webThickness: wallIn * IN_TO_M,
    flangeThickness: wallIn * IN_TO_M,
    weightPerMetre: weightLbFt * LB_PER_FT_TO_KG_PER_M,
    area: areaIn2 * IN2_TO_M2,
    outerWidth: outerDiaIn * IN_TO_M,
    wallThickness: wallIn * IN_TO_M,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION DATABASE — Common W-shapes, HSS, and pipes
//  Values from AISC 15th Edition / CISC 11th Edition
//  Format: designation, depth(in), bf(in), tw(in), tf(in), wt(lb/ft), A(in²)
// ═══════════════════════════════════════════════════════════════════════════════

const SECTIONS: SteelSectionData[] = [
  // ── W-SHAPES (Wide Flange) ──────────────────────────────────────────────
  // W44
  w('W44X335', 44.02, 15.945, 1.025, 1.770, 335, 98.5),
  w('W44X290', 43.62, 15.825, 0.865, 1.580, 290, 85.4),
  w('W44X262', 43.31, 15.750, 0.785, 1.415, 262, 76.9),
  w('W44X230', 42.91, 15.750, 0.710, 1.220, 230, 67.8),
  // W40
  w('W40X593', 43.00, 16.690, 1.790, 2.990, 593, 174),
  w('W40X503', 42.05, 16.415, 1.535, 2.560, 503, 148),
  w('W40X397', 41.05, 16.120, 1.220, 2.050, 397, 117),
  w('W40X331', 40.38, 15.945, 1.025, 1.735, 331, 97.5),
  w('W40X278', 39.69, 15.865, 0.875, 1.440, 278, 82.0),
  w('W40X249', 39.38, 15.750, 0.780, 1.300, 249, 73.3),
  w('W40X215', 39.00, 15.750, 0.650, 1.220, 215, 63.5),
  w('W40X199', 38.67, 15.750, 0.650, 1.065, 199, 58.8),
  w('W40X183', 38.98, 11.810, 0.650, 1.065, 183, 54.1),
  w('W40X167', 38.59, 11.810, 0.650, 0.855, 167, 49.3),
  w('W40X149', 38.20, 11.810, 0.630, 0.680, 149, 43.8),
  // W36
  w('W36X652', 41.13, 17.575, 1.970, 3.540, 652, 192),
  w('W36X529', 39.78, 17.220, 1.610, 2.910, 529, 155),
  w('W36X395', 38.37, 16.830, 1.220, 2.200, 395, 116),
  w('W36X361', 38.00, 16.730, 1.120, 2.010, 361, 106),
  w('W36X302', 37.33, 16.655, 0.945, 1.680, 302, 89.0),
  w('W36X262', 36.85, 16.550, 0.840, 1.440, 262, 77.2),
  w('W36X231', 36.49, 16.470, 0.760, 1.260, 231, 67.7),
  w('W36X194', 36.49, 12.115, 0.765, 1.260, 194, 57.0),
  w('W36X182', 36.33, 12.075, 0.725, 1.180, 182, 53.6),
  w('W36X170', 36.17, 12.030, 0.680, 1.100, 170, 50.0),
  w('W36X160', 36.01, 12.000, 0.650, 1.020, 160, 47.0),
  w('W36X150', 35.85, 11.975, 0.625, 0.940, 150, 44.2),
  w('W36X135', 35.55, 11.950, 0.600, 0.790, 135, 39.7),
  // W33
  w('W33X387', 36.01, 16.200, 1.260, 2.280, 387, 114),
  w('W33X354', 35.55, 16.100, 1.160, 2.090, 354, 104),
  w('W33X291', 34.84, 15.860, 0.960, 1.730, 291, 85.7),
  w('W33X241', 34.18, 15.860, 0.830, 1.400, 241, 71.1),
  w('W33X201', 33.68, 15.745, 0.715, 1.150, 201, 59.1),
  w('W33X169', 33.82, 11.500, 0.670, 1.220, 169, 49.5),
  w('W33X152', 33.49, 11.565, 0.635, 1.055, 152, 44.7),
  w('W33X130', 33.09, 11.510, 0.580, 0.855, 130, 38.3),
  w('W33X118', 32.86, 11.480, 0.550, 0.740, 118, 34.7),
  // W30
  w('W30X391', 33.19, 15.590, 1.360, 2.440, 391, 115),
  w('W30X357', 32.80, 15.470, 1.240, 2.240, 357, 105),
  w('W30X292', 32.01, 15.250, 1.020, 1.850, 292, 86.0),
  w('W30X261', 31.61, 15.155, 0.930, 1.650, 261, 76.7),
  w('W30X211', 30.94, 15.105, 0.775, 1.315, 211, 62.3),
  w('W30X191', 30.68, 15.040, 0.710, 1.185, 191, 56.3),
  w('W30X173', 30.44, 14.985, 0.655, 1.065, 173, 50.8),
  w('W30X148', 30.67, 10.480, 0.650, 1.180, 148, 43.5),
  w('W30X132', 30.31, 10.545, 0.615, 1.000, 132, 38.8),
  w('W30X124', 30.17, 10.515, 0.585, 0.930, 124, 36.5),
  w('W30X116', 30.01, 10.495, 0.565, 0.850, 116, 34.2),
  w('W30X108', 29.83, 10.475, 0.545, 0.760, 108, 31.7),
  w('W30X99',  29.65, 10.450, 0.520, 0.670, 99, 29.1),
  w('W30X90',  29.53, 10.400, 0.470, 0.610, 90, 26.3),
  // W27
  w('W27X539', 32.52, 15.265, 1.970, 3.540, 539, 159),
  w('W27X368', 30.39, 14.725, 1.380, 2.480, 368, 108),
  w('W27X281', 29.29, 14.440, 1.060, 1.930, 281, 82.9),
  w('W27X235', 28.66, 14.190, 0.910, 1.610, 235, 69.4),
  w('W27X194', 28.11, 14.035, 0.750, 1.340, 194, 57.1),
  w('W27X178', 27.81, 14.085, 0.725, 1.190, 178, 52.5),
  w('W27X161', 27.59, 14.020, 0.660, 1.080, 161, 47.6),
  w('W27X146', 27.38, 13.965, 0.605, 0.975, 146, 42.9),
  w('W27X129', 27.63, 10.010, 0.610, 1.105, 129, 37.8),
  w('W27X114', 27.29, 10.070, 0.570, 0.930, 114, 33.5),
  w('W27X102', 27.09, 10.015, 0.515, 0.830, 102, 30.0),
  w('W27X94',  26.92, 9.990, 0.490, 0.745, 94, 27.7),
  w('W27X84',  26.71, 9.960, 0.460, 0.640, 84, 24.8),
  // W24
  w('W24X370', 28.00, 13.660, 1.520, 2.720, 370, 109),
  w('W24X306', 27.13, 13.405, 1.260, 2.280, 306, 89.8),
  w('W24X250', 26.34, 13.185, 1.040, 1.890, 250, 73.5),
  w('W24X192', 25.47, 12.950, 0.810, 1.460, 192, 56.3),
  w('W24X162', 25.00, 12.955, 0.705, 1.220, 162, 47.7),
  w('W24X146', 24.74, 12.900, 0.650, 1.090, 146, 43.0),
  w('W24X131', 24.48, 12.855, 0.605, 0.960, 131, 38.5),
  w('W24X117', 24.26, 12.800, 0.550, 0.850, 117, 34.4),
  w('W24X104', 24.06, 12.750, 0.500, 0.750, 104, 30.6),
  w('W24X103', 24.53, 9.000, 0.550, 0.980, 103, 30.3),
  w('W24X94',  24.31, 9.065, 0.515, 0.875, 94, 27.7),
  w('W24X84',  24.10, 9.020, 0.470, 0.770, 84, 24.7),
  w('W24X76',  23.92, 8.990, 0.440, 0.680, 76, 22.4),
  w('W24X68',  23.73, 8.965, 0.415, 0.585, 68, 20.1),
  w('W24X62',  23.74, 7.040, 0.430, 0.590, 62, 18.2),
  w('W24X55',  23.57, 7.005, 0.395, 0.505, 55, 16.2),
  // W21
  w('W21X201', 23.03, 12.575, 0.910, 1.630, 201, 59.2),
  w('W21X182', 22.72, 12.500, 0.830, 1.480, 182, 53.6),
  w('W21X166', 22.48, 12.420, 0.750, 1.360, 166, 48.8),
  w('W21X147', 22.06, 12.510, 0.720, 1.150, 147, 43.2),
  w('W21X132', 21.83, 12.440, 0.650, 1.035, 132, 38.8),
  w('W21X122', 21.68, 12.390, 0.600, 0.960, 122, 35.9),
  w('W21X111', 21.51, 12.340, 0.550, 0.875, 111, 32.6),
  w('W21X101', 21.36, 12.290, 0.500, 0.800, 101, 29.8),
  w('W21X93',  21.62, 8.420, 0.580, 0.930, 93, 27.3),
  w('W21X83',  21.43, 8.355, 0.515, 0.835, 83, 24.3),
  w('W21X73',  21.24, 8.295, 0.455, 0.740, 73, 21.5),
  w('W21X68',  21.13, 8.270, 0.430, 0.685, 68, 20.0),
  w('W21X62',  20.99, 8.240, 0.400, 0.615, 62, 18.3),
  w('W21X57',  21.06, 6.555, 0.405, 0.650, 57, 16.7),
  w('W21X50',  20.83, 6.530, 0.380, 0.535, 50, 14.7),
  w('W21X48',  20.62, 8.140, 0.350, 0.520, 48, 14.1),
  w('W21X44',  20.66, 6.500, 0.350, 0.450, 44, 13.0),
  // W18
  w('W18X311', 22.32, 12.005, 1.520, 2.740, 311, 91.5),
  w('W18X258', 21.46, 11.770, 1.280, 2.300, 258, 75.9),
  w('W18X211', 20.67, 11.555, 1.060, 1.910, 211, 62.1),
  w('W18X175', 20.04, 11.375, 0.890, 1.590, 175, 51.3),
  w('W18X143', 19.49, 11.220, 0.730, 1.320, 143, 42.0),
  w('W18X130', 19.25, 11.160, 0.670, 1.200, 130, 38.2),
  w('W18X119', 18.97, 11.265, 0.655, 1.060, 119, 35.1),
  w('W18X106', 18.73, 11.200, 0.590, 0.940, 106, 31.1),
  w('W18X97',  18.59, 11.145, 0.535, 0.870, 97, 28.5),
  w('W18X86',  18.39, 11.090, 0.480, 0.770, 86, 25.3),
  w('W18X76',  18.21, 11.035, 0.425, 0.680, 76, 22.3),
  w('W18X71',  18.47, 7.635, 0.495, 0.810, 71, 20.8),
  w('W18X65',  18.35, 7.590, 0.450, 0.750, 65, 19.1),
  w('W18X60',  18.24, 7.555, 0.415, 0.695, 60, 17.6),
  w('W18X55',  18.11, 7.530, 0.390, 0.630, 55, 16.2),
  w('W18X50',  17.99, 7.495, 0.355, 0.570, 50, 14.7),
  w('W18X46',  18.06, 6.060, 0.360, 0.605, 46, 13.5),
  w('W18X40',  17.90, 6.015, 0.315, 0.525, 40, 11.8),
  w('W18X35',  17.70, 6.000, 0.300, 0.425, 35, 10.3),
  // W16
  w('W16X100', 16.97, 10.425, 0.585, 0.985, 100, 29.5),
  w('W16X89',  16.75, 10.365, 0.525, 0.875, 89, 26.2),
  w('W16X77',  16.52, 10.295, 0.455, 0.760, 77, 22.6),
  w('W16X67',  16.33, 10.235, 0.395, 0.665, 67, 19.6),
  w('W16X57',  16.43, 7.120, 0.430, 0.715, 57, 16.8),
  w('W16X50',  16.26, 7.070, 0.380, 0.630, 50, 14.7),
  w('W16X45',  16.13, 7.035, 0.345, 0.565, 45, 13.3),
  w('W16X40',  16.01, 6.995, 0.305, 0.505, 40, 11.8),
  w('W16X36',  15.86, 6.985, 0.295, 0.430, 36, 10.6),
  w('W16X31',  15.88, 5.525, 0.275, 0.440, 31, 9.12),
  w('W16X26',  15.69, 5.500, 0.250, 0.345, 26, 7.68),
  // W14
  w('W14X730', 22.42, 17.890, 3.070, 4.910, 730, 215),
  w('W14X605', 20.92, 17.415, 2.595, 4.160, 605, 178),
  w('W14X500', 19.60, 17.010, 2.190, 3.500, 500, 147),
  w('W14X426', 18.67, 16.695, 1.875, 3.035, 426, 125),
  w('W14X370', 17.92, 16.475, 1.655, 2.660, 370, 109),
  w('W14X311', 17.12, 16.230, 1.410, 2.260, 311, 91.4),
  w('W14X257', 16.38, 15.995, 1.175, 1.890, 257, 75.6),
  w('W14X233', 16.04, 15.890, 1.070, 1.720, 233, 68.5),
  w('W14X211', 15.72, 15.800, 0.980, 1.560, 211, 62.0),
  w('W14X193', 15.48, 15.710, 0.890, 1.440, 193, 56.8),
  w('W14X176', 15.22, 15.650, 0.830, 1.310, 176, 51.8),
  w('W14X159', 14.98, 15.565, 0.745, 1.190, 159, 46.7),
  w('W14X145', 14.78, 15.500, 0.680, 1.090, 145, 42.7),
  w('W14X132', 14.66, 14.725, 0.645, 1.030, 132, 38.8),
  w('W14X120', 14.48, 14.670, 0.590, 0.940, 120, 35.3),
  w('W14X109', 14.32, 14.605, 0.525, 0.860, 109, 32.0),
  w('W14X99',  14.16, 14.565, 0.485, 0.780, 99, 29.1),
  w('W14X90',  14.02, 14.520, 0.440, 0.710, 90, 26.5),
  w('W14X82',  14.31, 10.130, 0.510, 0.855, 82, 24.0),
  w('W14X74',  14.17, 10.070, 0.450, 0.785, 74, 21.8),
  w('W14X68',  14.04, 10.035, 0.415, 0.720, 68, 20.0),
  w('W14X61',  13.89, 9.995, 0.375, 0.645, 61, 17.9),
  w('W14X53',  13.92, 8.060, 0.370, 0.660, 53, 15.6),
  w('W14X48',  13.79, 8.030, 0.340, 0.595, 48, 14.1),
  w('W14X43',  13.66, 7.995, 0.305, 0.530, 43, 12.6),
  w('W14X38',  14.10, 6.770, 0.310, 0.515, 38, 11.2),
  w('W14X34',  13.98, 6.745, 0.285, 0.455, 34, 10.0),
  w('W14X30',  13.84, 6.730, 0.270, 0.385, 30, 8.85),
  w('W14X26',  13.91, 5.025, 0.255, 0.420, 26, 7.69),
  w('W14X22',  13.74, 5.000, 0.230, 0.335, 22, 6.49),
  // W12
  w('W12X336', 16.82, 13.385, 1.775, 2.955, 336, 98.8),
  w('W12X279', 15.85, 13.140, 1.530, 2.470, 279, 81.9),
  w('W12X230', 15.05, 12.895, 1.285, 2.070, 230, 67.7),
  w('W12X190', 14.38, 12.670, 1.060, 1.735, 190, 56.0),
  w('W12X170', 14.03, 12.570, 0.960, 1.560, 170, 50.0),
  w('W12X152', 13.71, 12.480, 0.870, 1.400, 152, 44.7),
  w('W12X136', 13.41, 12.400, 0.790, 1.250, 136, 39.9),
  w('W12X120', 13.12, 12.320, 0.710, 1.105, 120, 35.3),
  w('W12X106', 12.89, 12.220, 0.610, 0.990, 106, 31.2),
  w('W12X96',  12.71, 12.160, 0.550, 0.900, 96, 28.2),
  w('W12X87',  12.53, 12.125, 0.515, 0.810, 87, 25.6),
  w('W12X79',  12.38, 12.080, 0.470, 0.735, 79, 23.2),
  w('W12X72',  12.25, 12.040, 0.430, 0.670, 72, 21.1),
  w('W12X65',  12.12, 12.000, 0.390, 0.605, 65, 19.1),
  w('W12X58',  12.19, 10.010, 0.360, 0.640, 58, 17.0),
  w('W12X53',  12.06, 9.995, 0.345, 0.575, 53, 15.6),
  w('W12X50',  12.19, 8.080, 0.370, 0.640, 50, 14.6),
  w('W12X45',  12.06, 8.045, 0.335, 0.575, 45, 13.1),
  w('W12X40',  11.94, 8.005, 0.295, 0.515, 40, 11.7),
  w('W12X35',  12.50, 6.560, 0.300, 0.520, 35, 10.3),
  w('W12X30',  12.34, 6.520, 0.260, 0.440, 30, 8.79),
  w('W12X26',  12.22, 6.490, 0.230, 0.380, 26, 7.65),
  w('W12X22',  12.31, 4.030, 0.260, 0.425, 22, 6.48),
  w('W12X19',  12.16, 4.005, 0.235, 0.350, 19, 5.57),
  w('W12X16',  11.99, 3.990, 0.220, 0.265, 16, 4.71),
  w('W12X14',  11.91, 3.970, 0.200, 0.225, 14, 4.16),
  // W10
  w('W10X112', 11.36, 10.415, 0.755, 1.250, 112, 32.9),
  w('W10X100', 11.10, 10.340, 0.680, 1.120, 100, 29.3),
  w('W10X88',  10.84, 10.265, 0.605, 0.990, 88, 25.9),
  w('W10X77',  10.60, 10.190, 0.530, 0.870, 77, 22.7),
  w('W10X68',  10.40, 10.130, 0.470, 0.770, 68, 20.0),
  w('W10X60',  10.22, 10.080, 0.420, 0.680, 60, 17.6),
  w('W10X54',  10.09, 10.030, 0.370, 0.615, 54, 15.8),
  w('W10X49',  9.98, 10.000, 0.340, 0.560, 49, 14.4),
  w('W10X45',  10.10, 8.020, 0.350, 0.620, 45, 13.3),
  w('W10X39',  9.92, 7.985, 0.315, 0.530, 39, 11.5),
  w('W10X33',  9.73, 7.960, 0.290, 0.435, 33, 9.71),
  w('W10X30',  10.47, 5.810, 0.300, 0.510, 30, 8.84),
  w('W10X26',  10.33, 5.770, 0.260, 0.440, 26, 7.61),
  w('W10X22',  10.17, 5.750, 0.240, 0.360, 22, 6.49),
  w('W10X19',  10.24, 4.020, 0.250, 0.395, 19, 5.62),
  w('W10X17',  10.11, 4.010, 0.240, 0.330, 17, 4.99),
  w('W10X15',  9.99, 4.000, 0.230, 0.270, 15, 4.41),
  w('W10X12',  9.87, 3.960, 0.190, 0.210, 12, 3.54),
  // W8
  w('W8X67',   9.00, 8.280, 0.570, 0.935, 67, 19.7),
  w('W8X58',   8.75, 8.220, 0.510, 0.810, 58, 17.1),
  w('W8X48',   8.50, 8.110, 0.400, 0.685, 48, 14.1),
  w('W8X40',   8.25, 8.070, 0.360, 0.560, 40, 11.7),
  w('W8X35',   8.12, 8.020, 0.310, 0.495, 35, 10.3),
  w('W8X31',   8.00, 7.995, 0.285, 0.435, 31, 9.13),
  w('W8X28',   8.06, 6.535, 0.285, 0.465, 28, 8.24),
  w('W8X24',   7.93, 6.495, 0.245, 0.400, 24, 7.08),
  w('W8X21',   8.28, 5.270, 0.250, 0.400, 21, 6.16),
  w('W8X18',   8.14, 5.250, 0.230, 0.330, 18, 5.26),
  w('W8X15',   8.11, 4.015, 0.245, 0.315, 15, 4.44),
  w('W8X13',   7.99, 4.000, 0.230, 0.255, 13, 3.84),
  w('W8X10',   7.89, 3.940, 0.170, 0.205, 10, 2.96),
  // W6
  w('W6X25',   6.38, 6.080, 0.320, 0.455, 25, 7.34),
  w('W6X20',   6.20, 6.020, 0.260, 0.365, 20, 5.87),
  w('W6X15',   5.99, 5.990, 0.230, 0.260, 15, 4.43),
  w('W6X16',   6.28, 4.030, 0.260, 0.405, 16, 4.74),
  w('W6X12',   6.03, 4.000, 0.230, 0.280, 12, 3.55),
  w('W6X9',    5.90, 3.940, 0.170, 0.215, 9, 2.68),
  // W5
  w('W5X19',   5.15, 5.030, 0.270, 0.430, 19, 5.56),
  w('W5X16',   5.01, 5.000, 0.240, 0.360, 16, 4.71),
  // W4
  w('W4X13',   4.16, 4.060, 0.280, 0.345, 13, 3.83),

  // ── HSS RECTANGULAR ─────────────────────────────────────────────────────
  hssRect('HSS12X12X5/8',  12, 12, 0.581, 76.07, 22.4),
  hssRect('HSS12X12X1/2',  12, 12, 0.465, 62.46, 18.4),
  hssRect('HSS12X12X3/8',  12, 12, 0.349, 48.86, 14.4),
  hssRect('HSS10X10X5/8',  10, 10, 0.581, 62.46, 18.4),
  hssRect('HSS10X10X1/2',  10, 10, 0.465, 48.86, 14.4),
  hssRect('HSS10X10X3/8',  10, 10, 0.349, 35.24, 10.4),
  hssRect('HSS10X10X1/4',  10, 10, 0.233, 24.73, 7.10),
  hssRect('HSS8X8X5/8',    8,  8,  0.581, 48.85, 14.4),
  hssRect('HSS8X8X1/2',    8,  8,  0.465, 42.05, 12.4),
  hssRect('HSS8X8X3/8',    8,  8,  0.349, 32.58, 9.60),
  hssRect('HSS8X8X1/4',    8,  8,  0.233, 21.63, 6.37),
  hssRect('HSS8X6X1/2',    8,  6,  0.465, 35.24, 10.4),
  hssRect('HSS8X6X3/8',    8,  6,  0.349, 27.48, 8.10),
  hssRect('HSS8X6X1/4',    8,  6,  0.233, 18.99, 5.60),
  hssRect('HSS8X4X1/2',    8,  4,  0.465, 28.43, 8.37),
  hssRect('HSS8X4X3/8',    8,  4,  0.349, 22.37, 6.59),
  hssRect('HSS8X4X1/4',    8,  4,  0.233, 15.62, 4.60),
  hssRect('HSS6X6X5/8',    6,  6,  0.581, 35.24, 10.4),
  hssRect('HSS6X6X1/2',    6,  6,  0.465, 28.43, 8.37),
  hssRect('HSS6X6X3/8',    6,  6,  0.349, 21.63, 6.37),
  hssRect('HSS6X6X1/4',    6,  6,  0.233, 15.62, 4.60),
  hssRect('HSS6X4X1/2',    6,  4,  0.465, 21.63, 6.37),
  hssRect('HSS6X4X3/8',    6,  4,  0.349, 16.96, 5.00),
  hssRect('HSS6X4X1/4',    6,  4,  0.233, 12.21, 3.60),
  hssRect('HSS4X4X1/2',    4,  4,  0.465, 14.83, 4.37),
  hssRect('HSS4X4X3/8',    4,  4,  0.349, 12.21, 3.60),
  hssRect('HSS4X4X1/4',    4,  4,  0.233, 8.81,  2.60),
  hssRect('HSS4X4X3/16',   4,  4,  0.174, 6.87,  2.02),

  // ── HSS ROUND ───────────────────────────────────────────────────────────
  hssRound('HSS16X0.500', 16, 0.465, 24.73, 22.7),
  hssRound('HSS16X0.375', 16, 0.349, 19.02, 17.5),
  hssRound('HSS14X0.500', 14, 0.465, 21.63, 19.8),
  hssRound('HSS14X0.375', 14, 0.349, 16.60, 15.2),
  hssRound('HSS12.750X0.500', 12.75, 0.465, 19.02, 17.9),
  hssRound('HSS12.750X0.375', 12.75, 0.349, 14.58, 14.4),
  hssRound('HSS10.750X0.500', 10.75, 0.465, 16.15, 15.0),
  hssRound('HSS10.750X0.250', 10.75, 0.233, 8.25, 7.72),
  hssRound('HSS8.625X0.500',  8.625, 0.465, 12.76, 11.9),
  hssRound('HSS8.625X0.322',  8.625, 0.300, 8.40, 7.85),
  hssRound('HSS8.625X0.250',  8.625, 0.233, 6.57, 6.14),
  hssRound('HSS6.625X0.500',  6.625, 0.465, 9.62, 8.97),
  hssRound('HSS6.625X0.280',  6.625, 0.259, 5.62, 5.19),
  hssRound('HSS6.625X0.250',  6.625, 0.233, 5.07, 4.73),
  hssRound('HSS5.563X0.375',  5.563, 0.349, 6.04, 5.71),
  hssRound('HSS5.563X0.258',  5.563, 0.238, 4.25, 3.97),
  hssRound('HSS4.500X0.337',  4.500, 0.313, 4.71, 4.11),
  hssRound('HSS4.500X0.237',  4.500, 0.218, 3.40, 2.97),
  hssRound('HSS3.500X0.300',  3.500, 0.276, 3.24, 2.80),
  hssRound('HSS3.500X0.216',  3.500, 0.196, 2.41, 2.07),
];

// ═══════════════════════════════════════════════════════════════════════════════
//  LOOKUP INDEX — built once from SECTIONS array for O(1) lookups
// ═══════════════════════════════════════════════════════════════════════════════

const sectionIndex = new Map<string, SteelSectionData>();

function rebuildIndex(): void {
  sectionIndex.clear();
  for (const s of SECTIONS) {
    sectionIndex.set(s.designation, s);
  }
}

// Build index on module load
rebuildIndex();

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a section designation to the canonical form used in the index.
 * Handles common user input variations:
 *   "W10 x 49" → "W10X49"
 *   "w 10x49"  → "W10X49"
 *   "HSS 6x6x3/8" → "HSS6X6X3/8"
 */
export function normalizeSectionName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')       // strip spaces
    .replace(/×/g, 'X')       // unicode multiply sign → X
    .replace(/\*/g, 'X');     // asterisk → X
}

/**
 * Look up a steel section by designation.
 * Returns the section data (all dimensions in metres) or null if not found.
 *
 * Accepts common variations: "W10x49", "W10 X 49", "w10x49", etc.
 */
export function lookupSteelSection(designation: string): SteelSectionData | null {
  const key = normalizeSectionName(designation);
  return sectionIndex.get(key) || null;
}

/**
 * Try to extract a section designation from a free-text name/description.
 * Looks for patterns like "W10x49", "HSS6x6x3/8", "W 14 X 22", etc.
 * Returns the normalized designation or null if none found.
 */
export function parseSectionFromText(text: string): string | null {
  if (!text) return null;

  // W-shape: W followed by number, then x/X, then number
  const wMatch = text.match(/\bW\s*(\d+)\s*[xX×*]\s*(\d+)\b/i);
  if (wMatch) {
    const candidate = `W${wMatch[1]}X${wMatch[2]}`;
    if (sectionIndex.has(candidate)) return candidate;
  }

  // HSS rectangular: HSS + num x num x fraction-or-decimal
  const hssRectMatch = text.match(/\bHSS\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+\/\d+|\d+\.\d+)/i);
  if (hssRectMatch) {
    const candidate = normalizeSectionName(`HSS${hssRectMatch[1]}X${hssRectMatch[2]}X${hssRectMatch[3]}`);
    if (sectionIndex.has(candidate)) return candidate;
  }

  // HSS round: HSS + num x 0.xxx
  const hssRoundMatch = text.match(/\bHSS\s*(\d+(?:\.\d+)?)\s*[xX×*]\s*(0\.\d+)/i);
  if (hssRoundMatch) {
    const candidate = normalizeSectionName(`HSS${hssRoundMatch[1]}X${hssRoundMatch[2]}`);
    if (sectionIndex.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Register a custom steel section at runtime.
 * Use this to add regional or project-specific sections.
 */
export function registerSteelSection(section: SteelSectionData): void {
  const normalized = { ...section, designation: normalizeSectionName(section.designation) };
  SECTIONS.push(normalized);
  sectionIndex.set(normalized.designation, normalized);
}

/**
 * Get all available section designations (for autocomplete, validation, etc.).
 */
export function getAllSectionDesignations(): string[] {
  return Array.from(sectionIndex.keys());
}

/**
 * Get all sections matching a shape type.
 */
export function getSectionsByShape(shape: SectionShape): SteelSectionData[] {
  return SECTIONS.filter(s => s.shape === shape);
}
