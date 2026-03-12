/**
 * 🔧 Assembly Logic Service
 * 
 * Converts individual materials into proper construction assemblies
 * following professional estimation practices
 */

export interface AssemblyComponent {
  material: string;
  quantity: number;
  unit: string;
  rate: number;
  subtotal: number;
  notes?: string;
}

export interface Assembly {
  id: string;
  name: string;
  description: string;
  baseUnit: string; // e.g., "100 SF" for wall assembly
  components: AssemblyComponent[];
  totalCost: number;
  csiCode?: string;
}

export class AssemblyLogicService {

  /**
   * 🎯 Convert raw materials into proper assemblies
   */
  processAssemblies(rawMaterials: any[]): Assembly[] {
    const assemblies: Assembly[] = [];
    
    // Group materials by assembly type
    const assemblyGroups = this.groupMaterialsByAssembly(rawMaterials);
    
    for (const [assemblyType, materials] of Object.entries(assemblyGroups)) {
      const assembly = this.createAssembly(assemblyType, materials);
      if (assembly) {
        assemblies.push(assembly);
      }
    }
    
    return assemblies;
  }

  /**
   * 🔧 Group materials into logical assemblies
   */
  private groupMaterialsByAssembly(materials: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};
    
    for (const material of materials) {
      const assemblyType = this.determineAssemblyType(material);
      
      if (!groups[assemblyType]) {
        groups[assemblyType] = [];
      }
      groups[assemblyType].push(material);
    }
    
    return groups;
  }

  /**
   * 🎯 Determine assembly type from material
   */
  private determineAssemblyType(material: any): string {
    const description = (material.description || material.name || '').toLowerCase();
    
    // Wall assemblies
    if (description.includes('gypsum') || description.includes('drywall')) {
      return 'wall_assembly';
    }
    
    // Floor assemblies  
    if (description.includes('underlayment') || description.includes('flooring')) {
      return 'floor_assembly';
    }
    
    // Fastener assemblies
    if (description.includes('screw') || description.includes('bolt') || description.includes('nail')) {
      return 'fastener_assembly';
    }
    
    // Concrete assemblies
    if (description.includes('concrete') || description.includes('precast')) {
      return 'concrete_assembly';
    }
    
    // Masonry assemblies
    if (description.includes('brick') || description.includes('masonry')) {
      return 'masonry_assembly';
    }
    
    return 'miscellaneous';
  }

  /**
   * 🏗️ Create proper assembly from grouped materials
   */
  private createAssembly(assemblyType: string, materials: any[]): Assembly | null {
    if (materials.length === 0) return null;
    
    switch (assemblyType) {
      case 'fastener_assembly':
        return this.createFastenerAssembly(materials);
      case 'wall_assembly':
        return this.createWallAssembly(materials);
      case 'floor_assembly':
        return this.createFloorAssembly(materials);
      default:
        return this.createGenericAssembly(assemblyType, materials);
    }
  }

  /**
   * 🔩 Create fastener assembly (fixes the screw issue!)
   */
  private createFastenerAssembly(materials: any[]): Assembly {
    const components: AssemblyComponent[] = materials.map(material => ({
      material: material.description || material.name,
      quantity: 0, // No quantity until user specifies assembly ratio
      unit: 'box', // Change from "ea" to "box" 
      rate: 0, // No cost until user inputs
      subtotal: 0,
      notes: 'Specify assembly ratio (e.g., 1 box per 100 sheets)'
    }));

    return {
      id: `assembly_fasteners_${Date.now()}`,
      name: 'Fastener Assembly',
      description: 'Self-drilling screws and bolts - specify assembly ratios',
      baseUnit: 'per assembly', // User defines the base (e.g., "per 100 SF wall")
      components,
      totalCost: 0,
      csiCode: '06 05 23' // Fasteners and supports
    };
  }

  /**
   * 🧱 Create wall assembly 
   */
  private createWallAssembly(materials: any[]): Assembly {
    const components: AssemblyComponent[] = materials.map(material => ({
      material: material.description || material.name,
      quantity: 0, // Will be calculated from wall area
      unit: this.getProperUnit(material, 'wall'),
      rate: 0, // User must input real rates
      subtotal: 0,
      notes: 'Cost per SF of wall area'
    }));

    return {
      id: `assembly_wall_${Date.now()}`,
      name: 'Wall Assembly',
      description: 'Complete wall system with all components',
      baseUnit: '100 SF', // Standard estimation unit
      components,
      totalCost: 0,
      csiCode: '06 10 00' // Wood framing
    };
  }

  /**
   * 🏢 Create floor assembly
   */
  private createFloorAssembly(materials: any[]): Assembly {
    const components: AssemblyComponent[] = materials.map(material => ({
      material: material.description || material.name,
      quantity: 0,
      unit: this.getProperUnit(material, 'floor'),
      rate: 0,
      subtotal: 0,
      notes: 'Cost per SF of floor area'
    }));

    return {
      id: `assembly_floor_${Date.now()}`,
      name: 'Floor Assembly',
      description: 'Complete floor system with underlayment and finishes',
      baseUnit: '100 SF',
      components,
      totalCost: 0,
      csiCode: '03 54 16' // Floor underlayment
    };
  }

  /**
   * 📦 Create generic assembly for other materials
   */
  private createGenericAssembly(assemblyType: string, materials: any[]): Assembly {
    const components: AssemblyComponent[] = materials.map(material => ({
      material: material.description || material.name,
      quantity: 0,
      unit: this.getProperUnit(material, assemblyType),
      rate: 0,
      subtotal: 0
    }));

    return {
      id: `assembly_${assemblyType}_${Date.now()}`,
      name: `${assemblyType.replace('_', ' ')} Assembly`,
      description: `${assemblyType.replace('_', ' ')} components`,
      baseUnit: 'per unit',
      components,
      totalCost: 0
    };
  }

  /**
   * 📏 Get proper unit for material in assembly context
   */
  private getProperUnit(material: any, assemblyType: string): string {
    const description = (material.description || material.name || '').toLowerCase();
    
    // Fasteners
    if (description.includes('screw') || description.includes('bolt')) {
      return 'box'; // Screws sold in boxes
    }
    
    // Area-based materials
    if (description.includes('drywall') || description.includes('gypsum') || 
        description.includes('insulation') || description.includes('sheathing')) {
      return 'SF';
    }
    
    // Volume-based materials
    if (description.includes('concrete') || description.includes('mortar')) {
      return 'CY';
    }
    
    // Linear materials
    if (description.includes('pipe') || description.includes('conduit') || 
        description.includes('wire') || description.includes('cable')) {
      return 'LF';
    }
    
    // Weight-based materials
    if (description.includes('steel') || description.includes('rebar')) {
      return 'LBS';
    }
    
    return 'EA';
  }
}