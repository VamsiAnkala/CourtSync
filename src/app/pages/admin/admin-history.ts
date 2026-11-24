import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { allocate, formatINR, isMembershipActive } from '../../core/court-logic';
import { addDays, errMsg, prettyDate, todayIso } from '../../core/dates';
import { Expense, Group, Player, Session, Vote } from '../../core/models';

@Component({
  selector: 'app-admin-history',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }
    <div class="card !p-0">
      <div class="divide-y divide-slate-100">
        @for (s of sessions(); track s.id) {
          <div class="px-4 py-3 text-sm">
            <button class="flex w-full items-center justify-between text-left" (click)="toggle(s)">
              <span class="font-medium">{{ prettyDate(s.session_date, true) }}</span>
              <span class="chip" [class]="s.status === 'COMPLETED' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'">{{ s.status.toLowerCase() }}</span>
            </button>
            @if (open() === s.id) {
              <div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
                <p class="mb-2 font-semibold">{{ inVotes().length }} in · {{ members() }} members · {{ inVotes().length - members() }} drop-ins · {{ alloc().courts.length }} court(s)</p>
                @for (v of inVotes(); track v.id) {
                  <div class="flex justify-between py-0.5"><span>{{ nameOf(v.player_id) }}</span><span>{{ v.fee_applied > 0 ? formatINR(v.fee_applied) : '' }}</span></div>
                }
                @if (dayExpenses().length) {
                  <p class="mb-1 mt-3 font-semibold">Expenses</p>
                  @for (e of dayExpenses(); track e.id) {
                    <div class="flex justify-between py-0.5"><span>{{ e.description || e.category }}</span><span>{{ formatINR(e.amount) }}</span></div>
                  }
                }
              </div>
            }
          </div>
        } @empty { <p class="p-4 text-sm text-muted">No sessions in the last {{ days() }} days.</p> }
      </div>
    </div>
    <div class="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
      <span>Showing the last {{ days() }} days</span>
      <button class="btn-ghost !px-3.5 !py-2" (click)="loadOlder()">Load older</button>
    </div>
  `,
})
export class AdminHistoryTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly sessions = signal<Session[]>([]);
  readonly players = signal<Player[]>([]);
  readonly open = signal<string | null>(null);
  readonly votes = signal<Vote[]>([]);
  readonly dayExpenses = signal<Expense[]>([]);
  readonly error = signal('');
  readonly days = signal(90);
  readonly formatINR = formatINR;
  readonly prettyDate = prettyDate;

  readonly playerMap = computed(() => new Map(this.players().map((p) => [p.id, p])));
  readonly inVotes = computed(() => this.votes().filter((v) => v.vote_status === 'IN'));
  readonly openDate = computed(() => this.sessions().find((s) => s.id === this.open())?.session_date ?? '');
  readonly members = computed(() => {
    const date = this.openDate();
    const pm = this.playerMap();
    return this.inVotes().filter((v) => { const p = pm.get(v.player_id); return !!p && isMembershipActive(p, date); }).length;
  });
  readonly alloc = computed(() => {
    const date = this.openDate();
    const pm = this.playerMap();
    return allocate(
      this.inVotes(), this.group().players_per_court, this.group().max_courts,
      (v) => { const p = pm.get(v.player_id); return !!p && isMembershipActive(p, date); },
    );
  });

  constructor() {
    effect(() => { this.group(); this.days.set(90); void this.load(); });
  }

  nameOf(id: string) { return this.playerMap().get(id)?.name ?? 'Unknown'; }

  private async load() {
    try {
      const [sessions, players] = await Promise.all([
        this.api.listSessions(this.group().id, addDays(todayIso(), -this.days()), todayIso()), this.api.getPlayers(this.group().id),
      ]);
      this.sessions.set(sessions);
      this.players.set(players);
    } catch (e) { this.error.set(errMsg(e)); }
  }

  async loadOlder() {
    this.days.update((d) => d + 90);
    await this.load();
  }

  async toggle(s: Session) {
    if (this.open() === s.id) { this.open.set(null); return; }
    this.open.set(s.id);
    try {
      const [votes, expenses] = await Promise.all([this.api.getVotes(s.id), this.api.expenses(s.group_id, s.session_date, s.session_date)]);
      this.votes.set(votes);
      this.dayExpenses.set(expenses);
    } catch (e) { this.error.set(errMsg(e)); }
  }
}
