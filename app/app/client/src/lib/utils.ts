import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Legacy formatting functions (kept for backward compatibility)
// These are now superseded by useProjectUnits hooks for automatic detection

export function formatCurrency(amount: number, country?: string): string {
  if (amount === 0) return "Not specified";
  
  const isUSA = country?.toLowerCase().includes('us') || country?.toLowerCase().includes('usa');
  
  if (isUSA) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  
  // Default to Canadian for all other countries
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatArea(area: number, country?: string): string {
  if (area === 0) return "Not specified";
  
  const isUSA = country?.toLowerCase().includes('us') || country?.toLowerCase().includes('usa');
  
  if (isUSA) {
    return `${area.toLocaleString()} ft²`;
  }
  
  // Default to metric for Canada and other countries
  return `${area.toLocaleString()} m²`;
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
