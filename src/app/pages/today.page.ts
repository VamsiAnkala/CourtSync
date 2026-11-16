import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { allocate, coverageFor, formatINR, isMembershipActive } from '../core/court-logic';
import { errMsg, prettyDate } from '../core/dates';
import { Group, Player, Session, Vote } from '../core/models';
import { formatRoster, whatsappShareUrl } from '../core/whatsapp';

@Component({
  selector: 'app-today',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto min-h-dvh max-w-md px-4 pb-24 pt-6">
      @if (loading()) {
        <div class="mt-24 text-center text-muted">Loading CourtSync…</div>
      } @else if (fatal()) {
        <div class="card mt-10 text-center">
          <p class="text-lg font-semibold">{{ fatal() }}</p>
          <button class="btn-ghost mt-4" (click)="load()">Try again</button>
        </div>
      } @else if (group(); as g) {
        <header class="mb-5 flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-brand-600">CourtSync</p>
            <h1 class="text-xl font-bold">{{ g.name }}</h1>
          </div>
          <a class="btn-ghost !px-3 !py-2" [routerLink]="['/g', slug(), 'me']">My ledger</a>
        </header>

        @if (!me()) {
          <section class="card">
            <h2 class="text-lg font-semibold">Who are you?</h2>
            <p class="mb-4 text-sm text-muted">Pick your name once. This device will remember you.</p>
            <div class="max-h-72 space-y-2 overflow-y-auto">
              @for (p of activePlayers(); track p.id) {
                <button class="btn-ghost w-full !justify-between" (click)="claim(p)">
                  <span>{{ p.name }}</span>
                  <span class="chip" [class]="p.tier === 'MEMBER' ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'">
                    {{ p.tier === 'MEMBER' ? 'Member' : 'Drop-in' }}
                  </span>
                </button>
              }
            </div>
            <div class="mt-5 border-t border-slate-100 pt-4">
              <h3 class="mb-2 text-sm font-semibold">Not on the list? Register as a drop-in</h3>
              <label class="label" for="rn">Name</label>
              <input id="rn" class="input mb-2" [value]="newName()" (input)="newName.set($any($event.target).value)" />
              <label class="label" for="rp">Phone</label>
              <input id="rp" class="input mb-3" inputmode="tel" [value]="newPhone()" (input)="newPhone.set($any($event.target).value)" />
              <button class="btn-primary w-full" [disabled]="newName().trim().length < 2 || busy()" (click)="register()">Register</button>
              <p class="mt-2 text-xs text-muted">The admin approves new players before they can vote.</p>
            </div>
          </section>
        } @else if (me(); as p) {
          <section class="card bg-gradient-to-br from-brand-600 to-emerald-800 text-white !ring-0">
            <p class="text-sm opacity-80">{{ dateLabel() }}</p>
            @if (g.venue || g.play_time) {
              <p class="text-sm opacity-80">{{ [g.venue, g.play_time].filter(isTruthy).join(' · ') }}</p>
            }
            <div class="mt-3 flex items-end gap-2">
              <span class="text-6xl font-extrabold leading-none">{{ alloc().playing }}</span>
              <span class="pb-1 text-sm opacity-80">playing · {{ alloc().courts.length }} court{{ alloc().courts.length > 1 ? 's' : '' }}</span>
            </div>
            <div class="mt-4 space-y-2">
              @for (c of alloc().courts; track c.number) {
                <div>
                  <div class="flex justify-between text-xs font-medium">
                    <span>Court {{ c.number }}: {{ c.status === 'TRIGGERED' ? 'Triggered' : c.status === 'FULL' ? 'Full' : 'Booked' }}</span>
                    <span>{{ c.players.length }}/{{ c.capacity }}</span>
                  </div>
                  <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/25">
                    <div class="h-full rounded-full bg-white transition-all" [style.width.%]="(c.players.length / c.capacity) * 100"></div>
                  </div>
                </div>
              }
            </div>
            @if (alloc().courts[0].players.length >= g.players_per_court && alloc().courts.length === 1) {
              <p class="mt-3 text-xs opacity-90">Court 1 is full. The next player triggers Court 2.</p>
            }
          </section>

          @if (p.status === 'PENDING') {
            <div class="card mt-4 text-center text-sm text-amber-700">Your registration is awaiting admin approval. You'll be able to vote once approved.</div>
          } @else if (session(); as s) {
            @if (s.status !== 'OPEN') {
              <div class="card mt-4 text-center text-sm text-muted">
                Voting is {{ s.status === 'CANCELLED' ? 'cancelled for today' : 'closed' }}.
              </div>
            } @else {
              <section class="card mt-4">
                <div class="mb-3 flex items-center justify-between">
                  <div>
                    <p class="text-sm font-semibold">{{ p.name }}</p>
                    <p class="text-xs text-muted">
                      @switch (coverage()) {
                        @case ('MEMBERSHIP') { Covered by membership }
                        @case ('EXPIRED') { Membership expired · {{ formatINR(g.daily_dropin_fee) }} drop-in fee applies }
                        @default { {{ formatINR(g.daily_dropin_fee) }} drop-in fee applies }
                      }
                    </p>
                  </div>
                  @if (myPosition(); as pos) {
                    <span class="chip" [class]="pos.waitlisted ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'">
                      {{ pos.waitlisted ? 'Waitlist #' + pos.n : 'Court ' + pos.court }}
                    </span>
                  }
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <button class="btn h-14 text-base" [class]="myVote() === 'IN' ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'"
                          [disabled]="busy()" (click)="vote('IN')">I'm In</button>
                  <button class="btn h-14 text-base" [class]="myVote() === 'OUT' ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'"
                          [disabled]="busy()" (click)="vote('OUT')">Out</button>
                </div>
              </section>
            }
          }

          @if (error()) {
            <p class="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p>
          }

          @for (c of alloc().courts; track c.number) {
            <section class="card mt-4">
              <h3 class="mb-2 flex justify-between text-sm font-semibold">
                <span>Court {{ c.number }}</span><span class="text-muted">{{ c.players.length }}/{{ c.capacity }}</span>
              </h3>
              <ol class="space-y-1.5 text-sm">
                @for (v of c.players; track v.id; let i = $index) {
                  <li class="flex items-center justify-between">
                    <span [class.font-semibold]="v.player_id === p.id">{{ i + 1 }}. {{ nameOf(v.player_id) }}</span>
                    @if (isMember(v.player_id)) { <span class="chip bg-brand-100 text-brand-700">Member</span> }
                  </li>
                } @empty {
                  <li class="text-muted">No players yet</li>
                }
              </ol>
            </section>
          }
          @if (alloc().waitlist.length) {
            <section class="card mt-4">
              <h3 class="mb-2 text-sm font-semibold">Waitlist</h3>
              <ol class="space-y-1.5 text-sm">
                @for (v of alloc().waitlist; track v.id; let i = $index) { <li>{{ i + 1 }}. {{ nameOf(v.player_id) }}</li> }
              </ol>
            </section>
          }

          <div class="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/90 p-3 backdrop-blur">
            <div class="mx-auto flex max-w-md gap-2">
              <a class="btn-primary flex-1" [href]="shareUrl()" target="_blank" rel="noopener">Post roster to WhatsApp</a>
              <button class="btn-ghost" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
            </div>
          </div>
        }

        <footer class="mt-8 text-center text-xs text-muted">
          <a [routerLink]="['/g', slug(), 'admin']" class="underline">Admin</a>
        </footer>
      }
    </main>
  `,
})
export class TodayPage implements OnDestroy {
  private api = inject(ApiService);
  readonly slug = input.required<string>();

  readonly loading = signal(true);
  readonly fatal = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly copied = signal(false);
  readonly group = signal<Group | null>(null);
  readonly players = signal<Player[]>([]);
  readonly session = signal<Session | null>(null);
  readonly votes = signal<Vote[]>([]);
  readonly myId = signal<string | null>(null);
  readonly newName = signal('');
  readonly newPhone = signal('');

  readonly formatINR = formatINR;
  readonly isTruthy = (x: unknown) => !!x;
  private unwatch?: () => void;

  readonly playerMap = computed(() => new Map(this.players().map((p) => [p.id, p])));
  readonly activePlayers = computed(() => this.players().filter((p) => p.status === 'ACTIVE'));
  readonly me = computed(() => (this.myId() ? this.playerMap().get(this.myId()!) ?? null : null));
  readonly inVotes = computed(() => this.votes().filter((v) => v.vote_status === 'IN'));
  readonly alloc = computed(() => {
    const g = this.group();
    const s = this.session();
    const pm = this.playerMap();
    const date = s?.session_date ?? '';
    return allocate(
      this.inVotes(), g?.players_per_court ?? 7, g?.max_courts ?? 3,
      (v) => { const p = pm.get(v.player_id); return !!p && isMembershipActive(p, date); },
    );
  });
  readonly myVote = computed(() => this.votes().find((v) => v.player_id === this.myId())?.vote_status ?? null);
  readonly myPosition = computed(() => {
    const id = this.myId();
    const a = this.alloc();
    for (const c of a.courts) if (c.players.some((v) => v.player_id === id)) return { waitlisted: false, court: c.number, n: 0 };
    const w = a.waitlist.findIndex((v) => v.player_id === id);
    return w >= 0 ? { waitlisted: true, court: 0, n: w + 1 } : null;
  });
  readonly coverage = computed(() => {
    const p = this.me();
    const s = this.session();
    return p && s ? coverageFor(p, s.session_date) : 'DROP_IN_FEE';
  });
  readonly dateLabel = computed(() => (this.session() ? prettyDate(this.session()!.session_date, true) : ''));
  readonly rosterText = computed(() => {
    const g = this.group();
    const s = this.session();
    return g && s ? formatRoster(g, s.session_date, this.alloc(), this.playerMap()) : '';
  });
  readonly shareUrl = computed(() => whatsappShareUrl(this.rosterText() + '\n\n' + location.origin + '/g/' + this.slug() + '/today'));

  constructor() {
    effect(() => {
      this.slug();
      void this.load();
    });
  }

  ngOnDestroy() { this.unwatch?.(); }

  async load() {
    this.loading.set(true);
    this.fatal.set('');
    this.unwatch?.();
    try {
      const g = await this.api.getGroup(this.slug());
      if (!g) { this.fatal.set('Group not found'); return; }
      this.group.set(g);
      const [players, myId] = await Promise.all([this.api.getPlayers(g.id), this.api.myPlayerId()]);
      this.players.set(players);
      this.myId.set(myId);
      const session = await this.api.todaySession(this.slug()).catch((e) => {
        this.fatal.set(errMsg(e) === 'no session today' ? 'No game scheduled today.' : errMsg(e));
        return null;
      });
      if (!session) return;
      this.session.set(session);
      this.votes.set(await this.api.getVotes(session.id));
      this.unwatch = this.api.watchSession(session.id, () => void this.refresh());
    } catch (e) {
      this.fatal.set(errMsg(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async refresh() {
    const s = this.session();
    if (!s) return;
    const [votes, players, sessions] = await Promise.all([
      this.api.getVotes(s.id), this.api.getPlayers(s.group_id), this.api.todaySession(this.slug()).catch(() => s),
    ]);
    this.votes.set(votes);
    this.players.set(players);
    this.session.set(sessions);
  }

  async claim(p: Player) {
    await this.run(async () => { await this.api.claimPlayer(p.id); this.myId.set(p.id); });
  }

  async register() {
    await this.run(async () => {
      const id = await this.api.registerPlayer(this.slug(), this.newName(), this.newPhone());
      this.players.set(await this.api.getPlayers(this.group()!.id));
      this.myId.set(id);
    });
  }

  async vote(status: 'IN' | 'OUT') {
    const s = this.session();
    if (!s || this.myVote() === status) return;
    await this.run(async () => { await this.api.castVote(s.id, status); await this.refresh(); });
  }

  async copy() {
    await navigator.clipboard.writeText(this.rosterText());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1800);
  }

  nameOf(id: string) { return this.playerMap().get(id)?.name ?? 'Unknown'; }
  isMember(id: string) { return this.playerMap().get(id)?.tier === 'MEMBER'; }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try { await fn(); } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }
}
