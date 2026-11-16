import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { formatINR } from '../core/court-logic';
import { errMsg, prettyDate } from '../core/dates';
import { Group, LedgerPayment, Player, Session, Vote } from '../core/models';

@Component({
  selector: 'app-my-ledger',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto min-h-dvh max-w-md px-4 pb-16 pt-6">
      <a class="text-sm text-brand-700" [routerLink]="['/g', slug(), 'today']">← Back to today</a>
      <h1 class="mb-4 mt-2 text-xl font-bold">My ledger</h1>

      @if (loading()) {
        <p class="mt-16 text-center text-muted">Loading…</p>
      } @else if (error()) {
        <p class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p>
      } @else if (!me()) {
        <div class="card text-center text-sm text-muted">Pick your name on the Today page first.</div>
      } @else {
        <section class="card">
          <p class="text-sm text-muted">{{ me()!.name }}</p>
          <p class="mt-1 text-4xl font-extrabold" [class.text-rose-600]="balance().balance > 0" [class.text-brand-600]="balance().balance <= 0">
            {{ formatINR(balance().balance) }}
          </p>
          <p class="text-xs text-muted">pending · accrued {{ formatINR(balance().accrued) }} · paid {{ formatINR(balance().settled) }}</p>
          @if (balance().balance > 0 && group()?.upi_id; as upi) {
            <div class="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
              <p class="text-xs text-muted">Pay to UPI ID</p>
              <p class="font-semibold">{{ upi }}</p>
              <a class="btn-primary mt-3 w-full" [href]="upiLink(upi)">Pay {{ formatINR(balance().balance) }} via UPI</a>
            </div>
          }
          @if (me()!.tier === 'MEMBER') {
            <p class="mt-3 text-xs text-muted">
              Membership {{ me()!.membership_valid_until ? 'valid until ' + me()!.membership_valid_until : 'not active' }}
            </p>
          }
        </section>

        <h2 class="mb-2 mt-6 text-sm font-semibold">Attendance</h2>
        <div class="card divide-y divide-slate-100 !p-0">
          @for (h of history(); track h.id) {
            <div class="flex items-center justify-between px-4 py-3 text-sm">
              <span>{{ prettyDate(h.sessions.session_date) }}</span>
              @if (h.sessions.status === 'COMPLETED') {
                <span [class.text-muted]="h.fee_applied === 0">{{ h.fee_applied > 0 ? formatINR(h.fee_applied) : 'Covered' }}</span>
              } @else {
                <span class="chip bg-slate-100 text-slate-600">{{ h.sessions.status.toLowerCase() }}</span>
              }
            </div>
          } @empty {
            <p class="p-4 text-sm text-muted">No games yet.</p>
          }
        </div>

        <h2 class="mb-2 mt-6 text-sm font-semibold">Payments</h2>
        <div class="card divide-y divide-slate-100 !p-0">
          @for (p of payments(); track p.id) {
            <div class="flex items-center justify-between px-4 py-3 text-sm">
              <span>{{ prettyDate(p.paid_on) }} · {{ p.payment_type === 'MEMBERSHIP' ? 'Membership' : 'Settlement' }}</span>
              <span class="font-medium">{{ formatINR(p.amount) }}</span>
            </div>
          } @empty {
            <p class="p-4 text-sm text-muted">No payments recorded.</p>
          }
        </div>
      }
    </main>
  `,
})
export class MyLedgerPage {
  private api = inject(ApiService);
  readonly slug = input.required<string>();
  readonly loading = signal(true);
  readonly error = signal('');
  readonly group = signal<Group | null>(null);
  readonly me = signal<Player | null>(null);
  readonly balance = signal({ accrued: 0, settled: 0, balance: 0 });
  readonly history = signal<(Vote & { sessions: Session })[]>([]);
  readonly payments = signal<LedgerPayment[]>([]);
  readonly formatINR = formatINR;
  readonly prettyDate = prettyDate;

  constructor() {
    effect(() => {
      this.slug();
      void this.load();
    });
  }

  upiLink(upi: string) {
    return `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(this.group()?.name ?? 'CourtSync')}&am=${this.balance().balance}&cu=INR`;
  }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const g = await this.api.getGroup(this.slug());
      this.group.set(g);
      const id = await this.api.myPlayerId();
      if (!g || !id) return;
      const [players, bal, hist, pays] = await Promise.all([
        this.api.getPlayers(g.id), this.api.myBalance(), this.api.myHistory(id), this.api.myPayments(id),
      ]);
      this.me.set(players.find((p) => p.id === id) ?? null);
      this.balance.set(bal);
      this.history.set(hist);
      this.payments.set(pays);
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.loading.set(false);
    }
  }
}
