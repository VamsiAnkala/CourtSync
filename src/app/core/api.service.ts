import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environment';
import {
  Expense, ExpenseCategory, Group, LedgerPayment, Player, PlayerBalance, PoolSummary, Session, Vote,
} from './models';

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  private ready?: Promise<void>;

  /** Every visitor gets an anonymous Supabase session so RLS can identify them. */
  ensureSession(): Promise<void> {
    this.ready ??= (async () => {
      const { data } = await this.client.auth.getSession();
      if (!data.session) unwrap(await this.client.auth.signInAnonymously());
    })();
    return this.ready;
  }

  private async db() {
    await this.ensureSession();
    return this.client;
  }

  // ---- group / players
  async getGroup(slug: string): Promise<Group | null> {
    const c = await this.db();
    return unwrap(await c.from('groups').select('*').eq('slug', slug).maybeSingle());
  }
  async getPlayers(groupId: string): Promise<Player[]> {
    const c = await this.db();
    return unwrap(await c.from('players').select('*').eq('group_id', groupId).order('name'));
  }
  async myPlayerId(): Promise<string | null> {
    const c = await this.db();
    const row = unwrap(await c.from('player_devices').select('player_id').maybeSingle());
    return (row as { player_id: string } | null)?.player_id ?? null;
  }
  async claimPlayer(playerId: string) {
    const c = await this.db();
    unwrap(await c.rpc('claim_player', { p_player_id: playerId }));
  }
  async registerPlayer(slug: string, name: string, phone: string): Promise<string> {
    const c = await this.db();
    return unwrap(await c.rpc('register_player', { p_slug: slug, p_name: name, p_phone: phone || null }));
  }

  // ---- sessions / votes
  async todaySession(slug: string): Promise<Session> {
    const c = await this.db();
    return unwrap(await c.rpc('get_or_create_today_session', { p_slug: slug }));
  }
  async getVotes(sessionId: string): Promise<Vote[]> {
    const c = await this.db();
    return unwrap(await c.from('attendance_votes').select('*').eq('session_id', sessionId));
  }
  async castVote(sessionId: string, status: 'IN' | 'OUT') {
    const c = await this.db();
    unwrap(await c.rpc('cast_vote', { p_session_id: sessionId, p_status: status }));
  }
  watchSession(sessionId: string, onChange: () => void): () => void {
    const ch = this.client
      .channel('session-' + sessionId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_votes', filter: `session_id=eq.${sessionId}` }, onChange)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, onChange)
      .subscribe();
    return () => void this.client.removeChannel(ch);
  }

  // ---- my ledger
  async myBalance(): Promise<{ accrued: number; settled: number; balance: number }> {
    const c = await this.db();
    const rows = unwrap(await c.rpc('my_balance')) as { accrued: number; settled: number; balance: number }[];
    return rows[0] ?? { accrued: 0, settled: 0, balance: 0 };
  }
  async myHistory(playerId: string): Promise<(Vote & { sessions: Session })[]> {
    const c = await this.db();
    return unwrap(await c.from('attendance_votes').select('*, sessions!inner(*)')
      .eq('player_id', playerId).eq('vote_status', 'IN').order('voted_at', { ascending: false }).limit(90));
  }
  async myPayments(playerId: string): Promise<LedgerPayment[]> {
    const c = await this.db();
    return unwrap(await c.from('ledger_payments').select('*').eq('player_id', playerId).order('paid_on', { ascending: false }));
  }

  // ---- admin
  async adminLogin(slug: string, pin: string): Promise<boolean> {
    const c = await this.db();
    return unwrap(await c.rpc('admin_login', { p_slug: slug, p_pin: pin })) as boolean;
  }
  async isAdmin(groupId: string): Promise<boolean> {
    const c = await this.db();
    const rows = unwrap(await c.from('group_admins').select('group_id').eq('group_id', groupId));
    return (rows as unknown[]).length > 0;
  }
  async updateGroup(id: string, patch: Partial<Group>) {
    const c = await this.db();
    unwrap(await c.from('groups').update(patch).eq('id', id));
  }
  async setAdminPin(groupId: string, pin: string) {
    const c = await this.db();
    unwrap(await c.rpc('set_admin_pin', { p_group_id: groupId, p_new_pin: pin }));
  }
  async listSessions(groupId: string, from: string, to: string): Promise<Session[]> {
    const c = await this.db();
    return unwrap(await c.from('sessions').select('*').eq('group_id', groupId)
      .gte('session_date', from).lte('session_date', to).order('session_date', { ascending: false }));
  }
  async createSession(groupId: string, date: string): Promise<Session> {
    const c = await this.db();
    return unwrap(await c.rpc('admin_create_session', { p_group_id: groupId, p_date: date }));
  }
  async updateSession(id: string, patch: Partial<Session>) {
    const c = await this.db();
    unwrap(await c.from('sessions').update(patch).eq('id', id));
  }
  async adminSetVote(sessionId: string, playerId: string, status: 'IN' | 'OUT') {
    const c = await this.db();
    unwrap(await c.rpc('admin_set_vote', { p_session_id: sessionId, p_player_id: playerId, p_status: status }));
  }
  async completeSession(sessionId: string, courts: number | null, extraCost: number | null) {
    const c = await this.db();
    unwrap(await c.rpc('complete_session', {
      p_session_id: sessionId, p_courts_booked: courts, p_extra_court_cost: extraCost,
    }));
  }
  async updatePlayer(id: string, patch: Partial<Player>) {
    const c = await this.db();
    const rows = unwrap(await c.from('players').update(patch).eq('id', id).select('id'));
    if (!rows?.length) throw new Error('Update was not applied. Your admin session may have expired: leave Admin and enter the PIN again.');
  }
  async addPlayer(groupId: string, name: string, phone: string): Promise<void> {
    const c = await this.db();
    const row = unwrap(await c.from('players').insert({ group_id: groupId, name: name.trim(), status: 'ACTIVE', tier: 'DROP_IN' })
      .select('id').single()) as { id: string };
    if (phone.trim()) unwrap(await c.from('player_private').insert({ player_id: row.id, phone: phone.trim() }));
  }
  async playerPhones(): Promise<Record<string, string>> {
    const c = await this.db();
    const rows = unwrap(await c.from('player_private').select('player_id, phone')) as { player_id: string; phone: string }[];
    return Object.fromEntries(rows.map((r) => [r.player_id, r.phone]));
  }
  async recordMembership(playerId: string, amount: number, start: string, end: string, notes: string | null) {
    const c = await this.db();
    unwrap(await c.rpc('record_membership_payment', {
      p_player_id: playerId, p_amount: amount, p_period_start: start, p_period_end: end, p_paid_on: null, p_notes: notes,
    }));
  }
  async recordSettlement(groupId: string, playerId: string, amount: number, paidOn: string, notes: string | null) {
    const c = await this.db();
    unwrap(await c.from('ledger_payments').insert({
      group_id: groupId, player_id: playerId, payment_type: 'SETTLEMENT', amount, paid_on: paidOn, notes,
    }));
  }
  async balances(groupId: string): Promise<PlayerBalance[]> {
    const c = await this.db();
    return unwrap(await c.rpc('player_balances', { p_group_id: groupId }));
  }
  async payments(groupId: string, from: string, to: string): Promise<LedgerPayment[]> {
    const c = await this.db();
    return unwrap(await c.from('ledger_payments').select('*').eq('group_id', groupId)
      .gte('paid_on', from).lte('paid_on', to).order('paid_on', { ascending: false }));
  }
  async poolSummary(groupId: string, from: string, to: string): Promise<PoolSummary> {
    const c = await this.db();
    return unwrap(await c.rpc('pool_summary', { p_group_id: groupId, p_from: from, p_to: to }));
  }

  // ---- expenses ledger
  async expenses(groupId: string, from: string, to: string): Promise<Expense[]> {
    const c = await this.db();
    return unwrap(await c.from('expenses').select('*').eq('group_id', groupId)
      .gte('expense_date', from).lte('expense_date', to)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false }));
  }
  async addExpense(e: { group_id: string; expense_date: string; category: ExpenseCategory; description: string; amount: number; notes: string | null }) {
    const c = await this.db();
    unwrap(await c.from('expenses').insert({ ...e, source: 'MANUAL' }));
  }
  async updateExpense(id: string, patch: Partial<Expense>) {
    const c = await this.db();
    unwrap(await c.from('expenses').update(patch).eq('id', id));
  }
  async deleteExpense(id: string) {
    const c = await this.db();
    unwrap(await c.from('expenses').delete().eq('id', id));
  }
}
