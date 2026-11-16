import { Allocation } from './court-logic';
import { Group, Player, Vote } from './models';

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function formatRoster(
  group: Pick<Group, 'name' | 'venue' | 'play_time' | 'players_per_court'>,
  sessionDate: string,
  allocation: Allocation<Vote>,
  players: Map<string, Pick<Player, 'name' | 'tier'>>,
): string {
  const lines: string[] = [];
  lines.push(`🏸 *${group.name}* - ${prettyDate(sessionDate)}`);
  if (group.venue || group.play_time) {
    lines.push([group.venue, group.play_time].filter(Boolean).join(' | '));
  }
  lines.push(`${allocation.playing} playing | ${allocation.courts.length} court${allocation.courts.length > 1 ? 's' : ''}`);
  for (const court of allocation.courts) {
    lines.push('', `*Court ${court.number}* (${court.players.length}/${court.capacity})`);
    court.players.forEach((v, i) => {
      const p = players.get(v.player_id);
      lines.push(`${i + 1}. ${p?.name ?? 'Unknown'}${p?.tier === 'MEMBER' ? ' (M)' : ''}`);
    });
  }
  if (allocation.waitlist.length) {
    lines.push('', '*Waitlist*');
    allocation.waitlist.forEach((v, i) => lines.push(`${i + 1}. ${players.get(v.player_id)?.name ?? 'Unknown'}`));
  }
  return lines.join('\n');
}

export function whatsappShareUrl(text: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
