(() => {
  // Holds variable values even when their UI elements are removed.
  const vars = {};

  const varsEl = document.getElementById('vars');
  const varTpl = document.getElementById('var-template');

  const varUpdated = (varEl) => {
  };

  const updateVars = () => {
    const old = new Set([...document.querySelectorAll('#vars > .var')].map((v) => v.id.slice(4)));
    // Extract the variable names from the system and all user prompts.
    const neww = new Set();
    for (const n of document.querySelectorAll('#system-prompt, .message > .content')) {
      (n.value.match(/\$\{[a-zA-Z_0-9-]+\}/g) || []).map((v) => v.slice(2, -1)).forEach(i => neww.add(i));
    }

    // Remove the missing ones.
    for (const n of [...old].filter(i => !neww.has(i))) {
      document.getElementById(`var-${n}`).remove();
    }
    // Add new ones
    for (const n of [...neww].filter(i => !old.has(i))) {
      const el = varTpl.content.cloneNode(true);
      el.querySelector('.var').id = `var-${n}`;
      el.querySelector('.name').textContent = `${n}:`;
      const valEl = el.querySelector('.value');
      valEl.value = vars[n] || '';
      valEl.addEventListener('input', (e) => {
        vars[e.target.parentElement.id.slice(4)] = e.target.value;
      });
      varsEl.appendChild(el);
    }
  };
  window.setInterval(updateVars, 500);

})();