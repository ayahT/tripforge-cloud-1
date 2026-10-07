import { useState } from 'react';
import { format, eachDayOfInterval, parseISO, isWithinInterval } from 'date-fns';
import { CalendarDays, DollarSign, Plus, Trash2, Ban, Tag, CalendarRange } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Vehicle } from '@/hooks/use-vehicles';
import {
  useVehiclePricing,
  useVehicleBlockedDates,
  useAddPricing,
  useDeletePricing,
  useAddBlockedDate,
  useDeleteBlockedDate,
} from '@/hooks/use-vehicle-pricing';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Props {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const useVehicleBookings = (vehicleId: string | undefined) => {
  return useQuery({
    queryKey: ['vehicle-bookings', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, customer_name, pickup_date, return_date, status')
        .eq('vehicle_id', vehicleId!)
        .order('pickup_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vehicleId,
  });
};

const VehiclePricingDialog = ({ vehicle, open, onOpenChange }: Props) => {
  const { data: pricing = [], isLoading: pricingLoading } = useVehiclePricing(vehicle?.id);
  const { data: blocked = [], isLoading: blockedLoading } = useVehicleBlockedDates(vehicle?.id);
  const { data: bookings = [] } = useVehicleBookings(vehicle?.id);
  const addPricing = useAddPricing();
  const deletePricing = useDeletePricing();
  const addBlocked = useAddBlockedDate();
  const deleteBlocked = useDeleteBlockedDate();

  // Pricing form
  const [seasonName, setSeasonName] = useState('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [dailyRate, setDailyRate] = useState('');
  const [weeklyRate, setWeeklyRate] = useState('');
  const [monthlyRate, setMonthlyRate] = useState('');

  // Blocked date form
  const [blockStart, setBlockStart] = useState<Date>();
  const [blockEnd, setBlockEnd] = useState<Date>();
  const [blockReason, setBlockReason] = useState('');

  const resetPricingForm = () => {
    setSeasonName('');
    setStartDate(undefined);
    setEndDate(undefined);
    setDailyRate('');
    setWeeklyRate('');
    setMonthlyRate('');
  };

  const resetBlockForm = () => {
    setBlockStart(undefined);
    setBlockEnd(undefined);
    setBlockReason('');
  };

  const handleAddPricing = () => {
    if (!vehicle || !seasonName || !startDate || !endDate || !dailyRate) {
      toast.error('Fill in season name, dates, and daily rate');
      return;
    }
    addPricing.mutate(
      {
        vehicle_id: vehicle.id,
        season_name: seasonName,
        start_date: format(startDate, 'yyyy-MM-dd'),
        end_date: format(endDate, 'yyyy-MM-dd'),
        daily_rate: parseFloat(dailyRate),
        weekly_rate: weeklyRate ? parseFloat(weeklyRate) : null,
        monthly_rate: monthlyRate ? parseFloat(monthlyRate) : null,
      },
      {
        onSuccess: () => {
          toast.success('Pricing season added');
          resetPricingForm();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleAddBlocked = () => {
    if (!vehicle || !blockStart || !blockEnd) {
      toast.error('Select start and end dates');
      return;
    }
    addBlocked.mutate(
      {
        vehicle_id: vehicle.id,
        start_date: format(blockStart, 'yyyy-MM-dd'),
        end_date: format(blockEnd, 'yyyy-MM-dd'),
        reason: blockReason || null,
      },
      {
        onSuccess: () => {
          toast.success('Dates blocked');
          resetBlockForm();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  if (!vehicle) return null;

  // Build day-level sets for calendar highlighting
  const bookedMap = { base: [] as Date[], start: [] as Date[], middle: [] as Date[], end: [] as Date[] };
  bookings.forEach((b: any) => {
    try {
      const start = parseISO(b.pickup_date);
      const end = parseISO(b.return_date);
      const days = eachDayOfInterval({ start, end });
      if (days.length === 1) {
        bookedMap.base.push(days[0]);
      } else if (days.length > 1) {
        bookedMap.start.push(days[0]);
        bookedMap.end.push(days[days.length - 1]);
      }
    } catch {}
  });

  const blockedMap = { base: [] as Date[], start: [] as Date[], middle: [] as Date[], end: [] as Date[] };
  blocked.forEach((b) => {
    try {
      const start = parseISO(b.start_date);
      const end = parseISO(b.end_date);
      const days = eachDayOfInterval({ start, end });
      if (days.length === 1) {
        blockedMap.base.push(days[0]);
      } else if (days.length > 1) {
        blockedMap.start.push(days[0]);
        blockedMap.end.push(days[days.length - 1]);
      }
    } catch {}
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-accent" />
            Pricing & Availability — {vehicle.brand} {vehicle.model}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="calendar" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="calendar" className="flex-1 gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" /> Calendar
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1 gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Seasonal Pricing
            </TabsTrigger>
            <TabsTrigger value="blocked" className="flex-1 gap-1.5">
              <Ban className="h-3.5 w-3.5" /> Blocked Dates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4 mt-4">
            <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-accent/30 border border-accent/50" /> Booked</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-destructive/30 border border-destructive/50" /> Blocked</span>
            </div>
            <div className="flex justify-center">
              <Calendar
                mode="multiple"
                numberOfMonths={2}
                selected={[]}
                onSelect={() => {}}
                modifiers={{
                  booked: bookedMap.base, booked_start: bookedMap.start, booked_middle: bookedMap.middle, booked_end: bookedMap.end,
                  blocked: blockedMap.base, blocked_start: blockedMap.start, blocked_middle: blockedMap.middle, blocked_end: blockedMap.end
                }}
                modifiersClassNames={{
                  booked: 'bg-accent/30 text-accent-foreground font-semibold',
                  booked_start: 'bg-accent/30 text-accent-foreground font-semibold',
                  booked_middle: 'bg-accent/30 text-accent-foreground font-semibold',
                  booked_end: 'bg-accent/30 text-accent-foreground font-semibold',
                  blocked: 'bg-destructive/30 text-destructive font-semibold line-through',
                  blocked_start: 'bg-destructive/30 text-destructive font-semibold line-through',
                  blocked_middle: 'bg-destructive/30 text-destructive font-semibold line-through',
                  blocked_end: 'bg-destructive/30 text-destructive font-semibold line-through',
                }}
                className={cn('p-3 pointer-events-auto rounded-md border border-border')}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Upcoming bookings</p>
              {bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No bookings for this vehicle yet.</p>
              ) : (
                <div className="space-y-2">
                  {bookings.map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-foreground">{b.customer_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(parseISO(b.pickup_date), 'MMM d')} — {format(parseISO(b.return_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] capitalize">{b.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="pricing" className="space-y-5 mt-4">
            {pricingLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : pricing.length > 0 ? (
              <div className="space-y-2">
                {pricing.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          <Tag className="h-2.5 w-2.5 mr-1" />
                          {p.season_name}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(p.start_date), 'MMM d')} — {format(new Date(p.end_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-foreground mt-1">
                        <span><strong>${p.daily_rate}</strong>/day</span>
                        {p.weekly_rate && <span><strong>${p.weekly_rate}</strong>/week</span>}
                        {p.monthly_rate && <span><strong>${p.monthly_rate}</strong>/month</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deletePricing.mutate({ id: p.id, vehicleId: vehicle.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No pricing seasons yet. Add one below.</p>
            )}

            <div className="rounded-xl border border-border p-4 space-y-4 bg-card">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="h-4 w-4 text-accent" /> Add Season
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Season Name</Label>
                  <Input placeholder="e.g. High Season, Summer..." value={seasonName} onChange={(e) => setSeasonName(e.target.value)} className="mt-1" />
                </div>

                <div>
                  <Label className="text-xs">Start Date</Label>
                  <DatePickerField date={startDate} onSelect={setStartDate} />
                </div>
                <div>
                  <Label className="text-xs">End Date</Label>
                  <DatePickerField date={endDate} onSelect={setEndDate} />
                </div>

                <div>
                  <Label className="text-xs">Daily Rate ($) *</Label>
                  <Input type="number" min="0" step="0.01" placeholder="50" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Weekly Rate ($)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="300" value={weeklyRate} onChange={(e) => setWeeklyRate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Monthly Rate ($)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="1000" value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} className="mt-1" />
                </div>
              </div>

              <Button onClick={handleAddPricing} disabled={addPricing.isPending} className="w-full">
                {addPricing.isPending ? 'Adding...' : 'Add Pricing Season'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="blocked" className="space-y-5 mt-4">
            {blockedLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : blocked.length > 0 ? (
              <div className="space-y-2">
                {blocked.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-destructive/5 p-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground">
                        {format(new Date(b.start_date), 'MMM d')} — {format(new Date(b.end_date), 'MMM d, yyyy')}
                      </span>
                      {b.reason && <p className="text-[11px] text-muted-foreground">{b.reason}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteBlocked.mutate({ id: b.id, vehicleId: vehicle.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No blocked dates. Add below to mark unavailable periods.</p>
            )}

            <div className="rounded-xl border border-border p-4 space-y-4 bg-card">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="h-4 w-4 text-accent" /> Block Dates
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start Date</Label>
                  <DatePickerField date={blockStart} onSelect={setBlockStart} />
                </div>
                <div>
                  <Label className="text-xs">End Date</Label>
                  <DatePickerField date={blockEnd} onSelect={setBlockEnd} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Reason (optional)</Label>
                  <Input placeholder="e.g. Maintenance, Reserved..." value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="mt-1" />
                </div>
              </div>

              <Button onClick={handleAddBlocked} disabled={addBlocked.isPending} variant="destructive" className="w-full">
                {addBlocked.isPending ? 'Blocking...' : 'Block These Dates'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const DatePickerField = ({ date, onSelect }: { date: Date | undefined; onSelect: (d: Date | undefined) => void }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        variant="outline"
        className={cn('w-full mt-1 justify-start text-left font-normal', !date && 'text-muted-foreground')}
      >
        <CalendarDays className="mr-2 h-4 w-4" />
        {date ? format(date, 'PPP') : 'Pick a date'}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={date} onSelect={onSelect} initialFocus className={cn('p-3 pointer-events-auto')} />
    </PopoverContent>
  </Popover>
);

export default VehiclePricingDialog;
