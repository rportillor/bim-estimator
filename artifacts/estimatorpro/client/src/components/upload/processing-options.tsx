import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield } from "lucide-react";

interface ProcessingOptionsProps {
  standard: string;
  onStandardChange: (value: string) => void;
}

export default function ProcessingOptions({ standard, onStandardChange }: ProcessingOptionsProps) {
  return (
    <Card className="border-blue-100 bg-blue-50/40">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
            <Shield className="h-5 w-5 text-blue-700" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <Label className="text-sm font-semibold text-gray-900">Construction Standards</Label>
              <p className="text-xs text-gray-500 mt-0.5">
                Controls which code references, pricing indices, and unit conventions the AI uses when reading your drawings.
              </p>
            </div>
            <Select value={standard} onValueChange={onStandardChange}>
              <SelectTrigger className="bg-white max-w-xs" data-testid="select-standards">
                <SelectValue placeholder="Select standards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CA">
                  <span className="flex flex-col">
                    <span className="font-medium">Canadian (NBC / CSA)</span>
                  </span>
                </SelectItem>
                <SelectItem value="US">
                  <span className="flex flex-col">
                    <span className="font-medium">US (IBC / ASTM / AISC)</span>
                  </span>
                </SelectItem>
                <SelectItem value="BOTH">
                  <span className="font-medium">Both Canadian & US</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              {standard === 'CA' && 'Pricing in CAD · metric units · NBC / OBC compliance · CSA material specs'}
              {standard === 'US' && 'Pricing in USD · imperial units · IBC compliance · ASTM / AISC specs'}
              {standard === 'BOTH' && 'Dual-standard analysis — useful for cross-border projects or cost comparisons'}
              {!standard && 'Choose the standard that matches your project location'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
