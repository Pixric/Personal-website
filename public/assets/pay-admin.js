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

  var cash = null;

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
    cash = d;

    $('payEnabled').checked = !!p.enabled;
    $('payApiUrl').value = p.api_url || '';
    $('payPid').value = p.pid || '';
    $('payKey').value = '';
    $('payKey').placeholder = p.key_set ? '已设置，留空表示不修改' : '请输入商户密钥';
    $('payKeyHint').textContent = p.key_set
      ? '密钥已保存（服务端持有，不会回显）'
      : '密钥只在服务端使用，不会发送到浏览器';
    $('payNotifyUrl').value = p.notify_url || '';
    $('payReturnUrl').value = p.return_url || '';

    $('payEntryDonate').checked = !!p.entry_donate;
    $('payEntryPage').checked = !!p.entry_page;
    $('donateTitle').value = p.donate_title || '';
    $('donateDesc').value = p.donate_desc || '';
    $('donatePresets').value = p.donate_presets || '';
    $('kamiTitle').value = p.kami_title || '';
    $('kamiDesc').value = p.kami_desc || '';

    var k = d.kami || {};
    $('kamiStats').textContent = '可用 ' + (k.available || 0) + ' / 已用 ' + (k.used || 0) +
      ' / 共 ' + (k.total || 0) + (k.price ? ' · ' + k.price + ' 元' : '');

    renderKami(d.kami_list || []);
    renderOrders(d.orders || []);
  }

  function renderKami(list) {
    var body = $('kamiBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="pay-empty">还没有卡密，点击上方「批量生成」创建</td></tr>';
      return;
    }
    body.innerHTML = '';
    list.forEach(function (k) {
      var tr = document.createElement('tr');
      var stateCls = k.status === 'available' ? 'pay-ok' : 'pay-muted';
      tr.innerHTML =
        '<td><code class="kami-code">' + esc(k.code) + '</code></td>' +
        '<td>' + esc(k.price) + ' 元</td>' +
        '<td><span class="pay-tag ' + stateCls + '">' + (k.status === 'available' ? '可用' : '已使用') + '</span></td>' +
        '<td>' + esc(k.batch || '—') + '</td>' +
        '<td>' + fmtTime(k.created_at) + '</td>' +
        '<td class="num"><button class="btn ghost small kami-del" type="button">删除</button></td>';

      var btn = tr.querySelector('.kami-del');
      btn.addEventListener('click', function () {
        if (!confirm('确定删除卡密 ' + k.code + '？')) return;
        api('/admin/pay/kami/' + k.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadPay(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      body.appendChild(tr);
    });
  }

  function renderOrders(list) {
    var body = $('orderBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="pay-empty">还没有订单</td></tr>';
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

  function loadPay() {
    return api('/admin/pay/state').then(fillForm).catch(function (e) {
      toast(e.message, 'error');
    });
  }

  function initPay() {
    if (window.__payInited) return;
    window.__payInited = true;

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
          toast('支付配置已保存', 'success');
          loadPay();
        })
        .catch(function (e) { msg(el, e.message, 'error'); })
        .finally(function () { btn.disabled = false; });
    });

    $('testPay').addEventListener('click', function () {
      var btn = $('testPay');
      var el = $('payMsg');
      btn.disabled = true;
      msg(el, '检测中…');
      api('/admin/pay/test')
        .then(function (d) {
          msg(el, d.message + '（签名示例 ' + d.sample_sign.slice(0, 8) + '…）', 'success');
        })
        .catch(function (e) { msg(el, e.message, 'error'); })
        .finally(function () { btn.disabled = false; });
    });

    $('savePayEntry').addEventListener('click', function () {
      var btn = $('savePayEntry');
      var el = $('payEntryMsg');
      btn.disabled = true;
      api('/admin/settings', {
        method: 'PUT',
        body: {
          pay_entry_donate: $('payEntryDonate').checked,
          pay_entry_page: $('payEntryPage').checked,
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

    $('refreshKami').addEventListener('click', loadPay);
    $('refreshOrders').addEventListener('click', loadPay);

    loadPay();
  }

  window.GRWZ = window.GRWZ || {};
  window.GRWZ.initPay = initPay;
  window.GRWZ.loadPay = loadPay;
})();
