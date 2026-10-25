(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var API = '/api';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function apiCall(path, options) {
    var opts = options || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin' };
    if (opts.body) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '解析失败' }; })
        .then(function (data) {
          if (!r.ok || data.ok === false) {
            var err = new Error(data.error || ('请求失败 (' + r.status + ')'));
            err.status = r.status;
            throw err;
          }
          return data;
        });
    });
  }

  var current = null;
  var cropper = null;

  function openCoverModal(track, onDone) {
    current = { track: track, onDone: onDone, selectedCover: null };

    var root = $('modalRoot');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal cover-modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div>' +
            '<div class="modal-title">设置封面</div>' +
            '<div class="modal-sub">' + esc(track.title) + '</div>' +
          '</div>' +
          '<button class="icon-btn-xs" id="cvClose" title="关闭" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +

        '<div class="cv-tabs">' +
          '<button class="cv-tab active" data-tab="search" type="button">搜索封面</button>' +
          '<button class="cv-tab" data-tab="upload" type="button">上传图片</button>' +
        '</div>' +

        '<div class="cv-pane" id="cvPaneSearch">' +
          '<div class="cv-search-row">' +
            '<input type="search" id="cvQuery" placeholder="输入歌名或歌手，例如 lemon tree" />' +
            '<button class="btn primary small" id="cvSearchBtn" type="button">搜索</button>' +
          '</div>' +
          '<div class="cv-results" id="cvResults">' +
            '<div class="cv-hint">搜索后会显示专辑封面，点击即可使用</div>' +
          '</div>' +
        '</div>' +

        '<div class="cv-pane" id="cvPaneUpload" hidden>' +
          '<input type="file" id="cvFile" accept="image/*" hidden />' +
          '<button class="btn" id="cvPickFile" type="button">选择图片文件</button>' +
          '<div class="cv-hint" style="margin-top:8px">支持 jpg / png / webp</div>' +
        '</div>' +

        '<div class="cv-crop-wrap" id="cvCropWrap" hidden>' +
          '<div class="cv-crop-box"><img id="cvCropImg" alt="" /></div>' +
          '<div class="cv-crop-actions">' +
            '<button class="btn primary small" id="cvCropApply" type="button">使用裁剪结果</button>' +
            '<button class="btn ghost small" id="cvCropReset" type="button">重置</button>' +
            '<button class="btn ghost small" id="cvCropBack" type="button">返回</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.appendChild(mask);

    mask.querySelector('#cvClose').addEventListener('click', closeCoverModal);
    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeCoverModal();
    });

    Array.prototype.forEach.call(mask.querySelectorAll('.cv-tab'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(mask.querySelectorAll('.cv-tab'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        var tab = btn.getAttribute('data-tab');
        $('cvPaneSearch').hidden = tab !== 'search';
        $('cvPaneUpload').hidden = tab !== 'upload';
        $('cvCropWrap').hidden = true;
      });
    });

    $('cvSearchBtn').addEventListener('click', doSearch);
    $('cvQuery').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch();
    });
    $('cvPickFile').addEventListener('click', function () { $('cvFile').click(); });
    $('cvFile').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (ev) { startCrop(ev.target.result, function (dataUrl) {
        uploadBlob(dataUrl, 'cover');
      }); };
      reader.readAsDataURL(f);
    });

    $('cvCropApply').addEventListener('click', applyCrop);
    $('cvCropReset').addEventListener('click', function () {
      if (cropper) cropper.reset();
    });
    $('cvCropBack').addEventListener('click', function () {
      destroyCrop();
      $('cvCropWrap').hidden = true;
      $('cvPaneSearch').hidden = false;
    });

    if (track.title) {
      $('cvQuery').value = track.title + (track.artist ? ' ' + track.artist : '');
    }
    setTimeout(function () { $('cvQuery').focus(); }, 100);
  }

  function closeCoverModal() {
    destroyCrop();
    var m = document.querySelector('.cover-modal');
    if (m && m.parentNode) {
      var mask = m.parentNode;
      mask.classList.add('out');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
    }
    current = null;
  }

  function doSearch() {
    var q = $('cvQuery').value.trim();
    if (!q) return;
    var box = $('cvResults');
    box.innerHTML = '<div class="cv-hint">搜索中…</div>';

    apiCall('/admin/cover-search?q=' + encodeURIComponent(q))
      .then(function (data) {
        if (!data.items || !data.items.length) {
          box.innerHTML = '<div class="cv-hint">没有找到，换个关键词试试，或直接上传图片</div>';
          return;
        }
        box.innerHTML = '';
        data.items.forEach(function (item) {
          var el = document.createElement('div');
          el.className = 'cv-item';
          el.innerHTML =
            '<img src="' + esc(item.coverSmall) + '" alt="" loading="lazy" />' +
            '<div class="cv-item-title">' + esc(item.title) + '</div>' +
            '<div class="cv-item-artist">' + esc(item.artist) + '</div>';
          el.addEventListener('click', function () {
            startCrop(item.cover, function () {
              apiCall('/admin/cover-fetch', {
                method: 'POST',
                body: { url: item.cover, track_id: current.track.id },
              }).then(function (r) {
                onCoverDone(r.url);
              }).catch(function (e) {
                showCvMsg(e.message);
              });
            });
          });
          box.appendChild(el);
        });
      })
      .catch(function (e) {
        box.innerHTML = '<div class="cv-hint">' + esc(e.message) + '</div>';
      });
  }

  function startCrop(srcOrDataUrl, onApply) {
    if (typeof Cropper === 'undefined') {
      onApply();
      return;
    }
    current.cropSource = srcOrDataUrl;
    current.onCrop = onApply;
    $('cvPaneSearch').hidden = true;
    $('cvPaneUpload').hidden = true;
    $('cvCropWrap').hidden = false;

    var img = $('cvCropImg');
    img.src = srcOrDataUrl;

    if (cropper) { cropper.destroy(); cropper = null; }
    img.onload = function () {
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.85,
        background: false,
        responsive: true,
        checkOrientation: false,
        guides: true,
      });
    };
  }

  function applyCrop() {
    if (!cropper) {
      if (current && current.onCrop) current.onCrop();
      return;
    }
    var canvas = cropper.getCroppedCanvas({
      width: 600, height: 600, imageSmoothingQuality: 'high',
    });
    if (!canvas) { showCvMsg('裁剪失败，请重试'); return; }
    var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    destroyCrop();

    if (current.isRemote) {
      uploadBlob(dataUrl, 'cover');
    } else if (current.onCrop) {
      current.onCrop(dataUrl);
    }
  }

  function destroyCrop() {
    if (cropper) { cropper.destroy(); cropper = null; }
  }

  function uploadBlob(dataUrl, kind) {
    var bin = atob(dataUrl.split(',')[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var blob = new Blob([arr], { type: 'image/jpeg' });

    var fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', blob, 'cover.jpg');

    showCvMsg('上传中…');
    fetch(API + '/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '上传失败');
        return apiCall('/admin/tracks/' + current.track.id, {
          method: 'PUT', body: { cover_key: res.key },
        }).then(function () {
          onCoverDone(res.url);
        });
      })
      .catch(function (e) { showCvMsg(e.message); });
  }

  function onCoverDone(url) {
    var done = current && current.onDone;
    closeCoverModal();
    if (done) done(url);
  }

  function showCvMsg(text) {
    var box = $('cvResults');
    if (box) box.innerHTML = '<div class="cv-hint">' + esc(text) + '</div>';
  }

  window.GRWZ = window.GRWZ || {};
  window.GRWZ.openCoverModal = openCoverModal;
})();
