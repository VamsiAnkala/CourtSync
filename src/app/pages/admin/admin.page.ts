import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { errMsg } from '../../core/dates';
import { Group } from '../../core/models';
import { ThemeToggle } from '../../core/theme-toggle';
import { AdminSessionTab } from './admin-session';
import { AdminMoneyTab } from './admin-money';
import { AdminDuesTab } from './admin-dues';
import { AdminPlayersTab } from './admin-players';
import { AdminHistoryTab } from './admin-history';
import { AdminSettingsTab } from './admin-settings';

type Tab = 'session' | 'money' | 'dues' | 'players' | 'history' | 'settings';

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, ThemeToggle, AdminSessionTab, AdminMoneyTab, AdminDuesTab, AdminPlayersTab, AdminHistoryTab, AdminSettingsTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page-enter mx-auto min-h-dvh max-w-3xl px-4 pb-16 pt-6">
      <div class="flex items-center justify-between gap-3">
        <a class="back-link" [routerLink]="['/g', slug(), 'today']">← Today</a>
        <app-theme-toggle />
      </div>
      @if (loading()) {
        <div class="mt-6 space-y-4" aria-busy="true"><div class="skeleton h-10 w-1/2"></div><div class="skeleton h-40"></div></div>
      } @else if (!group()) {
        <p class="mt-20 text-center text-muted">{{ error() || 'Group not found' }}</p>
      } @else if (!isAdmin()) {
        <section class="card mx-auto mt-14 max-w-sm text-center">
          <span class="logo mx-auto mb-3 !h-14 !w-14 !rounded-2xl" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </span>
          <h1 class="text-xl font-extrabold">Admin access</h1>
          <p class="mb-5 text-sm text-muted">{{ group()!.name }}</p>
          <div class="text-left">
            <label class="label" for="pin">Admin PIN</label>
            <input id="pin" type="password" class="input mb-3" [(ngModel)]="pin" (keyup.enter)="login()" autocomplete="current-password" />
          </div>
          @if (error()) { <p class="alert error mb-3 text-left">{{ error() }}</p> }
          <button class="btn-primary w-full" [disabled]="!pin || busy()" (click)="login()">Unlock</button>
        </section>
      } @else {
        <p class="eyebrow mt-3">Admin</p>
        <h1 class="mb-4 text-2xl font-extrabold">{{ group()!.name }}</h1>
        <nav class="tabs mb-5">
          @for (t of tabs; track t.id) {
            <button class="tab" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
          }
        </nav>
        <div class="tab-body" [attr.data-tab]="tab()">
        @switch (tab()) {
          @case ('session') { <app-admin-session [group]="group()!" /> }
          @case ('money') { <app-admin-money [group]="group()!" /> }
          @case ('dues') { <app-admin-dues [group]="group()!" /> }
          @case ('players') { <app-admin-players [group]="group()!" /> }
          @case ('history') { <app-admin-history [group]="group()!" /> }
          @case ('settings') { <app-admin-settings [group]="group()!" (saved)="group.set($event)" /> }
        }
        </div>
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
