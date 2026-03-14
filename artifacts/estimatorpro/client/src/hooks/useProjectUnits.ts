import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';

/**
 * Automatic country/unit detection hook for projects
 * Reads project data and automatically determines appropriate units and currency
 */
export function useProjectUnits() {
  const [location] = useLocation();
  
  // Extract project ID from URL
  const projectId = location.match(/\/projects\/([^/]+)/)?.[1];
  
  // Fetch project data to get country information
  const { data: project, isLoading } = useQuery({
    queryKey: ['/api/projects', projectId],
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  // Determine country and units automatically
  const country = (project as any)?.country || 'canada';
  const isUSA = country.toLowerCase().includes('us') || country.toLowerCase().includes('usa');
  
  return {
    country,
    isMetric: !isUSA,
    currency: isUSA ? 'USD' : 'CAD',
    locale: isUSA ? 'en-US' : 'en-CA',
    areaUnit: isUSA ? 'ft²' : 'm²',
    lengthUnit: isUSA ? 'ft' : 'm',
    volumeUnit: isUSA ? 'ft³' : 'm³',
    isLoading,
  };
}

/**
 * Automatic currency formatting based on project country
 */
export function useProjectCurrency() {
  const { currency, locale } = useProjectUnits();
  
  return (amount: number): string => {
    if (amount === 0) return "Not specified";
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
}

/**
 * Automatic area formatting based on project country
 */
export function useProjectArea() {
  const { areaUnit } = useProjectUnits();
  
  return (area: number): string => {
    if (area === 0) return "Not specified";
    return `${area.toLocaleString()} ${areaUnit}`;
  };
}