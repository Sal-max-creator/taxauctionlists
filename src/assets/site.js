// Calendar filters: hide rows that don't match the chosen state / sale type / format.
document.querySelectorAll("[data-filter-table]").forEach((wrap) => {
  const table = document.querySelector(wrap.dataset.filterTable);
  if (!table) return;
  const selects = wrap.querySelectorAll("select");
  const apply = () => {
    const want = Object.fromEntries([...selects].map((s) => [s.name, s.value]));
    let shown = 0;
    table.querySelectorAll("tbody tr").forEach((row) => {
      const ok = Object.entries(want).every(([k, v]) => !v || row.dataset[k] === v);
      row.hidden = !ok;
      if (ok) shown++;
    });
    const count = wrap.querySelector("[data-count]");
    if (count) count.textContent = `${shown} sale${shown === 1 ? "" : "s"}`;
  };
  selects.forEach((s) => s.addEventListener("change", apply));
  apply();
});

// Signup form. No email provider is connected yet, so with an empty endpoint nothing is sent anywhere.
document.querySelectorAll(".signup-form").forEach((form) => {
  const status = form.querySelector(".signup-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.textContent = "Please enter a valid email address.";
      return;
    }
    const endpoint = form.dataset.endpoint;
    if (!endpoint) {
      status.textContent = "Thanks! Signups open soon, so nothing was sent yet.";
      return;
    }
    try {
      const res = await fetch(endpoint, { method: "POST", body: new FormData(form) });
      status.textContent = res.ok ? "You're on the list. Check your inbox to confirm." : "Something went wrong. Please try again.";
      if (res.ok) form.reset();
    } catch {
      status.textContent = "Something went wrong. Please try again.";
    }
  });
});
