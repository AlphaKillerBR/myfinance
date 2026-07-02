/* app.js — UI, navegação e regras de negócio do app financeiro. */

const EXPENSE_CATEGORIES = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Compras', 'Contas', 'Educação', 'Outros'];
const INCOME_CATEGORIES = ['Salário', 'Freelance', 'Investimentos', 'Presente', 'Outros'];

let state = {
  currentView: 'inicio',
  transactionType: 'expense',
  selectedMethod: 'debito',
  selectedCategory: EXPENSE_CATEGORIES[0],
  selectedGoalIcon: '✈️',
  selectedGoalCurrency: 'BRL',
  selectedContributionCurrency: 'BRL',
  selectedReminderRecurrence: 'none',
  editingGoalId: null,
  editingReminderId: null,
  contributionGoalId: null,
};

// ---------- utilidades ----------

function formatBRL(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const CURRENCY_LOCALES = { BRL: 'pt-BR', USD: 'en-US', EUR: 'de-DE' };

// O teclado numérico do iPhone em português mostra vírgula, não ponto —
// e <input type="number"> só aceita ponto, então os campos de valor usam
// type="text" e essa função interpreta os dois formatos.
function parseAmount(str) {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (s.includes(',')) {
    // formato brasileiro: ponto = separador de milhar, vírgula = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return parseFloat(s);
}

function formatAmountForInput(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Máscara estilo "calculadora": o usuário só digita números (sem vírgula/ponto)
// e o campo já formata como valor em reais, tratando os 2 últimos dígitos
// como centavos (ex: digitar 132089 vira 1.320,89).
function attachAmountMask(inputEl) {
  inputEl.addEventListener('input', () => {
    const digits = inputEl.value.replace(/\D/g, '');
    if (!digits) {
      inputEl.value = '';
      return;
    }
    const cents = parseInt(digits, 10);
    inputEl.value = formatAmountForInput(cents / 100);
  });
}

['input-amount', 'goal-target', 'contribution-amount', 'reminder-amount'].forEach((id) => {
  attachAmountMask(document.getElementById(id));
});

function formatCurrency(value, currency) {
  const locale = CURRENCY_LOCALES[currency] || 'pt-BR';
  return (Number(value) || 0).toLocaleString(locale, { style: 'currency', currency: currency || 'BRL' });
}

// Metas criadas antes do suporte a múltiplas moedas só tinham `currentAmount`
// (sempre em BRL). Essa função migra pra estrutura nova (`balances` por
// moeda) na hora da leitura, sem perder o valor já guardado.
function ensureGoalBalances(goal) {
  if (!goal.balances) {
    goal.balances = { BRL: goal.currentAmount || 0, USD: 0, EUR: 0 };
  }
  if (!goal.targetCurrency) {
    goal.targetCurrency = 'BRL';
  }
  return goal;
}

function goalTotalInCurrency(goal, toCurrency, ratesData) {
  const balances = goal.balances || { BRL: 0, USD: 0, EUR: 0 };
  return Object.entries(balances).reduce((sum, [cur, amt]) => {
    if (!amt) return sum;
    return sum + Rates.convert(amt, cur, toCurrency, ratesData);
  }, 0);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStr) {
  const today = new Date(todayISO());
  const target = new Date(dateStr);
  return Math.round((target - today) / 86400000);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- navegação ----------

function navigate(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  const titles = { inicio: 'Início', lancamentos: 'Lançamentos', metas: 'Metas', lembretes: 'Lembretes', ajustes: 'Ajustes' };
  document.getElementById('topbar-title').textContent = titles[view];

  const greetingEl = document.getElementById('topbar-greeting');
  if (view === 'inicio') {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    greetingEl.textContent = greeting + ',';
    greetingEl.classList.remove('hidden');
  } else {
    greetingEl.classList.add('hidden');
  }

  renderAll();
}

document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(btn.dataset.nav);
  });
});

// ---------- render: início ----------

async function renderDashboard() {
  const transactions = await DB.listTransactions();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTx = transactions.filter((t) => t.date.startsWith(monthKey));

  const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  document.getElementById('balance-value').textContent = formatBRL(income - expense);
  document.getElementById('sum-income').textContent = formatBRL(income);
  document.getElementById('sum-expense').textContent = formatBRL(expense);

  // gráficos de gastos do mês (forma de pagamento e categoria)
  const monthExpenses = monthTx.filter((t) => t.type === 'expense');
  const METHOD_LABELS = { debito: 'Débito', credito: 'Crédito', pix: 'Pix', dinheiro: 'Dinheiro' };
  const byMethod = {};
  const byCategory = {};
  monthExpenses.forEach((t) => {
    byMethod[t.method] = (byMethod[t.method] || 0) + t.amount;
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const methodItems = Object.entries(byMethod)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: METHOD_LABELS[k] || k, value: v }));
  const categoryItems = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k, value: v }));
  renderBarList('chart-method', methodItems);
  renderBarList('chart-category', categoryItems);

  // últimos lançamentos
  const recentEl = document.getElementById('recent-transactions');
  recentEl.innerHTML = '';
  const recent = transactions.slice(0, 6);
  if (recent.length === 0) {
    recentEl.appendChild(el('<div class="empty">Nenhum lançamento ainda.</div>'));
  } else {
    recent.forEach((t) => recentEl.appendChild(transactionRow(t)));
  }

  // próximos lembretes
  const reminders = (await DB.listReminders()).filter((r) => !r.paid);
  reminders.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const upcoming = reminders.slice(0, 4);
  const upcomingEl = document.getElementById('upcoming-reminders');
  upcomingEl.innerHTML = '';
  if (upcoming.length === 0) {
    upcomingEl.appendChild(el('<div class="empty">Nenhum lembrete pendente.</div>'));
  } else {
    upcoming.forEach((r) => upcomingEl.appendChild(reminderPreviewRow(r)));
  }

  // metas preview
  const goals = (await DB.listGoals()).map(ensureGoalBalances);
  const goalsEl = document.getElementById('goals-preview');
  goalsEl.innerHTML = '';
  if (goals.length === 0) {
    goalsEl.appendChild(el('<div class="empty">Nenhuma meta criada.</div>'));
  } else {
    const ratesData = await Rates.getRatesFromBRL();
    goals.slice(0, 3).forEach((g) => goalsEl.appendChild(goalPreviewRow(g, ratesData)));
  }
}

function renderBarList(elId, items) {
  const container = document.getElementById(elId);
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.appendChild(el('<div class="empty">Sem gastos neste mês.</div>'));
    return;
  }
  const max = Math.max(...items.map((i) => i.value));
  items.forEach((item) => {
    const pct = max > 0 ? Math.max(2, (item.value / max) * 100) : 0;
    container.appendChild(el(`
      <div class="bar-row">
        <div class="bar-label-row">
          <span>${escapeHTML(item.label)}</span>
          <span class="bar-value">${formatBRL(item.value)}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
    `));
  });
}

function transactionRow(t) {
  const sign = t.type === 'income' ? '+' : '-';
  const icon = t.type === 'income' ? '💰' : categoryIcon(t.category);
  const row = el(`
    <div class="row-item">
      <div class="row-left">
        <div class="row-icon" style="background:${pastelColorFor(t.category)}">${icon}</div>
        <div>
          <div class="row-title">${escapeHTML(t.description || t.category)}</div>
          <div class="row-sub">${t.category} · ${formatDatePt(t.date)}</div>
        </div>
      </div>
      <div class="row-right">
        <div class="row-amount ${t.type}">${sign} ${formatBRL(t.amount)}</div>
        <button class="row-delete-btn" title="Excluir lançamento">🗑️</button>
      </div>
    </div>
  `);
  row.querySelector('.row-delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Excluir este lançamento?')) {
      await DB.deleteTransaction(t.id);
      showToast('Lançamento excluído');
      renderAll();
    }
  });
  return row;
}

async function renderTransactionsList() {
  const transactions = await DB.listTransactions();
  const listEl = document.getElementById('all-transactions-list');
  listEl.innerHTML = '';
  if (transactions.length === 0) {
    listEl.appendChild(el('<div class="empty">Nenhum lançamento ainda.</div>'));
    return;
  }
  transactions.forEach((t) => listEl.appendChild(transactionRow(t)));
}

function reminderPreviewRow(r) {
  const d = daysBetween(r.dueDate);
  const label = d < 0 ? `Atrasado ${Math.abs(d)}d` : d === 0 ? 'Vence hoje' : `Vence em ${d}d`;
  return el(`
    <div class="row-item">
      <div class="row-left">
        <div class="row-icon">🔔</div>
        <div>
          <div class="row-title">${escapeHTML(r.name)}</div>
          <div class="row-sub">${label}</div>
        </div>
      </div>
      <div class="row-amount expense">${formatBRL(r.amount)}</div>
    </div>
  `);
}

function formatCurrencyCompact(value, currency) {
  const locale = CURRENCY_LOCALES[currency] || 'pt-BR';
  return (Number(value) || 0).toLocaleString(locale, { style: 'currency', currency: currency || 'BRL', maximumFractionDigits: 0 });
}

function goalPreviewRow(g, ratesData) {
  const totalInTarget = goalTotalInCurrency(g, g.targetCurrency, ratesData);
  const pct = g.targetAmount > 0 ? Math.min(100, (totalInTarget / g.targetAmount) * 100) : 0;
  const totalBRL = goalTotalInCurrency(g, 'BRL', ratesData);
  const totalUSD = goalTotalInCurrency(g, 'USD', ratesData);
  const totalEUR = goalTotalInCurrency(g, 'EUR', ratesData);
  return el(`
    <div class="row-item">
      <div class="row-left">
        <div class="row-icon">${g.icon}</div>
        <div>
          <div class="row-title">${escapeHTML(g.name)}</div>
          <div class="row-sub">${pct.toFixed(0)}% de ${formatCurrency(g.targetAmount, g.targetCurrency)}</div>
          <div class="row-sub row-sub-totals">${formatCurrencyCompact(totalBRL, 'BRL')} · ${formatCurrencyCompact(totalUSD, 'USD')} · ${formatCurrencyCompact(totalEUR, 'EUR')}</div>
        </div>
      </div>
    </div>
  `);
}

const PASTEL_PALETTE = ['#FFE1D1', '#E7E1FB', '#DAF3E5', '#DCEEFB', '#FDE3ED', '#FFF2C2'];

function pastelColorFor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PASTEL_PALETTE[hash % PASTEL_PALETTE.length];
}

function categoryIcon(category) {
  const map = {
    'Alimentação': '🍔', 'Transporte': '🚌', 'Moradia': '🏠', 'Lazer': '🎬',
    'Saúde': '💊', 'Compras': '🛍️', 'Contas': '🧾', 'Educação': '📚', 'Outros': '📦',
    'Salário': '💼', 'Freelance': '💻', 'Investimentos': '📈', 'Presente': '🎁',
  };
  return map[category] || '📦';
}

function formatDatePt(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- render: metas ----------

async function renderGoals() {
  const goals = (await DB.listGoals()).map(ensureGoalBalances);
  const listEl = document.getElementById('goals-list');
  listEl.innerHTML = '';
  if (goals.length === 0) {
    listEl.appendChild(el('<div class="empty">Nenhuma meta ainda. Crie a primeira!</div>'));
    return;
  }

  const ratesData = await Rates.getRatesFromBRL();
  const rateNote = ratesData.date
    ? `Cotação de ${formatDateLongPt(ratesData.date)}${ratesData.stale ? ' (offline, pode estar desatualizada)' : ''}`
    : 'Cotação indisponível no momento (sem internet)';

  goals.forEach((g) => {
    const totalInTarget = goalTotalInCurrency(g, g.targetCurrency, ratesData);
    const pct = g.targetAmount > 0 ? Math.min(100, (totalInTarget / g.targetAmount) * 100) : 0;
    const deadlineTxt = g.deadline ? `Prazo: ${formatDateLongPt(g.deadline)}` : 'Sem prazo definido';

    const balanceParts = Object.entries(g.balances)
      .filter(([, amt]) => amt)
      .map(([cur, amt]) => formatCurrency(amt, cur));
    const balancesTxt = balanceParts.length ? balanceParts.join(' + ') : 'Nenhum valor guardado ainda';

    const totalBRL = goalTotalInCurrency(g, 'BRL', ratesData);
    const totalUSD = goalTotalInCurrency(g, 'USD', ratesData);
    const totalEUR = goalTotalInCurrency(g, 'EUR', ratesData);
    const convertedTxt = `Equivalente hoje: ${formatCurrency(totalBRL, 'BRL')} · ${formatCurrency(totalUSD, 'USD')} · ${formatCurrency(totalEUR, 'EUR')}`;

    const card = el(`
      <div class="goal-card" data-id="${g.id}">
        <div class="goal-top">
          <div><span class="goal-icon">${g.icon}</span><span class="goal-name">${escapeHTML(g.name)}</span></div>
        </div>
        <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
        <div class="goal-meta">
          <span>${formatCurrency(totalInTarget, g.targetCurrency)} de ${formatCurrency(g.targetAmount, g.targetCurrency)}</span>
          <span>${deadlineTxt}</span>
        </div>
        <div class="goal-balances">${escapeHTML(balancesTxt)}</div>
        <div class="goal-converted">${escapeHTML(convertedTxt)}</div>
        <div class="goal-rate-note">${escapeHTML(rateNote)}</div>
        <div class="goal-actions">
          <button class="secondary-btn contribute-btn">+ Adicionar valor</button>
          <button class="secondary-btn edit-goal-btn">Editar</button>
          <button class="danger-btn delete-goal-btn">Excluir</button>
        </div>
      </div>
    `);
    card.querySelector('.contribute-btn').addEventListener('click', () => openContributionModal(g.id));
    card.querySelector('.edit-goal-btn').addEventListener('click', () => openGoalModal(g));
    card.querySelector('.delete-goal-btn').addEventListener('click', async () => {
      if (confirm(`Excluir a meta "${g.name}"?`)) {
        await DB.deleteGoal(g.id);
        renderAll();
      }
    });
    listEl.appendChild(card);
  });
}

function formatDateLongPt(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ---------- render: lembretes ----------

async function renderReminders() {
  const reminders = await DB.listReminders();
  reminders.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const listEl = document.getElementById('reminders-list');
  listEl.innerHTML = '';
  if (reminders.length === 0) {
    listEl.appendChild(el('<div class="empty">Nenhum lembrete ainda.</div>'));
    return;
  }
  reminders.forEach((r) => {
    const d = daysBetween(r.dueDate);
    let statusClass = '';
    let label = `Vence em ${d} dias`;
    if (r.paid) { statusClass = 'paid'; label = 'Pago'; }
    else if (d < 0) { statusClass = 'overdue'; label = `Atrasado ${Math.abs(d)} dia(s)`; }
    else if (d <= 3) { statusClass = 'soon'; label = d === 0 ? 'Vence hoje' : `Vence em ${d} dia(s)`; }

    const card = el(`
      <div class="reminder-card ${statusClass}" data-id="${r.id}">
        <div>
          <div class="reminder-name">${escapeHTML(r.name)}</div>
          <div class="reminder-due">${label} · ${formatDateLongPt(r.dueDate)}${r.recurrence !== 'none' ? ' · recorrente' : ''}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="reminder-amount">${formatBRL(r.amount)}</div>
          ${r.paid ? '' : '<button class="secondary-btn mark-paid-btn">Marcar pago</button>'}
        </div>
      </div>
    `);
    if (!r.paid) {
      card.querySelector('.mark-paid-btn').addEventListener('click', () => markReminderPaid(r));
    }
    card.addEventListener('click', (e) => {
      if (e.target.closest('.mark-paid-btn')) return;
      openReminderModal(r);
    });
    listEl.appendChild(card);
  });
}

async function markReminderPaid(r) {
  await DB.updateReminder(r.id, { paid: true });
  await DB.addTransaction({
    date: todayISO(),
    type: 'expense',
    method: 'debito',
    category: r.category || 'Contas',
    description: r.name,
    amount: r.amount,
    goalId: null,
  });

  if (r.recurrence !== 'none') {
    const next = nextDueDate(r.dueDate, r.recurrence);
    await DB.addReminder({
      name: r.name,
      amount: r.amount,
      dueDate: next,
      recurrence: r.recurrence,
      category: r.category,
      paid: false,
    });
  }
  showToast('Lembrete marcado como pago');
  renderAll();
}

function nextDueDate(dateStr, recurrence) {
  const d = new Date(dateStr);
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (recurrence === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- render: ajustes ----------

async function renderSettings() {
  const statusText = document.getElementById('drive-status-text');
  const connectBtn = document.getElementById('btn-drive-connect');
  const syncBtn = document.getElementById('btn-drive-sync');
  const disconnectBtn = document.getElementById('btn-drive-disconnect');

  if (!DriveSync.isConfigured()) {
    statusText.textContent = 'Google Drive ainda não configurado (veja js/config.js e o README).';
    connectBtn.disabled = true;
    connectBtn.textContent = 'Configuração pendente';
  } else if (DriveSync.isConnected()) {
    const last = DriveSync.lastSyncedAt();
    statusText.textContent = last ? `Conectado. Última sincronização: ${new Date(last).toLocaleString('pt-BR')}` : 'Conectado. Ainda não sincronizado.';
    connectBtn.classList.add('hidden');
    syncBtn.classList.remove('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    statusText.textContent = 'Não conectado.';
    connectBtn.classList.remove('hidden');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Conectar Google Drive';
    syncBtn.classList.add('hidden');
    disconnectBtn.classList.add('hidden');
  }

  const catsEl = document.getElementById('categories-list');
  catsEl.innerHTML = '';
  [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].forEach((c) => {
    catsEl.appendChild(el(`<span class="chip">${c}</span>`));
  });
}

// ---------- render geral ----------

async function renderAll() {
  if (state.currentView === 'inicio') await renderDashboard();
  if (state.currentView === 'lancamentos') await renderTransactionsList();
  if (state.currentView === 'metas') await renderGoals();
  if (state.currentView === 'lembretes') await renderReminders();
  if (state.currentView === 'ajustes') await renderSettings();
}

// ---------- modal: transação ----------

function openTransactionModal() {
  state.transactionType = 'expense';
  state.selectedMethod = 'debito';
  state.selectedCategory = EXPENSE_CATEGORIES[0];
  document.getElementById('input-amount').value = '';
  document.getElementById('input-description').value = '';
  document.getElementById('input-date').value = todayISO();
  document.querySelectorAll('#type-toggle .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === 'expense'));
  document.querySelectorAll('#method-row .chip').forEach((b) => b.classList.toggle('active', b.dataset.method === 'debito'));
  renderCategoryChips();
  document.getElementById('modal-transaction').classList.remove('hidden');
}

function renderCategoryChips() {
  const cats = state.transactionType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  if (!cats.includes(state.selectedCategory)) state.selectedCategory = cats[0];
  const row = document.getElementById('category-row');
  row.innerHTML = '';
  cats.forEach((c) => {
    const chip = el(`<button class="chip ${c === state.selectedCategory ? 'active' : ''}" data-category="${c}">${c}</button>`);
    chip.addEventListener('click', () => {
      state.selectedCategory = c;
      row.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      chip.classList.add('active');
    });
    row.appendChild(chip);
  });
}

document.querySelectorAll('#type-toggle .segmented-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.transactionType = btn.dataset.type;
    document.querySelectorAll('#type-toggle .segmented-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderCategoryChips();
  });
});

document.querySelectorAll('#method-row .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.selectedMethod = btn.dataset.method;
    document.querySelectorAll('#method-row .chip').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('fab-add').addEventListener('click', openTransactionModal);
document.getElementById('qa-add').addEventListener('click', openTransactionModal);
document.getElementById('qa-sync').addEventListener('click', () => {
  if (!DriveSync.isConfigured()) { showToast('Configure o Google Drive nos Ajustes primeiro'); return; }
  runSync();
});
document.getElementById('btn-cancel-transaction').addEventListener('click', () => {
  document.getElementById('modal-transaction').classList.add('hidden');
});

document.getElementById('btn-save-transaction').addEventListener('click', async () => {
  const amount = parseAmount(document.getElementById('input-amount').value);
  if (!amount || amount <= 0) { showToast('Informe um valor válido'); return; }
  const date = document.getElementById('input-date').value || todayISO();
  const description = document.getElementById('input-description').value.trim();

  await DB.addTransaction({
    date, type: state.transactionType, method: state.selectedMethod,
    category: state.selectedCategory, description, amount, goalId: null,
  });

  document.getElementById('modal-transaction').classList.add('hidden');
  showToast('Lançamento salvo');
  renderAll();
});

// ---------- modal: meta ----------

function openGoalModal(goal) {
  state.editingGoalId = goal ? goal.id : null;
  document.getElementById('goal-modal-title').textContent = goal ? 'Editar meta' : 'Nova meta';
  document.getElementById('goal-name').value = goal ? goal.name : '';
  document.getElementById('goal-target').value = goal ? formatAmountForInput(goal.targetAmount) : '';
  document.getElementById('goal-deadline').value = goal ? goal.deadline || '' : '';
  state.selectedGoalIcon = goal ? goal.icon : '✈️';
  state.selectedGoalCurrency = goal ? goal.targetCurrency || 'BRL' : 'BRL';
  document.querySelectorAll('#goal-icon-row .chip').forEach((b) => b.classList.toggle('active', b.dataset.icon === state.selectedGoalIcon));
  document.querySelectorAll('#goal-currency-row .chip').forEach((b) => b.classList.toggle('active', b.dataset.currency === state.selectedGoalCurrency));
  document.getElementById('modal-goal').classList.remove('hidden');
}

document.getElementById('btn-new-goal').addEventListener('click', () => openGoalModal(null));
document.getElementById('btn-cancel-goal').addEventListener('click', () => document.getElementById('modal-goal').classList.add('hidden'));

document.querySelectorAll('#goal-icon-row .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.selectedGoalIcon = btn.dataset.icon;
    document.querySelectorAll('#goal-icon-row .chip').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.querySelectorAll('#goal-currency-row .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.selectedGoalCurrency = btn.dataset.currency;
    document.querySelectorAll('#goal-currency-row .chip').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('btn-save-goal').addEventListener('click', async () => {
  const name = document.getElementById('goal-name').value.trim();
  const targetAmount = parseAmount(document.getElementById('goal-target').value);
  const deadline = document.getElementById('goal-deadline').value || null;
  if (!name || !targetAmount || targetAmount <= 0) { showToast('Preencha nome e valor alvo'); return; }

  if (state.editingGoalId) {
    await DB.updateGoal(state.editingGoalId, { name, targetAmount, deadline, icon: state.selectedGoalIcon, targetCurrency: state.selectedGoalCurrency });
  } else {
    await DB.addGoal({
      name, targetAmount, deadline, icon: state.selectedGoalIcon, color: '#0B6E4F',
      targetCurrency: state.selectedGoalCurrency, balances: { BRL: 0, USD: 0, EUR: 0 },
    });
  }
  document.getElementById('modal-goal').classList.add('hidden');
  showToast('Meta salva');
  renderAll();
});

// ---------- modal: aporte em meta ----------

function openContributionModal(goalId) {
  state.contributionGoalId = goalId;
  state.selectedContributionCurrency = 'BRL';
  document.getElementById('contribution-amount').value = '';
  document.querySelectorAll('#contribution-currency-row .chip').forEach((b) => b.classList.toggle('active', b.dataset.currency === 'BRL'));
  document.getElementById('modal-contribution').classList.remove('hidden');
}

document.getElementById('btn-cancel-contribution').addEventListener('click', () => document.getElementById('modal-contribution').classList.add('hidden'));

document.querySelectorAll('#contribution-currency-row .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.selectedContributionCurrency = btn.dataset.currency;
    document.querySelectorAll('#contribution-currency-row .chip').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('btn-save-contribution').addEventListener('click', async () => {
  const amount = parseAmount(document.getElementById('contribution-amount').value);
  if (!amount || amount <= 0) { showToast('Informe um valor válido'); return; }
  const currency = state.selectedContributionCurrency;
  const goals = (await DB.listGoals()).map(ensureGoalBalances);
  const goal = goals.find((g) => g.id === state.contributionGoalId);
  if (!goal) return;

  const newBalances = { ...goal.balances, [currency]: (goal.balances[currency] || 0) + amount };
  await DB.updateGoal(goal.id, { balances: newBalances });

  // O lançamento fica registrado no resumo mensal em reais, convertendo
  // pela cotação do dia (o valor original em cada moeda fica guardado na meta).
  const ratesData = await Rates.getRatesFromBRL();
  const amountInBRL = Rates.convert(amount, currency, 'BRL', ratesData);
  await DB.addTransaction({
    date: todayISO(), type: 'expense', method: 'debito',
    category: `Meta: ${goal.name}`,
    description: `Aporte - ${goal.name} (${formatCurrency(amount, currency)})`,
    amount: amountInBRL, goalId: goal.id,
  });

  document.getElementById('modal-contribution').classList.add('hidden');
  showToast('Valor adicionado à meta');
  renderAll();
});

// ---------- modal: lembrete ----------

function openReminderModal(reminder) {
  state.editingReminderId = reminder ? reminder.id : null;
  document.getElementById('reminder-modal-title').textContent = reminder ? 'Editar lembrete' : 'Novo lembrete';
  document.getElementById('reminder-name').value = reminder ? reminder.name : '';
  document.getElementById('reminder-amount').value = reminder ? formatAmountForInput(reminder.amount) : '';
  document.getElementById('reminder-due-date').value = reminder ? reminder.dueDate : todayISO();
  state.selectedReminderRecurrence = reminder ? reminder.recurrence : 'none';
  document.querySelectorAll('#reminder-recurrence-row .chip').forEach((b) => b.classList.toggle('active', b.dataset.recurrence === state.selectedReminderRecurrence));
  document.getElementById('modal-reminder').classList.remove('hidden');
}

document.getElementById('btn-new-reminder').addEventListener('click', () => openReminderModal(null));
document.getElementById('btn-cancel-reminder').addEventListener('click', () => document.getElementById('modal-reminder').classList.add('hidden'));

document.querySelectorAll('#reminder-recurrence-row .chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.selectedReminderRecurrence = btn.dataset.recurrence;
    document.querySelectorAll('#reminder-recurrence-row .chip').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.getElementById('btn-save-reminder').addEventListener('click', async () => {
  const name = document.getElementById('reminder-name').value.trim();
  const amount = parseAmount(document.getElementById('reminder-amount').value);
  const dueDate = document.getElementById('reminder-due-date').value;
  if (!name || !amount || amount <= 0 || !dueDate) { showToast('Preencha todos os campos'); return; }

  if (state.editingReminderId) {
    await DB.updateReminder(state.editingReminderId, { name, amount, dueDate, recurrence: state.selectedReminderRecurrence });
  } else {
    await DB.addReminder({ name, amount, dueDate, recurrence: state.selectedReminderRecurrence, category: 'Contas', paid: false });
  }
  document.getElementById('modal-reminder').classList.add('hidden');
  showToast('Lembrete salvo');
  renderAll();
});

// ---------- Google Drive ----------

document.getElementById('btn-drive-connect').addEventListener('click', async () => {
  try {
    await DriveSync.connect();
    await runSync();
  } catch (e) {
    showToast('Não foi possível conectar: ' + e.message);
  }
  renderSettings();
});

document.getElementById('btn-drive-sync').addEventListener('click', runSync);
document.getElementById('sync-indicator').addEventListener('click', runSync);

document.getElementById('btn-drive-disconnect').addEventListener('click', () => {
  DriveSync.disconnect();
  renderSettings();
  showToast('Google Drive desconectado');
});

async function runSync() {
  if (!DriveSync.isConfigured()) { showToast('Configure o Client ID primeiro (veja README)'); return; }
  const indicator = document.getElementById('sync-indicator');
  indicator.classList.add('spinning');
  try {
    await DriveSync.sync();
    showToast('Sincronizado com o Google Drive');
  } catch (e) {
    showToast('Falha ao sincronizar: ' + e.message);
  } finally {
    indicator.classList.remove('spinning');
    renderAll();
    renderSettings();
  }
}

// ---------- exportar / importar ----------

document.getElementById('btn-export').addEventListener('click', async () => {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeapp-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    await DB.mergeDataset(data);
    showToast('Backup importado com sucesso');
    renderAll();
  } catch (err) {
    showToast('Arquivo inválido');
  }
  e.target.value = '';
});

// ---------- init ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

navigate('inicio');
