(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem('quota-otter-theme') || 'system'; } catch {}
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
  function apply() {
    document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  }
  window.quotaTheme = {
    get preference() { return preference; },
    set(value) {
      if (!['light', 'dark', 'system'].includes(value)) return;
      preference = value;
      try { localStorage.setItem('quota-otter-theme', value); } catch {}
      apply();
    },
  };
  media.addEventListener('change', apply);
  apply();
})();
