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

const PROXY_SCHEME = {
  http: 'PROXY',
  https: 'HTTPS',
  socks4: 'SOCKS4',
  socks5: 'SOCKS5'
};

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const tabDomainMap = {};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('settings', (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

chrome.storage.local.get('settings', (result) => {
  if (result.settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, result.settings);
  }
  applyProxy();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue);
    applyProxy();
  }
});

function applyProxy() {
  if (!settings.enabled) {
    setDirect();
    updateBadge(false);
    return;
  }
  if (settings.mode === 'url') {
    applyPAC();
  } else if (settings.mode === 'tab') {
    checkActiveTab();
  }
}

function setDirect() {
  chrome.proxy.settings.set({
    value: { mode: 'direct' },
    scope: 'regular'
  });
}

function applyPAC() {
  const scheme = PROXY_SCHEME[settings.proxy.protocol] || 'PROXY';
  const proxyLine = `${scheme} ${settings.proxy.host}:${settings.proxy.port}`;
  const whitelistJson = JSON.stringify(settings.whitelist);

  const pac = `
function FindProxyForURL(url, host) {
  var domains = ${whitelistJson};
  if (domains.length === 0) return 'DIRECT';
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    if (d.indexOf('*') !== -1) {
      if (shExpMatch(host, d)) return '${proxyLine}';
    } else {
      if (host === d || dnsDomainIs(host, d)) return '${proxyLine}';
    }
  }
  return 'DIRECT';
}`;

  chrome.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: { data: pac }
    },
    scope: 'regular'
  });

  updateBadge(settings.whitelist.length > 0);
}

function isDomainMatch(domain) {
  domain = domain.toLowerCase();
  return settings.whitelist.some(d => {
    d = d.toLowerCase();
    if (d.includes('*')) {
      var regex = new RegExp('^' + d.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(domain);
    }
    return domain === d || domain.endsWith('.' + d);
  });
}

async function checkActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0 || !tabs[0].url) {
      setDirect();
      updateBadge(false);
      return;
    }
    let domain;
    try {
      domain = new URL(tabs[0].url).hostname;
    } catch (e) {
      setDirect();
      updateBadge(false);
      return;
    }

    const match = settings.whitelist.length > 0 && isDomainMatch(domain);
    if (match) {
      chrome.proxy.settings.set({
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: {
              scheme: settings.proxy.protocol,
              host: settings.proxy.host,
              port: settings.proxy.port
            }
          }
        },
        scope: 'regular'
      });
    } else {
      setDirect();
    }
    updateBadge(match);
  } catch (e) {
    console.error('checkActiveTab error:', e);
    setDirect();
    updateBadge(false);
  }
}

// Tab tracking
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    const url = tab.url || changeInfo.url;
    if (url) {
      try {
        tabDomainMap[tabId] = new URL(url).hostname;
      } catch (e) {
        delete tabDomainMap[tabId];
      }
    }
    if (settings.mode === 'tab') checkActiveTab();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabDomainMap[tabId];
  if (settings.mode === 'tab') checkActiveTab();
});

chrome.tabs.onActivated.addListener(() => {
  if (settings.mode === 'tab') checkActiveTab();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE && settings.mode === 'tab') {
    checkActiveTab();
  }
});

function updateBadge(active) {
  if (!settings.enabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: active ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: active ? '#4CAF50' : '#9E9E9E' });
}
