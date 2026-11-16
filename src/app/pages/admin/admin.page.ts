import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errMsg } from '../../core/dates';
import { Group } from '../../core/models';
import { AdminSessionTab } from './admin-session';
import { AdminMoneyTab } from './admin-money';
import { AdminDuesTab } from './admin-dues';
import { AdminPlayersTab } from './admin-players';
import { AdminHistoryTab } from './admin-history';
import { AdminSettingsTab } from './admin-settings';

type Tab = 'session' | 'money' | 'dues' | 'players' | 'history' | 'settings';

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, AdminSessionTab, AdminMoneyTab, AdminDuesTab, AdminPlayersTab, AdminHistoryTab, AdminSettingsTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto min-h-dvh max-w-3xl px-4 pb-16 pt-6">
      <a class="text-sm text-brand-700" [routerLink]="['/g', slug(), 'today']">← Today</a>
      @if (loading()) {
        <p class="mt-20 text-center text-muted">Loading…</p>
      } @else if (!group()) {
        <p class="mt-20 text-center text-muted">{{ error() || 'Group not found' }}</p>
      } @else if (!isAdmin()) {
        <section class="card mx-auto mt-16 max-w-sm">
          <h1 class="text-lg font-bold">Admin access</h1>
          <p class="mb-4 text-sm text-muted">{{ group()!.name }}</p>
          <label class="label" for="pin">Admin PIN</label>
          <input id="pin" type="password" class="input mb-3" [(ngModel)]="pin" (keyup.enter)="login()" autocomplete="current-password" />
          @if (error()) { <p class="mb-3 text-sm text-rose-600">{{ error() }}</p> }
          <button class="btn-primary w-full" [disabled]="!pin || busy()" (click)="login()">Unlock</button>
        </section>
      } @else {
        <h1 class="mb-4 mt-2 text-xl font-bold">{{ group()!.name }} · Admin</h1>
        <nav class="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200/70">
          @for (t of tabs; track t.id) {
            <button class="whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition"
                    [class]="tab() === t.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
                    (click)="tab.set(t.id)">{{ t.label }}</button>
          }
        </nav>
        @switch (tab()) {
          @case ('session') { <app-admin-session [group]="group()!" /> }
          @case ('money') { <app-admin-money [group]="group()!" /> }
          @case ('dues') { <app-admin-dues [group]="group()!" /> }
          @case ('players') { <app-admin-players [group]="group()!" /> }
          @case ('history') { <app-admin-history [group]="group()!" /> }
          @case ('settings') { <app-admin-settings [group]="group()!" (saved)="group.set($event)" /> }
        }
      }
    </main>
  `,
})
export class AdminPage {
  private api = inject(ApiService);
  readonly slug = input.required<string>();
  readonly group = signal<Group | null>(null);
  readonly isAdmin = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly tab = signal<Tab>('session');
  pin = '';
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'session', label: 'Session' },
    { id: 'money', label: 'Pool & expenses' },
    { id: 'dues', label: 'Dues' },
    { id: 'players', label: 'Players' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];

  constructor() {
    effect(() => {
      this.slug();
      void this.load();
    });
  }

  private async load() {
    this.loading.set(true);
    try {
      const g = await this.api.getGroup(this.slug());
      this.group.set(g);
      this.isAdmin.set(g ? await this.api.isAdmin(g.id) : false);
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.loading.set(false);
    }
  }

  async login() {
    this.busy.set(true);
    this.error.set('');
    try {
      const ok = await this.api.adminLogin(this.slug(), this.pin);
      this.pin = '';
      if (ok) this.isAdmin.set(true);
      else this.error.set('Incorrect PIN');
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
