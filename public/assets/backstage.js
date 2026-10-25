(function () {
  'use strict';

  var ICONS = window.PERSONAL_WEBSITE_ICONS || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = { settings: {}, tracks: [], socials: [], limits: {} };

  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>';
  var ICON_ERR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 16.8v.2"/></svg>';
  var ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.4v.2"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function iconSvg(name) {
    var ic = ICONS[name] || ICONS.link;
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + ic.path + '"/></svg>';
  }

  function api(path, options) {
    var opts = options || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin' };
    if (opts.body) {
      if (opts.body instanceof FormData) {
        init.body = opts.body;
      } else {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(opts.body);
      }
    }
    return fetch('/api' + path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; })
        .then(function (data) {
          if (!r.ok || data.ok === false) {
            var err = new Error(data.error || ('请求失败 (' + r.status + ')'));
            err.status = r.status;
            err.payload = data;
            throw err;
          }
          return data;
        });
    });
  }

  function toast(message, kind, title) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    var icon = kind === 'success' ? ICON_OK : (kind === 'error' ? ICON_ERR : ICON_INFO);
    el.innerHTML =
      '<span class="toast-icon">' + icon + '</span>' +
      '<div class="toast-body">' +
        (title ? '<div class="toast-title">' + esc(title) + '</div>' : '') +
        '<div class="toast-msg">' + esc(message) + '</div>' +
      '</div>' +
      '<button class="toast-close" type="button" aria-label="关闭">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>';

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }
    el.querySelector('.toast-close').addEventListener('click', close);
    box.appendChild(el);
    setTimeout(close, kind === 'error' ? 5000 : 3200);
    return el;
  }

  function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '') + (el.classList.contains('inline') ? ' inline' : '');
  }

  var modalNode = null;

  function openUploadModal(title, sub) {
    var root = $('modalRoot');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div>' +
            '<div class="modal-title">' + esc(title) + '</div>' +
            '<div class="modal-sub" id="upSub">' + esc(sub || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="upload-list" id="upList"></div>' +
        '<div class="modal-foot" id="upFoot"></div>' +
      '</div>';
    root.appendChild(mask);
    modalNode = mask;
    return mask;
  }

  function closeUploadModal() {
    if (!modalNode) return;
    var m = modalNode;
    modalNode = null;
    m.classList.add('out');
    setTimeout(function () {
      if (m.parentNode) m.parentNode.removeChild(m);
    }, 220);
  }

  function addUploadItem(name) {
    var list = $('upList');
    if (!list) return null;
    var item = document.createElement('div');
    item.className = 'up-item';
    item.innerHTML =
      '<div class="up-row">' +
        '<span class="up-name">' + esc(name) + '</span>' +
        '<span class="up-status">等待中</span>' +
      '</div>' +
      '<div class="up-bar"><span></span></div>';
    list.appendChild(item);
    return {
      setProgress: function (pct) {
        item.querySelector('.up-bar span').style.width = Math.min(100, Math.max(0, pct)) + '%';
        item.querySelector('.up-status').textContent = Math.round(pct) + '%';
      },
      ok: function (text) {
        item.querySelector('.up-bar span').style.width = '100%';
        var s = item.querySelector('.up-status');
        s.className = 'up-status ok';
        s.textContent = text || '完成';
      },
      err: function (text) {
        item.querySelector('.up-bar').classList.add('err');
        var s = item.querySelector('.up-status');
        s.className = 'up-status err';
        s.textContent = text || '失败';
      },
    };
  }

  function uploadOne(file, kind, extra, item) {
    return new Promise(function (resolve) {
      var fd = new FormData();
      fd.append('kind', kind);
      Object.keys(extra || {}).forEach(function (k) { fd.append(k, extra[k]); });
      fd.append('file', file, file.name);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/upload');
      xhr.withCredentials = true;

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && item) item.setProgress((e.loaded / e.total) * 100);
      };

      xhr.onload = function () {
        var res = {};
        try { res = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
          if (item) item.ok();
          resolve({ ok: true, data: res });
        } else {
          var m = res.error || ('HTTP ' + xhr.status);
          if (item) item.err(m);
          resolve({ ok: false, error: m });
        }
      };

      xhr.onerror = function () {
        if (item) item.err('网络错误');
        resolve({ ok: false, error: '网络错误' });
      };

      xhr.send(fd);
    });
  }

  function runUploadQueue(title, files, kind, extraFn) {
    var mask = openUploadModal(title, '共 ' + files.length + ' 个文件');
    var items = files.map(function (f) { return addUploadItem(f.name); });
    var i = 0;
    var failed = [];

    function next() {
      if (i >= files.length) {
        var foot = $('upFoot');
        foot.innerHTML = '';
        var btn = document.createElement('button');
        btn.className = 'btn primary small';
        btn.type = 'button';
        btn.textContent = '完成';
        btn.addEventListener('click', closeUploadModal);
        foot.appendChild(btn);

        setTimeout(function () {
          closeUploadModal();
          if (failed.length) toast(failed.length + ' 个文件上传失败：' + failed.join('、'), 'error', '上传部分失败');
          else toast('全部上传完成', 'success', '上传成功');
          loadState();
        }, failed.length ? 2000 : 900);
        return;
      }

      var file = files[i];
      var extra = extraFn ? extraFn(file, i) : {};
      uploadOne(file, kind, extra, items[i]).then(function (r) {
        if (r.ok) {
          if (kind === 'avatar' || kind === 'bg') onMediaUploaded(kind, r.data);
          else if (kind === 'icon') onIconUploaded(r.data);
        } else {
          failed.push(file.name);
        }
        i++;
        next();
      });
    }

    next();
    return mask;
  }

  function uploadImage(file, kind, previewEl) {
    var mask = openUploadModal(
      kind === 'avatar' ? '上传头像' : '上传背景图',
      file.name
    );
    var item = addUploadItem(file.name);
    uploadOne(file, kind, {}, item).then(function (r) {
      if (r.ok) {
        var url = r.data.url;
        if (previewEl) {
          previewEl.style.backgroundImage = 'url("' + url + '")';
          previewEl.textContent = '';
        }
        state.settings[kind + '_url'] = url;
        state.settings[kind + '_key'] = r.data.key;
      }
      setTimeout(function () {
        closeUploadModal();
        if (r.ok) toast(kind === 'avatar' ? '头像已更新' : '背景图已更新', 'success');
        else toast(r.error, 'error', '上传失败');
      }, r.ok ? 700 : 1800);
    });
    return mask;
  }

  var pendingIconKey = '';

  function onIconUploaded(data) {
    pendingIconKey = data.key;
    selectedIcon = 'custom';
    $('socIconHint').textContent = '已上传自定义图标';
    renderIconPicker();
  }

  function onMediaUploaded(kind, data) {
    if (kind === 'avatar') {
      var ap = $('avatarPreview');
      ap.style.backgroundImage = 'url("' + data.url + '")';
      ap.textContent = '';
    } else if (kind === 'bg') {
      var bp = $('bgPreview');
      bp.style.backgroundImage = 'url("' + data.url + '")';
      bp.textContent = '';
    }
  }

  var pendingEntry = '';
  var isWizard = false;

  api('/setup/status').then(function (st) {
    if (st.initialized) {
      return api('/admin/me')
        .then(function () { showAdmin(); })
        .catch(function () { showLogin(); });
    }
    isWizard = true;
    if (st.security_entry_set) {
      pendingEntry = '(已设置)';
      showStep('stepAdmin');
    } else {
      showStep('stepEntry');
    }
  }).catch(function (e) {
    showStep('stepEntry');
    msg($('entryMsg'), '无法连接后端：' + e.message, 'error');
  });

  function showStep(id) {
    ['stepEntry', 'stepAdmin', 'stepDone', 'stepLogin'].forEach(function (s) {
      var el = $(s);
      if (el) el.hidden = (s !== id);
    });
    $('gate').hidden = false;
    $('admin').hidden = true;
    var focusMap = { stepEntry: 'entryInput', stepAdmin: 'adminUser', stepLogin: 'loginUser' };
    if (focusMap[id]) setTimeout(function () { $(focusMap[id]).focus(); }, 100);
  }

  function showLogin() {
    showStep('stepLogin');
    document.title = '登录 · Personal-website 后台';
  }

  var entryInput = $('entryInput');
  entryInput.addEventListener('input', function () {
    var v = entryInput.value.trim();
    $('entryPreview').innerHTML = esc(location.host) + '/<b>' + (esc(v) || '安全入口') + '</b>';
  });
  entryInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitEntry(); });
  $('entrySubmit').addEventListener('click', submitEntry);

  function submitEntry() {
    var btn = $('entrySubmit');
    var el = $('entryMsg');
    var value = entryInput.value.trim();

    if (value.length < 5) { msg(el, '安全入口至少 5 位', 'error'); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(value)) { msg(el, '只能包含字母、数字、下划线和中划线', 'error'); return; }

    btn.disabled = true;
    msg(el, '正在保存…');

    api('/setup/entry', { method: 'POST', body: { entry: value } })
      .then(function (res) {
        pendingEntry = res.entry || value;
        msg(el, '');
        try { history.replaceState(null, '', '/' + pendingEntry); } catch (e) {}
        toast('安全入口已保存：' + location.host + '/' + pendingEntry, 'success');
        showStep('stepAdmin');
      })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  }

  $('adminBack').addEventListener('click', function () { showStep('stepEntry'); });
  $('adminSubmit').addEventListener('click', submitAdmin);
  ['adminUser', 'adminPass', 'adminPass2'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') submitAdmin(); });
  });

  function submitAdmin() {
    var btn = $('adminSubmit');
    var el = $('adminMsg');
    var username = $('adminUser').value.trim();
    var password = $('adminPass').value;
    var password2 = $('adminPass2').value;

    if (username.length < 3) { msg(el, '账号至少 3 位', 'error'); return; }
    if (password.length < 6) { msg(el, '密码至少 6 位', 'error'); return; }
    if (password !== password2) { msg(el, '两次输入的密码不一致', 'error'); return; }

    btn.disabled = true;
    msg(el, '正在创建账号…');

    api('/setup/admin', {
      method: 'POST',
      body: { username: username, password: password, password_confirm: password2 },
    }).then(function (res) {
      msg(el, '');
      showDone(res.entry || pendingEntry);
    }).catch(function (e) {
      msg(el, e.message, 'error');
      btn.disabled = false;
      if (e.status === 403) {
        toast('管理员已存在，正在跳转登录…', 'info');
        setTimeout(function () { showLogin(); }, 1200);
      }
    });
  }

  function showDone(entry) {
    showStep('stepDone');
    var doneStep = $('stepDone');
    $('doneDesc').innerHTML = '账号已创建。4 秒后进入登录页，请记住后台地址：<br><code>' +
      esc(location.host) + '/<b>' + esc(entry || '') + '</b></code>';

    setTimeout(function () {
      doneStep.classList.add('fading');
      setTimeout(function () {
        if (entry && entry !== '(已设置)') location.replace('/' + entry);
        else location.reload();
      }, 500);
    }, 4000);
  }

  $('loginSubmit').addEventListener('click', submitLogin);
  ['loginUser', 'loginPass'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') submitLogin(); });
  });

  function submitLogin() {
    var btn = $('loginSubmit');
    var el = $('loginMsg');
    var username = $('loginUser').value.trim();
    var password = $('loginPass').value;

    if (!username || !password) { msg(el, '请输入账号和密码', 'error'); return; }

    btn.disabled = true;
    msg(el, '正在登录…');

    api('/auth/login', { method: 'POST', body: { username: username, password: password } })
      .then(function () {
        msg(el, '');
        showAdmin();
      })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  }

  function showAdmin() {
    $('gate').hidden = true;
    $('admin').hidden = false;
    document.title = '后台管理 · Personal-website';
    loadState();
  }

  function loadState() {
    return api('/admin/state').then(function (data) {
      state.settings = data.settings || {};
      state.tracks = data.tracks || [];
      state.socials = data.socials || [];
      state.limits = data.limits || {};
      state.files = data.files || [];
      state.visits = data.visits || 0;

      $('sideUser').textContent = state.settings.site_name || '我的官网';
      fillForms();
      renderTracks();
      renderSocials();
      renderIconPicker();
      renderStorage();
    }).catch(function (e) {
      if (e.status === 401) { showLogin(); return; }
      toast(e.message, 'error', '加载失败');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      var view = btn.getAttribute('data-view');
      Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
        v.hidden = (v.id !== 'view-' + view);
      });
      location.hash = view;
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('/admin/logout', { method: 'POST' })
      .catch(function () {})
      .finally(function () { location.reload(); });
  });

  function fillForms() {
    var s = state.settings;

    $('fSiteName').value = s.site_name || '';
    $('fNickname').value = s.nickname || '';
    $('fAbout').value = s.about_text || '';

    $('avatarPreview').style.backgroundImage = s.avatar_url ? 'url("' + s.avatar_url + '")' : '';
    $('avatarPreview').textContent = s.avatar_url ? '' : '未设置';
    var remote = s.bg_url_remote || '';
    $('bgPreview').style.backgroundImage = (remote || s.bg_url) ? 'url("' + (remote || s.bg_url) + '")' : '';
    $('bgPreview').textContent = (remote || s.bg_url) ? '' : '未设置（使用内置渐变）';
    $('fBgUrl').value = remote;
    $('fBgPosition').value = s.bg_position || 'center center';
    $('fBgSizeDesktop').value = s.bg_size_desktop || 'cover';
    $('fBgSizeMobile').value = s.bg_size_mobile || 'cover';
    $('fontInfo').textContent = s.font_url ? '已上传自定义字体' : '未上传自定义字体';

    ['anim_intro', 'anim_bg', 'anim_reveal', 'anim_avatar', 'anim_player'].forEach(function (k) {
      var el = document.querySelector('[data-anim="' + k + '"]');
      if (el) el.checked = s[k] === '1';
    });

    $('musicEnabled').checked = s.music_enabled === '1';
    $('musicMode').value = s.music_mode === 'random' ? 'random' : 'default';

    $('tgEnabled').checked = s.tg_enabled !== '0';
    $('tgTitle').value = s.tg_title || '加入我的频道';
    $('tgSub').value = s.tg_sub || '加入就是最大的帮助';
    $('tgUrl').value = s.tg_url || 'https://t.me/COASCN';

    $('fGithubUser').value = s.github_user || '';
    $('ghShowRepos').checked = s.github_show_repos === '1';
    $('ghShowChart').checked = s.github_show_chart === '1';
    updateGhLink();

    $('fFooterText').value = s.footer_text || '';
    $('fFooterLink').value = s.footer_link || '';
    var color = s.footer_color || '#8b8b8b';
    $('fFooterColor').value = color;
    $('fFooterColorText').value = color;
    var opacity = s.footer_opacity === '' ? 0.55 : parseFloat(s.footer_opacity);
    if (!isFinite(opacity)) opacity = 0.55;
    $('fFooterOpacity').value = opacity;
    $('footerOpacityVal').textContent = Math.round(opacity * 100) + '%';
    renderFooterPreview();

    $('fEntry').value = s.security_entry || '';
    $('entryHint').innerHTML = '当前后台登录地址：<b>' + esc(location.host) + '/' + esc(s.security_entry || '') + '</b>';
    $('viewSite').href = '/';
  }

  function updateGhLink() {
    var u = $('fGithubUser').value.trim();
    var a = $('ghLink');
    if (u) { a.href = 'https://github.com/' + encodeURIComponent(u); a.hidden = false; }
    else a.hidden = true;
  }
  $('fGithubUser').addEventListener('input', updateGhLink);

  $('saveProfile').addEventListener('click', function () {
    var btn = $('saveProfile');
    var el = $('profileMsg');
    btn.disabled = true;
    msg(el, '保存中…');
    api('/admin/settings', {
      method: 'PUT',
      body: {
        site_name: $('fSiteName').value.trim(),
        nickname: $('fNickname').value.trim(),
        about_text: $('fAbout').value,
      },
    }).then(function () {
      msg(el, '已保存', 'success');
      toast('资料已保存', 'success');
      $('sideUser').textContent = $('fSiteName').value.trim() || '我的官网';
    }).catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('avatarPick').addEventListener('click', function () { $('avatarFile').click(); });
  $('avatarFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (f) uploadImage(f, 'avatar', $('avatarPreview'));
  });

  $('bgPick').addEventListener('click', function () { $('bgFile').click(); });
  $('bgFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (f) uploadImage(f, 'bg', $('bgPreview'));
  });

  $('avatarClear').addEventListener('click', function () {
    api('/admin/settings', { method: 'PUT', body: { avatar_key: '' } })
      .then(function () {
        $('avatarPreview').style.backgroundImage = '';
        $('avatarPreview').textContent = '未设置';
        toast('已移除头像', 'success');
      }).catch(function (e) { toast(e.message, 'error'); });
  });

  $('bgClear').addEventListener('click', function () {
    api('/admin/settings', { method: 'PUT', body: { bg_key: '' } })
      .then(function () {
        $('bgPreview').style.backgroundImage = '';
        $('bgPreview').textContent = '未设置（使用内置渐变）';
        toast('已移除背景图', 'success');
      }).catch(function (e) { toast(e.message, 'error'); });
  });

  $('saveBg').addEventListener('click', function () {
    var btn = $('saveBg');
    var el = $('bgMsg');
    var url = $('fBgUrl').value.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      msg(el, '网络图片地址需要以 http:// 或 https:// 开头', 'error');
      return;
    }
    btn.disabled = true;
    msg(el, '保存中…');
    api('/admin/settings', {
      method: 'PUT',
      body: {
        bg_url: url,
        bg_position: $('fBgPosition').value,
        bg_size_desktop: $('fBgSizeDesktop').value,
        bg_size_mobile: $('fBgSizeMobile').value,
      },
    }).then(function () {
      msg(el, '已保存', 'success');
      toast('背景设置已保存', 'success');
      if (url) {
        $('bgPreview').style.backgroundImage = 'url("' + url + '")';
        $('bgPreview').textContent = '';
      }
    }).catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('fontPick').addEventListener('click', function () { $('fontFile').click(); });
  $('fontFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    var mask = openUploadModal('上传字体', f.name);
    var up = addUploadItem(f.name);
    uploadOne(f, 'font', {}, up).then(function (r) {
      setTimeout(function () {
        closeUploadModal();
        if (r.ok) {
          $('fontInfo').textContent = '已上传自定义字体：' + f.name;
          toast('字体已上传', 'success');
        } else {
          toast(r.error, 'error', '上传失败');
        }
      }, r.ok ? 600 : 1600);
    });
  });

  $('fontClear').addEventListener('click', function () {
    api('/admin/settings', { method: 'PUT', body: { font_key: '', font_family: '' } })
      .then(function () {
        $('fontInfo').textContent = '未上传自定义字体';
        toast('已移除自定义字体', 'success');
      }).catch(function (e) { toast(e.message, 'error'); });
  });

  $('saveAppearance').addEventListener('click', function () {
    var btn = $('saveAppearance');
    var el = $('appearanceMsg');
    btn.disabled = true;
    var body = { music_enabled: $('musicEnabled').checked, music_mode: $('musicMode').value };
    Array.prototype.forEach.call(document.querySelectorAll('[data-anim]'), function (x) {
      body[x.getAttribute('data-anim')] = x.checked;
    });
    api('/admin/settings', { method: 'PUT', body: body })
      .then(function () { msg(el, '已保存', 'success'); toast('外观设置已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('saveTg').addEventListener('click', function () {
    var btn = $('saveTg');
    var el = $('tgMsg');
    btn.disabled = true;
    api('/admin/settings', {
      method: 'PUT',
      body: {
        tg_enabled: $('tgEnabled').checked,
        tg_title: $('tgTitle').value.trim(),
        tg_sub: $('tgSub').value.trim(),
        tg_url: $('tgUrl').value.trim(),
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('频道设置已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('saveGithub').addEventListener('click', function () {
    var btn = $('saveGithub');
    var el = $('githubMsg');
    btn.disabled = true;
    api('/admin/settings', {
      method: 'PUT',
      body: {
        github_user: $('fGithubUser').value.trim(),
        github_show_repos: $('ghShowRepos').checked,
        github_show_chart: $('ghShowChart').checked,
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('GitHub 设置已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  ['fFooterColor', 'fFooterColorText', 'fFooterOpacity', 'fFooterText'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (id === 'fFooterColor') $('fFooterColorText').value = $('fFooterColor').value;
      if (id === 'fFooterColorText' && /^#[0-9a-fA-F]{3,8}$/.test($('fFooterColorText').value)) {
        $('fFooterColor').value = $('fFooterColorText').value;
      }
      $('footerOpacityVal').textContent = Math.round(parseFloat($('fFooterOpacity').value) * 100) + '%';
      renderFooterPreview();
    });
  });

  function renderFooterPreview() {
    var text = $('fFooterText').value || '（这里显示页脚文字）';
    var color = $('fFooterColorText').value || '#8b8b8b';
    var opacity = parseFloat($('fFooterOpacity').value);
    if (!isFinite(opacity)) opacity = 0.55;
    var el = $('footerPreview');
    el.style.color = color;
    el.style.opacity = opacity;
    el.textContent = text;
  }

  $('saveFooter').addEventListener('click', function () {
    var btn = $('saveFooter');
    var el = $('footerMsg');
    btn.disabled = true;
    api('/admin/settings', {
      method: 'PUT',
      body: {
        footer_text: $('fFooterText').value.trim(),
        footer_link: $('fFooterLink').value.trim(),
        footer_color: $('fFooterColorText').value.trim() || '#8b8b8b',
        footer_opacity: parseFloat($('fFooterOpacity').value),
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('页脚已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('saveEntry').addEventListener('click', function () {
    var btn = $('saveEntry');
    var el = $('entryMsg2');
    var value = $('fEntry').value.trim();
    if (value.length < 5) { msg(el, '安全入口至少 5 位', 'error'); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(value)) { msg(el, '只能包含字母、数字、下划线和中划线', 'error'); return; }

    btn.disabled = true;
    api('/admin/settings', { method: 'PUT', body: { security_entry: value } })
      .then(function () {
        msg(el, '已更新', 'success');
        toast('安全入口已更新，即将跳转到新地址', 'success');
        setTimeout(function () { location.replace('/' + value); }, 1600);
      })
      .catch(function (e) { msg(el, e.message, 'error'); btn.disabled = false; });
  });

  $('saveCreds').addEventListener('click', function () {
    var btn = $('saveCreds');
    var el = $('credsMsg');
    var cur = $('curPass').value;
    var nu = $('newUser').value.trim();
    var np = $('newPass').value;
    var np2 = $('newPass2').value;

    if (!cur) { msg(el, '请输入当前密码', 'error'); return; }
    if (np && np.length < 6) { msg(el, '新密码至少 6 位', 'error'); return; }
    if (np && np !== np2) { msg(el, '两次输入的新密码不一致', 'error'); return; }
    if (!nu && !np) { msg(el, '没有需要修改的内容', 'error'); return; }

    btn.disabled = true;
    api('/admin/credentials', {
      method: 'POST',
      body: {
        current_password: cur,
        new_username: nu,
        new_password: np,
        new_password_confirm: np2,
      },
    }).then(function () {
      msg(el, '已更新', 'success');
      toast('账号信息已更新', 'success');
      $('curPass').value = ''; $('newUser').value = ''; $('newPass').value = ''; $('newPass2').value = '';
      loadState();
    }).catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  function renderStorage() {
    var total = (state.files || []).reduce(function (a, f) { return a + (f.size || 0); }, 0);
    $('storageInfo').textContent = '共 ' + (state.files || []).length + ' 个文件，占用 ' +
      formatBytes(total) + '。访问量：' + (state.visits || 0);
  }

  $('wipeBtn').addEventListener('click', function () {
    var el = $('wipeConfirm');
    if (el.value.trim() !== 'DELETE') { toast('请输入 DELETE 以确认', 'error'); return; }
    if (!confirm('确定删除所有上传的音乐、头像和背景图吗？此操作不可撤销。')) return;
    api('/admin/wipe-assets', { method: 'POST', body: { confirm: 'DELETE' } })
      .then(function () { toast('已清空', 'success'); el.value = ''; loadState(); })
      .catch(function (e) { toast(e.message, 'error'); });
  });

  var trackFile = $('trackFile');
  var drop = $('trackDrop');
  drop.addEventListener('click', function () { trackFile.click(); });
  trackFile.addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files);
    this.value = '';
    if (files.length) uploadTracks(files);
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) {
      return /^audio\//.test(f.type) || /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i.test(f.name);
    });
    if (files.length) uploadTracks(files);
    else toast('请拖入音频文件', 'error');
  });

  function uploadTracks(files) {
    runUploadQueue('上传音乐', files, 'track', function (f) {
      return { title: f.name.replace(/\.[^.]+$/, '') };
    });
  }

  function renderTracks() {
    var list = $('trackList');
    $('trackCount').textContent = state.tracks.length + ' / ' + (state.limits.tracksMax || 50) + ' 首';

    if (!state.tracks.length) {
      list.innerHTML = '<div class="empty">还没有上传音乐。上传后前台右下角会出现播放器。</div>';
      return;
    }

    list.innerHTML = '';
    state.tracks.forEach(function (t) {
      var item = document.createElement('div');
      item.className = 'track-item';
      item.draggable = true;
      item.dataset.id = t.id;

      item.innerHTML =
        '<span class="track-handle" title="拖动排序">⠿</span>' +
        '<div class="track-cover" ' + (t.cover_url ? 'style="background-image:url(\'' + esc(t.cover_url) + '\')"' : '') + '>' +
          (t.cover_url ? '' : '♪') + '</div>' +
        '<div class="track-info">' +
          '<input type="text" class="t-title" value="' + esc(t.title) + '" placeholder="歌曲名" />' +
          '<input type="text" class="t-artist sub" value="' + esc(t.artist || '') + '" placeholder="歌手（可选）" />' +
        '</div>' +
        '<span class="track-meta">' + formatBytes(t.size) + '</span>' +
        '<div class="track-actions">' +
          '<button class="icon-btn-xs t-cover-btn" title="上传封面" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs t-save" title="保存" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs danger t-del" title="删除" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7"/></svg>' +
          '</button>' +
        '</div>';

      item.querySelector('.t-save').addEventListener('click', function () {
        api('/admin/tracks/' + t.id, {
          method: 'PUT',
          body: {
            title: item.querySelector('.t-title').value.trim() || '未命名',
            artist: item.querySelector('.t-artist').value.trim(),
          },
        }).then(function () {
          toast('已保存', 'success');
          t.title = item.querySelector('.t-title').value.trim();
          t.artist = item.querySelector('.t-artist').value.trim();
        }).catch(function (e) { toast(e.message, 'error'); });
      });

      item.querySelector('.t-cover-btn').addEventListener('click', function () {
        if (window.GRWZ && window.GRWZ.openCoverModal) {
          window.GRWZ.openCoverModal(t, function () {
            toast('封面已更新', 'success');
            loadState();
          });
        }
      });

      item.querySelector('.t-del').addEventListener('click', function () {
        if (!confirm('确定删除《' + t.title + '》吗？')) return;
        api('/admin/tracks/' + t.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadState(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      item.addEventListener('dragstart', function (e) {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(t.id));
      });
      item.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('drop-target'); });
        saveTrackOrder();
      });
      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        var dragging = list.querySelector('.dragging');
        if (!dragging || dragging === item) return;
        item.classList.add('drop-target');
        var rect = item.getBoundingClientRect();
        var after = (e.clientY - rect.top) > rect.height / 2;
        list.insertBefore(dragging, after ? item.nextSibling : item);
      });
      item.addEventListener('dragleave', function () { item.classList.remove('drop-target'); });

      list.appendChild(item);
    });
  }

  function saveTrackOrder() {
    var order = Array.prototype.map.call($('trackList').children, function (c) {
      return parseInt(c.dataset.id, 10);
    }).filter(function (n) { return !isNaN(n); });
    api('/admin/tracks/reorder', { method: 'POST', body: { order: order } })
      .then(function () { toast('顺序已保存', 'success'); loadState(); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  var selectedIcon = 'x';

  function renderIconPicker() {
    var picker = $('iconPicker');
    picker.innerHTML = '';

    Object.keys(ICONS).forEach(function (key) {
      var opt = document.createElement('div');
      opt.className = 'icon-opt' + (key === selectedIcon ? ' selected' : '');
      opt.dataset.icon = key;
      opt.title = ICONS[key].name;
      opt.innerHTML = iconSvg(key) + '<span>' + esc(ICONS[key].name) + '</span>';
      opt.addEventListener('click', function () {
        selectedIcon = key;
        pendingIconKey = '';
        $('socIconHint').textContent = '已选择内置图标：' + ICONS[key].name;
        Array.prototype.forEach.call(picker.children, function (c) {
          c.classList.toggle('selected', c.dataset.icon === key);
        });
      });
      picker.appendChild(opt);
    });

    var custom = document.createElement('div');
    custom.className = 'icon-opt' + (selectedIcon === 'custom' ? ' selected' : '');
    custom.dataset.icon = 'custom';
    custom.title = '自定义图标';
    custom.innerHTML = (pendingIconKey
      ? '<img src="/uploads/' + esc(pendingIconKey) + '" alt="" />'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>')
      + '<span>自定义</span>';
    custom.addEventListener('click', function () {
      selectedIcon = 'custom';
      if (!pendingIconKey) $('socIconFile').click();
      else {
        Array.prototype.forEach.call(picker.children, function (c) {
          c.classList.toggle('selected', c.dataset.icon === 'custom');
        });
      }
    });
    picker.appendChild(custom);
  }

  $('socIconPick').addEventListener('click', function () { $('socIconFile').click(); });
  $('socIconFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;

    var mask = openUploadModal('上传图标', f.name);
    var up = addUploadItem(f.name);
    uploadOne(f, 'icon', {}, up).then(function (r) {
      setTimeout(function () {
        closeUploadModal();
        if (r.ok) { onIconUploaded(r.data); toast('图标已上传', 'success'); }
        else toast(r.error, 'error', '上传失败');
      }, r.ok ? 600 : 1600);
    });
  });

  $('socAdd').addEventListener('click', function () {
    var btn = $('socAdd');
    var el = $('socMsg');
    var label = $('socLabel').value.trim();
    var url = $('socUrl').value.trim();

    if (!label) { msg(el, '请填写显示名称', 'error'); return; }
    if (!url) { msg(el, '请填写链接地址', 'error'); return; }

    btn.disabled = true;
    msg(el, '添加中…');

    api('/admin/socials', {
      method: 'POST',
      body: {
        label: label,
        url: url,
        icon: selectedIcon,
        icon_key: selectedIcon === 'custom' ? pendingIconKey : '',
      },
    }).then(function (res) {
      msg(el, '');
      $('socLabel').value = '';
      $('socUrl').value = '';
      pendingIconKey = '';
      $('socIconHint').textContent = '未选择时使用内置图标';
      if (res.auto_fixed) toast('链接已自动补全为 ' + res.url, 'info', '已补全 https://');
      if (res.hint) toast(res.hint, 'info');
      else toast('已添加', 'success');
      loadState();
    }).catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  function renderSocials() {
    var list = $('socialListAdmin');
    if (!state.socials.length) {
      list.innerHTML = '<div class="empty">还没有添加社交链接。</div>';
      return;
    }

    list.innerHTML = '';
    state.socials.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'social-admin-item' + (s.enabled ? '' : ' disabled');
      item.draggable = true;
      item.dataset.id = s.id;

      var iconMarkup = (s.icon === 'custom' && s.icon_url)
        ? '<img src="' + esc(s.icon_url) + '" alt="" />'
        : iconSvg(s.icon);

      item.innerHTML =
        '<span class="track-handle" title="拖动排序">⠿</span>' +
        '<div class="social-icon-box">' + iconMarkup + '</div>' +
        '<div class="social-admin-info">' +
          '<input type="text" class="s-label" value="' + esc(s.label) + '" placeholder="显示名称" />' +
          '<input type="text" class="s-url sub" value="' + esc(s.url) + '" placeholder="https://..." />' +
        '</div>' +
        '<div class="track-actions">' +
          '<button class="icon-btn-xs s-toggle" title="' + (s.enabled ? '隐藏' : '显示') + '" type="button">' +
            (s.enabled
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 4l16 16"/><path d="M9.5 5.8A9.8 9.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4M6.3 8A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1 0 1.9-.1 2.7-.4"/></svg>') +
          '</button>' +
          '<button class="icon-btn-xs s-save" title="保存" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs danger s-del" title="删除" type="button">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7"/></svg>' +
          '</button>' +
        '</div>';

      item.querySelector('.s-save').addEventListener('click', function () {
        api('/admin/socials/' + s.id, {
          method: 'PUT',
          body: {
            label: item.querySelector('.s-label').value.trim(),
            url: item.querySelector('.s-url').value.trim(),
          },
        }).then(function () { toast('已保存', 'success'); loadState(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      item.querySelector('.s-toggle').addEventListener('click', function () {
        api('/admin/socials/' + s.id, { method: 'PUT', body: { enabled: !s.enabled } })
          .then(function () { loadState(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      item.querySelector('.s-del').addEventListener('click', function () {
        if (!confirm('确定删除「' + s.label + '」吗？')) return;
        api('/admin/socials/' + s.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadState(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      item.addEventListener('dragstart', function (e) {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', function () {
        item.classList.remove('dragging');
        Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('drop-target'); });
        saveSocialOrder();
      });
      item.addEventListener('dragover', function (e) {
        e.preventDefault();
        var dragging = list.querySelector('.dragging');
        if (!dragging || dragging === item) return;
        item.classList.add('drop-target');
        var rect = item.getBoundingClientRect();
        var after = (e.clientY - rect.top) > rect.height / 2;
        list.insertBefore(dragging, after ? item.nextSibling : item);
      });
      item.addEventListener('dragleave', function () { item.classList.remove('drop-target'); });

      list.appendChild(item);
    });
  }

  function saveSocialOrder() {
    var order = Array.prototype.map.call($('socialListAdmin').children, function (c) {
      return parseInt(c.dataset.id, 10);
    }).filter(function (n) { return !isNaN(n); });
    api('/admin/socials/reorder', { method: 'POST', body: { order: order } })
      .then(function () { toast('顺序已保存', 'success'); loadState(); })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  var hash = (location.hash || '').replace('#', '');
  if (hash) {
    var btn = document.querySelector('.nav-item[data-view="' + hash + '"]');
    if (btn) setTimeout(function () { btn.click(); }, 300);
  }

  document.addEventListener('touchstart', function () {}, { passive: true });
})();