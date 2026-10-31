(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function api(path, opts) {
    var o = opts || {};
    var init = { method: o.method || 'GET', credentials: 'same-origin' };
    if (o.body) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(o.body);
    }
    return fetch('/api' + path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '解析失败' }; })
        .then(function (d) {
          if (!r.ok || d.ok === false) throw new Error(d.error || ('请求失败 ' + r.status));
          return d;
        });
    });
  }

  function msg(el, text, type) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg inline' + (type ? ' ' + type : '');
  }

  function toast(text, type) {
    if (window.toast) { window.toast(text, type); return; }
    console.log(text);
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var cache = { state: null, kamiList: [], orders: [] };

  function statusText(s) {
    var map = {
      WAIT_BUYER_PAY: '待支付',
      TRADE_SUCCESS: '已支付',
      TRADE_CLOSED: '已关闭',
      TRADE_REFUND: '已退款',
      TRADE_FREEZE: '已冻结',
      TRADE_UNFREEZE: '已解冻',
    };
    return map[s] || s || '—';
  }

  function fillForm(d) {
    var p = d.pay || {};
    cache.state = d;

    if ($('payEnabled')) $('payEnabled').checked = !!p.enabled;
    if ($('payApiUrl')) $('payApiUrl').value = p.api_url || '';
    if ($('payPid')) $('payPid').value = p.pid || '';
    if ($('payKey')) {
      $('payKey').value = '';
      $('payKey').placeholder = p.key_set ? '已设置，留空表示不修改' : '请输入商户密钥';
    }
    if ($('payKeyHint')) {
      $('payKeyHint').textContent = p.key_set
        ? '密钥已保存（服务端持有，不会回显）'
        : '密钥只在服务端使用，不会发送到浏览器';
    }
    if ($('payNotifyUrl')) $('payNotifyUrl').value = p.notify_url || '';
    if ($('payReturnUrl')) $('payReturnUrl').value = p.return_url || '';

    if ($('payEntryDonate')) $('payEntryDonate').checked = !!p.entry_donate;
    if ($('payEntryPage')) $('payEntryPage').checked = !!p.entry_page;
    if ($('fakaShowHome')) $('fakaShowHome').checked = !!p.faka_show_home;
    if ($('askPhone')) $('askPhone').checked = !!p.ask_phone;
    if ($('announceOn')) $('announceOn').checked = !!p.announce_on;
    if ($('announceText')) $('announceText').value = p.announce_text || '';
    if ($('donateTitle')) $('donateTitle').value = p.donate_title || '';
    if ($('donateDesc')) $('donateDesc').value = p.donate_desc || '';
    if ($('donatePresets')) $('donatePresets').value = p.donate_presets || '';
    if ($('kamiTitle')) $('kamiTitle').value = p.kami_title || '';
    if ($('kamiDesc')) $('kamiDesc').value = p.kami_desc || '';

    var k = d.kami || {};
    if ($('kamiStats')) {
      $('kamiStats').textContent = '可用 ' + (k.available || 0) + ' / 已用 ' + (k.used || 0) +
        ' / 共 ' + (k.total || 0) + (k.price ? ' · ' + k.price + ' 元' : '');
    }

    if ($('tpKamiAvail')) $('tpKamiAvail').textContent = k.available || 0;
    if ($('tpKamiUsed')) $('tpKamiUsed').textContent = k.used || 0;

    cache.kamiList = d.kami_list || [];
    cache.orders = d.orders || [];
    renderKami();
    renderOrders();

    var configured = !!(p.api_url && p.pid && p.key_set);
    Array.prototype.forEach.call(document.querySelectorAll('[data-pay-panel]'), function (el) {
      el.hidden = !configured;
    });

    var guide = document.querySelector('.bind-guide');
    if (guide) guide.hidden = configured;

    if (!configured) {
      var sw = $('paySwitchPanel');
      if (sw) sw.hidden = false;
    }
  }

  function renderKami() {
    var body = $('kamiBody');
    if (!body) return;

    var kw = String(($('kamiSearch') && $('kamiSearch').value) || '').trim().toUpperCase();
    var list = cache.kamiList.filter(function (k) {
      if (!kw) return true;
      return String(k.code || '').toUpperCase().indexOf(kw) >= 0 ||
        String(k.batch || '').toUpperCase().indexOf(kw) >= 0;
    });

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="pay-empty">' +
        (kw ? '没有匹配的卡密' : '还没有卡密，点击上方「批量生成」创建') + '</td></tr>';
      return;
    }

    body.innerHTML = '';
    list.forEach(function (k) {
      var tr = document.createElement('tr');
      var ok = k.status === 'available';
      tr.innerHTML =
        '<td><code class="kami-code">' + esc(k.code) + '</code></td>' +
        '<td>' + esc(k.price) + ' 元</td>' +
        '<td><span class="pay-tag ' + (ok ? 'pay-ok' : 'pay-muted') + '">' +
          (ok ? '可用' : '已使用') + '</span></td>' +
        '<td>' + esc(k.batch || '—') + '</td>' +
        '<td>' + fmtTime(k.created_at) + '</td>' +
        '<td class="num"><button class="btn ghost small kami-del" type="button">删除</button></td>';

      tr.querySelector('.kami-del').addEventListener('click', function () {
        if (!confirm('确定删除卡密 ' + k.code + '？')) return;
        api('/admin/pay/kami/' + k.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadPay(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      body.appendChild(tr);
    });
  }

  function renderOrders() {
    var body = $('orderBody');
    if (!body) return;

    var filter = ($('orderFilter') && $('orderFilter').value) || '';
    var list = cache.orders.filter(function (o) {
      return !filter || o.status === filter;
    });

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="pay-empty">' +
        (filter ? '该状态下没有订单' : '还没有订单') + '</td></tr>';
      return;
    }

    body.innerHTML = '';
    list.forEach(function (o) {
      var tr = document.createElement('tr');
      var cls = o.status === 'TRADE_SUCCESS' ? 'pay-ok' : 'pay-muted';
      tr.innerHTML =
        '<td><code>' + esc(o.out_trade_no) + '</code></td>' +
        '<td>' + (o.kind === 'kami' ? '卡密' : '赞赏') + '</td>' +
        '<td>' + esc(o.amount) + ' 元</td>' +
        '<td><span class="pay-tag ' + cls + '">' + esc(statusText(o.status)) + '</span></td>' +
        '<td>' + (o.kami ? '<code class="kami-code">' + esc(o.kami) + '</code>' : '—') + '</td>' +
        '<td>' + fmtTime(o.created_at) + '</td>';
      body.appendChild(tr);
    });
  }

  function drawChart(series) {
    var svg = $('tradeChart');
    if (!svg) return;

    var W = 720, H = 220;
    var padL = 44, padR = 16, padT = 14, padB = 26;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    var maxA = 1, maxO = 1;
    series.forEach(function (p) {
      if (p.amount > maxA) maxA = p.amount;
      if (p.orders > maxO) maxO = p.orders;
    });

    var n = series.length || 1;
    function xAt(i) { return padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1)); }
    function yAt(v, max) { return padT + innerH - (v / max) * innerH; }

    var parts = [];
    for (var g = 0; g <= 4; g++) {
      var y = padT + (innerH * g) / 4;
      parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
        '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>');
      var label = (maxA * (1 - g / 4)).toFixed(maxA >= 10 ? 0 : 1);
      parts.push('<text x="' + (padL - 8) + '" y="' + (y + 4) +
        '" text-anchor="end" font-size="10" fill="var(--text-3)">' + label + '</text>');
    }

    function path(key, max) {
      var d = '';
      series.forEach(function (p, i) {
        d += (i === 0 ? 'M' : 'L') + xAt(i).toFixed(1) + ' ' + yAt(p[key], max).toFixed(1) + ' ';
      });
      return d.trim();
    }

    parts.push('<path d="' + path('orders', maxO) + '" fill="none" stroke="#8fc4f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    parts.push('<path d="' + path('amount', maxA) + '" fill="none" stroke="#1a7ff0" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>');

    var every = Math.ceil(n / 7);
    series.forEach(function (p, i) {
      if (i % every !== 0 && i !== n - 1) return;
      var x = xAt(i);
      parts.push('<circle cx="' + x + '" cy="' + yAt(p.orders, maxO) + '" r="2.6" fill="#8fc4f5"/>');
      parts.push('<circle cx="' + x + '" cy="' + yAt(p.amount, maxA) + '" r="3.2" fill="#1a7ff0"/>');
      var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      parts.push('<text x="' + x + '" y="' + (H - 6) +
        '" text-anchor="' + anchor + '" font-size="10" fill="var(--text-3)">' + p.date.slice(5) + '</text>');
    });

    svg.innerHTML = parts.join('');
  }

  function loadOverview() {
    var days = ($('tradeRange') && $('tradeRange').value) || '14';
    return api('/admin/pay/overview?days=' + days).then(function (d) {
      if ($('tpWaitPay')) $('tpWaitPay').textContent = d.pending.wait_pay;
      if ($('tpKamiAvail')) $('tpKamiAvail').textContent = d.pending.kami_available;
      if ($('tpKamiUsed')) $('tpKamiUsed').textContent = d.pending.kami_used;
      if ($('tpPaid')) $('tpPaid').textContent = d.total.paid;

      if ($('tsTodayAmount')) $('tsTodayAmount').textContent = d.today.amount.toFixed(2);
      if ($('tsTodayAmountSub')) $('tsTodayAmountSub').textContent = '昨日 ' + d.yesterday.amount.toFixed(2);
      if ($('tsTodayOrders')) $('tsTodayOrders').textContent = d.today.orders;
      if ($('tsTodayOrdersSub')) $('tsTodayOrdersSub').textContent = '昨日 ' + d.yesterday.orders;
      if ($('tsTotalAmount')) $('tsTotalAmount').textContent = d.total.amount.toFixed(2);
      if ($('tsTotalOrders')) $('tsTotalOrders').textContent = d.total.orders;
      if ($('tsTotalPaidSub')) $('tsTotalPaidSub').textContent = '已成交 ' + d.total.paid;

      drawChart(d.series || []);
    }).catch(function (e) {
      toast(e.message, 'error');
    });
  }

  function runVerify(done) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal verify-modal" role="dialog">' +
        '<div class="verify-head">' +
          '<div class="verify-spin" id="vfSpin"></div>' +
          '<div class="verify-title" id="vfTitle">正在校验支付配置</div>' +
          '<div class="verify-sub" id="vfSub">请稍候，正在连接支付平台…</div>' +
        '</div>' +
        '<div class="verify-steps" id="vfSteps"></div>' +
        '<div class="verify-foot" id="vfFoot" hidden>' +
          '<button class="btn primary" id="vfClose" type="button">完成</button>' +
        '</div>' +
      '</div>';

    document.getElementById('modalRoot').appendChild(mask);

    function addStep(name, state, detail) {
      var box = document.getElementById('vfSteps');
      var el = document.createElement('div');
      el.className = 'vf-step ' + state;
      var icon = state === 'ok'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
        : state === 'fail'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
          : '<div class="vf-dot"></div>';
      el.innerHTML = '<span class="vf-icon">' + icon + '</span>' +
        '<span class="vf-name">' + name + '</span>' +
        '<span class="vf-detail">' + (detail || '') + '</span>';
      box.appendChild(el);
    }

    document.getElementById('vfClose').addEventListener('click', function () {
      mask.remove();
      if (done) done();
    });

    addStep('检查配置完整性', 'loading', '');

    api('/admin/pay/test').then(function (d) {
      var steps = d.steps || [];
      var box = document.getElementById('vfSteps');
      box.innerHTML = '';

      var allOk = true;
      steps.forEach(function (s) {
        addStep(s.name, s.ok ? 'ok' : 'fail', s.detail);
        if (!s.ok) allOk = false;
      });

      document.getElementById('vfSpin').className = allOk ? 'verify-spin ok' : 'verify-spin fail';
      document.getElementById('vfSpin').innerHTML = allOk
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      document.getElementById('vfTitle').textContent = allOk ? '配置校验通过' : '配置校验未通过';
      document.getElementById('vfSub').textContent = allOk
        ? '支付功能已就绪，可以开始营业了'
        : '请根据下方提示修正后重新校验';
      document.getElementById('vfFoot').hidden = false;

      toast(d.message, allOk ? 'success' : 'error');
      loadPay();
    }).catch(function (e) {
      addStep('校验请求', 'fail', e.message);
      document.getElementById('vfSpin').className = 'verify-spin fail';
      document.getElementById('vfTitle').textContent = '校验失败';
      document.getElementById('vfSub').textContent = e.message;
      document.getElementById('vfFoot').hidden = false;
      if (done) done();
    });
  }

  function loadPay() {
    return api('/admin/pay/state').then(fillForm).catch(function (e) {
      toast(e.message, 'error');
    });
  }

  function initPay() {
    if (window.__payInited) return;
    window.__payInited = true;

    if ($('savePay')) {
      $('savePay').addEventListener('click', function () {
        var btn = $('savePay');
        var el = $('payMsg');
        var body = {
          pay_enabled: $('payEnabled').checked,
          pay_api_url: $('payApiUrl').value.trim(),
          pay_pid: $('payPid').value.trim(),
          pay_notify_url: $('payNotifyUrl').value.trim(),
          pay_return_url: $('payReturnUrl').value.trim(),
        };
        var key = $('payKey').value.trim();
        if (key) body.pay_key = key;

        btn.disabled = true;
        msg(el, '保存中…');
        api('/admin/settings', { method: 'PUT', body: body })
          .then(function () {
            msg(el, '已保存', 'success');
            toast('交易配置已保存', 'success');
            loadPay();
          })
          .catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    if ($('testPay')) {
      $('testPay').addEventListener('click', function () {
        var btn = $('testPay');
        btn.disabled = true;
        runVerify(function () { btn.disabled = false; });
      });
    }

    if ($('savePayEntry')) {
      $('savePayEntry').addEventListener('click', function () {
        var btn = $('savePayEntry');
        var el = $('payEntryMsg');
        btn.disabled = true;
        api('/admin/settings', {
          method: 'PUT',
          body: {
            pay_entry_donate: $('payEntryDonate').checked,
            pay_entry_page: $('payEntryPage').checked,
            faka_show_home: $('fakaShowHome') ? $('fakaShowHome').checked : true,
            pay_ask_phone: $('askPhone') ? $('askPhone').checked : false,
            donate_title: $('donateTitle').value.trim(),
            donate_desc: $('donateDesc').value.trim(),
            donate_presets: $('donatePresets').value.trim(),
            kami_title: $('kamiTitle').value.trim(),
            kami_desc: $('kamiDesc').value.trim(),
          },
        }).then(function () {
          msg(el, '已保存', 'success');
          toast('入口设置已保存', 'success');
        }).catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    if ($('saveAnnounce')) {
      $('saveAnnounce').addEventListener('click', function () {
        var btn = $('saveAnnounce');
        var el = $('announceMsg');
        btn.disabled = true;
        api('/admin/settings', {
          method: 'PUT',
          body: {
            pay_announce_on: $('announceOn').checked,
            pay_announce: $('announceText').value,
          },
        }).then(function () {
          msg(el, '已保存', 'success');
          toast('公告已保存', 'success');
        }).catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    if ($('copyNotify')) {
      $('copyNotify').addEventListener('click', function () {
        var input = $('payNotifyUrl');
        var url = (input.value || '').trim();

        if (!url) {
          url = location.origin + '/api/pay/notify';
          input.value = url;
        }

        var done = function () { toast('通知地址已复制', 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(function () {
            input.select();
            document.execCommand('copy');
            done();
          });
        } else {
          input.select();
          document.execCommand('copy');
          done();
        }
      });
    }

    if ($('genKami')) {
      $('genKami').addEventListener('click', function () {
        var btn = $('genKami');
        var el = $('kamiMsg');
        var count = parseInt($('kamiCount').value, 10) || 1;
        var price = $('kamiPrice').value.trim();

        if (!/^\d+(\.\d{1,2})?$/.test(price)) {
          msg(el, '请填写正确的价格', 'error');
          return;
        }

        btn.disabled = true;
        msg(el, '生成中…');
        api('/admin/pay/kami', {
          method: 'POST',
          body: { count: count, price: price, batch: $('kamiBatch').value.trim() },
        }).then(function (d) {
          msg(el, '已生成 ' + d.count + ' 张', 'success');
          toast('已生成 ' + d.count + ' 张卡密', 'success');
          loadPay();
        }).catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    if ($('kamiSearch')) {
      $('kamiSearch').addEventListener('input', renderKami);
    }

    if ($('orderFilter')) {
      $('orderFilter').addEventListener('change', renderOrders);
    }

    if ($('refreshKami')) {
      $('refreshKami').addEventListener('click', loadPay);
    }

    if ($('refreshOrders')) {
      $('refreshOrders').addEventListener('click', loadPay);
    }

    if ($('tradeRange')) {
      $('tradeRange').addEventListener('change', loadOverview);
    }

    if ($('resetTrade')) {
      $('resetTrade').addEventListener('click', function () {
        var btn = $('resetTrade');
        var el = $('resetMsg');
        var confirmText = $('resetConfirm').value.trim();

        if (confirmText !== 'RESET') {
          msg(el, '请输入 RESET 以确认', 'error');
          return;
        }

        btn.disabled = true;
        msg(el, '重置中…');
        api('/admin/pay/reset', { method: 'POST', body: { confirm: 'RESET' } })
          .then(function () {
            msg(el, '已重置', 'success');
            toast('交易数据已重置', 'success');
            $('resetConfirm').value = '';
            loadPay();
            loadOverview();
          })
          .catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    loadPay();
    loadOverview();
  }

  window.GRWZ = window.GRWZ || {};
  window.GRWZ.initPay = initPay;
  window.GRWZ.loadPay = loadPay;
  window.GRWZ.loadOverview = loadOverview;
})();
