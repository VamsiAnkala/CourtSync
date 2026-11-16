export type Tier = 'MEMBER' | 'DROP_IN';
export type PlayerStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';
export type SessionStatus = 'OPEN' | 'LOCKED' | 'COMPLETED' | 'CANCELLED';
export type VoteStatus = 'IN' | 'OUT';
export type ExpenseCategory = 'COURT_FEE' | 'SHUTTLES' | 'EQUIPMENT' | 'OTHER';
export type ExtraCourtCostMode = 'POOL' | 'SPLIT';

export interface Group {
  id: string;
  name: string;
  slug: string;
  players_per_court: number;
  max_courts: number;
  base_court_cost: number;
  extra_court_default_cost: number;
  extra_court_cost_mode: ExtraCourtCostMode;
  membership_fee: number;
  daily_dropin_fee: number;
  cutoff_time: string | null;
  play_days: number[];
  venue: string | null;
  play_time: string | null;
  upi_id: string | null;
  timezone: string;
}

export interface Player {
  id: string;
  group_id: string;
  name: string;
  tier: Tier;
  membership_valid_until: string | null;
  status: PlayerStatus;
}

export interface Session {
  id: string;
  group_id: string;
  session_date: string;
  status: SessionStatus;
  courts_booked: number;
  notes: string | null;
}

export interface Vote {
  id: string;
  session_id: string;
  player_id: string;
  vote_status: VoteStatus;
  fee_applied: number;
  added_by_admin: boolean;
  voted_at: string;
}

export interface Expense {
  id: string;
  group_id: string;
  session_id: string | null;
  expense_date: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  source: 'MANUAL' | 'AUTO';
  notes: string | null;
}

export interface LedgerPayment {
  id: string;
  group_id: string;
  player_id: string;
  payment_type: 'MEMBERSHIP' | 'SETTLEMENT';
  amount: number;
  period_start: string | null;
  period_end: string | null;
  paid_on: string;
  notes: string | null;
}

export interface PoolSummary {
  memberships: number;
  dropins: number;
  expenses: number;
  expensesByCategory: Partial<Record<ExpenseCategory, number>>;
  net: number;
}

export interface PlayerBalance {
  player_id: string;
  accrued: number;
  settled: number;
  balance: number;
}
