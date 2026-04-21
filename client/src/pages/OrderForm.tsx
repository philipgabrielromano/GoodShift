import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRoute, useLocation as useWouterLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocations } from "@/hooks/use-locations";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ClipboardList, Pencil } from "lucide-react";

const ORDER_TYPES = [
  "Transfer and Receive",
  "End of Day/Equipment Count",
  "Donors",
  "Supplemental production",
] as const;

type OrderType = typeof ORDER_TYPES[number];

const LOCATIONS = [
  "Alliance", "Carrollton", "Chardon", "Foxboro", "Massillon",
  "Mayfield", "Middleburg", "New Philly", "North Canton", "North Olmsted",
  "Outlet Canton", "Outlet Cleveland", "Painesville", "Perry", "Route 62",
  "Snow Road", "Strongsville", "University", "Weirton", "Wintersville",
  "Willowick", "Transportation",
  "Home Pickups ADC", "Hillsdale ADC", "Corporate Campus ADC",
  "Washington Square ADC", "Uniontown ADC", "Tanglewood ADC",
  "Shuffel ADC", "Pepper Pike ADC", "North Royalton ADC",
  "Lyndhurst ADC", "Lincoln Way ADC", "Westlake ADC",
  "Jackson ADC", "Chesterland ADC",
  "Washington Square", "Westlake", "Gordon Square",
  "Donation Station", "City Mission",
  "Wired Up", "eCommerce",
];

const formSchema = z.object({
  orderDate: z.string().min(1, "Date is required"),
  orderType: z.enum(ORDER_TYPES, { required_error: "Order type is required" }),
  location: z.string().min(1, "Location is required"),
  totesRequested: z.number().nullable().optional(),
  totesReturned: z.number().nullable().optional(),
  durosRequested: z.number().nullable().optional(),
  durosReturned: z.number().nullable().optional(),
  blueBinsRequested: z.number().nullable().optional(),
  blueBinsReturned: z.number().nullable().optional(),
  gaylordsRequested: z.number().nullable().optional(),
  gaylordsReturned: z.number().nullable().optional(),
  palletsRequested: z.number().nullable().optional(),
  palletsReturned: z.number().nullable().optional(),
  containersRequested: z.number().nullable().optional(),
  containersReturned: z.number().nullable().optional(),
  apparelGaylordsRequested: z.number().nullable().optional(),
  apparelGaylordsReturned: z.number().nullable().optional(),
  waresGaylordsRequested: z.number().nullable().optional(),
  waresGaylordsReturned: z.number().nullable().optional(),
  electricalGaylordsRequested: z.number().nullable().optional(),
  electricalGaylordsReturned: z.number().nullable().optional(),
  accessoriesGaylordsRequested: z.number().nullable().optional(),
  accessoriesGaylordsReturned: z.number().nullable().optional(),
  booksGaylordsRequested: z.number().nullable().optional(),
  booksGaylordsReturned: z.number().nullable().optional(),
  shoesGaylordsRequested: z.number().nullable().optional(),
  shoesGaylordsReturned: z.number().nullable().optional(),
  furnitureGaylordsRequested: z.number().nullable().optional(),
  furnitureGaylordsReturned: z.number().nullable().optional(),
  savedWinterRequested: z.number().nullable().optional(),
  savedWinterReturned: z.number().nullable().optional(),
  savedSummerRequested: z.number().nullable().optional(),
  savedSummerReturned: z.number().nullable().optional(),
  savedHalloweenRequested: z.number().nullable().optional(),
  savedHalloweenReturned: z.number().nullable().optional(),
  savedChristmasRequested: z.number().nullable().optional(),
  savedChristmasReturned: z.number().nullable().optional(),
  fullTotes: z.number().nullable().optional(),
  emptyTotes: z.number().nullable().optional(),
  fullGaylords: z.number().nullable().optional(),
  emptyGaylords: z.number().nullable().optional(),
  fullDuros: z.number().nullable().optional(),
  emptyDuros: z.number().nullable().optional(),
  fullContainers: z.number().nullable().optional(),
  emptyContainers: z.number().nullable().optional(),
  fullBlueBins: z.number().nullable().optional(),
  emptyBlueBins: z.number().nullable().optional(),
  emptyPallets: z.number().nullable().optional(),
  outletApparel: z.number().nullable().optional(),
  outletShoes: z.number().nullable().optional(),
  outletMetal: z.number().nullable().optional(),
  outletWares: z.number().nullable().optional(),
  outletAccessories: z.number().nullable().optional(),
  outletElectrical: z.number().nullable().optional(),
  ecomContainersSent: z.number().nullable().optional(),
  rotatedApparel: z.number().nullable().optional(),
  rotatedShoes: z.number().nullable().optional(),
  rotatedBooks: z.number().nullable().optional(),
  rotatedWares: z.number().nullable().optional(),
  apparelGaylordsUsed: z.number().nullable().optional(),
  waresGaylordsUsed: z.number().nullable().optional(),
  bookGaylordsUsed: z.number().nullable().optional(),
  shoeGaylordsUsed: z.number().nullable().optional(),
  donors: z.number().nullable().optional(),
  isCentralProcessing: z.boolean().nullable().optional(),
  apparelProduction: z.number().nullable().optional(),
  waresProduction: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function NumberField({ label, value, onChange, testId }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; testId: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <Input
        type="number"
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="h-9"
      />
    </div>
  );
}

interface AuthStatus {
  isAuthenticated: boolean;
  user: { id: number; name: string; email: string; role: string; locationIds: string[] | null } | null;
}

export default function OrderForm() {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const { data: authStatus } = useQuery<AuthStatus>({ queryKey: ["/api/auth/status"] });
  const { data: dbLocations } = useLocations();
  const [, navigate] = useWouterLocation();
  const [isEditMatch, editParams] = useRoute<{ id: string }>("/orders/edit/:id");
  const editId = isEditMatch ? Number(editParams?.id) : null;
  const isEditMode = editId !== null && Number.isFinite(editId);

  const { data: existingOrder, isLoading: isLoadingExisting } = useQuery<Record<string, any>>({
    queryKey: ["/api/orders", editId],
    enabled: isEditMode,
  });

  const defaultLocation = (() => {
    const userLocIds = authStatus?.user?.locationIds;
    if (!userLocIds || userLocIds.length === 0 || !dbLocations) return "";
    const userLocNames = dbLocations
      .filter((loc: any) => userLocIds.includes(String(loc.id)))
      .map((loc: any) => loc.name)
      .filter((name: string) => LOCATIONS.includes(name))
      .sort((a: string, b: string) => a.localeCompare(b));
    return userLocNames.length > 0 ? userLocNames[0] : "";
  })();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      orderDate: today,
      orderType: undefined,
      location: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!isEditMode && defaultLocation && !form.getValues("location")) {
      form.setValue("location", defaultLocation);
    }
  }, [defaultLocation, isEditMode]);

  useEffect(() => {
    if (isEditMode && existingOrder) {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(existingOrder)) {
        if (["id", "submittedBy", "submittedAt"].includes(k)) continue;
        cleaned[k] = v;
      }
      if (cleaned.orderDate && typeof cleaned.orderDate === "string") {
        cleaned.orderDate = cleaned.orderDate.slice(0, 10);
      }
      form.reset(cleaned as FormValues);
    }
  }, [isEditMode, existingOrder]);

  const orderType = form.watch("orderType");
  const location = form.watch("location");

  const isTransfer = orderType === "Transfer and Receive";
  const isEndOfDay = orderType === "End of Day/Equipment Count";
  const isDonors = orderType === "Donors";
  const isSupplemental = orderType === "Supplemental production";
  const isOutletLocation = location === "Outlet Canton" || location === "Outlet Cleveland";

  const submitMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const method = isEditMode ? "PUT" : "POST";
      const url = isEditMode ? `/api/orders/${editId}` : "/api/orders";
      const res = await apiRequest(method, url, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: isEditMode ? "Order updated successfully" : "Order submitted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      if (isEditMode) {
        navigate("/orders");
      } else {
        form.reset({ orderDate: today, orderType: undefined, location: defaultLocation, notes: "" });
      }
    },
    onError: (err: Error) => {
      toast({
        title: isEditMode ? "Failed to update order" : "Failed to submit order",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormValues) => {
    submitMutation.mutate(data);
  };

  if (isEditMode && isLoadingExisting) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold" data-testid="text-order-form-title">Order Form</h1>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Order Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="orderDate">Date *</Label>
                <Input
                  id="orderDate"
                  type="date"
                  data-testid="input-order-date"
                  {...form.register("orderDate")}
                />
                {form.formState.errors.orderDate && (
                  <p className="text-sm text-destructive">{form.formState.errors.orderDate.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Type of Order *</Label>
                <Select
                  value={orderType || ""}
                  onValueChange={(val: string) => form.setValue("orderType", val as OrderType, { shouldValidate: true })}
                >
                  <SelectTrigger data-testid="select-order-type">
                    <SelectValue placeholder="Select Order Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_TYPES.map((t) => (
                      <SelectItem key={t} value={t} data-testid={`option-order-type-${t.toLowerCase().replace(/[\s\/]+/g, '-')}`}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.orderType && (
                  <p className="text-sm text-destructive">{form.formState.errors.orderType.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Location *</Label>
                <Select
                  value={location}
                  onValueChange={(val) => form.setValue("location", val, { shouldValidate: true })}
                >
                  <SelectTrigger data-testid="select-location">
                    <SelectValue placeholder="Select Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map((l) => (
                      <SelectItem key={l} value={l} data-testid={`option-location-${l.toLowerCase().replace(/\s+/g, '-')}`}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.location && (
                  <p className="text-sm text-destructive">{form.formState.errors.location.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {isTransfer && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equipment Requested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="Totes" value={form.watch("totesRequested")} onChange={(v) => form.setValue("totesRequested", v)} testId="input-totes-requested" />
                  <NumberField label="Duros" value={form.watch("durosRequested")} onChange={(v) => form.setValue("durosRequested", v)} testId="input-duros-requested" />
                  <NumberField label="Blue Bins" value={form.watch("blueBinsRequested")} onChange={(v) => form.setValue("blueBinsRequested", v)} testId="input-blue-bins-requested" />
                  <NumberField label="Gaylords" value={form.watch("gaylordsRequested")} onChange={(v) => form.setValue("gaylordsRequested", v)} testId="input-gaylords-requested" />
                  <NumberField label="Pallets" value={form.watch("palletsRequested")} onChange={(v) => form.setValue("palletsRequested", v)} testId="input-pallets-requested" />
                  <NumberField label="Containers" value={form.watch("containersRequested")} onChange={(v) => form.setValue("containersRequested", v)} testId="input-containers-requested" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equipment Returned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="Totes" value={form.watch("totesReturned")} onChange={(v) => form.setValue("totesReturned", v)} testId="input-totes-returned" />
                  <NumberField label="Duros" value={form.watch("durosReturned")} onChange={(v) => form.setValue("durosReturned", v)} testId="input-duros-returned" />
                  <NumberField label="Blue Bins" value={form.watch("blueBinsReturned")} onChange={(v) => form.setValue("blueBinsReturned", v)} testId="input-blue-bins-returned" />
                  <NumberField label="Gaylords" value={form.watch("gaylordsReturned")} onChange={(v) => form.setValue("gaylordsReturned", v)} testId="input-gaylords-returned" />
                  <NumberField label="Pallets" value={form.watch("palletsReturned")} onChange={(v) => form.setValue("palletsReturned", v)} testId="input-pallets-returned" />
                  <NumberField label="Containers" value={form.watch("containersReturned")} onChange={(v) => form.setValue("containersReturned", v)} testId="input-containers-returned" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Category Gaylords Requested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="Apparel" value={form.watch("apparelGaylordsRequested")} onChange={(v) => form.setValue("apparelGaylordsRequested", v)} testId="input-apparel-gaylords-requested" />
                  <NumberField label="Wares" value={form.watch("waresGaylordsRequested")} onChange={(v) => form.setValue("waresGaylordsRequested", v)} testId="input-wares-gaylords-requested" />
                  <NumberField label="Electrical" value={form.watch("electricalGaylordsRequested")} onChange={(v) => form.setValue("electricalGaylordsRequested", v)} testId="input-electrical-gaylords-requested" />
                  <NumberField label="Accessories" value={form.watch("accessoriesGaylordsRequested")} onChange={(v) => form.setValue("accessoriesGaylordsRequested", v)} testId="input-accessories-gaylords-requested" />
                  <NumberField label="Books" value={form.watch("booksGaylordsRequested")} onChange={(v) => form.setValue("booksGaylordsRequested", v)} testId="input-books-gaylords-requested" />
                  <NumberField label="Shoes" value={form.watch("shoesGaylordsRequested")} onChange={(v) => form.setValue("shoesGaylordsRequested", v)} testId="input-shoes-gaylords-requested" />
                  <NumberField label="Furniture" value={form.watch("furnitureGaylordsRequested")} onChange={(v) => form.setValue("furnitureGaylordsRequested", v)} testId="input-furniture-gaylords-requested" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Seasonal Items Requested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <NumberField label="Winter" value={form.watch("savedWinterRequested")} onChange={(v) => form.setValue("savedWinterRequested", v)} testId="input-saved-winter-requested" />
                  <NumberField label="Summer" value={form.watch("savedSummerRequested")} onChange={(v) => form.setValue("savedSummerRequested", v)} testId="input-saved-summer-requested" />
                  <NumberField label="Halloween" value={form.watch("savedHalloweenRequested")} onChange={(v) => form.setValue("savedHalloweenRequested", v)} testId="input-saved-halloween-requested" />
                  <NumberField label="Christmas" value={form.watch("savedChristmasRequested")} onChange={(v) => form.setValue("savedChristmasRequested", v)} testId="input-saved-christmas-requested" />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {isEndOfDay && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equipment Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <NumberField label="Full Totes" value={form.watch("fullTotes")} onChange={(v) => form.setValue("fullTotes", v)} testId="input-full-totes" />
                  <NumberField label="Empty Totes" value={form.watch("emptyTotes")} onChange={(v) => form.setValue("emptyTotes", v)} testId="input-empty-totes" />
                  <NumberField label="Full Gaylords" value={form.watch("fullGaylords")} onChange={(v) => form.setValue("fullGaylords", v)} testId="input-full-gaylords" />
                  <NumberField label="Empty Gaylords" value={form.watch("emptyGaylords")} onChange={(v) => form.setValue("emptyGaylords", v)} testId="input-empty-gaylords" />
                  <NumberField label="Full Duros" value={form.watch("fullDuros")} onChange={(v) => form.setValue("fullDuros", v)} testId="input-full-duros" />
                  <NumberField label="Empty Duros" value={form.watch("emptyDuros")} onChange={(v) => form.setValue("emptyDuros", v)} testId="input-empty-duros" />
                  <NumberField label="Full Containers" value={form.watch("fullContainers")} onChange={(v) => form.setValue("fullContainers", v)} testId="input-full-containers" />
                  <NumberField label="Empty Containers" value={form.watch("emptyContainers")} onChange={(v) => form.setValue("emptyContainers", v)} testId="input-empty-containers" />
                  <NumberField label="Full Blue Bins" value={form.watch("fullBlueBins")} onChange={(v) => form.setValue("fullBlueBins", v)} testId="input-full-blue-bins" />
                  <NumberField label="Empty Blue Bins" value={form.watch("emptyBlueBins")} onChange={(v) => form.setValue("emptyBlueBins", v)} testId="input-empty-blue-bins" />
                  <NumberField label="Empty Pallets" value={form.watch("emptyPallets")} onChange={(v) => form.setValue("emptyPallets", v)} testId="input-empty-pallets" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Category Gaylords Returned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="Apparel" value={form.watch("apparelGaylordsReturned")} onChange={(v) => form.setValue("apparelGaylordsReturned", v)} testId="input-apparel-gaylords-returned" />
                  <NumberField label="Wares" value={form.watch("waresGaylordsReturned")} onChange={(v) => form.setValue("waresGaylordsReturned", v)} testId="input-wares-gaylords-returned" />
                  <NumberField label="Electrical" value={form.watch("electricalGaylordsReturned")} onChange={(v) => form.setValue("electricalGaylordsReturned", v)} testId="input-electrical-gaylords-returned" />
                  <NumberField label="Accessories" value={form.watch("accessoriesGaylordsReturned")} onChange={(v) => form.setValue("accessoriesGaylordsReturned", v)} testId="input-accessories-gaylords-returned" />
                  <NumberField label="Books" value={form.watch("booksGaylordsReturned")} onChange={(v) => form.setValue("booksGaylordsReturned", v)} testId="input-books-gaylords-returned" />
                  <NumberField label="Shoes" value={form.watch("shoesGaylordsReturned")} onChange={(v) => form.setValue("shoesGaylordsReturned", v)} testId="input-shoes-gaylords-returned" />
                  <NumberField label="Furniture" value={form.watch("furnitureGaylordsReturned")} onChange={(v) => form.setValue("furnitureGaylordsReturned", v)} testId="input-furniture-gaylords-returned" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Outlet Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="Apparel" value={form.watch("outletApparel")} onChange={(v) => form.setValue("outletApparel", v)} testId="input-outlet-apparel" />
                  <NumberField label="Shoes" value={form.watch("outletShoes")} onChange={(v) => form.setValue("outletShoes", v)} testId="input-outlet-shoes" />
                  <NumberField label="Metal" value={form.watch("outletMetal")} onChange={(v) => form.setValue("outletMetal", v)} testId="input-outlet-metal" />
                  <NumberField label="Wares" value={form.watch("outletWares")} onChange={(v) => form.setValue("outletWares", v)} testId="input-outlet-wares" />
                  <NumberField label="Accessories" value={form.watch("outletAccessories")} onChange={(v) => form.setValue("outletAccessories", v)} testId="input-outlet-accessories" />
                  <NumberField label="Electrical" value={form.watch("outletElectrical")} onChange={(v) => form.setValue("outletElectrical", v)} testId="input-outlet-electrical" />
                </div>
              </CardContent>
            </Card>

            {isOutletLocation && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Rotated Items & Gaylords Used</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <NumberField label="Rotated Apparel" value={form.watch("rotatedApparel")} onChange={(v) => form.setValue("rotatedApparel", v)} testId="input-rotated-apparel" />
                    <NumberField label="Rotated Shoes" value={form.watch("rotatedShoes")} onChange={(v) => form.setValue("rotatedShoes", v)} testId="input-rotated-shoes" />
                    <NumberField label="Rotated Books" value={form.watch("rotatedBooks")} onChange={(v) => form.setValue("rotatedBooks", v)} testId="input-rotated-books" />
                    <NumberField label="Rotated Wares" value={form.watch("rotatedWares")} onChange={(v) => form.setValue("rotatedWares", v)} testId="input-rotated-wares" />
                    <NumberField label="Apparel Gaylords Used" value={form.watch("apparelGaylordsUsed")} onChange={(v) => form.setValue("apparelGaylordsUsed", v)} testId="input-apparel-gaylords-used" />
                    <NumberField label="Wares Gaylords Used" value={form.watch("waresGaylordsUsed")} onChange={(v) => form.setValue("waresGaylordsUsed", v)} testId="input-wares-gaylords-used" />
                    <NumberField label="Book Gaylords Used" value={form.watch("bookGaylordsUsed")} onChange={(v) => form.setValue("bookGaylordsUsed", v)} testId="input-book-gaylords-used" />
                    <NumberField label="Shoe Gaylords Used" value={form.watch("shoeGaylordsUsed")} onChange={(v) => form.setValue("shoeGaylordsUsed", v)} testId="input-shoe-gaylords-used" />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Seasonal Items Returned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <NumberField label="Winter" value={form.watch("savedWinterReturned")} onChange={(v) => form.setValue("savedWinterReturned", v)} testId="input-saved-winter-returned" />
                  <NumberField label="Summer" value={form.watch("savedSummerReturned")} onChange={(v) => form.setValue("savedSummerReturned", v)} testId="input-saved-summer-returned" />
                  <NumberField label="Halloween" value={form.watch("savedHalloweenReturned")} onChange={(v) => form.setValue("savedHalloweenReturned", v)} testId="input-saved-halloween-returned" />
                  <NumberField label="Christmas" value={form.watch("savedChristmasReturned")} onChange={(v) => form.setValue("savedChristmasReturned", v)} testId="input-saved-christmas-returned" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Other</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <NumberField label="eCom Containers Sent" value={form.watch("ecomContainersSent")} onChange={(v) => form.setValue("ecomContainersSent", v)} testId="input-ecom-containers-sent" />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {isDonors && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Donor Count</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <NumberField label="Donors" value={form.watch("donors")} onChange={(v) => form.setValue("donors", v)} testId="input-donors" />
              </div>
            </CardContent>
          </Card>
        )}

        {isSupplemental && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Supplemental Production</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Are you entering production from Central Processing or Lee Harvard Store?
                </Label>
                <RadioGroup
                  value={form.watch("isCentralProcessing") === true ? "yes" : form.watch("isCentralProcessing") === false ? "no" : ""}
                  onValueChange={(val) => form.setValue("isCentralProcessing", val === "yes")}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="yes" id="cp-yes" data-testid="radio-central-processing-yes" />
                    <Label htmlFor="cp-yes">YES</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="no" id="cp-no" data-testid="radio-central-processing-no" />
                    <Label htmlFor="cp-no">NO</Label>
                  </div>
                </RadioGroup>
              </div>
              {form.watch("isCentralProcessing") === true && (
                <div className="grid grid-cols-2 gap-4">
                  <NumberField label="Apparel Production" value={form.watch("apparelProduction")} onChange={(v) => form.setValue("apparelProduction", v)} testId="input-apparel-production" />
                  <NumberField label="Wares Production" value={form.watch("waresProduction")} onChange={(v) => form.setValue("waresProduction", v)} testId="input-wares-production" />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Optional notes..."
              data-testid="input-notes"
              {...form.register("notes")}
            />
          </CardContent>
        </Card>

        <Button
          type="submit"
          className="w-full md:w-auto"
          disabled={submitMutation.isPending}
          data-testid="button-submit-order"
        >
          {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Submit Order
        </Button>
      </form>
    </div>
  );
}
