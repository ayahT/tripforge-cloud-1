import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarRange, Loader2, Plus, CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  agencyId: string;
}

const CreateReservationDialog = ({ agencyId }: Props) => {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState<string>('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();

  const { data: vehicles = [], isLoading: isLoadingVehicles } = useQuery({
    queryKey: ['vehicles', agencyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, brand, model, license_plate')
        .eq('agency_id', agencyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!agencyId && open,
  });

  const { data: existingReservations = [] } = useQuery({
    queryKey: ['vehicle-reservations', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, pickup_date, return_date, customer_name')
        .eq('vehicle_id', vehicleId)
        .order('pickup_date', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId && open,
  });

  const createReservation = useMutation({
    mutationFn: async () => {
      if (!vehicleId || !startDate || !endDate) throw new Error('Missing required fields');
      
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          agency_id: agencyId,
          vehicle_id: vehicleId,
          pickup_date: format(startDate, 'yyyy-MM-dd') + 'T12:00:00Z',
          return_date: format(endDate, 'yyyy-MM-dd') + 'T12:00:00Z',
          customer_name: customerName || 'Manual Reservation',
          status: 'confirmed',
          notes: notes,
          amount: 0,
        });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Reservation created successfully' });
      queryClient.invalidateQueries({ queryKey: ['vehicle-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['agency-bookings'] });
      reset();
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: 'Error creating reservation', description: err.message, variant: 'destructive' });
    }
  });

  const reset = () => {
    setVehicleId('');
    setStartDate(undefined);
    setEndDate(undefined);
    setCustomerName('');
    setNotes('');
  };

  const handleSubmit = () => {
    if (!vehicleId) {
      toast({ title: 'Please select a vehicle', variant: 'destructive' });
      return;
    }
    if (!startDate || !endDate) {
      toast({ title: 'Please select start and end dates', variant: 'destructive' });
      return;
    }
    if (startDate > endDate) {
      toast({ title: 'Start date must be before end date', variant: 'destructive' });
      return;
    }
    createReservation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 rounded-xl">
          <CalendarRange className="h-4 w-4" /> Add Reservation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Vehicle Reservation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Select Vehicle *</Label>
            <Select value={vehicleId} onValueChange={setVehicleId} disabled={isLoadingVehicles}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingVehicles ? 'Loading vehicles...' : 'Choose a vehicle'} />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.brand} {v.model} {v.license_plate ? `(${v.license_plate})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Customer Name</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="John Doe" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 flex flex-col">
              <Label>Start Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('justify-start text-left font-normal', !startDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5 flex flex-col">
              <Label>End Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('justify-start text-left font-normal', !endDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus disabled={(date) => (startDate ? date < startDate : false)} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </div>

          {/* Display Existing Reservations as Date Ranges */}
          {vehicleId && existingReservations.length > 0 && (
            <div className="mt-6">
              <Label className="mb-2 block">Existing Reservations for this vehicle</Label>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {existingReservations.map((res: any) => (
                  <div key={res.id} className="text-sm p-2 bg-muted rounded-md flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Reservation: {res.customer_name || 'Manual'}</span>
                      <span>{format(new Date(res.pickup_date), 'MMMM d')} &rarr; {format(new Date(res.return_date), 'MMMM d, yyyy')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createReservation.isPending}>
            {createReservation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Reservation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateReservationDialog;
