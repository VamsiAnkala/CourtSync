import { Routes } from '@angular/router';
import { environment } from '../environment';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: `g/${environment.defaultGroupSlug}/today` },
  { path: 'g/:slug', pathMatch: 'full', redirectTo: 'g/:slug/today' },
  { path: 'g/:slug/today', loadComponent: () => import('./pages/today.page').then((m) => m.TodayPage), title: 'CourtSync · Today' },
  { path: 'g/:slug/me', loadComponent: () => import('./pages/my-ledger.page').then((m) => m.MyLedgerPage), title: 'CourtSync · My ledger' },
  { path: 'g/:slug/admin', loadComponent: () => import('./pages/admin/admin.page').then((m) => m.AdminPage), title: 'CourtSync · Admin' },
  { path: '**', redirectTo: '' },
];
