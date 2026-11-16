import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { formatINR } from '../../core/court-logic';
import { downloadCsv, toCsv } from '../../core/csv';
import { errMsg, monthStart, prettyDate, todayIso } from '../../core/dates';
import { Expense, ExpenseCategory, Group, PoolSummary } from '../../core/models';

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  COURT_FEE: 'Court fee', SHUTTLES: 'Shuttles', EQUIPMENT: 'Equipment', OTHER: 'Other',
};

@Component({
  selector: 'app-admin-money',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="label" for="f">From</label>
        <input id="f" type="date" class="input" [ngModel]="from()" (ngModelChange)="from.set($event)" />
      </div>
      <div>
        <label class="label" for="t">To</label>
        <input id="t" type="date" class="input" [ngModel]="to()" (ngModelChange)="to.set($event)" />
      </div>
      <button class="btn-ghost" (click)="exportCsv()">Export CSV</button>
    </div>

    @if (error()) { <p class="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error() }}</p> }

    @if (pool(); as p) {
      <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="card !p-4"><p class="text-xs text-muted">Memberships</p><p class="text-lg font-bold">{{ formatINR(p.memberships) }}</p></div>
        <div class="card !p-4"><p class="text-xs text-muted">Drop-in fees paid</p><p class="text-lg font-bold">{{ formatINR(p.dropins) }}</p></div>
        <div class="card !p-4"><p class="text-xs text-muted">Expenses</p><p class="text-lg font-bold text-rose-600">{{ formatINR(p.expenses) }}</p></div>
        <div class="card !p-4 !bg-brand-600 text-white !ring-0"><p class="text-xs opacity-80">Pool balance</p><p class="text-lg font-bold">{{ formatINR(p.net) }}</p></div>
      </div>
      <p class="mb-4 text-xs text-muted">Pool = memberships + drop-in payments received − all expenses (court fees, shuttles, equipment, other).</p>
    }

    <div class="card mb-4">
      <h2 class="mb-3 font-semibold">Log an expense</h2>
      <div class="grid gap-3 sm:grid-cols-5">
        <div><label class="label" for="ed">Date</label><input id="ed" type="date" class="input" [(ngModel)]="newDate" /></div>
        <div>
          <label class="label" for="ec">Category</label>
          <select id="ec" class="input" [(ngModel)]="newCategory">
            @for (c of categories; track c) { <option [value]="c">{{ label(c) }}</option> }
          </select>
        </div>
        <div class="sm:col-span-2"><label class="label" for="edesc">Description</label><input id="edesc" class="input" placeholder="e.g. 2 tubes Yonex shuttles" [(ngModel)]="newDesc" /></div>
        <div><label class="label" for="ea">Amount (₹)</label><input id="ea" type="number" min="0" class="input" [(ngModel)]="newAmount" /></div>
      </div>
      <button class="btn-primary mt-3" [disabled]="busy() || !newAmount || newAmount <= 0" (click)="add()">Add expense</button>
    </div>

    <div class="card !p-0">
      <div class="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Expense ledger</div>
      <div class="divide-y divide-slate-100">
        @for (e of expenses(); track e.id) {
          <div class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div class="min-w-0">
              <p class="truncate font-medium">{{ e.description || label(e.category) }}</p>
              <p class="text-xs text-muted">{{ prettyDate(e.expense_date) }} · {{ label(e.category) }}@if (e.source === 'AUTO') { · auto }</p>
            </div>
            <div class="flex items-center gap-2">
              @if (editing() === e.id) {
                <input name="ea-{{ e.id }}" type="number" min="0" class="input !w-24 !py-1.5" [(ngModel)]="editAmount" aria-label="New amount" />
                <button class="btn-primary !px-2.5 !py-1.5 !text-xs" [disabled]="busy()" (click)="saveEdit(e)">Save</button>
                <button class="btn-ghost !px-2.5 !py-1.5 !text-xs" (click)="editing.set(null)">Cancel</button>
              } @else if (confirmDelete() === e.id) {
                <span class="text-xs text-muted">Delete?</span>
                <button class="btn-danger !px-2.5 !py-1.5 !text-xs" [disabled]="busy()" (click)="remove(e)">Yes</button>
                <button class="btn-ghost !px-2.5 !py-1.5 !text-xs" (click)="confirmDelete.set(null)">No</button>
              } @else {
                <span class="font-semibold">{{ formatINR(e.amount) }}</span>
                <button class="btn-ghost !px-2.5 !py-1.5 !text-xs" (click)="edit(e)">Edit</button>
                <button class="btn-danger !px-2.5 !py-1.5 !text-xs" (click)="confirmDelete.set(e.id)">Delete</button>
              }
            </div>
          </div>
        } @empty {
          <p class="p-4 text-sm text-muted">No expenses in this range.</p>
        }
      </div>
    </div>
  `,
})
export class AdminMoneyTab {
  private api = inject(ApiService);
  readonly group = input.required<Group>();
  readonly from = signal(monthStart(todayIso()));
  readonly to = signal(todayIso());
  readonly pool = signal<PoolSummary | null>(null);
  readonly expenses = signal<Expense[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly editing = signal<string | null>(null);
  readonly confirmDelete = signal<string | null>(null);
  editAmount = 0;
  readonly categories: ExpenseCategory[] = ['COURT_FEE', 'SHUTTLES', 'EQUIPMENT', 'OTHER'];
  newDate = todayIso();
  newCategory: ExpenseCategory = 'SHUTTLES';
  newDesc = '';
  newAmount: number | null = null;
  readonly formatINR = formatINR;
  readonly prettyDate = prettyDate;

  constructor() {
    effect(() => {
      this.from();
      this.to();
      void this.load();
    });
  }

  label(c: ExpenseCategory) { return CATEGORY_LABEL[c]; }

  private async load() {
    this.error.set('');
    try {
      const [pool, expenses] = await Promise.all([
        this.api.poolSummary(this.group().id, this.from(), this.to()),
        this.api.expenses(this.group().id, this.from(), this.to()),
      ]);
      this.pool.set(pool);
      this.expenses.set(expenses);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try { await fn(); await this.load(); } catch (e) { this.error.set(errMsg(e)); } finally { this.busy.set(false); }
  }

  add() {
    return this.run(async () => {
      await this.api.addExpense({
        group_id: this.group().id, expense_date: this.newDate, category: this.newCategory,
        description: this.newDesc.trim(), amount: this.newAmount!, notes: null,
      });
      this.newDesc = '';
      this.newAmount = null;
    });
  }

  edit(e: Expense) {
    this.error.set('');
    this.confirmDelete.set(null);
    this.editAmount = e.amount;
    this.editing.set(e.id);
  }

  saveEdit(e: Expense) {
    const amount = Number(this.editAmount);
    if (!Number.isFinite(amount) || amount < 0) { this.error.set('Enter a valid amount'); return; }
    return this.run(async () => {
      await this.api.updateExpense(e.id, { amount, source: 'MANUAL' });
      this.editing.set(null);
    });
  }

  remove(e: Expense) {
    return this.run(async () => {
      await this.api.deleteExpense(e.id);
      this.confirmDelete.set(null);
    });
  }

  exportCsv() {
    const p = this.pool();
    const rows: unknown[][] = this.expenses().map((e) => [e.expense_date, this.label(e.category), e.description ?? '', e.amount]);
    const csv = toCsv(['Date', 'Category', 'Description', 'Amount'], rows)
      + (p ? `\r\n\r\nMemberships,${p.memberships}\r\nDrop-in payments,${p.dropins}\r\nExpenses,${p.expenses}\r\nPool balance,${p.net}` : '');
    downloadCsv(`courtsync-${this.from()}_${this.to()}.csv`, csv);
  }
}
