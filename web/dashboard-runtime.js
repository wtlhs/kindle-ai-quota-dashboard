(function () {
  var STABLE_DATA_FALLBACK = 'data.js';
  var LIVE = window.DASH_LIVE_ENDPOINT || STABLE_DATA_FALLBACK;
  var ENDPOINT_POINTER = 'live-endpoint.js';
  var last = null;
  var rendered = '';
  var POLL_INTERVAL_MS = 3 * 60 * 1000;
  var POLL_OFFSET_MS = 5000;
  var WD = ['周日','周一','周二','周三','周四','周五','周六'];

  function el(id) { return document.getElementById(id); }
  function nodeText(node, value) {
    value = String(value);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function txt(id, value) { nodeText(el(id), value); }
  function nodeClass(node, value) {
    if (node && node.className !== value) node.className = value;
  }
  function nodeHtml(node, value) {
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }
  function nodeStyle(node, name, value) {
    if (node && node.style[name] !== value) node.style[name] = value;
  }
  function nodeAttr(node, name, value) {
    value = String(value);
    if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp(value) { var n = Date.parse(value || ''); return isNaN(n) ? 0 : n; }
  function hhmm(value) { var d = new Date(value); return isNaN(d.getTime()) ? '--:--' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function quietHours(value) {
    var hour = (value || new Date()).getHours();
    return hour >= 3 && hour < 8;
  }
  function delayUntilEight(value) {
    var now = value || new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 5, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  function clock() {
    var d = new Date();
    txt('dtTime', pad(d.getHours()) + ':' + pad(d.getMinutes()));
    txt('dtDate', d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日');
    txt('dtWeek', WD[d.getDay()]);
    heartbeat();
  }

  function battery() {
    var m = String(location.search || '').match(/[?&]battery=([0-9]{1,3})/);
    var c = String(location.search || '').match(/[?&]charging=([01])/);
    var pct = m ? Number(m[1]) : null;
    var charging = c ? c[1] === '1' : false;
    if (window.KINDLE_DEVICE) {
      if (typeof window.KINDLE_DEVICE.battery === 'number') pct = window.KINDLE_DEVICE.battery;
      if (typeof window.KINDLE_DEVICE.charging === 'boolean') charging = window.KINDLE_DEVICE.charging;
      else if (window.KINDLE_DEVICE.charging === 0 || window.KINDLE_DEVICE.charging === 1) charging = window.KINDLE_DEVICE.charging === 1;
    }
    if (pct === null) return;
    pct = Math.max(0, Math.min(100, pct));
    txt('batPct', (charging ? '⚡ ' : '') + pct + '%');
    var fill = el('batFill');
    nodeAttr(fill, 'width', Math.round(18 * pct / 100));
  }

  function loadDeviceStatus() {
    var script = document.createElement('script');
    script.async = true;
    script.src = 'device-status.js?_=' + Date.now();
    script.onload = function () { battery(); if (script.parentNode) script.parentNode.removeChild(script); };
    script.onerror = function () { if (script.parentNode) script.parentNode.removeChild(script); };
    document.getElementsByTagName('head')[0].appendChild(script);
  }

  function heartbeat() {
    var age = last ? Math.floor((Date.now() - stamp(last.updatedAt)) / 60000) : 99999;
    var when = hhmm(last && last.updatedAt);
    var status = el('dataStatus');
    var alert = el('dataAlert');
    var rel = el('relTime');
    if (last) nodeText(rel, age < 1 ? '刚刚更新' : age + '分钟前更新');
    if (quietHours()) {
      nodeText(status, '夜间省电 · 08:00恢复');
      nodeClass(status, '');
      nodeText(alert, '');
      nodeClass(alert, 'data-alert');
    } else if (!last || age > 15) {
      nodeText(status, '离线 · 最后 ' + when);
      nodeClass(status, 'warn');
      nodeText(alert, '电脑或数据链路已离线 · 最后在线 ' + when);
      nodeClass(alert, 'data-alert on');
    } else if (age >= 7) {
      nodeText(status, '延迟 ' + age + ' 分钟 · ' + when);
      nodeClass(status, 'warn');
      nodeText(alert, '实时数据延迟 ' + age + ' 分钟 · 正在显示最后一次结果');
      nodeClass(alert, 'data-alert on');
    } else {
      nodeText(status, '实时 · ' + when);
      nodeClass(status, '');
      nodeText(alert, '');
      nodeClass(alert, 'data-alert');
    }
  }

  function label(name) {
    name = String(name || '');
    if (/5小时|5H/i.test(name)) return '5H QUOTA';
    if (/7天|周|WEEK/i.test(name)) return 'WEEKLY';
    if (/月|MONTH/i.test(name)) return 'MONTHLY';
    return name || 'QUOTA';
  }

  function countdown(value) {
    var ms = stamp(value) - Date.now();
    if (!value || !ms) return '↻ 未提供刷新时间';
    if (ms <= 0) return '↻ 即将刷新';
    var mins = Math.ceil(ms / 60000);
    var days = Math.floor(mins / 1440);
    var hours = Math.floor((mins % 1440) / 60);
    mins = mins % 60;
    if (days) return '↻ ' + days + 'd' + (hours ? ' ' + hours + 'h' : '');
    if (hours) return '↻ ' + hours + 'h' + pad(mins) + 'm';
    return '↻ ' + mins + 'm';
  }

  function quota(cardId, source) {
    var card = el(cardId);
    if (!card) return;
    var rows = card.querySelectorAll('.q-row');
    var windows = source && source.ok && source.windows ? source.windows : [];
    var i, spans, bar, refresh;
    for (i = 0; i < rows.length; i++) {
      if (i >= windows.length) { nodeStyle(rows[i], 'display', 'none'); continue; }
      nodeStyle(rows[i], 'display', 'block');
      spans = rows[i].querySelectorAll('.q-label span');
      if (spans.length > 1) {
        nodeText(spans[0], label(windows[i].name));
        nodeText(spans[1], windows[i].displayValue != null
          ? String(windows[i].displayValue)
          : Math.round(Number(windows[i].usedPct) || 0) + '%');
      }
      bar = rows[i].querySelector('.q-bar-fill');
      if (bar) {
        var barPct = windows[i].barPct != null ? windows[i].barPct : windows[i].usedPct;
        nodeStyle(bar, 'width', Math.max(0, Math.min(100, Number(barPct) || 0)) + '%');
      }
      refresh = rows[i].querySelector('.q-refresh');
      nodeText(refresh, windows[i].detailText || countdown(windows[i].resetAt));
    }
    if (!windows.length && rows.length) {
      nodeStyle(rows[0], 'display', 'block');
      spans = rows[0].querySelectorAll('.q-label span');
      if (spans.length > 1) { nodeText(spans[0], '获取失败'); nodeText(spans[1], '--'); }
      bar = rows[0].querySelector('.q-bar-fill');
      nodeStyle(bar, 'width', '0%');
      refresh = rows[0].querySelector('.q-refresh');
      nodeText(refresh, '↻ 等待下次采集');
    }
  }

  function weatherIcon(key, desc) {
    var v = (String(key || '') + ' ' + String(desc || '')).toLowerCase();
    if (/thunder|雷/.test(v)) return 'ϟ';
    if (/snow|雪/.test(v)) return '❄';
    if (/rain|wet|雨/.test(v)) return '☂';
    if (/fog|mist|haze|雾/.test(v)) return '≋';
    if (/clear|sun|晴/.test(v)) return '☀';
    return '☁';
  }

  function weather(w) {
    if (!w || !w.ok) return;
    txt('weatherTemp', Math.round(Number(w.tempC)) + '°');
    var icon = el('weatherIcon');
    nodeHtml(icon, '<span style="font-size:30px;line-height:1">' + weatherIcon(w.iconKey, w.description) + '</span>');
    var detail = el('weatherDetail');
    nodeHtml(detail, String(w.description || '天气') + ' · 体感 ' + Math.round(Number(w.feelsLikeC)) + '° · 湿度 ' + Math.round(Number(w.humidity)) + '%<br>风 ' + Math.round(Number(w.windKph)) + 'km/h · ' + String(w.place || '北京'));
  }

  function deepseek(source) {
    if (source && source.ok && typeof source.balance === 'number') {
      txt('deepSeekBalance', '¥ ' + Number(source.balance).toFixed(2));
      txt('deepSeekDetail', '实时余额 · 按量计费');
    } else {
      txt('deepSeekBalance', '¥ --');
      txt('deepSeekDetail', '获取失败 · 等待下次采集');
    }
  }

  function renderQuote(q) {
    if (!q || !q.text) return;
    var qtNode = document.querySelector('.quote-text');
    var qsNode = document.querySelector('.quote-src');
    if (qtNode) nodeText(qtNode, q.text);
    if (qsNode && q.source) nodeText(qsNode, '— ' + q.source);
  }

  function render(data) {
    if (!data || !data.updatedAt || !data.sources) return;
    if (rendered && stamp(data.updatedAt) < stamp(rendered)) return;
    last = data;
    if (data.updatedAt !== rendered) {
      rendered = data.updatedAt;
      weather(data.weather);
      quota('cardClaude', data.sources.claude);
      quota('cardCodex', data.sources.codex);
      quota('cardKimi', data.sources.kimi);
      deepseek(data.sources.deepseek);
      renderQuote(data.quote);
      var rel = el('relTime');
      if (rel) nodeAttr(rel, 'data-ts', data.updatedAt);
    }
    heartbeat();
  }

  function loadDataFrom(url, allowFallback) {
    if (!url || url.indexOf('__LIVE_') === 0) return;
    var script = document.createElement('script');
    script.async = true;
    script.src = url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
    script.onload = function () { render(window.DASH_DATA); if (script.parentNode) script.parentNode.removeChild(script); };
    script.onerror = function () {
      if (script.parentNode) script.parentNode.removeChild(script);
      if (allowFallback && url !== STABLE_DATA_FALLBACK) loadDataFrom(STABLE_DATA_FALLBACK, false);
    };
    document.getElementsByTagName('head')[0].appendChild(script);
  }

  function loadLiveData() {
    loadDataFrom(LIVE, true);
  }

  function poll() {
    loadDeviceStatus();
    var pointer = document.createElement('script');
    pointer.async = true;
    pointer.src = ENDPOINT_POINTER + '?_=' + Date.now();
    pointer.onload = function () {
      var next = window.DASH_LIVE_ENDPOINT || '';
      if (next && next.indexOf('__LIVE_') !== 0) LIVE = next;
      if (pointer.parentNode) pointer.parentNode.removeChild(pointer);
      loadLiveData();
    };
    pointer.onerror = function () {
      if (pointer.parentNode) pointer.parentNode.removeChild(pointer);
      LIVE = STABLE_DATA_FALLBACK;
      loadLiveData();
    };
    document.getElementsByTagName('head')[0].appendChild(pointer);
  }

  function schedulePoll() {
    var date = new Date();
    var now = date.getTime();
    var delay;
    if (quietHours(date)) {
      delay = delayUntilEight(date);
    } else {
      delay = (POLL_OFFSET_MS - (now % POLL_INTERVAL_MS) + POLL_INTERVAL_MS) % POLL_INTERVAL_MS;
      if (delay < 250) delay += POLL_INTERVAL_MS;
    }
    setTimeout(function () {
      if (!quietHours()) poll();
      schedulePoll();
    }, delay);
  }

  function scheduleClock() {
    var date = new Date();
    var now = date.getTime();
    var delay = quietHours(date)
      ? delayUntilEight(date)
      : 60000 - (now % 60000) + 100;
    setTimeout(function () {
      clock();
      scheduleClock();
    }, delay);
  }

  render(window.DASH_DATA);
  clock();
  battery();
  if (!quietHours()) poll();
  schedulePoll();
  scheduleClock();
}());
