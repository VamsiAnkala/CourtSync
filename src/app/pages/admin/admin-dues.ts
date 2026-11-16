import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { formatINR } from '../../core/court-logic';
import { downloadCsv, toCsv } from '../../core/csv';
import { errMsg, prettyDate, todayIso } from '../../core/dates';
import { Group, Player, PlayerBalance, Session, Vote } from '../../core/models';

@Component({
  selector: 'app-admin-dues',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }
    <div class="mb-3 flex items-center justify-between">
      <p class="text-sm text-muted">Outstanding: <span class="font-semibold text-rose-600">{{ formatINR(totalDue()) }}</span></p>
      <button class="btn-ghost" (click)="exportCsv()">Export CSV</button>
    </div>
    <div class="card !p-0">
      <div class="divide-y divide-slate-100">
        @for (r of rows(); track r.player.id) {
          <div class="px-4 py-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <button class="min-w-0 text-left" (click)="toggle(r.player)">
                <p class="truncate font-medium">{{ r.player.name }}</p>
                <p class="text-xs text-muted">accrued {{ formatINR(r.b.accrued) }} · paid {{ formatINR(r.b.settled) }}</p>
              </button>
              <div class="flex items-center gap-2">
                <span class="font-bold" [class.text-rose-600]="r.b.balance > 0">{{ formatINR(r.b.balance) }}</span>
                @if (r.b.balance > 0) {
                  <button class="btn-primary !px-3 !py-1.5 !text-xs" [disabled]="busy()" (click)="settle(r.player, r.b.balance)">Mark paid</button>
                }
              </div>
            </div>
            @if (settling() === r.player.id) {
              <div class="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
                <div class="flex-1"><label class="label" for="sa-{{ r.player.id }}">Amount received (₹)</label><input id="sa-{{ r.player.id }}" name="sa" type="number" min="1" class="input" [(ngModel)]="settleAmount" /></div>
                <button class="btn-primary" [disabled]="busy()" (click)="confirmSettle()">Record</button>
                <button class="btn-ghost" (click)="settling.set(null)">Cancel</button>
              </div>
            }
            @if (open() === r.player.id) {
              <div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
                @for (d of detail(); track d.id) {
                  <div class="flex justify-between py-0.5">
                    <span>{{ prettyDate(d.sessions.session_date) }}</span>
                    <span>{{ d.fee_applied > 0 ? formatINR(d.fee_applied) : 'covered' }}</span>
                  </div>
                } @empty { <p class="text-muted">No games.</p> }
              </div>
            }
          </div>
        } @empty {
          <p class="p-4 text-sm text-muted">No players with dues yet.</p>
        }
      </div>
    </div>
  `,
})
export class AdminDuesTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly players = signal<Player[]>([]);
  readonly balances = signal<PlayerBalance[]>([]);
  readonly open = signal<string | null>(null);
  readonly detail = signal<(Vote & { sessions: Session })[]>([]);
  readonly busy = signal(false);
  readonly settling = signal<string | null>(null);
  settleAmount = 0;
  readonly error = signal('');
  readonly formatINR = formatINR;
  readonly prettyDate = prettyDate;

  readonly rows = computed(() => {
    const byId = new Map(this.players().map((p) => [p.id, p]));
    return this.balances()
      .filter((b) => b.accrued > 0 || b.settled > 0)
      .map((b) => ({ b, player: byId.get(b.player_id)! }))
      .filter((r) => !!r.player)
      .sort((a, c) => c.b.balance - a.b.balance);
  });
  readonly totalDue = computed(() => this.balances().reduce((s, b) => s + Math.max(0, b.balance), 0));

  constructor() {
    effect(() => { this.group(); void this.load(); });
  }

  private async load() {
    try {
      const [players, balances] = await Promise.all([this.api.getPlayers(this.group().id), this.api.balances(this.group().id)]);
      this.players.set(players);
      this.balances.set(balances);
    } catch (e) { this.error.set(errMsg(e)); }
  }

  async toggle(p: Player) {
    if (this.open() === p.id) { this.open.set(null); return; }
    this.open.set(p.id);
    try { this.detail.set(await this.api.myHistory(p.id)); } catch (e) { this.error.set(errMsg(e)); }
  }

  settle(p: Player, due: number) {
    this.error.set('');
    this.settleAmount = due;
    this.settling.set(p.id);
  }

  async confirmSettle() {
    const id = this.settling();
    if (!id) return;
    const amount = Number(this.settleAmount);
    if (!Number.isFinite(amount) || amount <= 0) { this.error.set('Enter a valid amount'); return; }
    this.busy.set(true);
    try {
      await this.api.recordSettlement(this.group().id, id, amount, todayIso(), null);
      this.settling.set(null);
      await this.load();
    } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }

  exportCsv() {
    const csv = toCsv(['Player', 'Accrued', 'Paid', 'Balance'], this.rows().map((r) => [r.player.name, r.b.accrued, r.b.settled, r.b.balance]));
    downloadCsv(`courtsync-dues-${todayIso()}.csv`, csv);
  }
}
