/**
 * @param {'scan' | 'settings'} current
 */
export function initAppNav(current) {
  const btn = document.getElementById('navMenuBtn');
  const panel = document.getElementById('navMenuPanel');
  if (!btn || !panel) return;

  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });

  panel.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', close);
  });

  document.addEventListener('click', (e) => {
    if (
      !panel.hidden &&
      e.target instanceof Node &&
      !panel.contains(e.target) &&
      !btn.contains(e.target)
    ) {
      close();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  panel.querySelectorAll('[data-nav]').forEach((link) => {
    const page = /** @type {HTMLElement} */ (link).dataset.nav;
    if (page === current) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('nav-menu-link--current');
    }
  });
}
