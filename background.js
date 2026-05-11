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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitDomain(value) {
  return value.toLowerCase().split('.').filter(Boolean);
}

function isPatternLabelMatch(label, patternLabel) {
  if (!patternLabel.includes('*')) {
    return label === patternLabel;
  }

  const regex = new RegExp(
    '^' + patternLabel.split('*').map(escapeRegExp).join('.*') + '$'
  );
  return regex.test(label);
}

function isWildcardDomainMatch(domain, pattern) {
  const domainLabels = splitDomain(domain);
  const patternLabels = splitDomain(pattern);
  const memo = new Map();

  function match(domainIndex, patternIndex) {
    const key = `${domainIndex}:${patternIndex}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    let result;
    if (patternIndex === patternLabels.length) {
      result = domainIndex === domainLabels.length;
    } else if (patternLabels[patternIndex] === '*') {
      result = false;
      for (let nextIndex = domainIndex; nextIndex <= domainLabels.length; nextIndex++) {
        if (match(nextIndex, patternIndex + 1)) {
          result = true;
          break;
        }
      }
    } else {
      result =
        domainIndex < domainLabels.length &&
        isPatternLabelMatch(domainLabels[domainIndex], patternLabels[patternIndex]) &&
        match(domainIndex + 1, patternIndex + 1);
    }

    memo.set(key, result);
    return result;
  }

  return match(0, 0);
}

function isDomainPatternMatch(domain, pattern) {
  const normalizedDomain = domain.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (!normalizedPattern.includes('*')) {
    return normalizedDomain === normalizedPattern || normalizedDomain.endsWith('.' + normalizedPattern);
  }

  return isWildcardDomainMatch(normalizedDomain, normalizedPattern);
}

function applyPAC() {
  const scheme = PROXY_SCHEME[settings.proxy.protocol] || 'PROXY';
  const proxyLine = `${scheme} ${settings.proxy.host}:${settings.proxy.port}`;
  const whitelistJson = JSON.stringify(settings.whitelist);

  const pac = [
    'function escapeRegExp(value) {',
    "  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
    '}',
    'function splitDomain(value) {',
    "  var parts = value.toLowerCase().split('.');",
    '  var result = [];',
    '  for (var i = 0; i < parts.length; i++) {',
    '    if (parts[i]) result.push(parts[i]);',
    '  }',
    '  return result;',
    '}',
    'function isPatternLabelMatch(label, patternLabel) {',
    "  if (patternLabel.indexOf('*') === -1) return label === patternLabel;",
    "  var pieces = patternLabel.split('*');",
    "  var source = '^';",
    '  for (var i = 0; i < pieces.length; i++) {',
    "    if (i > 0) source += '.*';",
    '    source += escapeRegExp(pieces[i]);',
    '  }',
    "  source += '$';",
    '  return new RegExp(source).test(label);',
    '}',
    'function isWildcardDomainMatch(host, pattern) {',
    '  var domainLabels = splitDomain(host);',
    '  var patternLabels = splitDomain(pattern);',
    '  var memo = {};',
    '  function match(domainIndex, patternIndex) {',
    "    var key = domainIndex + ':' + patternIndex;",
    '    if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];',
    '    var result;',
    '    if (patternIndex === patternLabels.length) {',
    '      result = domainIndex === domainLabels.length;',
    "    } else if (patternLabels[patternIndex] === '*') {",
    '      result = false;',
    '      for (var nextIndex = domainIndex; nextIndex <= domainLabels.length; nextIndex++) {',
    '        if (match(nextIndex, patternIndex + 1)) {',
    '          result = true;',
    '          break;',
    '        }',
    '      }',
    '    } else {',
    '      result = domainIndex < domainLabels.length &&',
    '        isPatternLabelMatch(domainLabels[domainIndex], patternLabels[patternIndex]) &&',
    '        match(domainIndex + 1, patternIndex + 1);',
    '    }',
    '    memo[key] = result;',
    '    return result;',
    '  }',
    '  return match(0, 0);',
    '}',
    'function isDomainPatternMatch(host, pattern) {',
    '  host = host.toLowerCase();',
    '  pattern = pattern.toLowerCase();',
    "  if (pattern.indexOf('*') === -1) return host === pattern || dnsDomainIs(host, '.' + pattern);",
    '  return isWildcardDomainMatch(host, pattern);',
    '}',
    'function FindProxyForURL(url, host) {',
    `  var domains = ${whitelistJson};`,
    "  if (domains.length === 0) return 'DIRECT';",
    '  host = host.toLowerCase();',
    '  for (var i = 0; i < domains.length; i++) {',
    `    if (isDomainPatternMatch(host, domains[i])) return '${proxyLine}';`,
    '  }',
    "  return 'DIRECT';",
    '}'
  ].join('\n');

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
  return settings.whitelist.some(pattern => isDomainPatternMatch(domain, pattern));
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
