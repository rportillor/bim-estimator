import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface GridConfirmationDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detectedGrid?: {
    lettersAxis?: "x" | "y";
    numbersAxis?: "x" | "y";
    originLetter?: string;
    originNumber?: string;
    groundFloorName?: string;
    units?: "mm" | "m" | "ft-in";
    gridLetters?: string[];
    gridNumbers?: string[];
  };
  onConfirmed?: () => void;
}

type Axis = "x" | "y";
type UnitSystem = "mm" | "m" | "ft-in";

export function GridConfirmationDialog({
  projectId,
  open,
  onOpenChange,
  detectedGrid,
  onConfirmed,
}: GridConfirmationDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [lettersAxis, setLettersAxis] = useState<Axis>("x");
  const [originLetter, setOriginLetter] = useState("A");
  const [originNumber, setOriginNumber] = useState("1");
  const [groundFloorName, setGroundFloorName] = useState("Ground Floor");
  const [units, setUnits] = useState<UnitSystem>("mm");

  // Derive numbers axis from letters axis
  const numbersAxis: Axis = lettersAxis === "x" ? "y" : "x";

  // Sync defaults from detected grid whenever it changes or dialog opens
  useEffect(() => {
    if (!open) return;
    if (detectedGrid) {
      if (detectedGrid.lettersAxis) setLettersAxis(detectedGrid.lettersAxis);
      if (detectedGrid.originLetter) setOriginLetter(detectedGrid.originLetter);
      if (detectedGrid.originNumber) setOriginNumber(detectedGrid.originNumber);
      if (detectedGrid.groundFloorName) setGroundFloorName(detectedGrid.groundFloorName);
      if (detectedGrid.units) setUnits(detectedGrid.units);
    }
  }, [open, detectedGrid]);

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(
        `/api/projects/${projectId}/grid-config`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            lettersAxis,
            numbersAxis,
            originLetter: originLetter.trim().toUpperCase(),
            originNumber: originNumber.trim(),
            groundFloorName: groundFloorName.trim(),
            units,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Server returned ${response.status}`);
      }

      toast({
        title: "Grid configuration saved",
        description: "Element placement will use the confirmed grid settings.",
      });

      onOpenChange(false);
      onConfirmed?.();
    } catch (error) {
      toast({
        title: "Failed to save grid configuration",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const axisLabel = (axis: Axis) =>
    axis === "x" ? "X (left to right)" : "Y (bottom to top)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Confirm Grid Configuration</DialogTitle>
          <DialogDescription>
            Verify the structural grid orientation and origin before elements
            are placed. These settings control how extracted geometry maps to
            model coordinates.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {/* Letters axis */}
          <div className="grid gap-2">
            <Label htmlFor="letters-axis">
              Grid letters (A, B, C...) run along which axis?
            </Label>
            <Select
              value={lettersAxis}
              onValueChange={(v) => setLettersAxis(v as Axis)}
            >
              <SelectTrigger id="letters-axis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="x">X (left to right)</SelectItem>
                <SelectItem value="y">Y (bottom to top)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Numbers axis (auto-derived, read-only display) */}
          <div className="grid gap-2">
            <Label>Grid numbers (1, 2, 3...) run along which axis?</Label>
            <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
              {axisLabel(numbersAxis)}
            </div>
          </div>

          {/* Origin grid intersection */}
          <div className="grid gap-2">
            <Label>Origin grid intersection (0, 0)</Label>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="origin-letter" className="text-xs text-muted-foreground mb-1 block">
                  Letter
                </Label>
                <Input
                  id="origin-letter"
                  value={originLetter}
                  onChange={(e) => setOriginLetter(e.target.value)}
                  placeholder="A"
                  maxLength={4}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="origin-number" className="text-xs text-muted-foreground mb-1 block">
                  Number
                </Label>
                <Input
                  id="origin-number"
                  value={originNumber}
                  onChange={(e) => setOriginNumber(e.target.value)}
                  placeholder="1"
                  maxLength={4}
                />
              </div>
            </div>
          </div>

          {/* Ground floor name */}
          <div className="grid gap-2">
            <Label htmlFor="ground-floor">
              Which floor is ground level (Z=0)?
            </Label>
            <Input
              id="ground-floor"
              value={groundFloorName}
              onChange={(e) => setGroundFloorName(e.target.value)}
              placeholder="Ground Floor"
            />
          </div>

          {/* Unit system */}
          <div className="grid gap-2">
            <Label htmlFor="units">Drawing units</Label>
            <Select
              value={units}
              onValueChange={(v) => setUnits(v as UnitSystem)}
            >
              <SelectTrigger id="units">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mm">Millimeters (mm)</SelectItem>
                <SelectItem value="m">Meters (m)</SelectItem>
                <SelectItem value="ft-in">Feet-Inches (ft-in)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Detected grid info hint */}
          {detectedGrid?.gridLetters && detectedGrid.gridLetters.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Detected grid letters: {detectedGrid.gridLetters.join(", ")}
              {detectedGrid.gridNumbers && detectedGrid.gridNumbers.length > 0 && (
                <> | Numbers: {detectedGrid.gridNumbers.join(", ")}</>
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? "Saving..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
