import { allocate, courtsNeeded, coverageFor, formatINR, isMembershipActive } from './court-logic';
import { formatRoster, whatsappShareUrl } from './whatsapp';
import { toCsv } from './csv';

const v = (n: number, t = n) => ({
  id: 'v' + String(n).padStart(3, '0'),
  player_id: 'p' + n,
  voted_at: `2026-01-01T10:${String(t).padStart(2, '0')}:00Z`,
});

describe('courtsNeeded (7 per court)', () => {
  it('uses one court up to 7 players', () => {
    expect(courtsNeeded(0, 7, 3)).toBe(1);
    expect(courtsNeeded(7, 7, 3)).toBe(1);
  });
  it('triggers Court 2 at the 8th player', () => {
    expect(courtsNeeded(8, 7, 3)).toBe(2);
    expect(courtsNeeded(14, 7, 3)).toBe(2);
  });
  it('triggers Court 3 at the 15th player and caps at max courts', () => {
    expect(courtsNeeded(15, 7, 3)).toBe(3);
    expect(courtsNeeded(40, 7, 3)).toBe(3);
  });
});

describe('allocate', () => {
  it('splits evenly once Court 2 is triggered (9 players -> 5 + 4)', () => {
    const votes = Array.from({ length: 9 }, (_, i) => v(i + 1));
    const a = allocate(votes, 7, 3);
    expect(a.courts.length).toBe(2);
    expect(a.courts.map((c) => c.players.length)).toEqual([5, 4]);
    expect(a.courts[0].status).toBe('BOOKED');
    expect(a.courts[1].status).toBe('TRIGGERED');
    expect(a.waitlist.length).toBe(0);
  });
  it('splits 8 players 4 + 4', () => {
    const a = allocate(Array.from({ length: 8 }, (_, i) => v(i + 1)), 7, 3);
    expect(a.courts.map((c) => c.players.length)).toEqual([4, 4]);
  });
  it('keeps members together in Court 1', () => {
    // p1..p6 are members; 9 players -> Court 1 (5) all members, Court 2 (4) = 1 member + 3 drop-ins
    const votes = Array.from({ length: 9 }, (_, i) => v(i + 1));
    const members = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    const a = allocate(votes, 7, 3, (x) => members.has(x.player_id));
    expect(a.courts[0].players.map((x) => x.player_id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(a.courts[1].players.map((x) => x.player_id)).toEqual(['p6', 'p7', 'p8', 'p9']);
  });
  it('puts members first even when they voted later', () => {
    const votes = Array.from({ length: 8 }, (_, i) => v(i + 1));
    const a = allocate(votes, 7, 3, (x) => x.player_id === 'p8');
    expect(a.courts[0].players[0].player_id).toBe('p8');
  });
  it('fills 7 + 7 when 14 play and 3 courts at 15+', () => {
    expect(allocate(Array.from({ length: 14 }, (_, i) => v(i + 1, i)), 7, 3).courts.map((c) => c.players.length)).toEqual([7, 7]);
    expect(allocate(Array.from({ length: 15 }, (_, i) => v(i + 1, i)), 7, 3).courts.map((c) => c.players.length)).toEqual([5, 5, 5]);
  });
  it('waitlists overflow beyond max courts by vote time', () => {
    const votes = Array.from({ length: 23 }, (_, i) => v(i + 1, i));
    const a = allocate(votes, 7, 3);
    expect(a.playing).toBe(21);
    expect(a.courts.map((c) => c.players.length)).toEqual([7, 7, 7]);
    expect(a.waitlist.map((x) => x.player_id)).toEqual(['p22', 'p23']);
  });
  it('orders by voted_at regardless of input order', () => {
    const a = allocate([v(2, 5), v(1, 1)], 7, 3);
    expect(a.courts[0].players.map((x) => x.player_id)).toEqual(['p1', 'p2']);
  });
  it('shows an empty Court 1 as BOOKED', () => {
    expect(allocate([], 7, 3).courts[0].status).toBe('BOOKED');
  });
});

describe('membership coverage', () => {
  const m = { tier: 'MEMBER' as const, membership_valid_until: '2026-02-01' };
  it('covers members on or before the valid-until date', () => {
    expect(isMembershipActive(m, '2026-02-01')).toBe(true);
    expect(coverageFor(m, '2026-02-02')).toBe('EXPIRED');
  });
  it('charges drop-ins', () => {
    expect(coverageFor({ tier: 'DROP_IN', membership_valid_until: null }, '2026-01-01')).toBe('DROP_IN_FEE');
  });
});

describe('formatting', () => {
  it('formats INR', () => expect(formatINR(1500)).toBe('₹1,500'));
  it('builds a WhatsApp roster', () => {
    const votes = [v(1), v(2)].map((x) => ({ ...x, session_id: 's', vote_status: 'IN' as const, fee_applied: 0, added_by_admin: false }));
    const a = allocate(votes, 7, 3);
    const players = new Map([
      ['p1', { name: 'Asha', tier: 'MEMBER' as const }],
      ['p2', { name: 'Ravi', tier: 'DROP_IN' as const }],
    ]);
    const text = formatRoster({ name: 'Club', venue: 'Arena', play_time: '7 PM', players_per_court: 7 }, '2026-01-05', a, players);
    expect(text).toContain('1. Asha (M)');
    expect(text).toContain('2. Ravi');
    expect(text).toContain('Court 1');
    expect(whatsappShareUrl('a b')).toBe('https://wa.me/?text=a%20b');
  });
});

describe('toCsv', () => {
  it('quotes commas and neutralises formulas', () => {
    const csv = toCsv(['a', 'b'], [['x,y', '=SUM(1)'], [5, '-3']]);
    expect(csv).toBe('a,b\r\n"x,y",\'=SUM(1)\r\n5,-3');
  });
});
