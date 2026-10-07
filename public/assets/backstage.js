/* ============================================================
   后台逻辑：初始化向导 → 登录 → 管理面板
   ============================================================ */
(function () {
  'use strict';

  var ICONS = window.GRWZ_ICONS || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = { settings: {}, tracks: [], socials: [], limits: {} };

  /* ---------------- 通用 ---------------- */

  function api(path, options) {
    var opts = options || {};
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body && !(opts.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : undefined,
      body: opts.body instanceof FormData
        ? opts.body
        : (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应解析失败' }; })
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

  function msg(el, text, kind) {
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '') + (el.classList.contains('inline') ? ' inline' : '');
  }

  var toastTimer = null;
  function toast(text, kind) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function iconSvg(name) {
    var ic = ICONS[name] || ICONS.link;
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + ic.path + '"/></svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  /* ============================================================
     入口：判断显示向导、登录还是面板
     ============================================================ */

  var pendingEntry = '';   // 向导中已设置的安全入口
  var isWizard = false;    // 当前是否处于初始化向导流程

  api('/setup/status').then(function (st) {
    if (st.initialized) {
      // 初始化完成 → 检查是否已登录
      return api('/admin/me')
        .then(function () { showAdmin(); })
        .catch(function () { showLogin(st); });
    }

    // 未初始化 → 进入向导
    isWizard = true;
    if (st.security_entry_set) {
      // 已经设过安全入口，直接进入注册管理员步骤
      pendingEntry = '(已设置)';
      showStep('stepAdmin');
    } else {
      showStep('stepEntry');
    }
  }).catch(function (e) {
    // 通常是数据库还没初始化
    showStep('stepEntry');
    msg($('entryMsg'), '无法连接后端：' + e.message + '（请确认已执行数据库初始化命令）', 'error');
  });

  function showStep(id) {
    ['stepEntry', 'stepAdmin', 'stepDone', 'stepLogin'].forEach(function (s) {
      var el = $(s);
      if (el) el.hidden = (s !== id);
    });
    $('gate').hidden = false;
    $('admin').hidden = true;

    var focusMap = {
      stepEntry: 'entryInput',
      stepAdmin: 'adminUser',
      stepLogin: 'loginUser',
    };
    if (focusMap[id]) setTimeout(function () { $(focusMap[id]).focus(); }, 120);
  }

  function showLogin(st) {
    showStep('stepLogin');
    document.title = '登录 · 个人官网后台';
  }

  /* ============================================================
     第 1 步：设置安全入口
     ============================================================ */

  var entryInput = $('entryInput');

  entryInput.addEventListener('input', function () {
    var v = entryInput.value.trim();
    $('entryPreview').innerHTML = esc(location.host) + '/<b>' + (esc(v) || '安全入口') + '</b>';
  });
  entryInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitEntry();
  });
  $('entrySubmit').addEventListener('click', submitEntry);

  function submitEntry() {
    var btn = $('entrySubmit');
    var el = $('entryMsg');
    var value = entryInput.value.trim();

    if (value.length < 5) return msg(el, '安全入口至少 5 位', 'error');
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return msg(el, '只能包含字母、数字、下划线和中划线', 'error');
    }

    btn.disabled = true;
    msg(el, '正在保存…');

    api('/setup/entry', { method: 'POST', body: { entry: value } })
      .then(function (res) {
        pendingEntry = res.entry || value;
        msg(el, '');
        // 更新浏览器地址栏，让用户直观看到新的后台入口
        try { history.replaceState(null, '', '/' + pendingEntry); } catch (e2) {}
        showStep('stepAdmin');
      })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  }

  /* ============================================================
     第 2 步：注册管理员
     ============================================================ */

  $('adminBack').addEventListener('click', function () { showStep('stepEntry'); });
  $('adminSubmit').addEventListener('click', submitAdmin);

  ['adminUser', 'adminPass', 'adminPass2'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitAdmin();
    });
  });

  function submitAdmin() {
    var btn = $('adminSubmit');
    var el = $('adminMsg');
    var username = $('adminUser').value.trim();
    var password = $('adminPass').value;
    var password2 = $('adminPass2').value;

    if (username.length < 3) return msg(el, '账号至少 3 位', 'error');
    if (password.length < 6) return msg(el, '密码至少 6 位', 'error');
    if (password !== password2) return msg(el, '两次输入的密码不一致', 'error');

    btn.disabled = true;
    msg(el, '正在创建账号…');

    api('/setup/admin', {
      method: 'POST',
      body: { username: username, password: password, password_confirm: password2 },
    })
      .then(function (res) {
        msg(el, '');
        showDone(res.entry || pendingEntry);
      })
      .catch(function (e) { msg(el, e.message, 'error'); btn.disabled = false; });
  }

  /* ============================================================
     第 3 步：「一切完成」→ 淡出 → 进入安全入口登录
     ============================================================ */

  function showDone(entry) {
    showStep('stepDone');

    var doneStep = $('stepDone');
    var desc = $('doneDesc');
    desc.innerHTML = '账号已创建。4 秒后将进入登录页，' +
      '请记住你的后台地址：<br><code>' + esc(location.host) + '/<b>' + esc(entry || '') + '</b></code>';

    // 4 秒展现时间，随后淡出并进入安全入口登录页
    setTimeout(function () {
      doneStep.classList.add('fading');
      setTimeout(function () {
        // 跳转到真实的安全入口地址 —— 这样用户看到的就是以后要用的登录地址
        if (entry && entry !== '(已设置)') {
          location.replace('/' + entry);
        } else {
          location.reload();
        }
      }, 800);
    }, 4000);
  }

  /* ============================================================
     登录
     ============================================================ */

  $('loginSubmit').addEventListener('click', submitLogin);
  ['loginUser', 'loginPass'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitLogin();
    });
  });

  function submitLogin() {
    var btn = $('loginSubmit');
    var el = $('loginMsg');
    var username = $('loginUser').value.trim();
    var password = $('loginPass').value;

    if (!username || !password) return msg(el, '请输入账号和密码', 'error');

    btn.disabled = true;
    msg(el, '正在登录…');

    api('/auth/login', { method: 'POST', body: { username: username, password: password } })
      .then(function () {
        msg(el, '登录成功', 'success');
        showAdmin();
      })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  }

  /* ============================================================
     管理面板
     ============================================================ */

  function showAdmin() {
    $('gate').hidden = true;
    $('admin').hidden = false;
    document.title = '后台管理 · 个人官网';
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
      state.storage_ready = data.storage_ready !== false;

      $('sideUser').textContent = (state.settings.site_name || '我的官网');
      $('storageBanner').hidden = state.storage_ready !== false;
      fillForms();
      renderTracks();
      renderSocials();
      renderIconPicker();
      renderStorage();
    }).catch(function (e) {
      if (e.status === 401) { showLogin(); return; }
      toast(e.message, 'error');
    });
  }

  /* ---------------- 视图切换 ---------------- */

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

  /* ---------------- 表单填充 ---------------- */

  function fillForms() {
    var s = state.settings;

    $('fSiteName').value = s.site_name || '';
    $('fNickname').value = s.nickname || '';
    $('fAbout').value = s.about_text || '';

    $('avatarPreview').style.backgroundImage = s.avatar_url ? 'url("' + s.avatar_url + '")' : '';
    $('avatarPreview').textContent = s.avatar_url ? '' : '未设置';
    $('bgPreview').style.backgroundImage = s.bg_url ? 'url("' + s.bg_url + '")' : '';
    $('bgPreview').textContent = s.bg_url ? '' : '未设置（使用内置渐变）';

    // 动画开关
    var animMap = {
      anim_intro: 'anim_intro',
      anim_bg: 'anim_bg',
      anim_reveal: 'anim_reveal',
      anim_avatar: 'anim_avatar',
      anim_player: 'anim_player',
    };
    Object.keys(animMap).forEach(function (k) {
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
    var color = s.footer_color || '#8a8a8e';
    $('fFooterColor').value = color;
    $('fFooterColorText').value = color;
    var opacity = s.footer_opacity === '' ? 0.55 : parseFloat(s.footer_opacity);
    if (!isFinite(opacity)) opacity = 0.55;
    $('fFooterOpacity').value = opacity;
    $('footerOpacityVal').textContent = Math.round(opacity * 100) + '%';
    renderFooterPreview();

    $('fEntry').value = s.security_entry || '';
    $('entryHint').innerHTML = '当前后台登录地址：<b>' + esc(location.host) + '/' + esc(s.security_entry || '') + '</b>';

    // 站点链接
    $('viewSite').href = '/';
  }

  function updateGhLink() {
    var u = $('fGithubUser').value.trim();
    var a = $('ghLink');
    if (u) {
      a.href = 'https://github.com/' + encodeURIComponent(u);
      a.hidden = false;
    } else {
      a.hidden = true;
    }
  }
  $('fGithubUser').addEventListener('input', updateGhLink);

  /* ---------------- 保存：关于我 ---------------- */

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
      $('sideUser').textContent = $('fSiteName').value.trim() || '我的官网';
      toast('已保存', 'success');
    }).catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 2500); });
  });

  /* ---------------- 头像 / 背景上传 ---------------- */

  $('avatarPick').addEventListener('click', function () { $('avatarFile').click(); });
  $('avatarFile').addEventListener('change', function () {
    var f = this.files[0];
    if (f) doImageUpload(f, 'avatar', $('avatarPreview'));
    this.value = '';
  });

  $('avatarClear').addEventListener('click', function () {
    api('/admin/settings', { method: 'PUT', body: { avatar_key: '' } })
      .then(function () {
        state.settings.avatar_key = '';
        state.settings.avatar_url = '';
        $('avatarPreview').style.backgroundImage = '';
        $('avatarPreview').textContent = '未设置';
        toast('已移除头像', 'success');
      })
      .catch(function (e) { toast(e.message, 'error'); });
  });

  $('bgPick').addEventListener('click', function () { $('bgFile').click(); });
  $('bgFile').addEventListener('change', function () {
    var f = this.files[0];
    if (f) doImageUpload(f, 'bg', $('bgPreview'));
    this.value = '';
  });

  $('bgClear').addEventListener('click', function () {
    api('/admin/settings', { method: 'PUT', body: { bg_key: '' } })
      .then(function () {
        state.settings.bg_key = '';
        state.settings.bg_url = '';
        $('bgPreview').style.backgroundImage = '';
        $('bgPreview').textContent = '未设置（使用内置渐变）';
        toast('已移除背景图', 'success');
      })
      .catch(function (e) { toast(e.message, 'error'); });
  });

  function doImageUpload(file, kind, previewEl) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);

    toast('正在上传…');
    fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '上传失败');
        state.settings[kind + '_key'] = res.key;
        state.settings[kind + '_url'] = res.url;
        if (kind === 'avatar') {
          previewEl.style.backgroundImage = 'url("' + res.url + '")';
          previewEl.textContent = '';
        } else {
          previewEl.style.backgroundImage = 'url("' + res.url + '")';
          previewEl.textContent = '';
        }
        toast('上传成功', 'success');
      })
      .catch(function (e) { toast(e.message, 'error'); });
  }

  /* ---------------- 保存：外观与动画 ---------------- */

  $('saveAppearance').addEventListener('click', function () {
    var btn = $('saveAppearance');
    var el = $('appearanceMsg');
    btn.disabled = true;
    msg(el, '保存中…');

    var body = {
      music_enabled: $('musicEnabled').checked,
      music_mode: $('musicMode').value,
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-anim]'), function (el2) {
      body[el2.getAttribute('data-anim')] = el2.checked;
    });

    api('/admin/settings', { method: 'PUT', body: body })
      .then(function () { msg(el, '已保存', 'success'); toast('已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 2500); });
  });

  $('saveTg').addEventListener('click', function () {
    var btn = $('saveTg');
    var el = $('tgMsg');
    btn.disabled = true;
    msg(el, '保存中…');

    api('/admin/settings', {
      method: 'PUT',
      body: {
        tg_enabled: $('tgEnabled').checked,
        tg_title: $('tgTitle').value.trim(),
        tg_sub: $('tgSub').value.trim(),
        tg_url: $('tgUrl').value.trim(),
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 2500); });
  });

  /* ---------------- 保存：GitHub ---------------- */

  $('saveGithub').addEventListener('click', function () {
    var btn = $('saveGithub');
    var el = $('githubMsg');
    btn.disabled = true;
    msg(el, '保存中…');

    api('/admin/settings', {
      method: 'PUT',
      body: {
        github_user: $('fGithubUser').value.trim(),
        github_show_repos: $('ghShowRepos').checked,
        github_show_chart: $('ghShowChart').checked,
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 2500); });
  });

  /* ---------------- 保存：页脚 ---------------- */

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
    var color = $('fFooterColorText').value || '#8a8a8e';
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
    msg(el, '保存中…');

    api('/admin/settings', {
      method: 'PUT',
      body: {
        footer_text: $('fFooterText').value.trim(),
        footer_link: $('fFooterLink').value.trim(),
        footer_color: $('fFooterColorText').value.trim() || '#8a8a8e',
        footer_opacity: parseFloat($('fFooterOpacity').value),
      },
    }).then(function () { msg(el, '已保存', 'success'); toast('已保存', 'success'); })
      .catch(function (e) { msg(el, e.message, 'error'); })
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 2500); });
  });

  /* ---------------- 安全入口 ---------------- */

  $('saveEntry').addEventListener('click', function () {
    var btn = $('saveEntry');
    var el = $('entryMsg');
    var value = $('fEntry').value.trim();

    if (value.length < 5) return msg(el, '安全入口至少 5 位', 'error');
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return msg(el, '只能包含字母、数字、下划线和中划线', 'error');

    btn.disabled = true;
    msg(el, '保存中…');

    api('/admin/settings', { method: 'PUT', body: { security_entry: value } })
      .then(function () {
        state.settings.security_entry = value;
        msg(el, '已更新', 'success');
        toast('安全入口已更新，即将跳转到新地址…', 'success');
        setTimeout(function () { location.replace('/' + value); }, 1800);
      })
      .catch(function (e) { msg(el, e.message, 'error'); btn.disabled = false; });
  });

  /* ---------------- 账号密码 ---------------- */

  $('saveCreds').addEventListener('click', function () {
    var btn = $('saveCreds');
    var el = $('credsMsg');
    var cur = $('curPass').value;
    var nu = $('newUser').value.trim();
    var np = $('newPass').value;
    var np2 = $('newPass2').value;

    if (!cur) return msg(el, '请输入当前密码', 'error');
    if (np && np.length < 6) return msg(el, '新密码至少 6 位', 'error');
    if (np && np !== np2) return msg(el, '两次输入的新密码不一致', 'error');
    if (!nu && !np) return msg(el, '没有需要修改的内容', 'error');

    btn.disabled = true;
    msg(el, '保存中…');

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
      .finally(function () { btn.disabled = false; setTimeout(function () { msg(el, ''); }, 3000); });
  });

  /* ---------------- 存储占用 / 清空 ---------------- */

  function renderStorage() {
    var total = (state.files || []).reduce(function (a, f) { return a + (f.size || 0); }, 0);
    $('storageInfo').textContent = '共 ' + (state.files || []).length + ' 个文件，占用 ' +
      formatBytes(total) + '。R2 免费额度为 10GB。访问量：' + (state.visits || 0);
  }

  $('wipeBtn').addEventListener('click', function () {
    var el = $('wipeConfirm');
    if (el.value.trim() !== 'DELETE') return toast('请输入 DELETE 以确认', 'error');
    if (!confirm('确定要删除所有上传的音乐、头像和背景图吗？此操作不可撤销。')) return;

    api('/admin/wipe-assets', { method: 'POST', body: { confirm: 'DELETE' } })
      .then(function () {
        toast('已清空', 'success');
        el.value = '';
        loadState();
      })
      .catch(function (e) { toast(e.message, 'error'); });
  });

  /* ============================================================
     音乐管理
     ============================================================ */

  var trackFile = $('trackFile');
  var drop = $('trackDrop');

  drop.addEventListener('click', function () { trackFile.click(); });
  trackFile.addEventListener('change', function () {
    if (this.files.length) uploadTracks(Array.prototype.slice.call(this.files));
    this.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files)
      .filter(function (f) { return /^audio\//.test(f.type) || /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i.test(f.name); });
    if (files.length) uploadTracks(files);
    else toast('请拖入音频文件', 'error');
  });

  /** 顺序上传，逐个显示进度 */
  function uploadTracks(files) {
    var box = $('trackProgress');
    var bar = $('trackProgressBar');
    var text = $('trackProgressText');
    box.hidden = false;

    var maxBytes = state.limits.maxUploadBytes || 96 * 1024 * 1024;
    var i = 0;
    var failed = [];

    function next() {
      if (i >= files.length) {
        box.hidden = true;
        bar.style.width = '0%';
        loadState().then(function () {
          if (failed.length) toast('部分文件上传失败：' + failed.join('、'), 'error');
          else toast('上传完成', 'success');
        });
        return;
      }

      var file = files[i];
      text.textContent = '正在上传 ' + (i + 1) + '/' + files.length + '：' + file.name + '（' + formatBytes(file.size) + '）';

      if (file.size > maxBytes) {
        failed.push(file.name + '（超过 ' + formatBytes(maxBytes) + '）');
        i++; next(); return;
      }

      var fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'track');
      fd.append('title', file.name.replace(/\.[^.]+$/, ''));
      fd.append('duration', '');

      // 用 XHR 以便拿到上传进度
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/upload');
      xhr.withCredentials = true;

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var pct = (e.loaded / e.total) * 100;
          bar.style.width = pct + '%';
        }
      };

      xhr.onload = function () {
        var res = {};
        try { res = JSON.parse(xhr.responseText); } catch (e2) {}
        if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
          bar.style.width = '100%';
        } else {
          failed.push(file.name + '（' + (res.error || ('HTTP ' + xhr.status)) + '）');
        }
        i++;
        bar.style.width = '0%';
        next();
      };

      xhr.onerror = function () {
        failed.push(file.name + '（网络错误）');
        i++;
        next();
      };

      xhr.send(fd);
    }

    next();
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
          (t.cover_url ? '' : '♪') +
        '</div>' +
        '<div class="track-info">' +
          '<input type="text" class="t-title" value="' + esc(t.title) + '" placeholder="歌曲名" />' +
          '<input type="text" class="t-artist sub" value="' + esc(t.artist || '') + '" placeholder="歌手（可选）" />' +
        '</div>' +
        '<span class="track-meta">' + formatBytes(t.size) + '</span>' +
        '<div class="track-actions">' +
          '<button class="icon-btn-xs t-cover-btn" title="上传封面">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h3l1.5-2h7L17 5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm8 3.5A4.5 4.5 0 1 0 16.5 13 4.5 4.5 0 0 0 12 8.5Zm0 2A2.5 2.5 0 1 1 9.5 13 2.5 2.5 0 0 1 12 10.5Z"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs t-save" title="保存">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h11l3 3v15H5zm2 2v4h8V5zm5 7a3 3 0 1 0 3 3 3 3 0 0 0-3-3Z"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs danger t-del" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z"/></svg>' +
          '</button>' +
        '</div>';

      // 保存
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

      // 上传封面
      item.querySelector('.t-cover-btn').addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = function () {
          var f = input.files[0];
          if (!f) return;
          var fd = new FormData();
          fd.append('file', f);
          fd.append('kind', 'cover');
          toast('正在上传封面…');
          fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (!res.ok) throw new Error(res.error || '上传失败');
              return api('/admin/tracks/' + t.id, { method: 'PUT', body: { cover_key: res.key } })
                .then(function () {
                  state.settings.__changed = true;
                  toast('封面已更新', 'success');
                  loadState();
                });
            })
            .catch(function (e) { toast(e.message, 'error'); });
        };
        input.click();
      });

      // 删除
      item.querySelector('.t-del').addEventListener('click', function () {
        if (!confirm('确定删除《' + t.title + '》吗？')) return;
        api('/admin/tracks/' + t.id, { method: 'DELETE' })
          .then(function () { toast('已删除', 'success'); loadState(); })
          .catch(function (e) { toast(e.message, 'error'); });
      });

      // 拖动排序
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

  /* ============================================================
     社交链接
     ============================================================ */

  var selectedIcon = 'x';
  var uploadedIconKey = '';

  function renderIconPicker() {
    var picker = $('iconPicker');
    picker.innerHTML = '';

    Object.keys(ICONS).forEach(function (key) {
      var opt = document.createElement('div');
      opt.className = 'icon-opt' + (key === selectedIcon ? ' selected' : '');
      opt.dataset.icon = key;
      opt.innerHTML = iconSvg(key) + '<span>' + esc(ICONS[key].name) + '</span>';
      opt.addEventListener('click', function () {
        selectedIcon = key;
        uploadedIconKey = '';
        $('socIconHint').textContent = '未选择时使用内置图标';
        Array.prototype.forEach.call(picker.children, function (c) {
          c.classList.toggle('selected', c.dataset.icon === key);
        });
      });
      picker.appendChild(opt);
    });

    // 自定义图标选项
    var custom = document.createElement('div');
    custom.className = 'icon-opt' + (selectedIcon === 'custom' ? ' selected' : '');
    custom.dataset.icon = 'custom';
    custom.innerHTML = (uploadedIconKey
      ? '<img src="/api/file/' + encodeURIComponent(uploadedIconKey) + '" alt="" />'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>')
      + '<span>自定义</span>';
    custom.addEventListener('click', function () {
      selectedIcon = 'custom';
      if (!uploadedIconKey) {
        $('socIconFile').click();
      } else {
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

    var fd = new FormData();
    fd.append('file', f);
    fd.append('kind', 'icon');
    toast('正在上传图标…');

    fetch('/api/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || '上传失败');
        uploadedIconKey = res.key;
        selectedIcon = 'custom';
        $('socIconHint').textContent = '已上传自定义图标：' + f.name;
        renderIconPicker();
        toast('图标已上传', 'success');
      })
      .catch(function (e) { toast(e.message, 'error'); });
  });

  $('socAdd').addEventListener('click', function () {
    var btn = $('socAdd');
    var el = $('socMsg');
    var label = $('socLabel').value.trim();
    var url = $('socUrl').value.trim();

    if (!label) return msg(el, '请填写显示名称', 'error');
    if (!/^https?:\/\/.+/i.test(url)) return msg(el, '链接需要以 http:// 或 https:// 开头', 'error');

    btn.disabled = true;
    msg(el, '添加中…');

    api('/admin/socials', {
      method: 'POST',
      body: {
        label: label,
        url: url,
        icon: selectedIcon,
        icon_key: selectedIcon === 'custom' ? uploadedIconKey : '',
      },
    }).then(function (res) {
      msg(el, '');
      $('socLabel').value = '';
      $('socUrl').value = '';
      uploadedIconKey = '';
      $('socIconHint').textContent = '未选择时使用内置图标';
      if (res.hint) toast(res.hint, 'error'); else toast('已添加', 'success');
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
          '<button class="icon-btn-xs s-toggle" title="' + (s.enabled ? '隐藏' : '显示') + '">' +
            (s.enabled
              ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7Zm0 3a4 4 0 1 0 4 4 4 4 0 0 0-4-4Z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4.3 4.3 3l16.7 16.7-1.3 1.3-3-3A10.6 10.6 0 0 1 12 19c-5 0-9-4.5-9-7a7.4 7.4 0 0 1 2.2-3.7ZM12 8a4 4 0 0 1 4 4 3.9 3.9 0 0 1-.3 1.5l-5.2-5.2A3.9 3.9 0 0 1 12 8Z"/></svg>') +
          '</button>' +
          '<button class="icon-btn-xs s-save" title="保存">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h11l3 3v15H5zm2 2v4h8V5zm5 7a3 3 0 1 0 3 3 3 3 0 0 0-3-3Z"/></svg>' +
          '</button>' +
          '<button class="icon-btn-xs danger s-del" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z"/></svg>' +
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

  /* ---------------- 打开时按 hash 定位视图 ---------------- */
  var hash = (location.hash || '').replace('#', '');
  if (hash) {
    var btn = document.querySelector('.nav-item[data-view="' + hash + '"]');
    if (btn) setTimeout(function () { btn.click(); }, 400);
  }
})();
