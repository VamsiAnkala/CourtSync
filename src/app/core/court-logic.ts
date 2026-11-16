import { Player, Vote } from './models';

export interface CourtSlot<T> {
  number: number;
  players: T[];
  capacity: number;
  status: 'BOOKED' | 'TRIGGERED' | 'FULL';
}

export interface Allocation<T> {
  courts: CourtSlot<T>[];
  waitlist: T[];
  playing: number;
}

/** Courts needed for `count` players: Court 2 is triggered at player perCourt+1. */
export function courtsNeeded(count: number, perCourt: number, maxCourts: number): number {
  if (count <= 0) return 1;
  return Math.min(maxCourts, Math.max(1, Math.ceil(count / perCourt)));
}

/** Evenly split `total` players over `courts`, larger courts first (9 over 2 -> [5, 4]). */
export function courtSizes(total: number, courts: number): number[] {
  const base = Math.floor(total / courts);
  const extra = total % courts;
  return Array.from({ length: courts }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Who plays is decided first-come first-served (overflow beyond all courts is waitlisted).
 * Players are then split evenly across the needed courts, with members placed first so they stay together in Court 1.
 */
export function allocate<T extends { voted_at: string; id: string }>(
  inVotes: T[],
  perCourt: number,
  maxCourts: number,
  isMember: (v: T) => boolean = () => false,
  courtsOverride?: number,
): Allocation<T> {
  const ordered = [...inVotes].sort(
    (a, b) => a.voted_at.localeCompare(b.voted_at) || a.id.localeCompare(b.id),
  );
  const capacity = perCourt * maxCourts;
  const playing = ordered.slice(0, capacity);
  const waitlist = ordered.slice(capacity);
  const n = courtsOverride ?? courtsNeeded(playing.length, perCourt, maxCourts);
  const arranged = [...playing.filter(isMember), ...playing.filter((v) => !isMember(v))];
  const sizes = courtSizes(arranged.length, n);
  const courts: CourtSlot<T>[] = [];
  let offset = 0;
  for (let i = 0; i < n; i++) {
    const players = arranged.slice(offset, offset + sizes[i]);
    offset += sizes[i];
    courts.push({
      number: i + 1,
      players,
      capacity: perCourt,
      status: players.length >= perCourt ? 'FULL' : i === 0 ? 'BOOKED' : 'TRIGGERED',
    });
  }
  return { courts, waitlist, playing: playing.length };
}

export function isMembershipActive(
  player: Pick<Player, 'tier' | 'membership_valid_until'>,
  sessionDate: string,
): boolean {
  return (
    player.tier === 'MEMBER' &&
    !!player.membership_valid_until &&
    player.membership_valid_until >= sessionDate
  );
}

export type Coverage = 'MEMBERSHIP' | 'DROP_IN_FEE' | 'EXPIRED';

export function coverageFor(
  player: Pick<Player, 'tier' | 'membership_valid_until'>,
  sessionDate: string,
): Coverage {
  if (isMembershipActive(player, sessionDate)) return 'MEMBERSHIP';
  return player.tier === 'MEMBER' ? 'EXPIRED' : 'DROP_IN_FEE';
}

export function formatINR(amount: number): string {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount);
}

export type VoteLike = Pick<Vote, 'id' | 'voted_at' | 'player_id'>;
