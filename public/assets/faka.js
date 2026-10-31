(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
      bg.style.backgroundPosition = site.bg_position || 'center center';
      var mobile = window.matchMedia('(max-width: 768px)').matches;
      bg.style.backgroundSize = mobile
        ? (site.bg_size_mobile || 'cover')
        : (site.bg_size_desktop || 'cover');
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

    var dim = Number(site.dark_bg_dim || 0);
    if (site.dark_mode && dim > 0) {
      var layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;' +
        'background:rgba(0,0,0,' + (dim / 100) + ');';
      var bgEl = $('bg');
      if (bgEl && bgEl.parentNode) bgEl.parentNode.insertBefore(layer, bgEl.nextSibling);
    }
  }

  function applyFont(site) {
    if (!site.font_url || !site.font_family) return;
    var scope = String(site.font_scope || '').split(',');
    if (scope.indexOf('front') < 0) return;
    var style = document.createElement('style');
    style.textContent =
      '@font-face{font-family:"' + site.font_family + '";src:url("' + site.font_url + '");font-display:swap;}' +
      'body,button,input,textarea,select{font-family:"' + site.font_family + '",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif !important;}';
    document.head.appendChild(style);
  }

  var payCfg = {};
  var allGoods = [];
  var allCats = [];
  var curCat = 0;
  var curGoods = null;

  function renderBrand(site) {
    var name = site.site_name || '我的主页';
    $('navName').textContent = name;
    $('navLogo').textContent = name.slice(0, 1);

    if (site.avatar_url) {
      $('navLogo').style.backgroundImage = 'url("' + site.avatar_url.replace(/"/g, '%22') + '")';
      $('navLogo').style.backgroundSize = 'cover';
      $('navLogo').style.backgroundPosition = 'center';
      $('navLogo').textContent = '';
    }

    $('fakaTitle').textContent = site.pay && site.pay.kamiTitle ? site.pay.kamiTitle : '卡网';
    $('fakaSub').textContent = site.pay && site.pay.kamiDesc ? site.pay.kamiDesc : '付款后自动发货';
    document.title = $('fakaTitle').textContent;
  }

  function renderAnnounce(cfg) {
    payCfg = cfg || {};
    if (!cfg || !cfg.announce) return;
    $('announceCard').hidden = false;
    $('announceBody').textContent = cfg.announce;
  }

  function renderFilter() {
    var box = $('fakaFilter');
    if (!allCats.length || allGoods.length <= 1) { box.hidden = true; return; }

    box.hidden = false;
    box.innerHTML = '';

    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'faka-chip' + (curCat === 0 ? ' active' : '');
    all.textContent = '全部';
    all.addEventListener('click', function () { curCat = 0; renderFilter(); renderGoods(); });
    box.appendChild(all);

    allCats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'faka-chip' + (curCat === c.id ? ' active' : '');
      b.textContent = c.name;
      b.addEventListener('click', function () { curCat = c.id; renderFilter(); renderGoods(); });
      box.appendChild(b);
    });
  }

  function renderGoods() {
    var grid = $('goodsGrid');
    var list = curCat ? allGoods.filter(function (g) { return g.category_id === curCat; }) : allGoods;

    if (!list.length) {
      grid.innerHTML = '';
      $('fakaEmpty').hidden = false;
      return;
    }

    $('fakaEmpty').hidden = true;
    grid.innerHTML = '';

    list.forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'goods-card';

      var cover = g.cover_url
        ? '<div class="goods-cover" style="background-image:url(\'' + esc(g.cover_url) + '\')"></div>'
        : '<div class="goods-cover goods-cover-empty">暂无图片</div>';

      var tag = g.category_name ? '<span class="goods-tag">' + esc(g.category_name) + '</span>' : '';

      card.innerHTML =
        '<div style="position:relative">' + cover + tag + '</div>' +
        '<div class="goods-body">' +
          '<div class="goods-name">' + esc(g.title) + '</div>' +
          (g.desc ? '<div class="goods-desc">' + esc(g.desc) + '</div>' : '') +
          '<div class="goods-foot">' +
            '<div>' +
              '<div class="goods-price"><small>¥</small>' + esc(g.price) + '</div>' +
              '<div class="goods-stock">库存 ' + g.stock + ' · 已售 ' + (g.sales || 0) + '</div>' +
            '</div>' +
            '<button class="goods-buy" type="button">购买</button>' +
          '</div>' +
        '</div>';

      card.querySelector('.goods-buy').addEventListener('click', function () {
        openBuy(g);
      });

      grid.appendChild(card);
    });
  }

  function openBuy(g) {
    curGoods = g;
    $('buyTitle').textContent = '购买商品';
    $('buySub').textContent = '付款后自动发放卡密';

    $('buyGoods').innerHTML =
      '<div class="buy-goods-name">' + esc(g.title) + '</div>' +
      '<div class="buy-goods-row">' +
        '<span>单价</span>' +
        '<span class="buy-goods-price">¥' + esc(g.price) + '</span>' +
      '</div>';

    var phoneWrap = $('buyPhoneWrap');
    if (phoneWrap) {
      phoneWrap.hidden = !payCfg.askPhone;
      if (payCfg.askPhone) $('buyPhone').value = '';
    }

    $('buyTip').textContent = '';
    $('buySubmit').textContent = '支付 ¥' + g.price;
    $('buySubmit').disabled = false;
    $('payMask').hidden = false;
  }

  function closeBuy() {
    $('payMask').hidden = true;
  }

  function showResult(ok, title, sub, kami) {
    $('resultIcon').className = 'result-icon' + (ok ? '' : ' pending');
    $('resultIcon').innerHTML = ok
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/></svg>';

    $('resultTitle').textContent = title;
    $('resultSub').textContent = sub || '';

    if (kami) {
      $('kamiBox').hidden = false;
      $('kamiCode').textContent = kami;
    } else {
      $('kamiBox').hidden = true;
    }

    $('resultMask').hidden = false;
  }

  function pollStatus(no, tries) {
    var n = tries || 0;
    if (n > 30) {
      showResult(false, '暂未收到支付结果', '如已付款请联系站长，凭订单号查询');
      return;
    }

    fetch('/api/pay/status/' + no + '?_t=' + Date.now(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok && d.paid && d.kami) {
          showResult(true, '支付成功', '卡密已发放，请妥善保存', d.kami);
        } else if (d.ok && d.paid) {
          showResult(true, '支付成功', '请联系站长领取卡密', '');
        } else {
          setTimeout(function () { pollStatus(no, n + 1); }, 2000);
        }
      })
      .catch(function () {
        setTimeout(function () { pollStatus(no, n + 1); }, 2000);
      });
  }

  function init() {
    fetch('/api/site', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var site = d.site || {};
        applyBackground(site);
        applyTheme(site);
        applyFont(site);
        renderBrand(site);
        renderAnnounce(site.pay);

        return fetch('/api/pay/goods', { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (gd) {
            allGoods = gd.goods || [];
            allCats = gd.categories || [];

            if (curCat && !allCats.some(function (c) { return c.id === curCat; })) curCat = 0;

            renderFilter();
            renderGoods();

            $('page').hidden = false;
            $('boot').classList.add('hide');
          });
      })
      .catch(function () {
        $('boot').classList.add('hide');
        $('page').hidden = false;
        $('fakaEmpty').hidden = false;
      });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.pay-type'), function (el) {
    el.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.pay-type'), function (x) {
        x.classList.toggle('active', x === el);
      });
    });
  });

  $('payClose').addEventListener('click', closeBuy);
  $('payMask').addEventListener('click', function (e) { if (e.target === $('payMask')) closeBuy(); });

  $('buySubmit').addEventListener('click', function () {
    if (!curGoods) return;

    var btn = this;
    var tip = $('buyTip');
    var typeEl = document.querySelector('.pay-type.active');
    var paytype = typeEl ? typeEl.getAttribute('data-type') : 'alipay';

    if (payCfg.askPhone) {
      var ph = $('buyPhone') ? $('buyPhone').value.trim() : '';
      if (!/^1[3-9]\d{9}$/.test(ph)) {
        tip.textContent = '请填写正确的手机号';
        return;
      }
    }

    btn.disabled = true;
    tip.textContent = '正在创建订单…';

    fetch('/api/pay/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        kind: 'kami',
        goods_id: curGoods.id,
        paytype: paytype,
        phone: payCfg.askPhone && $('buyPhone') ? $('buyPhone').value.trim() : '',
      }),
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var data;
          try { data = JSON.parse(text); }
          catch (e) { throw new Error('服务器返回了非 JSON 内容，请检查支付配置'); }
          if (!r.ok || data.ok === false) throw new Error(data.error || '下单失败');
          return data;
        });
      })
      .then(function (d) {
        tip.textContent = '订单已创建，正在跳转…';
        if (d.pay_url) {
          sessionStorage.setItem('pw_pay_order', d.out_trade_no);
          location.href = d.pay_url;
        } else {
          tip.textContent = '未获取到支付链接';
          btn.disabled = false;
        }
      })
      .catch(function (e) {
        tip.textContent = e.message;
        btn.disabled = false;
      });
  });

  $('copyKami').addEventListener('click', function () {
    var code = $('kamiCode').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        $('copyKami').textContent = '已复制';
        setTimeout(function () { $('copyKami').textContent = '复制卡密'; }, 1500);
      });
    }
  });

  $('resultClose').addEventListener('click', function () {
    $('resultMask').hidden = true;
    sessionStorage.removeItem('pw_pay_order');
  });

  function showCaptcha(onPass) {
    var mask = document.createElement('div');
    mask.className = 'cap-mask';
    mask.innerHTML =
      '<div class="cap-box">' +
        '<div class="cap-title">安全验证</div>' +
        '<div class="cap-sub">请按住滑块，拖动到最右侧</div>' +
        '<div class="cap-track" id="capTrack">' +
          '<div class="cap-fill" id="capFill"></div>' +
          '<span class="cap-label" id="capLabel">按住滑块拖动</span>' +
          '<div class="cap-thumb" id="capThumb">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
          '</div>' +
        '</div>' +
        '<button class="cap-cancel" id="capCancel" type="button">取消</button>' +
      '</div>';
    document.body.appendChild(mask);

    var st = { drag: false, startX: 0, moved: 0, max: 0 };
    var thumb = document.getElementById('capThumb');
    var fill = document.getElementById('capFill');
    var label = document.getElementById('capLabel');

    function maxX() {
      var t = document.getElementById('capTrack');
      return t.clientWidth - thumb.offsetWidth - 4;
    }

    function move(cx) {
      if (!st.drag) return;
      var v = Math.max(0, Math.min(st.max, cx - st.startX));
      st.moved = v;
      thumb.style.transform = 'translateX(' + v + 'px)';
      fill.style.width = (v + 40) + 'px';
      label.style.opacity = String(Math.max(0, 1 - v / 40));
    }

    function end() {
      if (!st.drag) return;
      st.drag = false;
      if (st.moved >= st.max - 4) {
        thumb.classList.add('done');
        thumb.style.transform = 'translateX(' + st.max + 'px)';
        fill.style.width = '100%';
        label.textContent = '验证通过';
        label.style.opacity = '1';
        setTimeout(function () {
          mask.remove();
          if (onPass) onPass();
        }, 380);
      } else {
        st.moved = 0;
        thumb.style.transform = '';
        fill.style.width = '0';
        label.style.opacity = '1';
      }
    }

    thumb.addEventListener('mousedown', function (e) {
      e.preventDefault();
      st.drag = true;
      st.startX = e.clientX - st.moved;
      st.max = maxX();
    });
    document.addEventListener('mousemove', function (e) { if (st.drag) move(e.clientX); });
    document.addEventListener('mouseup', function () { if (st.drag) end(); });

    thumb.addEventListener('touchstart', function (e) {
      st.drag = true;
      st.startX = e.touches[0].clientX - st.moved;
      st.max = maxX();
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!st.drag) return;
      move(e.touches[0].clientX);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', function () { if (st.drag) end(); });

    document.getElementById('capCancel').addEventListener('click', function () { mask.remove(); });
  }

  function statusLabel(s) {
    var map = {
      WAIT_BUYER_PAY: '待支付',
      TRADE_SUCCESS: '已支付',
      TRADE_CLOSED: '已关闭',
      TRADE_REFUND: '已退款',
    };
    return map[s] || s || '未知';
  }

  function renderOrderList(orders) {
    var box = $('queryResult');
    if (!orders.length) {
      box.innerHTML = '<div class="qr-empty">没有查到相关订单</div>';
      return;
    }

    box.innerHTML = '';
    orders.forEach(function (o) {
      var ok = o.paid;
      var el = document.createElement('div');
      el.className = 'qr-item';
      el.innerHTML =
        '<div class="qr-row">' +
          '<span class="qr-no">' + esc(o.out_trade_no) + '</span>' +
          '<span class="qr-status ' + (ok ? 'ok' : '') + '">' + statusLabel(o.status) + '</span>' +
        '</div>' +
        '<div class="qr-meta">' + esc(o.subject || o.kind) + ' · ¥' + esc(o.amount) + '</div>' +
        (ok && o.kami
          ? '<div class="qr-kami"><span>卡密</span><code>' + esc(o.kami) + '</code></div>'
          : '');
      box.appendChild(el);
    });
  }

  function doQuery() {
    var box = $('queryResult');
    var input = $('queryInput');
    var kw = String(input.value || '').trim();

    if (!kw) {
      box.innerHTML = '<div class="qr-empty">请输入订单号或手机号</div>';
      return;
    }

    box.innerHTML = '<div class="qr-loading">查询中…</div>';

    fetch('/api/pay/order-query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ keyword: kw }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '查询失败');
        renderOrderList(d.orders || []);
      })
      .catch(function (e) {
        box.innerHTML = '<div class="qr-empty">' + esc(e.message) + '</div>';
      });
  }

  if ($('queryBtn')) {
    $('queryBtn').addEventListener('click', function () {
      var kw = String($('queryInput').value || '').trim();
      if (!kw) {
        $('queryResult').innerHTML = '<div class="qr-empty">请输入订单号或手机号</div>';
        return;
      }
      showCaptcha(doQuery);
    });

    $('queryInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var kw = String(this.value || '').trim();
        if (kw) showCaptcha(doQuery);
      }
    });
  }

  var pendingOrder = sessionStorage.getItem('pw_pay_order');
  if (pendingOrder) {
    pollStatus(pendingOrder, 0);
  }

  init();
})();
