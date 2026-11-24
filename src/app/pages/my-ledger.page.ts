import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { formatINR } from '../core/court-logic';
import { errMsg, prettyDate } from '../core/dates';
import { Group, LedgerPayment, Player, Session, Vote } from '../core/models';
import { hue, initials } from '../core/ui';
import { ThemeToggle } from '../core/theme-toggle';

@Component({
  selector: 'app-my-ledger',
  imports: [RouterLink, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page-enter mx-auto min-h-dvh max-w-md px-4 pb-16 pt-6">
      <div class="flex items-center justify-between gap-3">
        <a class="back-link" [routerLink]="['/g', slug(), 'today']">← Back to today</a>
        <app-theme-toggle />
      </div>
      <h1 class="mb-4 mt-2 text-2xl font-extrabold">History</h1>

      @if (loading()) {
        <div class="space-y-4" aria-busy="true"><div class="skeleton h-44"></div><div class="skeleton h-32"></div></div>
      } @else if (error()) {
        <p class="alert error">{{ error() }}</p>
      } @else if (!me()) {
        <div class="card text-center text-sm text-muted">Pick your name on the Today page first.</div>
      } @else {
        <section class="hero">
          <div class="flex items-center gap-3">
            <span class="avatar" [style.--h]="hue(me()!.name)">{{ initials(me()!.name) }}</span>
            <div>
              <p class="text-sm font-semibold">{{ me()!.name }}</p>
              @if (me()!.tier === 'MEMBER') {
                <p class="text-xs opacity-80">Membership {{ me()!.membership_valid_until ? 'valid until ' + me()!.membership_valid_until : 'not active' }}</p>
              }
            </div>
          </div>
          <p class="mt-5 text-xs font-semibold uppercase tracking-widest opacity-75">{{ balance().balance > 0 ? 'You owe' : 'All settled' }}</p>
          @for (b of [balance().balance]; track b) {
            <p class="hero-number">{{ formatINR(b) }}</p>
          }
          <div class="mt-4 flex gap-4 text-xs">
            <span class="rounded-full bg-white/15 px-3 py-1 font-medium">Accrued {{ formatINR(balance().accrued) }}</span>
            <span class="rounded-full bg-white/15 px-3 py-1 font-medium">Paid {{ formatINR(balance().settled) }}</span>
          </div>
        </section>

        @if (balance().balance > 0 && group()?.upi_id; as upi) {
          <section class="card mt-4">
            <p class="text-xs font-medium text-muted">Pay to UPI ID</p>
            <p class="font-display text-lg font-bold">{{ upi }}</p>
            <a class="btn-primary mt-3 w-full" [href]="upiLink(upi)">Pay {{ formatINR(balance().balance) }} via UPI</a>
          </section>
        }

        <h2 class="mb-2 mt-7 text-sm font-bold">Attendance</h2>
        <div class="card !p-2">
          @for (h of history(); track h.id; let i = $index) {
            <div class="row justify-between text-sm" [style.--i]="i">
              <span class="flex-1">{{ prettyDate(h.sessions.session_date) }}</span>
              @if (h.sessions.status === 'COMPLETED') {
                <span class="chip" [class]="h.fee_applied > 0 ? 'bg-rose-50 text-rose-700' : 'bg-brand-100 text-brand-700'">{{ h.fee_applied > 0 ? formatINR(h.fee_applied) : 'Covered' }}</span>
              } @else {
                <span class="chip bg-slate-100 text-slate-600">{{ h.sessions.status.toLowerCase() }}</span>
              }
            </div>
          } @empty {
            <p class="p-3 text-sm text-muted">No games yet.</p>
          }
        </div>

        <h2 class="mb-2 mt-7 text-sm font-bold">Payments</h2>
        <div class="card !p-2">
          @for (p of payments(); track p.id; let i = $index) {
            <div class="row justify-between text-sm" [style.--i]="i">
              <span class="flex-1">{{ prettyDate(p.paid_on) }} · {{ p.payment_type === 'MEMBERSHIP' ? 'Membership' : 'Settlement' }}</span>
              <span class="font-semibold">{{ formatINR(p.amount) }}</span>
            </div>
          } @empty {
            <p class="p-3 text-sm text-muted">No payments recorded.</p>
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
  readonly hue = hue;
  readonly initials = initials;
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
