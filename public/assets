/* ============================================================
   前台逻辑：拉取配置 → 渲染站点 → 播放器 / 动画 / 视差
   ============================================================ */
(function () {
  'use strict';

  var ICONS = window.GRWZ_ICONS || {};
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function iconSvg(name) {
    var ic = ICONS[name];
    if (!ic) ic = ICONS.link;
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + ic.path + '"/></svg>';
  }

  /** 社交图标：优先用户上传的图片，否则用内置图标 */
  function socialIconMarkup(item) {
    if (item.icon === 'custom' && item.icon_url) {
      return '<img src="' + esc(item.icon_url) + '" alt="" loading="lazy" />';
    }
    return iconSvg(item.icon);
  }

  function initial(name) {
    var s = String(name || '').trim();
    return s ? s.charAt(0).toUpperCase() : '·';
  }

  /* ---------------- 启动 ---------------- */

  fetch('/api/site', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.ok) throw new Error('配置加载失败');
      render(data);
    })
    .catch(function () {
      // 拿不到配置时不至于白屏：显示一个温和的错误
      $('boot').classList.add('hide');
      var box = $('notReady');
      box.hidden = false;
      box.querySelector('h1').textContent = '暂时无法加载';
      box.querySelector('p').textContent = '请稍后刷新页面重试。';
      var ps = box.querySelectorAll('p');
      if (ps[1]) ps[1].hidden = true;
    });

  function render(data) {
    var site = data.site || {};

    if (!data.initialized) {
      $('boot').classList.add('hide');
      $('notReady').hidden = false;
      document.title = '网站还在准备中';
      return;
    }

    applyBackground(site);
    applyAnimations(site);

    var displayName = site.site_name || (site.nickname || '我的主页');
    document.title = displayName;
    var desc = $('metaDesc');
    if (desc) desc.setAttribute('content', site.about_text || displayName);

    renderIdentity(site, displayName);
    renderAbout(site);
    renderTelegram(site);
    renderSocials(data.socials || [], site);
    renderFooter(site);

    $('page').hidden = false;
    $('boot').classList.add('hide');

    setupReveal(site);
    if (site.animations && site.animations.background) setupParallax();

    renderGitHub(site);
    setupPlayer(data, site);
  }

  /* ---------------- 背景 ---------------- */

  function applyBackground(site) {
    var bg = $('bg');
    if (site.bg_url) {
      bg.style.backgroundImage = 'url("' + site.bg_url.replace(/"/g, '%22') + '")';
    } else {
      // 没上传背景图时用一层渐变兜底，避免纯白页面
      bg.style.backgroundImage = 'linear-gradient(135deg,#e7dfe6 0%,#dfe4ee 50%,#e9e2e6 100%)';
      bg.style.filter = 'blur(0px) brightness(1) saturate(1)';
    }
  }

  /* ---------------- 动画开关 ---------------- */

  function applyAnimations(site) {
    var anim = site.animations || {};
    var page = $('page');

    // 1) 开场高斯模糊淡入
    if (anim.intro) {
      page.classList.add('anim-intro');
    } else {
      page.classList.add('no-anim-intro');
    }

    // 2) 头像悬停
    var wrap = $('avatarWrap');
    if (!anim.avatar) wrap.classList.remove('anim-avatar');

    // 3) 播放器入场
    var player = $('player');
    player.classList.add(anim.player ? 'anim-player' : 'no-anim-player');

    // 4) 滚动入场（在 setupReveal 里处理）
    window.__grwzAnim = anim;
  }

  /* ---------------- 身份区 ---------------- */

  function renderIdentity(site, displayName) {
    $('navName').textContent = displayName;
    $('name').textContent = site.site_name || displayName;

    var username = site.nickname || '';
    var unEl = $('username');
    if (username) { unEl.textContent = username; } else { unEl.hidden = true; }

    var bio = $('bioQuote');
    if (site.about_short) { bio.textContent = site.about_short; bio.hidden = false; }
    // 否则留给 GitHub 简介填充（见 renderGitHub）

    setImage('avatar', 'avatarFallback', site.avatar_url, displayName);
    setImage('navAvatar', 'navAvatarFallback', site.avatar_url, displayName);
  }

  /** 有图就显示图，没有就显示首字母占位块 */
  function setImage(imgId, fallbackId, url, name) {
    var img = $(imgId);
    var fb = $(fallbackId);
    if (url) {
      img.src = url;
      img.alt = name || '';
      img.hidden = false;
      fb.hidden = true;
      img.onerror = function () {
        img.hidden = true;
        fb.hidden = false;
      };
    } else {
      img.hidden = true;
      fb.hidden = false;
      fb.textContent = initial(name);
    }
  }

  function renderAbout(site) {
    var el = $('aboutText');
    var text = site.about_text || '';
    if (text.trim()) {
      el.textContent = text;
    } else {
      $('aboutCard').hidden = true;
    }
  }

  function renderTelegram(site) {
    if (!site.tg_enabled) return;
    var card = $('tgCard');
    card.href = site.tg_url || 'https://t.me/COASCN';
    $('tgTitle').textContent = site.tg_title || '加入我的频道';
    $('tgSub').textContent = site.tg_sub || '加入就是最大的帮助';
    card.hidden = false;
  }

  /* ---------------- 社交链接 ---------------- */

  function renderSocials(socials, site) {
    var nav = $('navSocials');
    var list = $('socialList');
    nav.innerHTML = '';
    list.innerHTML = '';

    if (!socials.length) {
      $('sidebar').querySelector('.social-list').style.display = 'none';
      return;
    }

    socials.forEach(function (item) {
      // 顶栏只放图标
      var a = document.createElement('a');
      a.className = 'icon-btn glass';
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', item.label);
      a.innerHTML = socialIconMarkup(item);
      nav.appendChild(a);

      // 侧栏图标 + 文字
      var b = document.createElement('a');
      b.className = 'social-btn glass';
      b.href = item.url;
      b.target = '_blank';
      b.rel = 'noopener';
      b.innerHTML = socialIconMarkup(item) + '<span>' + esc(item.label) + '</span>';
      list.appendChild(b);
    });
  }

  /* ---------------- 页脚 ---------------- */

  function renderFooter(site) {
    var f = site.footer || {};
    if (!f.text) return;

    var el = $('siteFooter');
    el.style.color = f.color || '#8a8a8e';
    el.style.opacity = typeof f.opacity === 'number' ? f.opacity : 0.55;

    if (f.link) {
      el.innerHTML = '<a href="' + esc(f.link) + '" target="_blank" rel="noopener">' + esc(f.text) + '</a>';
    } else {
      el.textContent = f.text;
    }
    el.hidden = false;
  }

  /* ---------------- 滚动入场 ---------------- */

  function setupReveal(site) {
    var anim = site.animations || {};
    var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    if (!anim.reveal) {
      items.forEach(function (el) { el.classList.add('no-anim', 'in-view'); });
      return;
    }

    // 依次给一点延迟，视觉上更顺
    items.forEach(function (el, i) { el.style.transitionDelay = (0.06 * i) + 's'; });

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- 背景视差（可开关） ---------------- */

  function setupParallax() {
    var bgEl = $('bg');
    if (!bgEl) return;

    var targetY = window.scrollY || 0;
    var currentY = targetY;
    var currentScale = 1.05;
    var isScrolling = false;
    var stopTimer = null;

    window.addEventListener('scroll', function () {
      targetY = window.scrollY || 0;
      isScrolling = true;
      clearTimeout(stopTimer);
      stopTimer = setTimeout(function () { isScrolling = false; }, 220);
    }, { passive: true });

    (function loop() {
      currentY += (targetY * 0.05 - currentY) * 0.07;
      var targetScale = isScrolling ? 1.12 : 1.05;
      currentScale += (targetScale - currentScale) * 0.06;
      bgEl.style.transform = 'scale(' + currentScale.toFixed(4) + ') translateY(' + currentY.toFixed(2) + 'px)';
      requestAnimationFrame(loop);
    })();
  }

  /* ---------------- GitHub ---------------- */

  function starIcon() { return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.6 6.8L12 17.8 5.8 21.1l1.6-6.8-5.2-4.7 6.9-.7L12 2.5z"/></svg>'; }
  function forkIcon() { return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 8v2a3 3 0 0 0 3 3h1v3a2 2 0 1 0 2 0v-3h1a3 3 0 0 0 3-3V8h-2v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V8H7Z"/></svg>'; }

  function renderGitHub(site) {
    var user = (site.github_user || '').trim();
    if (!user) return;

    var grid = $('repoGrid');
    var status = $('repoStatus');
    var bioQuote = $('bioQuote');

    // GitHub 简介作为副标题补充（仅在用户没填"一句话简介"时）
    fetch('https://api.github.com/users/' + encodeURIComponent(user))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (u) {
        if (u.bio && bioQuote.hidden) {
          bioQuote.textContent = u.bio;
          bioQuote.hidden = false;
        }
      })
      .catch(function () { /* 忽略 */ });

    if (site.github_show_chart) {
      var card = $('contribCard');
      var img = $('contribImg');
      img.src = 'https://ghchart.rshah.org/' + encodeURIComponent(user);
      img.alt = user + ' 的 GitHub 贡献图';
      img.onerror = function () {
        img.parentElement.innerHTML = '<p class="projects-status">贡献图加载失败。</p>';
      };
      card.hidden = false;
    }

    if (!site.github_show_repos) return;

    $('projectsCard').hidden = false;

    fetch('https://api.github.com/users/' + encodeURIComponent(user) + '/repos?per_page=100&sort=updated')
      .then(function (r) {
        if (!r.ok) throw new Error('GitHub API error');
        return r.json();
      })
      .then(function (repos) {
        var visible = repos.filter(function (r) { return !r.fork; });
        visible.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
        var list = visible.length ? visible : repos;

        if (!list.length) { status.textContent = '暂时没有可显示的项目。'; return; }
        status.style.display = 'none';

        list.forEach(function (repo, i) {
          var card = document.createElement('a');
          card.className = 'repo-card glass';
          card.href = repo.html_url;
          card.target = '_blank';
          card.rel = 'noopener';
          card.style.opacity = '0';
          card.style.animation = 'riseIn 0.7s cubic-bezier(.22,.61,.36,1) forwards';
          card.style.animationDelay = (0.05 * i) + 's';
          card.innerHTML =
            '<div class="repo-name">' + esc(repo.name) + '</div>' +
            (repo.description ? '<div class="repo-desc">' + esc(repo.description) + '</div>' : '') +
            '<div class="repo-meta">' +
              (repo.language ? '<span><span class="lang-dot"></span>' + esc(repo.language) + '</span>' : '') +
              '<span>' + starIcon() + repo.stargazers_count + '</span>' +
              '<span>' + forkIcon() + repo.forks_count + '</span>' +
            '</div>';
          grid.appendChild(card);
        });
      })
      .catch(function () { status.textContent = '项目加载失败，请稍后刷新重试。'; });
  }

  /* ---------------- 音乐播放器 ---------------- */

  function setupPlayer(data, site) {
    var tracks = data.tracks || [];
    if (!site.music_enabled || !tracks.length) return;

    // 播放顺序：默认顺序 or 随机
    var queue = tracks.slice();
    if (site.music_mode === 'random') shuffle(queue);
    var index = 0;

    var audio = $('audio');
    var player = $('player');
    var playerMain = $('playerMain');
    var toggleBtn = $('playerToggle');
    var chevronBtn = $('playerChevron');
    var iconPlay = $('iconPlay');
    var iconPause = $('iconPause');
    var art = $('playerArt');
    var artFallback = $('playerArtFallback');
    var titleEl = $('playerTitle');
    var hint = $('playerHint');
    var ringFg = $('ringFg');
    var seekBar = $('seekBar');
    var timeCurrent = $('timeCurrent');
    var timeTotal = $('timeTotal');

    var RING_LEN = 131.9;
    var isScrubbing = false;

    function shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
    }

    function formatTime(sec) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60).toString().padStart(2, '0');
      return m + ':' + s;
    }

    function loadTrack(i, autoplay) {
      var t = queue[i];
      if (!t) return;
      audio.src = t.url;
      titleEl.textContent = t.artist ? (t.title + ' · ' + t.artist) : t.title;
      playerMain.setAttribute('aria-label', t.title);

      if (t.cover) {
        art.src = t.cover;
        art.hidden = false;
        artFallback.hidden = true;
        art.onerror = function () { art.hidden = true; artFallback.hidden = false; };
      } else {
        art.hidden = true;
        artFallback.hidden = false;
      }

      ringFg.style.strokeDashoffset = String(RING_LEN);
      seekBar.value = 0;
      seekBar.style.setProperty('--seek-pct', '0%');
      timeCurrent.textContent = '0:00';
      timeTotal.textContent = t.duration ? formatTime(t.duration) : '0:00';

      if (autoplay) play();
    }

    function setPlayingUI(isPlaying) {
      iconPlay.style.display = isPlaying ? 'none' : 'block';
      iconPause.style.display = isPlaying ? 'block' : 'none';
      art.classList.toggle('spin', isPlaying);
      player.classList.toggle('playing', isPlaying);
      hint.textContent = isPlaying ? '点击暂停' : '点击播放';
    }

    function play() {
      var p = audio.play();
      if (p && p.then) {
        p.then(function () { setPlayingUI(true); }).catch(function () {
          setPlayingUI(false);
          armResumeOnGesture();
        });
      }
    }

    /** 浏览器自动播放拦截后，等用户第一次交互再开始 */
    var resumeArmed = false;

    function armResumeOnGesture() {
      if (resumeArmed) return;
      resumeArmed = true;

      // 提示语默认隐藏，避免和 CDN 上的默认状态抢注意力
      hint.textContent = '点击播放';

      var resume = function () {
        audio.play().then(function () { setPlayingUI(true); }).catch(function () {});
        document.removeEventListener('click', resume);
        document.removeEventListener('touchstart', resume);
        document.removeEventListener('keydown', resume);
        resumeArmed = false;
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('touchstart', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    }

    function togglePlay() {
      if (audio.paused) {
        audio.play().then(function () { setPlayingUI(true); }).catch(function () {});
      } else {
        audio.pause();
        setPlayingUI(false);
      }
    }

    function updateProgress() {
      if (isScrubbing) return;
      var dur = audio.duration || 0;
      var pct = dur ? (audio.currentTime / dur) : 0;
      ringFg.style.strokeDashoffset = String(RING_LEN * (1 - pct));
      seekBar.value = pct * 100;
      seekBar.style.setProperty('--seek-pct', (pct * 100) + '%');
      timeCurrent.textContent = formatTime(audio.currentTime);
      timeTotal.textContent = formatTime(dur);
    }

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);

    // 播放结束 → 下一首；单首循环播同一首
    audio.addEventListener('ended', function () {
      if (queue.length === 1) { audio.currentTime = 0; play(); return; }
      index = (index + 1) % queue.length;
      loadTrack(index, true);
    });

    seekBar.addEventListener('input', function () {
      isScrubbing = true;
      var dur = audio.duration || 0;
      var pct = seekBar.value / 100;
      seekBar.style.setProperty('--seek-pct', seekBar.value + '%');
      ringFg.style.strokeDashoffset = String(RING_LEN * (1 - pct));
      timeCurrent.textContent = formatTime(dur * pct);
    });
    seekBar.addEventListener('change', function () {
      var dur = audio.duration || 0;
      audio.currentTime = (seekBar.value / 100) * dur;
      isScrubbing = false;
    });

    toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePlay(); });
    playerMain.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.player-chevron')) return;
      togglePlay();
    });
    chevronBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      player.classList.toggle('expanded');
    });

    loadTrack(0, false);
    player.hidden = false;

    // 首屏尝试自动播放
    setTimeout(function () {
      audio.play().then(function () { setPlayingUI(true); }).catch(function () {
        setPlayingUI(false);
        armResumeOnGesture();
      });
    }, 400);
  }

  /* iOS Safari 需要有一个 touch 监听才会触发 :active */
  document.addEventListener('touchstart', function () {}, { passive: true });
})();
