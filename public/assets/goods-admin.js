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

  function toast(text, type) {
    if (window.toast) { window.toast(text, type); return; }
    console.log(text);
  }

  function msg(el, text, type) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg inline' + (type ? ' ' + type : '');
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var cache = { categories: [], goods: [] };

  function renderCategories() {
    var body = $('catBody');
    if (!body) return;

    if (!cache.categories.length) {
      body.innerHTML = '<tr><td colspan="5" class="pay-empty">还没有分类，点击右上角「新建分类」</td></tr>';
      return;
    }

    body.innerHTML = '';
    cache.categories.forEach(function (c) {
      var tr = document.createElement('tr');
      var on = c.enabled !== '0';
      tr.innerHTML =
        '<td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + (c.goods_count || 0) + ' 件</td>' +
        '<td>' + fmtTime(c.created_at) + '</td>' +
        '<td><label class="mini-switch"><input type="checkbox" ' + (on ? 'checked' : '') +
          ' data-cat="' + c.id + '" /><span></span></label></td>' +
        '<td class="num">' +
          '<button class="btn ghost small cat-edit" type="button">改名</button> ' +
          '<button class="btn ghost small cat-del" type="button">删除</button>' +
        '</td>';

      tr.querySelector('input').addEventListener('change', function () {
        api('/admin/pay/categories/' + c.id, {
          method: 'PUT', body: { enabled: this.checked },
        }).then(function () { toast('已保存', 'success'); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      tr.querySelector('.cat-edit').addEventListener('click', function () {
        var name = prompt('修改分类名称', c.name);
        if (!name || !name.trim()) return;
        api('/admin/pay/categories/' + c.id, { method: 'PUT', body: { name: name.trim() } })
          .then(function () { toast('已修改', 'success'); loadGoods(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      tr.querySelector('.cat-del').addEventListener('click', function () {
        if (!confirm('删除分类「' + c.name + '」？该分类下的商品会变为未分类。')) return;
        api('/admin/pay/categories/' + c.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadGoods(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      body.appendChild(tr);
    });
  }

  function renderGoods() {
    var body = $('goodsBody');
    if (!body) return;

    var kw = String(($('goodsSearch') && $('goodsSearch').value) || '').trim().toLowerCase();
    var list = cache.goods.filter(function (g) {
      if (!kw) return true;
      return String(g.title || '').toLowerCase().indexOf(kw) >= 0 ||
        String(g.category_name || '').toLowerCase().indexOf(kw) >= 0;
    });

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="pay-empty">' +
        (kw ? '没有匹配的商品' : '还没有商品，点击右上角「发布商品」') + '</td></tr>';
      return;
    }

    body.innerHTML = '';
    list.forEach(function (g) {
      var tr = document.createElement('tr');
      var on = g.enabled !== '0';
      var cover = g.cover_key
        ? '<div class="goods-thumb" style="background-image:url(\'/uploads/' + esc(g.cover_key) + '\')"></div>'
        : '<div class="goods-thumb goods-thumb-empty">无图</div>';

      var stockCls = g.stock > 0 ? '' : ' style="color:#d92d20"';

      tr.innerHTML =
        '<td><div class="goods-cell">' + cover +
          '<div class="goods-meta"><div class="goods-title">' + esc(g.title) + '</div>' +
          '<div class="goods-sub">ID ' + g.id + '</div></div></div></td>' +
        '<td>' + esc(g.category_name) + '</td>' +
        '<td>' + esc(g.price) + ' 元</td>' +
        '<td>' + (g.sales || 0) + '</td>' +
        '<td' + stockCls + '>' + g.stock + (g.stock === 0 ? ' (缺货)' : '') + '</td>' +
        '<td><span class="pay-tag ' + (on ? 'pay-ok' : 'pay-muted') + '">' +
          (on ? '销售中' : '已下架') + '</span></td>' +
        '<td class="num">' +
          '<button class="btn ghost small g-edit" type="button">编辑</button> ' +
          '<button class="btn ghost small g-copy" type="button">复制链接</button> ' +
          '<button class="btn ghost small g-del" type="button">删除</button>' +
        '</td>';

      tr.querySelector('.g-edit').addEventListener('click', function () { openGoodsEditor(g); });

      tr.querySelector('.g-copy').addEventListener('click', function () {
        var url = location.origin + '/pay?goods=' + g.id;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { toast('链接已复制', 'success'); })
            .catch(function () { toast(url, 'info'); });
        } else {
          toast(url, 'info');
        }
      });

      tr.querySelector('.g-del').addEventListener('click', function () {
        if (!confirm('删除商品「' + g.title + '」？其卡密也会一并删除。')) return;
        api('/admin/pay/goods/' + g.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadGoods(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      body.appendChild(tr);
    });
  }

  function renderKamiStock() {
    var body = $('kamiStockBody');
    if (!body) return;

    if (!cache.goods.length) {
      body.innerHTML = '<tr><td colspan="5" class="pay-empty">请先创建商品</td></tr>';
      return;
    }

    body.innerHTML = '';
    cache.goods.forEach(function (g) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(g.title) + '</td>' +
        '<td>' + esc(g.price) + ' 元</td>' +
        '<td><b>' + g.stock + '</b></td>' +
        '<td>' + (g.sold || 0) + '</td>' +
        '<td>' + (g.kami_total || 0) + '</td>';
      body.appendChild(tr);
    });
  }

  function fillGoodsSelect() {
    var sel = $('kamiGoods');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">请选择商品</option>';
    cache.goods.forEach(function (g) {
      var o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.title + '（' + g.price + ' 元，库存 ' + g.stock + '）';
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }

  function loadGoods() {
    return api('/admin/pay/goods').then(function (d) {
      cache.categories = d.categories || [];
      cache.goods = d.goods || [];
      renderCategories();
      renderGoods();
      renderKamiStock();
      fillGoodsSelect();
    }).catch(function (e) {
      toast(e.message, 'error');
    });
  }

  function openGoodsEditor(goods) {
    var isEdit = !!goods;
    var root = $('modalRoot');

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" role="dialog" style="max-width:520px">' +
        '<div class="modal-head">' +
          '<div><div class="modal-title">' + (isEdit ? '编辑商品' : '发布商品') + '</div></div>' +
          '<button class="icon-btn-xs" id="geClose" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="pe-body">' +
          '<label class="field">' +
            '<span class="field-label">商品名称</span>' +
            '<input id="geTitle" type="text" maxlength="120" placeholder="例如：小鱼饼干" />' +
          '</label>' +
          '<div class="grid-2">' +
            '<label class="field">' +
              '<span class="field-label">分类</span>' +
              '<select id="geCat"></select>' +
            '</label>' +
            '<label class="field">' +
              '<span class="field-label">售价（元）</span>' +
              '<input id="gePrice" type="text" placeholder="10.00" spellcheck="false" />' +
            '</label>' +
          '</div>' +
          '<div class="field">' +
            '<span class="field-label">封面图（可选）</span>' +
            '<div class="pe-upload-row">' +
              '<div class="pe-thumb" id="geCover">未上传</div>' +
              '<div class="pe-upload-actions">' +
                '<input type="file" id="geCoverFile" accept="image/*" hidden />' +
                '<button class="btn small" id="geCoverPick" type="button">上传封面</button>' +
                '<button class="btn ghost small" id="geCoverClear" type="button">移除</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<label class="field">' +
            '<span class="field-label">商品描述（可选）</span>' +
            '<textarea id="geDesc" rows="4" maxlength="2000" placeholder="简单介绍这个商品…"></textarea>' +
          '</label>' +
          '<label class="switch-row">' +
            '<span><b>上架销售</b><em>关闭后前台不显示该商品</em></span>' +
            '<input type="checkbox" id="geEnabled" checked />' +
          '</label>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<span class="msg inline" id="geMsg"></span>' +
          '<button class="btn ghost" id="geCancel" type="button">取消</button>' +
          '<button class="btn primary" id="geSave" type="button">保存</button>' +
        '</div>' +
      '</div>';

    root.appendChild(mask);

    var catSel = $('geCat');
    catSel.innerHTML = '<option value="0">未分类</option>';
    cache.categories.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      catSel.appendChild(o);
    });

    var draft = { cover_key: goods ? goods.cover_key || '' : '' };

    if (goods) {
      $('geTitle').value = goods.title || '';
      $('gePrice').value = goods.price || '';
      $('geDesc').value = goods.desc || '';
      $('geEnabled').checked = goods.enabled !== '0';
      catSel.value = String(goods.category_id || 0);
      if (goods.cover_key) {
        $('geCover').style.backgroundImage = 'url("/uploads/' + goods.cover_key + '")';
        $('geCover').textContent = '';
      }
    }

    function close() {
      mask.classList.add('out');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
    }

    $('geClose').addEventListener('click', close);
    $('geCancel').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });

    $('geCoverPick').addEventListener('click', function () { $('geCoverFile').click(); });
    $('geCoverFile').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;

      var fd = new FormData();
      fd.append('kind', 'post-cover');
      fd.append('file', f, f.name);

      fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || '上传失败');
          draft.cover_key = d.key;
          $('geCover').style.backgroundImage = 'url("' + d.url + '")';
          $('geCover').textContent = '';
          toast('封面已上传', 'success');
        })
        .catch(function (e) { toast(e.message, 'error'); });
    });

    $('geCoverClear').addEventListener('click', function () {
      draft.cover_key = '';
      $('geCover').style.backgroundImage = '';
      $('geCover').textContent = '未上传';
    });

    $('geSave').addEventListener('click', function () {
      var btn = $('geSave');
      var el = $('geMsg');
      var title = $('geTitle').value.trim();
      var price = $('gePrice').value.trim();

      if (!title) { msg(el, '请填写商品名称', 'error'); return; }
      if (!/^\d+(\.\d{1,2})?$/.test(price)) { msg(el, '请填写正确的价格', 'error'); return; }

      btn.disabled = true;
      var body = {
        title: title,
        price: price,
        category_id: parseInt(catSel.value, 10) || 0,
        cover_key: draft.cover_key,
        desc: $('geDesc').value,
        enabled: $('geEnabled').checked,
      };

      var req = isEdit
        ? api('/admin/pay/goods/' + goods.id, { method: 'PUT', body: body })
        : api('/admin/pay/goods', { method: 'POST', body: body });

      req.then(function () {
        close();
        toast(isEdit ? '已保存' : '已发布', 'success');
        loadGoods();
      }).catch(function (e) { msg(el, e.message, 'error'); })
        .finally(function () { btn.disabled = false; });
    });

    setTimeout(function () { $('geTitle').focus(); }, 100);
  }

  function initGoods() {
    if (window.__goodsInited) return;
    window.__goodsInited = true;

    if ($('newCategory')) {
      $('newCategory').addEventListener('click', function () {
        var name = prompt('分类名称');
        if (!name || !name.trim()) return;
        api('/admin/pay/categories', { method: 'POST', body: { name: name.trim() } })
          .then(function () { toast('分类已创建', 'success'); loadGoods(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });
    }

    if ($('newGoods')) {
      $('newGoods').addEventListener('click', function () {
        if (!cache.categories.length) {
          toast('建议先创建一个分类', 'info');
        }
        openGoodsEditor(null);
      });
    }

    if ($('goodsSearch')) {
      $('goodsSearch').addEventListener('input', renderGoods);
    }

    if ($('kamiText')) {
      $('kamiText').addEventListener('input', function () {
        var n = this.value.split(/\r?\n/).filter(function (x) { return x.trim(); }).length;
        $('kamiCountHint').textContent = '已输入 ' + n + ' 条';
      });
    }

    if ($('kamiRandom')) {
      $('kamiRandom').addEventListener('click', function () {
        var n = parseInt(prompt('生成多少条随机卡密？', '10'), 10);
        if (!n || n < 1 || n > 50000) return;
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var lines = [];
        for (var i = 0; i < n; i++) {
          var s = '';
          for (var j = 0; j < 16; j++) s += chars[Math.floor(Math.random() * chars.length)];
          lines.push(s);
        }
        $('kamiText').value = lines.join('\n');
        $('kamiText').dispatchEvent(new Event('input'));
      });
    }

    if ($('importKami')) {
      $('importKami').addEventListener('click', function () {
        var btn = $('importKami');
        var el = $('kamiImportMsg');
        var goodsId = $('kamiGoods').value;
        var text = $('kamiText').value;

        if (!goodsId) { msg(el, '请先选择商品', 'error'); return; }
        if (!text.trim()) { msg(el, '请粘贴卡密内容', 'error'); return; }

        btn.disabled = true;
        msg(el, '导入中…');

        api('/admin/pay/kami/batch', {
          method: 'POST',
          body: {
            goods_id: parseInt(goodsId, 10),
            text: text,
            batch: $('kamiBatch').value.trim(),
            dedupe: $('kamiDedupe').checked,
          },
        }).then(function (d) {
          msg(el, '成功导入 ' + d.count + ' 条', 'success');
          toast('已导入 ' + d.count + ' 条卡密', 'success');
          $('kamiText').value = '';
          $('kamiCountHint').textContent = '已输入 0 条';
          loadGoods();
        }).catch(function (e) { msg(el, e.message, 'error'); })
          .finally(function () { btn.disabled = false; });
      });
    }

    if ($('refreshKami')) {
      $('refreshKami').addEventListener('click', loadGoods);
    }

    loadGoods();
  }

  window.GRWZ = window.GRWZ || {};
  window.GRWZ.initGoods = initGoods;
  window.GRWZ.loadGoods = loadGoods;
})();
