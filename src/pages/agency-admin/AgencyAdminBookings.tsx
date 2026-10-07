import { motion } from 'framer-motion';
import { useOutletContext } from 'react-router-dom';
import {
  CalendarDays, Info, CreditCard, Loader2, CheckCircle2, CalendarRange, List,
  Search, Download, Filter, X, Phone, Mail, MapPin, Clock, User, Car,
  CheckCheck, XCircle, Trash2,
} from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import {
  eachDayOfInterval, parseISO, format, isSameDay, isToday, isThisWeek,
  startOfMonth, endOfMonth, isWithinInterval, startOfDay, endOfDay,
} from 'date-fns';
import { Agency } from '@/types/agency';
import { useAgencyBookings } from '@/hooks/use-agency-admin';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

type StatusKey = 'pending' | 'confirmed' | 'completed' | 'cancelled';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  confirmed: 'bg-accent/15 text-accent border-accent/30',
  completed: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

const AgencyAdminBookings = () => {
  const { agency } = useOutletContext<{ agency: Agency }>();
  const { data: bookings, isLoading, isError } = useAgencyBookings(agency.id);
  const queryClient = useQueryClient();

  const [chargingId, setChargingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const [detailBooking, setDetailBooking] = useState<any | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');

  // Realtime subscription
  useEffect(() => {
    if (!agency.id) return;
    const channel = supabase
      .channel(`bookings:${agency.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `agency_id=eq.${agency.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['agency-bookings', agency.id] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agency.id, queryClient]);

  const allServiceTypes = useMemo(() => {
    const set = new Set<string>();
    (bookings ?? []).forEach((b: any) => b.service_type && set.add(b.service_type));
    return Array.from(set).sort();
  }, [bookings]);

  const filtered = useMemo(() => {
    if (!bookings) return [];
    const q = search.trim().toLowerCase();
    return bookings.filter((b: any) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (serviceFilter !== 'all' && b.service_type !== serviceFilter) return false;
      if (q) {
        const hay = `${b.customer_name ?? ''} ${b.customer_email ?? ''} ${b.customer_phone ?? ''} ${b.pickup_location ?? ''} ${b.return_location ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bookings, search, statusFilter, serviceFilter]);

  // Calendar day groups
  const dayMap = useMemo(() => {
    const map: Record<string, Date[]> = {
      pending: [], confirmed: [], completed: [], cancelled: [],
      pending_start: [], pending_middle: [], pending_end: [],
      confirmed_start: [], confirmed_middle: [], confirmed_end: [],
      completed_start: [], completed_middle: [], completed_end: [],
      cancelled_start: [], cancelled_middle: [], cancelled_end: [],
    };
    
    filtered.forEach((b: any) => {
      try {
        const start = parseISO(b.pickup_date);
        const end = parseISO(b.return_date);
        const days = eachDayOfInterval({ start, end });
        const key = (b.status as StatusKey) in STATUS_STYLES ? (b.status as StatusKey) : 'pending';
        
        if (days.length === 1) {
          map[key].push(days[0]);
        } else if (days.length > 1) {
          map[`${key}_start`].push(days[0]);
          map[`${key}_end`].push(days[days.length - 1]);
          // Middle days are intentionally omitted from visual calendar highlights
          // per user request ("i want only the start and end")
        }
      } catch {}
    });
    return map;
  }, [filtered]);

  const dayBookings = useMemo(() => {
    if (!selectedDay) return [];
    return filtered.filter((b: any) => {
      try {
        const start = startOfDay(parseISO(b.pickup_date));
        const end = endOfDay(parseISO(b.return_date));
        // We still consider the middle days "unavailable" / occupied
        // so clicking on a middle day should still show the booking
        return isWithinInterval(selectedDay, { start, end });
      } catch { return false; }
    });
  }, [selectedDay, filtered]);

  // Stats
  const stats = useMemo(() => {
    const list = bookings ?? [];
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());
    const today = list.filter((b: any) => {
      try { return isToday(parseISO(b.pickup_date)); } catch { return false; }
    }).length;
    const thisWeek = list.filter((b: any) => {
      try { return isThisWeek(parseISO(b.pickup_date), { weekStartsOn: 1 }); } catch { return false; }
    }).length;
    const pending = list.filter((b: any) => b.status === 'pending').length;
    const monthRevenue = list
      .filter((b: any) => {
        try { return b.payment_status === 'paid' && isWithinInterval(parseISO(b.paid_at ?? b.created_at), { start: monthStart, end: monthEnd }); }
        catch { return false; }
      })
      .reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0);
    return { today, thisWeek, pending, monthRevenue };
  }, [bookings]);

  const handleCharge = async (bookingId: string) => {
    setChargingId(bookingId);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', { body: { booking_id: bookingId } });
      if (error) throw error;
      if (!data?.url) throw new Error('No checkout URL returned');
      window.open(data.url, '_blank');
    } catch (err: any) {
      toast({ title: 'Could not start checkout', description: err?.message ?? 'Please try again.', variant: 'destructive' });
    } finally { setChargingId(null); }
  };

  const updateStatus = async (id: string, status: StatusKey) => {
    setUpdatingId(id);
    const { error } = await supabase.from('bookings').update({ status }).eq('id', id);
    setUpdatingId(null);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Booking ${status}` });
    queryClient.invalidateQueries({ queryKey: ['agency-bookings', agency.id] });
    if (detailBooking?.id === id) setDetailBooking({ ...detailBooking, status });
  };

  const deleteBooking = async (id: string) => {
    if (!confirm('Delete this booking permanently?')) return;
    setUpdatingId(id);
    const { error } = await supabase.from('bookings').delete().eq('id', id);
    setUpdatingId(null);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Booking deleted' });
    queryClient.invalidateQueries({ queryKey: ['agency-bookings', agency.id] });
    setDetailBooking(null);
  };

  const exportCsv = () => {
    if (!filtered.length) return;
    const headers = ['Customer', 'Email', 'Phone', 'Service', 'Status', 'Payment', 'Pickup', 'Return', 'Pickup Loc', 'Return Loc', 'Amount', 'Created'];
    const rows = filtered.map((b: any) => [
      b.customer_name, b.customer_email ?? '', b.customer_phone ?? '',
      b.service_type ?? '', b.status ?? '', b.payment_status ?? '',
      b.pickup_date ?? '', b.return_date ?? '',
      (b.pickup_location ?? '').replace(/[\r\n,]+/g, ' '),
      (b.return_location ?? '').replace(/[\r\n,]+/g, ' '),
      b.amount ?? 0, b.created_at,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings-${agency.slug}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border capitalize',
      STATUS_STYLES[status] || 'bg-muted text-muted-foreground border-border')}>
      {status}
    </span>
  );

  const renderRow = (booking: any, i: number) => (
    <motion.tr
      key={booking.id}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.03 + i * 0.02 }}
      onClick={() => setDetailBooking(booking)}
      className="border-t border-border/40 hover:bg-accent/[0.04] transition-colors cursor-pointer"
    >
      <td className="px-7 py-4 text-[13px] font-medium text-foreground">{booking.customer_name}</td>
      <td className="px-6 py-4 text-[13px] text-muted-foreground capitalize">{booking.service_type}</td>
      <td className="px-6 py-4"><StatusBadge status={booking.status} /></td>
      <td className="px-6 py-4 text-[13px] text-muted-foreground tabular-nums">
        {booking.pickup_date ? format(parseISO(booking.pickup_date), 'MMM d, yyyy') : '—'}
      </td>
      <td className="px-7 py-4 text-right text-[14px] font-bold text-foreground tabular-nums">
        €{Number(booking.amount).toLocaleString()}
      </td>
      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
        {booking.payment_status === 'paid' ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> Paid
          </span>
        ) : (
          <Button size="sm" variant="outline" disabled={chargingId === booking.id || !Number(booking.amount)}
            onClick={() => handleCharge(booking.id)} className="h-8 gap-1.5 text-[12px]">
            {chargingId === booking.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
            {booking.payment_status === 'pending' ? 'Resume' : 'Charge'}
          </Button>
        )}
      </td>
    </motion.tr>
  );

  const StatCard = ({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) => (
    <div className="card-premium rounded-xl p-4">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">{label}</p>
      <p className={cn('mt-1 text-2xl font-display font-bold tabular-nums', accent ? 'text-accent' : 'text-foreground')}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-7 max-w-[1200px]">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-accent uppercase tracking-[0.2em] mb-1">Management</p>
          <h1 className="text-[30px] font-display font-bold text-foreground leading-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-light">
            Manage bookings for <span className="font-medium text-foreground">{agency.name}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </motion.div>

      {/* Stats */}
      {!isLoading && bookings && bookings.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Today" value={stats.today} />
          <StatCard label="This Week" value={stats.thisWeek} />
          <StatCard label="Pending" value={stats.pending} accent={stats.pending > 0} />
          <StatCard label="Revenue (Month)" value={`€${stats.monthRevenue.toLocaleString()}`} accent />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : isError || !bookings || bookings.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="card-premium rounded-xl p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
              <CalendarDays className="h-8 w-8 text-accent" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground">No Bookings Yet</h2>
            <div className="flex items-start gap-2 max-w-md text-left bg-secondary/40 rounded-xl p-4">
              <Info className="h-4 w-4 text-accent mt-0.5 shrink-0" />
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Bookings will appear here once customers start making reservations through your storefront.
              </p>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-5">
          {/* Filters */}
          <div className="card-premium rounded-xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer, email, phone, location…"
                className="pl-9 h-9 text-[13px]" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full md:w-[150px] text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="h-9 w-full md:w-[160px] text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {allServiceTypes.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(search || statusFilter !== 'all' || serviceFilter !== 'all') && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('all'); setServiceFilter('all'); }}
                className="h-9 gap-1.5 text-[12px]">
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>

          <Tabs defaultValue="calendar" className="w-full">
            <TabsList>
              <TabsTrigger value="calendar" className="gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> Calendar</TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5"><List className="h-3.5 w-3.5" /> List ({filtered.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="calendar" className="mt-4 space-y-5">
              <div className="card-premium rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-accent/30 border border-accent/50" /> Confirmed</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-amber-500/30 border border-amber-500/50" /> Pending</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-emerald-500/30 border border-emerald-500/50" /> Completed</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-destructive/30 border border-destructive/50" /> Cancelled</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedDay(new Date())} className="h-8 text-[12px]">Today</Button>
                </div>
                <div className="flex justify-center">
                  <Calendar
                    mode="single" numberOfMonths={2}
                    selected={selectedDay} onSelect={setSelectedDay}
                    modifiers={{
                      confirmed: dayMap.confirmed, pending: dayMap.pending,
                      completed: dayMap.completed, cancelled: dayMap.cancelled,
                      confirmed_start: dayMap.confirmed_start, confirmed_middle: dayMap.confirmed_middle, confirmed_end: dayMap.confirmed_end,
                      pending_start: dayMap.pending_start, pending_middle: dayMap.pending_middle, pending_end: dayMap.pending_end,
                      completed_start: dayMap.completed_start, completed_middle: dayMap.completed_middle, completed_end: dayMap.completed_end,
                      cancelled_start: dayMap.cancelled_start, cancelled_middle: dayMap.cancelled_middle, cancelled_end: dayMap.cancelled_end,
                    }}
                    modifiersClassNames={{
                      confirmed: 'bg-accent/30 text-accent-foreground font-semibold',
                      pending: 'bg-amber-500/30 text-foreground font-semibold',
                      completed: 'bg-emerald-500/30 text-foreground font-semibold',
                      cancelled: 'bg-destructive/30 text-destructive font-semibold line-through',
                      
                      confirmed_start: 'bg-accent/30 text-accent-foreground font-semibold',
                      confirmed_end: 'bg-accent/30 text-accent-foreground font-semibold',
                      
                      pending_start: 'bg-amber-500/30 text-foreground font-semibold',
                      pending_end: 'bg-amber-500/30 text-foreground font-semibold',
                      
                      completed_start: 'bg-emerald-500/30 text-foreground font-semibold',
                      completed_end: 'bg-emerald-500/30 text-foreground font-semibold',
                      
                      cancelled_start: 'bg-destructive/30 text-destructive font-semibold line-through',
                      cancelled_end: 'bg-destructive/30 text-destructive font-semibold line-through',
                    }}
                    className={cn('p-3 pointer-events-auto rounded-md border border-border')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  {selectedDay ? format(selectedDay, 'EEEE, MMM d, yyyy') : 'Select a day'}
                </p>
                {dayBookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No bookings on this day.</p>
                ) : (
                  <div className="space-y-2">
                    {dayBookings.map((b: any) => (
                      <button key={b.id} onClick={() => setDetailBooking(b)}
                        className="w-full flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3 hover:bg-secondary/50 transition-colors text-left">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">{b.customer_name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {format(parseISO(b.pickup_date), 'MMM d')} — {format(parseISO(b.return_date), 'MMM d, yyyy')} · {b.service_type}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-foreground tabular-nums">€{Number(b.amount).toLocaleString()}</span>
                          <StatusBadge status={b.status} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="list" className="mt-4">
              {filtered.length === 0 ? (
                <div className="card-premium rounded-xl p-8 text-center text-sm text-muted-foreground">
                  No bookings match your filters.
                </div>
              ) : (
                <div className="card-premium rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/70">
                          <th className="px-7 py-3.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Customer</th>
                          <th className="px-6 py-3.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Service</th>
                          <th className="px-6 py-3.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Status</th>
                          <th className="px-6 py-3.5 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Pickup</th>
                          <th className="px-7 py-3.5 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Amount</th>
                          <th className="px-6 py-3.5 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em] bg-secondary/40">Payment</th>
                        </tr>
                      </thead>
                      <tbody>{filtered.map(renderRow)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      )}

      {/* Booking detail drawer */}
      <Sheet open={!!detailBooking} onOpenChange={(o) => !o && setDetailBooking(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detailBooking && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display flex items-center gap-2">
                  Booking Details
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <StatusBadge status={detailBooking.status} />
                  <span className="text-[11px] text-muted-foreground">
                    Created {format(parseISO(detailBooking.created_at), 'MMM d, yyyy')}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Customer */}
                <section className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">Customer</p>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{detailBooking.customer_name}</p>
                    {detailBooking.customer_email && (
                      <a href={`mailto:${detailBooking.customer_email}`} className="text-xs text-muted-foreground hover:text-accent flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />{detailBooking.customer_email}
                      </a>
                    )}
                    {detailBooking.customer_phone && (
                      <a href={`tel:${detailBooking.customer_phone}`} className="text-xs text-muted-foreground hover:text-accent flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />{detailBooking.customer_phone}
                      </a>
                    )}
                  </div>
                </section>

                <Separator />

                {/* Trip */}
                <section className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">Trip</p>
                  <p className="text-xs text-foreground capitalize flex items-center gap-2"><Car className="h-3.5 w-3.5 text-muted-foreground" />{detailBooking.service_type}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    {format(parseISO(detailBooking.pickup_date), 'MMM d, yyyy HH:mm')}
                    {' → '}
                    {format(parseISO(detailBooking.return_date), 'MMM d, yyyy HH:mm')}
                  </p>
                  {detailBooking.pickup_location && (
                    <p className="text-xs text-muted-foreground flex items-start gap-2"><MapPin className="h-3.5 w-3.5 mt-0.5 text-emerald-500" /><span><strong className="text-foreground/80">Pickup:</strong> {detailBooking.pickup_location}</span></p>
                  )}
                  {detailBooking.return_location && (
                    <p className="text-xs text-muted-foreground flex items-start gap-2"><MapPin className="h-3.5 w-3.5 mt-0.5 text-destructive" /><span><strong className="text-foreground/80">Return:</strong> {detailBooking.return_location}</span></p>
                  )}
                </section>

                <Separator />

                {/* Payment */}
                <section className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">Payment</p>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-display font-bold text-foreground tabular-nums">€{Number(detailBooking.amount).toLocaleString()}</span>
                    {detailBooking.payment_status === 'paid' ? (
                      <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 gap-1"><CheckCircle2 className="h-3 w-3" />Paid</Badge>
                    ) : (
                      <Button size="sm" variant="outline" disabled={chargingId === detailBooking.id || !Number(detailBooking.amount)}
                        onClick={() => handleCharge(detailBooking.id)} className="h-8 gap-1.5 text-[12px]">
                        {chargingId === detailBooking.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                        Charge
                      </Button>
                    )}
                  </div>
                  {detailBooking.paid_at && (
                    <p className="text-[11px] text-muted-foreground">Paid {format(parseISO(detailBooking.paid_at), 'MMM d, yyyy HH:mm')}</p>
                  )}
                </section>

                {detailBooking.notes && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">Notes</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{detailBooking.notes}</p>
                    </section>
                  </>
                )}

                <Separator />

                {/* Actions */}
                <section className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]">Actions</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" disabled={updatingId === detailBooking.id || detailBooking.status === 'confirmed'}
                      onClick={() => updateStatus(detailBooking.id, 'confirmed')} className="gap-1.5 text-[12px]">
                      <CheckCheck className="h-3.5 w-3.5" /> Confirm
                    </Button>
                    <Button size="sm" variant="outline" disabled={updatingId === detailBooking.id || detailBooking.status === 'completed'}
                      onClick={() => updateStatus(detailBooking.id, 'completed')} className="gap-1.5 text-[12px]">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                    </Button>
                    <Button size="sm" variant="outline" disabled={updatingId === detailBooking.id || detailBooking.status === 'cancelled'}
                      onClick={() => updateStatus(detailBooking.id, 'cancelled')} className="gap-1.5 text-[12px]">
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button size="sm" variant="outline" disabled={updatingId === detailBooking.id}
                      onClick={() => deleteBooking(detailBooking.id)}
                      className="gap-1.5 text-[12px] text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AgencyAdminBookings;
