(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var PAYTYPE = { alipay: '支付宝', wxpay: '微信支付' };

  function applyBackground(site) {
    var bg = $('bg');
    if (!bg) return;
    var src = '';
    if (site.bg_api_enabled) {
      src = site.bg_api_preset || '';
      if (src) src += (src.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
    } else if (site.bg_remote_url) {
      src = site.bg_remote_url;
    } else if (site.bg_url) {
      src = site.bg_url;
    }
    if (src) {
      bg.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
      var mobile = window.matchMedia('(max-width: 768px)').matches;
      bg.style.backgroundSize = mobile
        ? (site.bg_size_mobile || 'cover')
        : (site.bg_size_desktop || 'cover');
      bg.style.backgroundPosition = site.bg_position || 'center center';
    }
  }

  function applyTheme(site) {
    document.documentElement.classList.toggle('dark', !!site.dark_mode);
    document.body.classList.toggle('dark', !!site.dark_mode);
    var round = Number(site.ui_round || 0);
    if (isFinite(round) && round > 0) {
      var k = round / 100;
      var root = document.documentElement;
      root.style.setProperty('--radius', Math.round(12 + 20 * k) + 'px');
      root.style.setProperty('--radius-lg', Math.round(16 + 26 * k) + 'px');
      root.style.setProperty('--radius-sm', Math.round(8 + 16 * k) + 'px');
    }
  }

  function renderAftersale(site, pay) {
    var list = [];

    var socials = (pay && pay.socials) || site.socials || [];
    for (var i = 0; i < socials.length; i++) {
      var s = socials[i];
      if (!s || !s.url) continue;
      var label = s.label || s.name || '联系方式';
      list.push('<div class="as-line"><b>' + esc(label) + '</b><a href="' + esc(s.url) +
        '" target="_blank" rel="noopener">' + esc(s.url) + '</a></div>');
    }

    if (site.tg_enabled && site.tg_url) {
      list.push('<div class="as-line"><b>Telegram</b><a href="' + esc(site.tg_url) +
        '" target="_blank" rel="noopener">' + esc(site.tg_url) + '</a></div>');
    }

    if (pay && pay.support_text) {
      list.push('<div class="as-line"><b>说明</b><span>' + esc(pay.support_text) + '</span></div>');
    }

    if (!list.length) {
      list.push('<div class="as-line"><b>说明</b><span>如遇问题，请通过站长留下的联系方式反馈订单号。</span></div>');
    }

    list.push('<div class="as-line"><b>提示</b><span>联系时请附上订单号，便于快速核对。</span></div>');

    $('aftersaleBody').innerHTML = list.join('');
    $('aftersalePanel').hidden = false;
  }

  function showLoading(orderNo) {
    $('kamiLoading').hidden = false;
    $('kamiSuccess').hidden = true;
    $('kamiFail').hidden = true;
    $('kamiCard').hidden = true;
    $('orderPanel').hidden = true;
    if (orderNo) $('ksOrder').textContent = orderNo;
  }

  function showSuccess(order) {
    $('kamiLoading').hidden = true;
    $('kamiFail').hidden = true;
    $('kamiSuccess').hidden = false;

    if (order.kami) {
      $('kamiCard').hidden = false;
      $('kcCode').textContent = order.kami;
    } else {
      $('kamiCard').hidden = true;
    }

    $('orderPanel').hidden = false;
    $('opNo').textContent = order.out_trade_no || '—';
    $('opGoods').textContent = order.subject || '—';
    $('opAmount').textContent = order.amount ? '¥' + order.amount : '—';
    $('opPaytype').textContent = PAYTYPE[order.paytype] || order.paytype || '—';
    $('opTime').textContent = fmtTime(order.created_at);
    $('opPaidTime').textContent = fmtTime(order.paid_at) || '—';

    if (order.phone) {
      $('opPhoneWrap').hidden = false;
      $('opPhone').textContent = order.phone;
    } else {
      $('opPhoneWrap').hidden = true;
    }

    if (order.trade_no) {
      $('opTradeWrap').hidden = false;
      $('opTrade').textContent = order.trade_no;
    } else {
      $('opTradeWrap').hidden = true;
    }
  }

  function showFail(title, sub) {
    $('kamiLoading').hidden = true;
    $('kamiSuccess').hidden = true;
    $('kamiFail').hidden = false;
    $('kamiFailTitle').textContent = title || '暂未确认支付';
    $('kamiFailSub').textContent = sub || '如已付款，请凭订单号联系站长';
  }

  function queryByClient(q) {
    return fetch(q.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: q.body,
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { return null; }
        if (Number(data.code) !== 1) return null;
        return data;
      });
  }

  function confirmPaid(no, resp) {
    return fetch('/api/pay/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ out_trade_no: no, response: resp }),
    }).then(function (r) { return r.json(); });
  }

  var tries = 0;
  var MAX = 40;

  function poll(orderNo) {
    tries++;
    if (tries > MAX) {
      showFail('暂未收到支付结果', '如已付款，请凭订单号联系站长');
      return;
    }

    fetch('/api/pay/status/' + orderNo + '?_t=' + Date.now(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) {
          showFail('订单不存在', d.error || '请检查订单号是否正确');
          return;
        }

        if (d.paid) {
          try { localStorage.removeItem('pw_last_order'); } catch (e) {}
          showSuccess(d);
          return;
        }

        if (d.client_query && d.client_query.endpoint) {
          return queryByClient(d.client_query)
            .then(function (resp) {
              if (resp && resp.data && resp.data.trade_status === 'TRADE_SUCCESS') {
                return confirmPaid(orderNo, resp).then(function (r) {
                  if (r && r.ok) {
                    return fetch('/api/pay/status/' + orderNo + '?_t=' + Date.now(), { credentials: 'same-origin' })
                      .then(function (x) { return x.json(); })
                      .then(function (fresh) {
                        if (fresh.paid) {
                          try { localStorage.removeItem('pw_last_order'); } catch (e) {}
                          showSuccess(fresh);
                        } else {
                          setTimeout(function () { poll(orderNo); }, 1500);
                        }
                      });
                  }
                  setTimeout(function () { poll(orderNo); }, 1800);
                });
              }
              setTimeout(function () { poll(orderNo); }, 2000);
            })
            .catch(function () { setTimeout(function () { poll(orderNo); }, 2500); });
        }

        setTimeout(function () { poll(orderNo); }, 2000);
      })
      .catch(function () { setTimeout(function () { poll(orderNo); }, 2500); });
  }

  function init() {
    fetch('/api/site', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var site = d.site || {};
        site.socials = d.socials || [];
        applyBackground(site);
        applyTheme(site);
        renderAftersale(site, site.pay || {});

        var qs = new URLSearchParams(location.search);
        var no = qs.get('no') || qs.get('out_trade_no');
        if (!no) {
          try { no = localStorage.getItem('pw_last_order'); } catch (e) {}
        }

        if (!no) {
          $('kamiWrap').hidden = false;
          $('boot').classList.add('hide');
          showFail('缺少订单号', '请从卡网页面重新进入，或输入订单号查询');
          return;
        }

        showLoading(no);
        $('kamiWrap').hidden = false;
        $('boot').classList.add('hide');
        window.scrollTo(0, 0);
        poll(no);
      })
      .catch(function () {
        $('boot').classList.add('hide');
        $('kamiWrap').hidden = false;
        showFail('加载失败', '请刷新页面重试');
      });
  }

  $('kcCopy').addEventListener('click', function () {
    var code = $('kcCode').textContent;
    if (!code) return;

    var done = function () {
      $('kcCopyText').textContent = '已复制';
      setTimeout(function () { $('kcCopyText').textContent = '复制卡密'; }, 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  });

  init();
})();
