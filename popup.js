const DEFAULT_SETTINGS = {
  enabled: true,
  mode: 'url',
  proxy: {
    protocol: 'http',
    host: '127.0.0.1',
    port: 8080
  },
  whitelist: []
};

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

const $ = (id) => document.getElementById(id);

const el = {
  toggleEnabled: $('toggleEnabled'),
  modeSelect: $('modeSelect'),
  protocolSelect: $('protocolSelect'),
  proxyHost: $('proxyHost'),
  proxyPort: $('proxyPort'),
  domainList: $('domainList'),
  emptyHint: $('emptyHint'),
  newDomain: $('newDomain'),
  addBtn: $('addBtn'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  saveBtn: $('saveBtn'),
  resetBtn: $('resetBtn')
};

chrome.storage.local.get('settings', (result) => {
  if (result.settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, result.settings);
  }
  renderAll();
});

function renderAll() {
  el.toggleEnabled.checked = settings.enabled;
  el.modeSelect.value = settings.mode;
  el.protocolSelect.value = settings.proxy.protocol;
  el.proxyHost.value = settings.proxy.host;
  el.proxyPort.value = settings.proxy.port;
  renderDomainList();
  updateStatus();
}

function renderDomainList() {
  el.domainList.innerHTML = '';
  if (settings.whitelist.length === 0) {
    el.domainList.innerHTML = '<div class="empty-hint">还没有添加域名</div>';
    return;
  }
  settings.whitelist.forEach((domain, index) => {
    const item = document.createElement('div');
    item.className = 'domain-item';
    item.innerHTML = `
      <span class="domain-text">${escapeHtml(domain)}</span>
      <button class="remove-btn" data-index="${index}" title="移除">&times;</button>
    `;
    item.querySelector('.remove-btn').addEventListener('click', () => {
      removeDomain(index);
    });
    el.domainList.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function addDomain() {
  const raw = el.newDomain.value.trim();
  if (!raw) return;

  const domains = raw.split(/[,;\s]+/).filter(Boolean);
  let added = 0;
  domains.forEach((d) => {
    let domain = d.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '');
    domain = domain.trim().toLowerCase();
    if (!domain || domain.includes('/') || domain.includes('?')) return;
    if (!settings.whitelist.includes(domain)) {
      settings.whitelist.push(domain);
      added++;
    }
  });

  if (added > 0) {
    el.newDomain.value = '';
    renderDomainList();
    updateStatus();
  }
}

function removeDomain(index) {
  settings.whitelist.splice(index, 1);
  renderDomainList();
  updateStatus();
}

function saveSettings() {
  settings.enabled = el.toggleEnabled.checked;
  settings.mode = el.modeSelect.value;
  settings.proxy.protocol = el.protocolSelect.value;
  settings.proxy.host = el.proxyHost.value.trim();
  settings.proxy.port = parseInt(el.proxyPort.value, 10) || 8080;

  chrome.storage.local.set({ settings }, () => {
    updateStatus();
    showSaved();
  });
}

function resetDefaults() {
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  renderAll();
  chrome.storage.local.set({ settings });
  showSaved();
}

function updateStatus() {
  const active = settings.enabled && settings.whitelist.length > 0;
  el.statusDot.className = 'status-dot ' + (active ? 'on' : 'off');
  if (!settings.enabled) {
    el.statusText.textContent = '代理已禁用';
  } else if (settings.whitelist.length === 0) {
    el.statusText.textContent = '代理已启用，等待添加域名';
  } else {
    el.statusText.textContent = `代理已启用 - ${settings.whitelist.length} 个域名`;
  }
}

let saveTimeout;
function showSaved() {
  el.saveBtn.textContent = '已保存 ✓';
  el.saveBtn.style.background = '#4CAF50';
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    el.saveBtn.textContent = '保存设置';
    el.saveBtn.style.background = '#1a73e8';
  }, 1500);
}

el.addBtn.addEventListener('click', addDomain);
el.newDomain.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain();
});
el.saveBtn.addEventListener('click', saveSettings);
el.resetBtn.addEventListener('click', resetDefaults);

el.toggleEnabled.addEventListener('change', updateStatus);
el.modeSelect.addEventListener('change', updateStatus);
