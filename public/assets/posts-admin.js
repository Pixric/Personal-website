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

  var state = { posts: [], editing: null };

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function loadPosts() {
    return api('/admin/posts').then(function (d) {
      state.posts = d.posts || [];
      renderList();
    }).catch(function (e) {
      var box = $('postListAdmin');
      if (box) box.innerHTML = '<p class="field-hint">' + esc(e.message) + '</p>';
    });
  }

  function renderList() {
    var box = $('postListAdmin');
    if (!box) return;

    if (!state.posts.length) {
      box.innerHTML = '<p class="field-hint">还没有帖子，点击上面「写新帖子」开始。</p>';
      return;
    }

    box.innerHTML = '';
    state.posts.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'post-item-admin';
      var cover = p.cover_url
        ? '<div class="pia-cover" style="background-image:url(\'' + esc(p.cover_url) + '\')"></div>'
        : '<div class="pia-cover pia-cover-empty">无封面</div>';

      el.innerHTML =
        cover +
        '<div class="pia-info">' +
          '<div class="pia-title">' + esc(p.title) +
            (p.published === '0' ? ' <span class="pia-draft">草稿</span>' : '') +
          '</div>' +
          '<div class="pia-meta">/' + esc(p.slug) + ' · ' + fmtDate(p.created_at) +
            ' · ' + (p.likes || 0) + ' 赞' +
            (p.file_name ? ' · 附件 ' + esc(p.file_name) : '') +
          '</div>' +
        '</div>' +
        '<div class="pia-actions">' +
          '<a class="icon-btn-xs" href="/' + esc(p.slug) + '" target="_blank" rel="noopener" title="查看">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"/></svg>' +
          '</a>' +
          '<button class="icon-btn-xs pia-edit" title="编辑" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs danger pia-del" title="删除" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7"/></svg>' +
          '</button>' +
        '</div>';

      el.querySelector('.pia-edit').addEventListener('click', function () { openEditor(p); });
      el.querySelector('.pia-del').addEventListener('click', function () {
        if (!confirm('确定删除《' + p.title + '》？附件也会一并删除。')) return;
        api('/admin/posts/' + p.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadPosts(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      box.appendChild(el);
    });
  }

  function openEditor(post) {
    state.editing = post || null;
    var isEdit = !!post;
    var root = $('modalRoot');

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal post-editor" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div>' +
            '<div class="modal-title">' + (isEdit ? '编辑帖子' : '写新帖子') + '</div>' +
            '<div class="modal-sub">支持 Markdown 语法</div>' +
          '</div>' +
          '<button class="icon-btn-xs" id="peClose" title="关闭" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +

        '<div class="pe-body">' +
          '<label class="field">' +
            '<span class="field-label">标题</span>' +
            '<input id="peTitle" type="text" maxlength="200" placeholder="帖子标题" />' +
          '</label>' +

          '<label class="field">' +
            '<span class="field-label">地址</span>' +
            '<div class="pe-slug-row">' +
              '<span class="pe-slug-prefix">/</span>' +
              '<input id="peSlug" type="text" maxlength="60" placeholder="留空自动生成" spellcheck="false" />' +
            '</div>' +
            '<span class="field-hint">只能用字母、数字、中文、下划线和中划线</span>' +
          '</label>' +

          '<label class="field">' +
            '<span class="field-label">正文</span>' +
            '<textarea id="peContent" rows="14" placeholder="写点什么…"></textarea>' +
          '</label>' +

          '<div class="field">' +
            '<span class="field-label">封面图（可选）</span>' +
            '<div class="pe-upload-row">' +
              '<div class="pe-thumb" id="peCoverThumb">未上传</div>' +
              '<div class="pe-upload-actions">' +
                '<input type="file" id="peCoverFile" accept="image/*" hidden />' +
                '<button class="btn small" id="peCoverPick" type="button">上传封面</button>' +
                '<button class="btn ghost small" id="peCoverClear" type="button">移除</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="field">' +
            '<span class="field-label">附件（可选，最大 500MB）</span>' +
            '<div class="pe-file-box" id="peFileBox">' +
              '<span class="field-hint">未选择附件</span>' +
            '</div>' +
            '<div class="pe-upload-actions" style="margin-top:8px">' +
              '<input type="file" id="peFileInput" hidden />' +
              '<button class="btn small" id="peFilePick" type="button">选择文件</button>' +
              '<button class="btn ghost small" id="peFileClear" type="button">移除附件</button>' +
            '</div>' +
          '</div>' +

          '<div class="field">' +
            '<span class="field-label">附件图标（可选）</span>' +
            '<div class="pe-upload-row">' +
              '<div class="pe-thumb" id="peIconThumb">默认</div>' +
              '<div class="pe-upload-actions">' +
                '<input type="file" id="peIconFile" accept="image/*" hidden />' +
                '<button class="btn small" id="peIconPick" type="button">上传图标</button>' +
                '<button class="btn ghost small" id="peIconClear" type="button">用默认</button>' +
              '</div>' +
            '</div>' +
            '<span class="field-hint">不设置则显示默认文件图标</span>' +
          '</div>' +

          '<label class="switch-row">' +
            '<span><b>立即发布</b><em>关闭则保存为草稿，不显示在首页</em></span>' +
            '<input type="checkbox" id="pePublished" checked />' +
          '</label>' +
        '</div>' +

        '<div class="modal-foot">' +
          '<span class="msg inline" id="peMsg"></span>' +
          '<button class="btn ghost" id="peCancel" type="button">取消</button>' +
          '<button class="btn primary" id="peSave" type="button">' + (isEdit ? '保存' : '发布') + '</button>' +
        '</div>' +
      '</div>';

    root.appendChild(mask);

    var draft = {
      cover_key: post ? post.cover_key || '' : '',
      file_key: post ? post.file_key || '' : '',
      file_name: post ? post.file_name || '' : '',
      file_size: post ? post.file_size || 0 : 0,
      file_icon_key: post ? post.file_icon_key || '' : '',
    };

    if (post) {
      $('peTitle').value = post.title || '';
      $('peSlug').value = post.slug || '';
      $('peContent').value = post.content || '';
      $('pePublished').checked = post.published !== '0';
      if (post.cover_url) {
        $('peCoverThumb').style.backgroundImage = 'url("' + post.cover_url + '")';
        $('peCoverThumb').textContent = '';
      }
      if (post.file_name) renderFileBox(draft);
      if (post.file_icon_url) {
        $('peIconThumb').style.backgroundImage = 'url("' + post.file_icon_url + '")';
        $('peIconThumb').textContent = '';
      }
    }

    function renderFileBox(d) {
      var box = $('peFileBox');
      box.innerHTML =
        '<span class="pe-file-name">' + esc(d.file_name) + '</span>' +
        '<span class="pe-file-size">' + fmtSize(d.file_size) + '</span>';
    }

    function close() {
      mask.classList.add('out');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 220);
    }

    $('peClose').addEventListener('click', close);
    $('peCancel').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });

    $('peCoverPick').addEventListener('click', function () { $('peCoverFile').click(); });
    $('peCoverFile').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      uploadTo(f, 'post-cover').then(function (r) {
        draft.cover_key = r.key;
        $('peCoverThumb').style.backgroundImage = 'url("' + r.url + '")';
        $('peCoverThumb').textContent = '';
        toast('封面已上传', 'success');
      }).catch(function (e) { toast(e.message, 'error'); });
    });

    $('peCoverClear').addEventListener('click', function () {
      draft.cover_key = '';
      $('peCoverThumb').style.backgroundImage = '';
      $('peCoverThumb').textContent = '未上传';
    });

    $('peFilePick').addEventListener('click', function () { $('peFileInput').click(); });
    $('peFileInput').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      if (f.size > 500 * 1024 * 1024) {
        toast('文件超过 500MB 上限', 'error');
        return;
      }
      var msgEl = $('peMsg');
      msgEl.textContent = '上传中… 0%';
      msgEl.className = 'msg inline';

      uploadTo(f, 'post-file', function (pct) {
        msgEl.textContent = '上传中… ' + pct + '%';
      }).then(function (r) {
        draft.file_key = r.key;
        draft.file_name = r.name || f.name;
        draft.file_size = r.size || f.size;
        renderFileBox(draft);
        msgEl.textContent = '';
        toast('附件已上传', 'success');
      }).catch(function (e) {
        msgEl.textContent = '';
        toast(e.message, 'error');
      });
    });

    $('peFileClear').addEventListener('click', function () {
      draft.file_key = '';
      draft.file_name = '';
      draft.file_size = 0;
      $('peFileBox').innerHTML = '<span class="field-hint">未选择附件</span>';
    });

    $('peIconPick').addEventListener('click', function () { $('peIconFile').click(); });
    $('peIconFile').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      uploadTo(f, 'post-icon').then(function (r) {
        draft.file_icon_key = r.key;
        $('peIconThumb').style.backgroundImage = 'url("' + r.url + '")';
        $('peIconThumb').textContent = '';
        toast('图标已上传', 'success');
      }).catch(function (e) { toast(e.message, 'error'); });
    });

    $('peIconClear').addEventListener('click', function () {
      draft.file_icon_key = '';
      $('peIconThumb').style.backgroundImage = '';
      $('peIconThumb').textContent = '默认';
    });

    $('peSave').addEventListener('click', function () {
      var btn = $('peSave');
      var msgEl = $('peMsg');
      var title = $('peTitle').value.trim();
      if (!title) {
        msgEl.textContent = '请填写标题';
        msgEl.className = 'msg inline error';
        return;
      }

      btn.disabled = true;
      var body = {
        title: title,
        slug: $('peSlug').value.trim(),
        content: $('peContent').value,
        cover_key: draft.cover_key,
        file_key: draft.file_key,
        file_name: draft.file_name,
        file_size: draft.file_size,
        file_icon_key: draft.file_icon_key,
        published: $('pePublished').checked,
      };

      var req = isEdit
        ? api('/admin/posts/' + post.id, { method: 'PUT', body: body })
        : api('/admin/posts', { method: 'POST', body: body });

      req.then(function () {
        close();
        toast(isEdit ? '已保存' : '已发布', 'success');
        loadPosts();
      }).catch(function (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'msg inline error';
      }).finally(function () { btn.disabled = false; });
    });

    setTimeout(function () { $('peTitle').focus(); }, 100);
  }

  function uploadTo(file, kind, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file, file.name);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/upload');
      xhr.withCredentials = true;

      if (onProgress) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = function () {
        var d = null;
        try { d = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && d && d.ok) resolve(d);
        else reject(new Error((d && d.error) || ('上传失败 ' + xhr.status)));
      };
      xhr.onerror = function () { reject(new Error('网络错误')); };
      xhr.send(fd);
    });
  }

  window.GRWZ = window.GRWZ || {};
  window.GRWZ.initPosts = function () {
    $('postNew').addEventListener('click', function () { openEditor(null); });
    $('postsEnabled').addEventListener('change', function () {
      var on = this.checked;
      api('/admin/settings', { method: 'PUT', body: { posts_enabled: on } })
        .then(function () { toast('帖子功能已' + (on ? '开启' : '关闭'), 'success'); })
        .catch(function (e) { toast(e.message, 'error'); });
    });
    loadPosts();
  };
  window.GRWZ.syncPostsUI = function (s) {
    var el = $('postsEnabled');
    if (el) el.checked = s.posts_enabled === '1';
  };
  window.GRWZ.loadPosts = loadPosts;
})();
