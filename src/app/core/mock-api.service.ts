import { Injectable } from '@angular/core';
import { allocate, isMembershipActive } from './court-logic';
import { addDays, todayIso } from './dates';
import {
  Expense, ExpenseCategory, Group, LedgerPayment, Player, PlayerBalance, PoolSummary, Session, Vote,
} from './models';

const PIN = '1234';
const clone = <T>(v: T): T => structuredClone(v);
const id = () => crypto.randomUUID();
const at = (date: string, minute: number) => `${date}T10:${String(minute).padStart(2, '0')}:00.000Z`;

/** In-memory stand-in for ApiService so the UI can be explored without Supabase. State resets on reload. */
@Injectable({ providedIn: 'root' })
export class MockApiService {
  private group: Group = {
    id: 'g1', name: 'Sunday Smashers', slug: 'my-group', players_per_court: 7, max_courts: 3,
    base_court_cost: 800, extra_court_default_cost: 800, extra_court_cost_mode: 'POOL', membership_fee: 1500,
    daily_dropin_fee: 150, cutoff_time: null, play_days: [1, 2, 3, 4, 5, 6, 7], venue: 'Ace Arena', play_time: '7:00 PM',
    upi_id: 'smashers@upi', timezone: 'Asia/Kolkata',
  };
  private players: Player[] = [];
  private phones: Record<string, string> = {};
  private sessions: Session[] = [];
  private votes: Vote[] = [];
  private expensesList: Expense[] = [];
  private paymentsList: LedgerPayment[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.seed();
  }

  private seed() {
    const today = todayIso();
    const mk = (name: string, tier: 'MEMBER' | 'DROP_IN', validDays: number | null, status: Player['status'] = 'ACTIVE') => {
      const p: Player = {
        id: id(), group_id: 'g1', name, tier, status,
        membership_valid_until: validDays === null ? null : addDays(today, validDays),
      };
      this.players.push(p);
      this.phones[p.id] = '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
      return p;
    };
    const members = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana'].map((n) => mk(n, 'MEMBER', 20));
    const expired = mk('Vikram', 'MEMBER', -5);
    const dropins = ['Ishaan', 'Neha', 'Priya', 'Tarun'].map((n) => mk(n, 'DROP_IN', null));
    mk('Zoya (new)', 'DROP_IN', null, 'PENDING');
    const pool = [...members, expired, ...dropins];

    // Past completed sessions.
    [1, 2, 4, 7].forEach((daysAgo, k) => {
      const date = addDays(today, -daysAgo);
      const s: Session = { id: id(), group_id: 'g1', session_date: date, status: 'OPEN', courts_booked: 1, notes: null };
      this.sessions.push(s);
      const count = [9, 6, 11, 8][k];
      pool.slice(0, count).forEach((p, i) => {
        this.votes.push({ id: id(), session_id: s.id, player_id: p.id, vote_status: 'IN', fee_applied: 0, added_by_admin: false, voted_at: at(date, i) });
      });
      this.completeInternal(s.id, null, null);
    });

    // Today: a few votes in.
    const todaySession: Session = { id: id(), group_id: 'g1', session_date: today, status: 'OPEN', courts_booked: 1, notes: null };
    this.sessions.push(todaySession);
    pool.slice(0, 6).forEach((p, i) => {
      this.votes.push({ id: id(), session_id: todaySession.id, player_id: p.id, vote_status: 'IN', fee_applied: 0, added_by_admin: false, voted_at: at(today, i + 1) });
    });

    // Money.
    members.forEach((m) => this.paymentsList.push({
      id: id(), group_id: 'g1', player_id: m.id, payment_type: 'MEMBERSHIP', amount: 1500,
      period_start: addDays(today, -10), period_end: addDays(today, 20), paid_on: addDays(today, -10), notes: null,
    }));
    this.paymentsList.push({ id: id(), group_id: 'g1', player_id: dropins[0].id, payment_type: 'SETTLEMENT', amount: 150, period_start: null, period_end: null, paid_on: addDays(today, -1), notes: null });
    this.expensesList.push(
      { id: id(), group_id: 'g1', session_id: null, expense_date: addDays(today, -3), category: 'SHUTTLES', description: '3 tubes Yonex Mavis', amount: 1650, source: 'MANUAL', notes: null },
      { id: id(), group_id: 'g1', session_id: null, expense_date: addDays(today, -6), category: 'EQUIPMENT', description: 'Net replacement', amount: 600, source: 'MANUAL', notes: null },
    );
  }

  private notify() { this.listeners.forEach((l) => l()); }

  private completeInternal(sessionId: string, courtsArg: number | null, extraArg: number | null) {
    const s = this.sessions.find((x) => x.id === sessionId)!;
    const g = this.group;
    const cap = g.max_courts * g.players_per_court;
    const ins = this.votes.filter((v) => v.session_id === s.id && v.vote_status === 'IN')
      .sort((a, b) => a.voted_at.localeCompare(b.voted_at) || a.id.localeCompare(b.id));
    const played = Math.min(ins.length, cap);
    let courts = courtsArg ?? Math.max(1, Math.ceil(played / g.players_per_court));
    courts = Math.min(Math.max(courts, 1), g.max_courts);
    const extraCost = extraArg ?? g.extra_court_default_cost;
    const extraTotal = extraCost * (courts - 1);
    const isMember = (v: Vote) => {
      const p = this.players.find((x) => x.id === v.player_id)!;
      return isMembershipActive(p, s.session_date);
    };
    const alloc = allocate(ins, g.players_per_court, g.max_courts, isMember, courts);
    const courtOf = new Map<string, number>();
    alloc.courts.forEach((c) => c.players.forEach((v) => courtOf.set(v.id, c.number)));
    const extraPlayers = alloc.courts.slice(1).reduce((t, c) => t + c.players.length, 0);

    this.expensesList = this.expensesList.filter((e) => !(e.session_id === s.id && e.source === 'AUTO'));
    for (let i = 1; i <= courts; i++) {
      this.expensesList.push({
        id: id(), group_id: g.id, session_id: s.id, expense_date: s.session_date, category: 'COURT_FEE',
        description: 'Court ' + i, amount: i === 1 ? g.base_court_cost : extraCost, source: 'AUTO', notes: null,
      });
    }
    ins.forEach((v) => {
      const court = courtOf.get(v.id);
      if (!court) { v.fee_applied = 0; return; }
      const split = g.extra_court_cost_mode === 'SPLIT' && court > 1 && extraPlayers > 0
        ? Math.round((extraTotal / extraPlayers) * 100) / 100 : 0;
      v.fee_applied = (isMember(v) ? 0 : g.daily_dropin_fee) + split;
    });
    this.votes.filter((v) => v.session_id === s.id && v.vote_status !== 'IN').forEach((v) => (v.fee_applied = 0));
    s.status = 'COMPLETED';
    s.courts_booked = courts;
  }

  // ---- same surface as ApiService
  async ensureSession() {}

  async getGroup(slug: string) { return slug === this.group.slug ? clone(this.group) : null; }
  async getPlayers(_groupId: string) { return clone([...this.players].sort((a, b) => a.name.localeCompare(b.name))); }
  async myPlayerId() { return localStorage.getItem('mock_player'); }
  async claimPlayer(playerId: string) { localStorage.setItem('mock_player', playerId); }
  async registerPlayer(_slug: string, name: string, phone: string) {
    const p: Player = { id: id(), group_id: 'g1', name: name.trim(), tier: 'DROP_IN', membership_valid_until: null, status: 'PENDING' };
    this.players.push(p);
    if (phone) this.phones[p.id] = phone;
    localStorage.setItem('mock_player', p.id);
    return p.id;
  }

  async todaySession(_slug: string) {
    const d = todayIso();
    let s = this.sessions.find((x) => x.session_date === d);
    if (!s) {
      s = { id: id(), group_id: 'g1', session_date: d, status: 'OPEN', courts_booked: 1, notes: null };
      this.sessions.push(s);
    }
    return clone(s);
  }
  async getVotes(sessionId: string) { return clone(this.votes.filter((v) => v.session_id === sessionId)); }

  private upsertVote(sessionId: string, playerId: string, status: 'IN' | 'OUT', byAdmin: boolean) {
    const existing = this.votes.find((v) => v.session_id === sessionId && v.player_id === playerId);
    if (existing) {
      if (existing.vote_status !== status) { existing.vote_status = status; existing.voted_at = new Date().toISOString(); }
      if (byAdmin) existing.added_by_admin = true;
    } else {
      this.votes.push({ id: id(), session_id: sessionId, player_id: playerId, vote_status: status, fee_applied: 0, added_by_admin: byAdmin, voted_at: new Date().toISOString() });
    }
    this.notify();
  }

  async castVote(sessionId: string, status: 'IN' | 'OUT') {
    const me = this.players.find((p) => p.id === localStorage.getItem('mock_player'));
    if (!me) throw new Error('choose your name first');
    if (me.status !== 'ACTIVE') throw new Error('your registration is pending admin approval');
    const s = this.sessions.find((x) => x.id === sessionId);
    if (!s || s.status !== 'OPEN') throw new Error('voting is closed');
    this.upsertVote(sessionId, me.id, status, false);
  }

  watchSession(_sessionId: string, onChange: () => void) {
    this.listeners.add(onChange);
    return () => void this.listeners.delete(onChange);
  }

  async myBalance() {
    const id = localStorage.getItem('mock_player');
    const accrued = this.accrued(id);
    const settled = this.settled(id);
    return { accrued, settled, balance: accrued - settled };
  }
  private accrued(playerId: string | null) {
    return this.votes.filter((v) => v.player_id === playerId && this.sessions.find((s) => s.id === v.session_id)?.status === 'COMPLETED')
      .reduce((t, v) => t + v.fee_applied, 0);
  }
  private settled(playerId: string | null) {
    return this.paymentsList.filter((p) => p.player_id === playerId && p.payment_type === 'SETTLEMENT').reduce((t, p) => t + p.amount, 0);
  }
  async myHistory(playerId: string) {
    return clone(this.votes.filter((v) => v.player_id === playerId && v.vote_status === 'IN')
      .map((v) => ({ ...v, sessions: this.sessions.find((s) => s.id === v.session_id)! }))
      .sort((a, b) => b.sessions.session_date.localeCompare(a.sessions.session_date)));
  }
  async myPayments(playerId: string) {
    return clone(this.paymentsList.filter((p) => p.player_id === playerId).sort((a, b) => b.paid_on.localeCompare(a.paid_on)));
  }

  // ---- admin
  async adminLogin(_slug: string, pin: string) {
    if (pin !== PIN) return false;
    localStorage.setItem('mock_admin', '1');
    return true;
  }
  async isAdmin(_groupId: string) { return localStorage.getItem('mock_admin') === '1'; }
  async updateGroup(_id: string, patch: Partial<Group>) { Object.assign(this.group, patch); }
  async setAdminPin(_groupId: string, _pin: string) {}
  async listSessions(_groupId: string, from: string, to: string) {
    return clone(this.sessions.filter((s) => s.session_date >= from && s.session_date <= to)
      .sort((a, b) => b.session_date.localeCompare(a.session_date)));
  }
  async createSession(_groupId: string, date: string) {
    let s = this.sessions.find((x) => x.session_date === date);
    if (!s) {
      s = { id: id(), group_id: 'g1', session_date: date, status: 'OPEN', courts_booked: 1, notes: null };
      this.sessions.push(s);
    }
    return clone(s);
  }
  async updateSession(sid: string, patch: Partial<Session>) {
    Object.assign(this.sessions.find((s) => s.id === sid)!, patch);
    this.notify();
  }
  async adminSetVote(sessionId: string, playerId: string, status: 'IN' | 'OUT') { this.upsertVote(sessionId, playerId, status, true); }
  async completeSession(sessionId: string, courts: number | null, extraCost: number | null) {
    this.completeInternal(sessionId, courts, extraCost);
    this.notify();
  }
  async updatePlayer(pid: string, patch: Partial<Player>) { Object.assign(this.players.find((p) => p.id === pid)!, patch); }
  async addPlayer(_groupId: string, name: string, phone: string) {
    const p: Player = { id: id(), group_id: 'g1', name: name.trim(), tier: 'DROP_IN', membership_valid_until: null, status: 'ACTIVE' };
    this.players.push(p);
    if (phone.trim()) this.phones[p.id] = phone.trim();
  }
  async playerPhones() { return clone(this.phones); }
  async recordMembership(playerId: string, amount: number, start: string, end: string, notes: string | null) {
    this.paymentsList.push({ id: id(), group_id: 'g1', player_id: playerId, payment_type: 'MEMBERSHIP', amount, period_start: start, period_end: end, paid_on: todayIso(), notes });
    const p = this.players.find((x) => x.id === playerId)!;
    p.tier = 'MEMBER';
    p.membership_valid_until = p.membership_valid_until && p.membership_valid_until > end ? p.membership_valid_until : end;
  }
  async recordSettlement(_groupId: string, playerId: string, amount: number, paidOn: string, notes: string | null) {
    this.paymentsList.push({ id: id(), group_id: 'g1', player_id: playerId, payment_type: 'SETTLEMENT', amount, period_start: null, period_end: null, paid_on: paidOn, notes });
  }
  async balances(_groupId: string): Promise<PlayerBalance[]> {
    return this.players.map((p) => {
      const accrued = this.accrued(p.id);
      const settled = this.settled(p.id);
      return { player_id: p.id, accrued, settled, balance: accrued - settled };
    });
  }
  async payments(_groupId: string, from: string, to: string) {
    return clone(this.paymentsList.filter((p) => p.paid_on >= from && p.paid_on <= to));
  }
  async poolSummary(_groupId: string, from: string, to: string): Promise<PoolSummary> {
    const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0);
    const pays = this.paymentsList.filter((p) => p.paid_on >= from && p.paid_on <= to);
    const exps = this.expensesList.filter((e) => e.expense_date >= from && e.expense_date <= to);
    const memberships = sum(pays.filter((p) => p.payment_type === 'MEMBERSHIP'));
    const dropins = sum(pays.filter((p) => p.payment_type === 'SETTLEMENT'));
    const expenses = sum(exps);
    const byCat: Partial<Record<ExpenseCategory, number>> = {};
    exps.forEach((e) => (byCat[e.category] = (byCat[e.category] ?? 0) + e.amount));
    return { memberships, dropins, expenses, expensesByCategory: byCat, net: memberships + dropins - expenses };
  }

  async expenses(_groupId: string, from: string, to: string) {
    return clone(this.expensesList.filter((e) => e.expense_date >= from && e.expense_date <= to)
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date)));
  }
  async addExpense(e: { group_id: string; expense_date: string; category: ExpenseCategory; description: string; amount: number; notes: string | null }) {
    this.expensesList.push({ ...e, id: id(), session_id: null, source: 'MANUAL' });
  }
  async updateExpense(eid: string, patch: Partial<Expense>) { Object.assign(this.expensesList.find((e) => e.id === eid)!, patch); }
  async deleteExpense(eid: string) { this.expensesList = this.expensesList.filter((e) => e.id !== eid); }
}
