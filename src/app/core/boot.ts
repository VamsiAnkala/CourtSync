export function hideBoot() {
  const el = document.getElementById('boot');
  if (!el) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 700);
}
