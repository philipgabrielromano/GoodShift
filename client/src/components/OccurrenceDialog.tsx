import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateOccurrence } from "@/hooks/use-occurrences";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Loader2, AlertTriangle, Upload, FileText, X, Check } from "lucide-react";
import { ABSENCE_REASONS } from "@shared/schema";

interface OccurrenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
  occurrenceDate: string;
}

const OCCURRENCE_TYPES = [
  { value: "half", label: "Half Occurrence (0.5)", points: 50 },
  { value: "full", label: "Full Occurrence (1.0)", points: 100 },
  { value: "ncns", label: "No Call/No Show (1.0 + Warning)", points: 100 },
];

export function OccurrenceDialog({ isOpen, onClose, employeeId, employeeName, occurrenceDate }: OccurrenceDialogProps) {
  const createOccurrence = useCreateOccurrence();
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload({
    onError: (error) => {
      toast({ 
        title: "Upload Error", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [occurrenceType, setOccurrenceType] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isFmla, setIsFmla] = useState<boolean>(false);
  const [isConsecutiveSickness, setIsConsecutiveSickness] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedDocumentUrl, setUploadedDocumentUrl] = useState<string | null>(null);

  const selectedReason = ABSENCE_REASONS.find(r => r.value === reason);
  const notesAvailable = selectedReason?.notesAvailable ?? false;

  useEffect(() => {
    if (isOpen) {
      setOccurrenceType("");
      setReason("");
      setNotes("");
      setIsFmla(false);
      setIsConsecutiveSickness(false);
      setSelectedFile(null);
      setUploadedDocumentUrl(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!notesAvailable) {
      setNotes("");
    }
  }, [notesAvailable]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast({ 
        title: "Invalid file type", 
        description: "Please select a PDF file only.", 
        variant: "destructive" 
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ 
        title: "File too large", 
        description: "Maximum file size is 10MB.", 
        variant: "destructive" 
      });
      return;
    }

    setSelectedFile(file);
    setUploadedDocumentUrl(null);
  };

  const handleUploadDocument = async () => {
    if (!selectedFile) return;

    const response = await uploadFile(selectedFile);
    if (response) {
      setUploadedDocumentUrl(response.objectPath);
      toast({ 
        title: "Document uploaded", 
        description: "PDF attached successfully." 
      });
    }
  };

  const handleRemoveDocument = () => {
    setSelectedFile(null);
    setUploadedDocumentUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!occurrenceType) {
      toast({ title: "Error", description: "Please select an occurrence type", variant: "destructive" });
      return;
    }

    if (!reason) {
      toast({ title: "Error", description: "Please select a reason", variant: "destructive" });
      return;
    }

    if (selectedFile && !uploadedDocumentUrl) {
      toast({ title: "Error", description: "Please upload the selected document before submitting", variant: "destructive" });
      return;
    }

    const typeInfo = OCCURRENCE_TYPES.find(t => t.value === occurrenceType);
    if (!typeInfo) return;

    try {
      await createOccurrence.mutateAsync({
        employeeId,
        occurrenceDate,
        occurrenceType,
        occurrenceValue: typeInfo.points,
        isNcns: occurrenceType === "ncns",
        isFmla,
        isConsecutiveSickness,
        reason: reason || undefined,
        notes: notesAvailable ? (notes || undefined) : undefined,
        documentUrl: uploadedDocumentUrl || undefined
      });

      const exemptionNote = isFmla ? " (FMLA - not counted)" : isConsecutiveSickness ? " (Consecutive sickness - not counted)" : "";
      toast({ 
        title: "Attendance record created", 
        description: `${typeInfo.label} recorded for ${employeeName}${exemptionNote}.` 
      });
      onClose();
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "Failed to record attendance", 
        variant: "destructive" 
      });
    }
  };

  const formattedDate = format(new Date(occurrenceDate + "T12:00:00"), "EEEE, MMMM d, yyyy");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-occurrence">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Record Attendance Issue
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Employee</Label>
            <div className="text-sm font-medium" data-testid="text-employee-name">{employeeName}</div>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <div className="text-sm text-muted-foreground" data-testid="text-occurrence-date">{formattedDate}</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="occurrenceType">Occurrence Type</Label>
            <Select value={occurrenceType} onValueChange={setOccurrenceType}>
              <SelectTrigger data-testid="select-occurrence-type">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {OCCURRENCE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value} data-testid={`option-${type.value}`}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {occurrenceType === "ncns" && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 dark:bg-red-950 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">
                <strong>Warning:</strong> A No Call/No Show results in 1.0 occurrence plus a final written warning. 
                A second NCNS within 12 months results in termination.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger data-testid="select-reason">
                <SelectValue placeholder="Select reason..." />
              </SelectTrigger>
              <SelectContent>
                {ABSENCE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value} data-testid={`option-reason-${r.value}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {notesAvailable && (
            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                placeholder="Describe the transportation issue..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="input-notes"
              />
            </div>
          )}

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="isFmla" 
                checked={isFmla} 
                onCheckedChange={(checked) => {
                  setIsFmla(checked === true);
                  if (checked) setIsConsecutiveSickness(false);
                }}
                data-testid="checkbox-fmla"
              />
              <Label htmlFor="isFmla" className="text-sm font-normal cursor-pointer">
                FMLA Usage <span className="text-muted-foreground">(will not count as occurrence)</span>
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox 
                id="isConsecutiveSickness" 
                checked={isConsecutiveSickness} 
                onCheckedChange={(checked) => {
                  setIsConsecutiveSickness(checked === true);
                  if (checked) setIsFmla(false);
                }}
                data-testid="checkbox-consecutive-sickness"
              />
              <Label htmlFor="isConsecutiveSickness" className="text-sm font-normal cursor-pointer">
                Consecutive Sickness <span className="text-muted-foreground">(will not count as occurrence)</span>
              </Label>
            </div>
          </div>

          {(isFmla || isConsecutiveSickness) && (
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 dark:bg-blue-950 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {isFmla 
                  ? "This absence is protected under FMLA and will be documented but not counted toward the occurrence total."
                  : "This is part of a consecutive illness period and will be documented but not counted toward the occurrence total."
                }
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Documentation (PDF only)</Label>
            <div className="flex flex-col gap-2">
              {!selectedFile ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                    data-testid="input-document"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-select-document"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Attach PDF
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                  <FileText className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{selectedFile.name}</span>
                  {uploadedDocumentUrl ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleUploadDocument}
                      disabled={isUploading}
                      data-testid="button-upload-document"
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Upload"
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveDocument}
                    disabled={isUploading}
                    data-testid="button-remove-document"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {selectedFile && !uploadedDocumentUrl && !isUploading && (
                <p className="text-xs text-muted-foreground">Click "Upload" to attach the document</p>
              )}
              {uploadedDocumentUrl && (
                <p className="text-xs text-green-600">Document attached successfully</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createOccurrence.isPending || !occurrenceType || !reason || isUploading}
              data-testid="button-submit"
            >
              {createOccurrence.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
