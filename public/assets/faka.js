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

  function renderAnnounce(payCfg) {
    if (!payCfg || !payCfg.announce) return;
    $('announceCard').hidden = false;
    $('announceBody').textContent = payCfg.announce;
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

    btn.disabled = true;
    tip.textContent = '正在创建订单…';

    fetch('/api/pay/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ kind: 'kami', goods_id: curGoods.id, paytype: paytype }),
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

  var pendingOrder = sessionStorage.getItem('pw_pay_order');
  if (pendingOrder) {
    pollStatus(pendingOrder, 0);
  }

  init();
})();
