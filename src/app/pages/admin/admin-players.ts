import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { formatINR, isMembershipActive } from '../../core/court-logic';
import { addDays, errMsg, todayIso } from '../../core/dates';
import { Group, Player } from '../../core/models';

@Component({
  selector: 'app-admin-players',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }

    @if (pending().length) {
      <div class="card mb-4 border-amber-200">
        <h2 class="mb-2 font-semibold">Awaiting approval</h2>
        @for (p of pending(); track p.id) {
          <div class="flex items-center justify-between py-1.5 text-sm">
            <span>{{ p.name }} <span class="text-xs text-muted">{{ phones()[p.id] }}</span></span>
            <span class="flex gap-2">
              <button class="btn-primary !px-3 !py-1.5 !text-xs" (click)="patch(p, { status: 'ACTIVE' })">Approve</button>
              <button class="btn-danger !px-3 !py-1.5 !text-xs" (click)="patch(p, { status: 'INACTIVE' })">Reject</button>
            </span>
          </div>
        }
      </div>
    }

    <div class="card mb-4">
      <h2 class="mb-3 font-semibold">Add player</h2>
      <div class="flex flex-wrap gap-3">
        <input class="input !w-auto flex-1" placeholder="Name" [(ngModel)]="newName" />
        <input class="input !w-auto flex-1" placeholder="Phone (optional)" inputmode="tel" [(ngModel)]="newPhone" />
        <button class="btn-primary" [disabled]="newName.trim().length < 2 || busy()" (click)="add()">Add</button>
      </div>
    </div>

    <div class="card !p-0">
      <div class="divide-y divide-slate-100">
        @for (p of active(); track p.id) {
          <div class="px-4 py-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-medium">{{ p.name }}</p>
                <p class="text-xs text-muted">
                  @if (p.tier === 'MEMBER') {
                    {{ memberActive(p) ? 'Member until ' + p.membership_valid_until : 'Membership expired ' + (p.membership_valid_until ?? '') }}
                  } @else { Drop-in }
                  @if (phones()[p.id]) { · {{ phones()[p.id] }} }
                </p>
              </div>
              <div class="flex gap-1.5">
                <button class="btn-ghost !px-3 !py-1.5 !text-xs" (click)="renew(p)">{{ p.tier === 'MEMBER' ? 'Renew' : 'Make member' }}</button>
                @if (p.tier === 'MEMBER') { <button class="btn-ghost !px-3 !py-1.5 !text-xs" (click)="patch(p, { tier: 'DROP_IN' })">To drop-in</button> }
                <button class="btn-danger !px-3 !py-1.5 !text-xs" (click)="patch(p, { status: 'INACTIVE' })">Remove</button>
              </div>
            </div>
            @if (renewing()?.id === p.id) {
              <div class="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                <div><label class="label" for="ra-{{ p.id }}">Amount paid (₹)</label><input id="ra-{{ p.id }}" name="ra" type="number" min="1" class="input" [(ngModel)]="renewAmount" /></div>
                <div><label class="label" for="rs-{{ p.id }}">Valid from</label><input id="rs-{{ p.id }}" name="rs" type="date" class="input" [(ngModel)]="renewStart" /></div>
                <div><label class="label" for="re-{{ p.id }}">Valid until</label><input id="re-{{ p.id }}" name="re" type="date" class="input" [(ngModel)]="renewEnd" /></div>
                <div class="flex gap-2 sm:col-span-3">
                  <button class="btn-primary !px-3 !py-1.5 !text-xs" [disabled]="busy()" (click)="confirmRenew()">Record payment</button>
                  <button class="btn-ghost !px-3 !py-1.5 !text-xs" (click)="renewing.set(null)">Cancel</button>
                </div>
              </div>
            }
          </div>
        } @empty { <p class="p-4 text-sm text-muted">No players yet.</p> }
      </div>
    </div>

    @if (notice()) { <p class="mt-4 rounded-xl bg-slate-100 p-3 text-xs text-muted">{{ notice() }}</p> }
    @if (inactive().length) {
      <details class="mt-4 text-sm">
        <summary class="cursor-pointer text-muted">Removed players ({{ inactive().length }})</summary>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          @if (confirmPurge()) {
            <span class="text-xs text-muted">Permanently delete removed players?</span>
            <button class="btn-danger !px-3 !py-1.5 !text-xs" [disabled]="busy()" (click)="purge()">Yes, delete</button>
            <button class="btn-ghost !px-3 !py-1.5 !text-xs" (click)="confirmPurge.set(false)">Cancel</button>
          } @else {
            <button class="btn-danger !px-3 !py-1.5 !text-xs" (click)="confirmPurge.set(true)">Clear all removed</button>
          }
        </div>
        @for (p of inactive(); track p.id) {
          <div class="flex items-center justify-between py-1.5"><span>{{ p.name }}</span>
            <button class="btn-ghost !px-3 !py-1.5 !text-xs" (click)="patch(p, { status: 'ACTIVE' })">Restore</button></div>
        }
      </details>
    }
  `,
})
export class AdminPlayersTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly players = signal<Player[]>([]);
  readonly phones = signal<Record<string, string>>({});
  readonly busy = signal(false);
  readonly error = signal('');
  readonly renewing = signal<Player | null>(null);
  readonly confirmPurge = signal(false);
  readonly notice = signal('');
  renewAmount = 0;
  renewStart = '';
  renewEnd = '';
  newName = '';
  newPhone = '';
  readonly formatINR = formatINR;

  readonly pending = computed(() => this.players().filter((p) => p.status === 'PENDING'));
  readonly active = computed(() => this.players().filter((p) => p.status === 'ACTIVE'));
  readonly inactive = computed(() => this.players().filter((p) => p.status === 'INACTIVE'));

  constructor() {
    effect(() => { this.group(); void this.load(); });
  }

  memberActive(p: Player) { return isMembershipActive(p, todayIso()); }

  private async load() {
    try {
      const [players, phones] = await Promise.all([this.api.getPlayers(this.group().id), this.api.playerPhones()]);
      this.players.set(players);
      this.phones.set(phones);
    } catch (e) { this.error.set(errMsg(e)); }
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try { await fn(); await this.load(); } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }

  patch(p: Player, patch: Partial<Player>) { return this.run(() => this.api.updatePlayer(p.id, patch)); }

  purge() {
    return this.run(async () => {
      const before = this.inactive().length;
      const deleted = await this.api.purgeRemovedPlayers(this.group().id);
      this.confirmPurge.set(false);
      const kept = before - deleted;
      this.notice.set(`Deleted ${deleted}.` + (kept > 0 ? ` ${kept} kept because they have payments or charged games.` : ''));
    });
  }

  add() {
    return this.run(async () => {
      await this.api.addPlayer(this.group().id, this.newName, this.newPhone);
      this.newName = '';
      this.newPhone = '';
    });
  }

  renew(p: Player) {
    const g = this.group();
    const start = p.membership_valid_until && p.membership_valid_until >= todayIso() ? addDays(p.membership_valid_until, 1) : todayIso();
    this.error.set('');
    this.renewAmount = g.membership_fee;
    this.renewStart = start;
    this.renewEnd = addDays(start, 29);
    this.renewing.set(p);
  }

  confirmRenew() {
    const p = this.renewing();
    if (!p) return;
    const amount = Number(this.renewAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(this.renewEnd) || this.renewEnd < this.renewStart) {
      this.error.set('Enter a valid amount and an end date on or after the start date');
      return;
    }
    return this.run(async () => {
      await this.api.recordMembership(p.id, amount, this.renewStart, this.renewEnd, null);
      this.renewing.set(null);
    });
  }
}
