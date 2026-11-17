import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { allocate, formatINR, isMembershipActive } from '../../core/court-logic';
import { errMsg, prettyDate, todayIso } from '../../core/dates';
import { Group, Player, Session, Vote } from '../../core/models';

@Component({
  selector: 'app-admin-session',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card mb-4 grid grid-cols-[1fr_auto] items-end gap-3">
      <div class="min-w-0">
        <label class="label" for="sd">Session date</label>
        <input id="sd" type="date" class="input" [ngModel]="date()" (ngModelChange)="date.set($event)" />
      </div>
      @if (!session() && !loading()) {
        <button class="btn-primary" [disabled]="busy()" (click)="createSession()">Create session</button>
      }
      @if (session(); as s) {
        <span class="chip h-11 px-4" [class]="s.status === 'COMPLETED' ? 'bg-brand-100 text-brand-700' : s.status === 'CANCELLED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'">{{ s.status }}</span>
      }
    </div>

    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }

    @if (session(); as s) {
      <div class="card mb-4">
        <h2 class="mb-3 font-semibold">{{ prettyDate(s.session_date, true) }} · {{ alloc().playing }} playing, {{ alloc().courts.length }} court(s)</h2>
        @if (s.status !== 'COMPLETED') {
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="label" for="cb">Courts booked</label>
              <input id="cb" type="number" min="1" [max]="group().max_courts" class="input" [(ngModel)]="courts" />
            </div>
            <div>
              <label class="label" for="ec">Cost per extra court</label>
              <input id="ec" type="number" min="0" class="input" [(ngModel)]="extraCost" />
            </div>
            <div class="flex items-end">
              <button class="btn-primary w-full" [disabled]="busy()" (click)="complete()">Finalise day</button>
            </div>
          </div>
          <p class="mt-2 text-xs text-muted">
            Finalising logs court fees as expenses (Court 1 {{ formatINR(group().base_court_cost) }}) and charges drop-in fees.
          </p>
          <div class="mt-3 flex gap-2">
            @if (s.status === 'OPEN') { <button class="btn-ghost" (click)="setStatus('LOCKED')">Lock voting</button> }
            @if (s.status === 'LOCKED') { <button class="btn-ghost" (click)="setStatus('OPEN')">Reopen voting</button> }
            <button class="btn-danger" (click)="setStatus('CANCELLED')">Cancel day</button>
          </div>
        } @else {
          <p class="text-sm text-muted">Finalised. Charges applied and court fees logged. You can re-finalise after changing votes:</p>
          <button class="btn-ghost mt-2" (click)="setStatus('OPEN')">Reopen</button>
        }
      </div>

      <div class="card !p-0">
        <div class="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Votes (tap to override)</div>
        <div class="divide-y divide-slate-100">
          @for (p of activePlayers(); track p.id) {
            <div class="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <span class="font-medium">{{ p.name }}</span>
                @if (p.tier === 'MEMBER') { <span class="chip ml-2 bg-brand-100 text-brand-700">Member</span> }
                @if (feeOf(p.id) > 0) { <span class="ml-2 text-xs text-muted">{{ formatINR(feeOf(p.id)) }}</span> }
              </div>
              <div class="flex gap-1">
                <button class="rounded-lg px-3 py-1.5 text-xs font-semibold" [class]="voteOf(p.id) === 'IN' ? 'bg-brand-600 text-white' : 'bg-slate-100'" (click)="setVote(p, 'IN')">In</button>
                <button class="rounded-lg px-3 py-1.5 text-xs font-semibold" [class]="voteOf(p.id) === 'OUT' ? 'bg-rose-600 text-white' : 'bg-slate-100'" (click)="setVote(p, 'OUT')">Out</button>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class AdminSessionTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly date = signal(todayIso());
  readonly session = signal<Session | null>(null);
  readonly votes = signal<Vote[]>([]);
  readonly players = signal<Player[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  courts: number | null = null;
  extraCost: number | null = null;
  readonly formatINR = formatINR;
  readonly prettyDate = prettyDate;

  readonly activePlayers = computed(() => this.players().filter((p) => p.status === 'ACTIVE'));
  readonly alloc = computed(() => {
    const pm = new Map(this.players().map((p) => [p.id, p]));
    const date = this.date();
    return allocate(
      this.votes().filter((v) => v.vote_status === 'IN'), this.group().players_per_court, this.group().max_courts,
      (v) => { const p = pm.get(v.player_id); return !!p && isMembershipActive(p, date); },
    );
  });

  constructor() {
    effect(() => {
      this.date();
      void this.load();
    });
  }

  voteOf(playerId: string) { return this.votes().find((v) => v.player_id === playerId)?.vote_status; }
  feeOf(playerId: string) { return this.votes().find((v) => v.player_id === playerId)?.fee_applied ?? 0; }

  private async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const g = this.group();
      const d = this.date();
      const [sessions, players] = await Promise.all([this.api.listSessions(g.id, d, d), this.api.getPlayers(g.id)]);
      this.players.set(players);
      const s = sessions[0] ?? null;
      this.session.set(s);
      this.votes.set(s ? await this.api.getVotes(s.id) : []);
      this.courts = s ? Math.max(s.courts_booked, this.alloc().courts.length) : null;
      this.extraCost = g.extra_court_default_cost;
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try { await fn(); await this.load(); } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }

  createSession() { return this.run(async () => { await this.api.createSession(this.group().id, this.date()); }); }
  setVote(p: Player, status: 'IN' | 'OUT') {
    const s = this.session();
    if (!s || this.voteOf(p.id) === status) return;
    return this.run(() => this.api.adminSetVote(s.id, p.id, status));
  }
  setStatus(status: Session['status']) {
    const s = this.session();
    if (!s) return;
    return this.run(() => this.api.updateSession(s.id, { status }));
  }
  complete() {
    const s = this.session();
    if (!s) return;
    return this.run(() => this.api.completeSession(s.id, this.courts, this.extraCost));
  }
}
