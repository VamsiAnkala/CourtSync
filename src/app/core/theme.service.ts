import { ApplicationRef, Injectable, inject, signal } from '@angular/core';

const KEY = 'courtsync-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private app = inject(ApplicationRef);
  readonly dark = signal(document.documentElement.classList.contains('dark'));

  toggle(origin?: HTMLElement) {
    const next = !this.dark();
    const apply = () => {
      this.dark.set(next);
      applyTheme(next);
      this.app.tick();
    };
    try { localStorage.setItem(KEY, next ? 'dark' : 'light'); } catch { /* storage unavailable */ }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!origin || reduced || !document.startViewTransition) { apply(); return; }

    const r = origin.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 1100, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }, () => undefined);
  }
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#059669');
}
