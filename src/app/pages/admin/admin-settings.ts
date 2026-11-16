import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { errMsg } from '../../core/dates';
import { ExtraCourtCostMode, Group } from '../../core/models';

const DAYS = [
  { n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 7, l: 'Sun' },
];

@Component({
  selector: 'app-admin-settings',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message()) { <p class="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-700">{{ message() }}</p> }
    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }

    <form class="card mb-4 grid gap-4 sm:grid-cols-2" (ngSubmit)="save()">
      <div class="sm:col-span-2"><label class="label" for="n">Group name</label><input id="n" name="name" class="input" [(ngModel)]="f.name" /></div>
      <div><label class="label" for="v">Venue</label><input id="v" name="venue" class="input" [(ngModel)]="f.venue" /></div>
      <div><label class="label" for="pt">Play time</label><input id="pt" name="play_time" class="input" [(ngModel)]="f.play_time" /></div>
      <div><label class="label" for="ppc">Players per court</label><input id="ppc" name="ppc" type="number" min="1" class="input" [(ngModel)]="f.players_per_court" /></div>
      <div><label class="label" for="mc">Max courts</label><input id="mc" name="mc" type="number" min="1" class="input" [(ngModel)]="f.max_courts" /></div>
      <div><label class="label" for="bc">Court 1 cost per day (₹)</label><input id="bc" name="bc" type="number" min="0" class="input" [(ngModel)]="f.base_court_cost" /></div>
      <div><label class="label" for="ecc">Extra court default cost (₹)</label><input id="ecc" name="ecc" type="number" min="0" class="input" [(ngModel)]="f.extra_court_default_cost" /></div>
      <div><label class="label" for="mf">Membership fee (₹)</label><input id="mf" name="mf" type="number" min="0" class="input" [(ngModel)]="f.membership_fee" /></div>
      <div><label class="label" for="df">Daily drop-in fee (₹)</label><input id="df" name="df" type="number" min="0" class="input" [(ngModel)]="f.daily_dropin_fee" /></div>
      <div>
        <label class="label" for="mode">Who pays for extra courts?</label>
        <select id="mode" name="mode" class="input" [(ngModel)]="f.extra_court_cost_mode">
          <option value="POOL">Admin pool pays</option>
          <option value="SPLIT">Split among Court 2+ players</option>
        </select>
      </div>
      <div><label class="label" for="ct">Voting cutoff (24h, optional)</label><input id="ct" name="ct" type="time" class="input" [(ngModel)]="f.cutoff_time" /></div>
      <div class="sm:col-span-2"><label class="label" for="upi">UPI ID</label><input id="upi" name="upi" class="input" [(ngModel)]="f.upi_id" /></div>
      <div class="sm:col-span-2">
        <span class="label">Game days</span>
        <div class="flex flex-wrap gap-2">
          @for (d of days; track d.n) {
            <button type="button" class="rounded-xl px-3 py-1.5 text-sm font-medium" [class]="f.play_days.includes(d.n) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'" (click)="toggleDay(d.n)">{{ d.l }}</button>
          }
        </div>
      </div>
      <div class="sm:col-span-2"><button class="btn-primary" type="submit" [disabled]="busy()">Save settings</button></div>
    </form>

    <div class="card">
      <h2 class="mb-3 font-semibold">Change admin PIN</h2>
      <div class="flex gap-3">
        <input type="password" class="input" placeholder="New PIN (min 4 characters)" [(ngModel)]="newPin" name="newPin" autocomplete="new-password" />
        <button class="btn-ghost" [disabled]="newPin.length < 4 || busy()" (click)="changePin()">Update</button>
      </div>
    </div>
  `,
})
export class AdminSettingsTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly saved = output<Group>();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly days = DAYS;
  newPin = '';
  f!: Group;

  ngOnInit() { this.f = { ...this.group(), play_days: [...this.group().play_days] }; }

  toggleDay(n: number) {
    this.f.play_days = this.f.play_days.includes(n) ? this.f.play_days.filter((x) => x !== n) : [...this.f.play_days, n].sort();
  }

  async save() {
    if (this.f.play_days.length === 0) { this.error.set('Select at least one game day'); return; }
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const { id, slug, ...patch } = this.f;
      void id; void slug;
      const clean = {
        ...patch,
        cutoff_time: patch.cutoff_time || null,
        venue: patch.venue || null,
        play_time: patch.play_time || null,
        upi_id: patch.upi_id || null,
        extra_court_cost_mode: patch.extra_court_cost_mode as ExtraCourtCostMode,
      };
      await this.api.updateGroup(this.group().id, clean);
      this.saved.emit({ ...this.group(), ...clean });
      this.message.set('Settings saved.');
    } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }

  async changePin() {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.api.setAdminPin(this.group().id, this.newPin);
      this.newPin = '';
      this.message.set('PIN updated.');
    } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }
}
