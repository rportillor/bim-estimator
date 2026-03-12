export function mulberry32(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededFloat(seed: number, min=0, max=1) {
  const r = mulberry32(seed)();
  return min + r * (max - min);
}

export class PRNG {
  private generator: () => number;
  
  constructor(seed: string | number) {
    // Convert string seed to number if needed
    const numericSeed = typeof seed === 'string' 
      ? seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      : seed;
    this.generator = mulberry32(numericSeed);
  }
  
  next(): number {
    return this.generator();
  }
  
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  
  boolean(probability = 0.5): boolean {
    return this.next() < probability;
  }
}