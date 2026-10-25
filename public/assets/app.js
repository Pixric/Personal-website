(function () {
  'use strict';

  var ICONS = window.PERSONAL_WEBSITE_ICONS || {};
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeHtml(s) { return esc(s); }

  function iconSvg(name) {
    var ic = ICONS[name] || ICONS.link;
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + ic.path + '"/></svg>';
  }

  function socialIconMarkup(item) {
    if (item.icon === 'custom' && item.icon_url) {
      return '<img src="' + esc(item.icon_url) + '" alt="" loading="lazy" />';
    }
    return iconSvg(item.icon);
  }

  function initial(name) {
    var s = String(name || '').trim();
    return s ? s.charAt(0).toUpperCase() : '•';
  }

  fetch('/api/site', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.ok) throw new Error('配置加载失败');
      render(data);
    })
    .catch(function () {
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
    applyFont(site);
    applyAnimations(site);

    var displayName = site.site_name || '我的主页';
    document.title = displayName;
    var desc = $('metaDesc');
    if (desc) desc.setAttribute('content', site.about_text || displayName);

    renderIdentity(site, displayName);
    renderAbout(site);
    renderSocials(data.socials || []);
    renderFooter(site);

    $('page').hidden = false;
    $('boot').classList.add('hide');

    setupReveal(site);
    if (site.animations && site.animations.background) setupParallax();

    renderGitHub(site);
    setupPlayer(data, site);
  }

  function applyBackground(site) {
    var bg = $('bg');
    var src = site.bg_url || site.bg_remote_url || '';
    if (src) {
      bg.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
      bg.style.backgroundPosition = site.bg_position || 'center center';
      var mobile = window.matchMedia('(max-width: 768px)').matches;
      bg.style.backgroundSize = mobile
        ? (site.bg_size_mobile || 'cover')
        : (site.bg_size_desktop || 'cover');
    } else {
      bg.style.backgroundImage = 'radial-gradient(1000px 600px at 15% -10%, #f3f3f4 0%, transparent 60%), radial-gradient(900px 500px at 95% 5%, #ededef 0%, transparent 55%), linear-gradient(180deg,#fafafa 0%,#f2f2f3 100%)';
      bg.style.filter = 'none';
    }
  }

  function applyFont(site) {
    if (!site.font_url || !site.font_family) return;
    var scope = String(site.font_scope || '').split(',');
    if (scope.indexOf('front') < 0) return;
    var style = document.createElement('style');
    style.textContent =
      '@font-face{font-family:"' + site.font_family + '";src:url("' + site.font_url + '");font-display:swap;}' +
      'body,button,input,textarea,select{font-family:"' + site.font_family + '",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif !important;}';
    document.head.appendChild(style);
  }

  function applyAnimations(site) {
    var anim = site.animations || {};

    if (anim.intro) document.body.classList.add('intro-anim');

    if (!anim.avatar) $('avatarWrap').classList.remove('anim-avatar');

    $('player').classList.add(anim.player ? 'anim-player' : 'no-anim-player');
  }

  function renderIdentity(site, displayName) {
    $('navName').textContent = displayName;
    $('name').textContent = site.site_name || displayName;

    var unEl = $('username');
    unEl.textContent = (site.nickname || '').trim() || '未设置';
    unEl.hidden = false;

    setImage('avatar', 'avatarFallback', site.avatar_url, displayName);
    setImage('navAvatar', 'navAvatarFallback', site.avatar_url, displayName);
  }

  function setImage(imgId, fallbackId, url, name) {
    var img = $(imgId);
    var fb = $(fallbackId);
    if (url) {
      img.src = url;
      img.alt = name || '';
      img.hidden = false;
      fb.hidden = true;
      img.onerror = function () { img.hidden = true; fb.hidden = false; };
    } else {
      img.hidden = true;
      fb.hidden = false;
      fb.textContent = initial(name);
    }
  }

  function renderAbout(site) {
    var text = site.about_text || '';
    $('aboutText').textContent = text.trim() || '未设置';
  }

  function renderSocials(socials) {
    var nav = $('navSocials');
    var list = $('socialList');
    nav.innerHTML = '';
    list.innerHTML = '';

    if (!socials.length) {
      list.style.display = 'none';
      return;
    }

    socials.forEach(function (item) {
      var isMail = /^mailto:/i.test(item.url);
      var isApp = isMail || /^(tel|sms):/i.test(item.url);

      var a = document.createElement('a');
      a.className = 'icon-btn';
      a.href = item.url;
      if (!isApp) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.setAttribute('aria-label', item.label);
      a.title = item.label;
      a.innerHTML = socialIconMarkup(item);
      nav.appendChild(a);

      var b = document.createElement('a');
      b.className = 'social-btn';
      b.href = item.url;
      if (!isApp) {
        b.target = '_blank';
        b.rel = 'noopener';
      }
      b.innerHTML = socialIconMarkup(item) + '<span>' + esc(item.label) + '</span>';
      list.appendChild(b);
    });
  }

  function renderFooter(site) {
    var f = site.footer || {};
    if (!f.text) return;

    var el = $('siteFooter');
    el.style.color = f.color || '#8b8b8b';
    el.style.opacity = typeof f.opacity === 'number' ? f.opacity : 0.55;

    if (f.link) {
      el.innerHTML = '<a href="' + esc(f.link) + '" target="_blank" rel="noopener">' + esc(f.text) + '</a>';
    } else {
      el.textContent = f.text;
    }
    el.hidden = false;
  }

  function setupReveal(site) {
    var anim = site.animations || {};
    var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    if (!anim.reveal) {
      items.forEach(function (el) { el.classList.add('no-anim', 'in-view'); });
      return;
    }

    items.forEach(function (el, i) { el.style.transitionDelay = (0.05 * i) + 's'; });

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
    }, { threshold: 0.1 });

    items.forEach(function (el) { io.observe(el); });
  }

  function setupParallax() {
    var bgEl = $('bg');
    if (!bgEl) return;

    var img = bgEl.style.backgroundImage;
    if (!img || img === 'none') return;

    var inner = document.createElement('div');
    inner.style.cssText =
      'position:absolute;top:-8%;left:-6%;width:112%;height:116%;' +
      'background-image:' + img + ';' +
      'background-size:cover;background-position:center center;' +
      'background-repeat:no-repeat;transform:translateY(0);will-change:transform;';
    bgEl.appendChild(inner);

    var targetY = window.scrollY || 0;
    var currentY = targetY;
    var stopTimer = null;

    window.addEventListener('scroll', function () {
      targetY = window.scrollY || 0;
      clearTimeout(stopTimer);
      stopTimer = setTimeout(function () {}, 200);
    }, { passive: true });

    (function loop() {
      currentY += (targetY * 0.04 - currentY) * 0.07;
      inner.style.transform = 'translateY(' + currentY.toFixed(2) + 'px)';
      requestAnimationFrame(loop);
    })();
  }

  function starIcon() { return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.6 6.8L12 17.8 5.8 21.1l1.6-6.8-5.2-4.7 6.9-.7L12 2.5z"/></svg>'; }
  function forkIcon() { return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM7 8v2a3 3 0 0 0 3 3h1v3a2 2 0 1 0 2 0v-3h1a3 3 0 0 0 3-3V8h-2v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V8H7Z"/></svg>'; }

  function renderGitHub(site) {
    var user = (site.github_user || '').trim();
    if (!user) return;

    var grid = $('repoGrid');
    var status = $('repoStatus');
    var bioQuote = $('bioQuote');

    fetch('https://api.github.com/users/' + encodeURIComponent(user))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (u) {
        if (u.bio && bioQuote.hidden) {
          bioQuote.textContent = u.bio;
          bioQuote.hidden = false;
        }
      })
      .catch(function () {});

    if (site.github_show_chart) {
      var card = $('contribCard');
      var img = $('contribImg');
      img.src = 'https://ghchart.rshah.org/2ea44f/' + encodeURIComponent(user);
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
          card.className = 'repo-card';
          card.href = repo.html_url;
          card.target = '_blank';
          card.rel = 'noopener';
          card.style.opacity = '0';
          card.style.animation = 'riseIn .5s ease forwards';
          card.style.animationDelay = (0.04 * i) + 's';
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

  function setupPlayer(data, site) {
    var tracks = data.tracks || [];
    if (!site.music_enabled || !tracks.length) return;

    var queue = tracks.slice();
    if (site.music_mode === 'random') shuffle(queue);
    var index = 0;

    var audio = $('audio');
    var player = $('player');
    var playerMain = $('playerMain');
    var toggleBtn = $('playerToggle');
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
    var prevBtn = $('playerPrev');
    var nextBtn = $('playerNext');
    var listBtn = $('playerListBtn');
    var playerList = $('playerList');
    var listItems = $('plItems');
    var searchEl = $('plSearch');

    var RING_LEN = 131.9;
    var isScrubbing = false;

    function renderList(keyword) {
      var kw = String(keyword || '').trim().toLowerCase();
      var all = queue;
      var shown = kw
        ? all.filter(function (t) {
            return String(t.title || '').toLowerCase().indexOf(kw) >= 0 ||
              String(t.artist || '').toLowerCase().indexOf(kw) >= 0;
          })
        : all;

      listItems.innerHTML = '';
      if (!shown.length) {
        listItems.innerHTML = '<div class="pl-empty">没有找到匹配的歌曲</div>';
        return;
      }

      shown.forEach(function (t) {
        var realIndex = queue.indexOf(t);
        var item = document.createElement('div');
        item.className = 'pl-item' + (realIndex === index ? ' active' : '');
        item.innerHTML =
          '<div class="pl-cover"' + (t.cover ? ' style="background-image:url(\'' + t.cover + '\')"' : '') + '>' +
            (t.cover ? '' : '♪') +
          '</div>' +
          '<div class="pl-info">' +
            '<span class="pl-title">' + escapeHtml(t.title) + '</span>' +
            (t.artist ? '<span class="pl-artist">' + escapeHtml(t.artist) + '</span>' : '') +
          '</div>' +
          (realIndex === index
            ? '<span class="pl-playing"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h3v16H7zM14 8h3v12h-3z"/></svg></span>'
            : '');
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          index = realIndex;
          loadTrack(index, true);
          renderList(searchEl.value);
        });
        listItems.appendChild(item);
      });
    }

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
      titleEl.textContent = t.title;
      titleEl.title = t.artist ? (t.title + ' · ' + t.artist) : t.title;
      hint.textContent = t.artist || '';

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
      if (!isPlaying && !audio.paused) return;
      var t = queue[index];
      if (t) hint.textContent = isPlaying ? (t.artist || '正在播放') : (t.artist || '点击播放');
    }

    function play() {
      var p = audio.play();
      if (p && p.then) {
        p.then(function () { setPlayingUI(true); }).catch(function () {
          setPlayingUI(false);
          armResume();
        });
      }
    }

    var resumeArmed = false;
    function armResume() {
      if (resumeArmed) return;
      resumeArmed = true;
      var t = queue[index];
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

    prevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (queue.length < 2) { audio.currentTime = 0; return; }
      index = (index - 1 + queue.length) % queue.length;
      loadTrack(index, true);
    });

    nextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (queue.length < 2) { audio.currentTime = 0; return; }
      index = (index + 1) % queue.length;
      loadTrack(index, true);
    });

    listBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = playerList.hidden;
      playerList.hidden = !open;
      listBtn.classList.toggle('active', open);
      if (open) {
        renderList();
        searchEl.value = '';
        setTimeout(function () { searchEl.focus(); }, 50);
      }
    });

    searchEl.addEventListener('input', function (e) {
      e.stopPropagation();
      renderList(searchEl.value);
    });
    searchEl.addEventListener('click', function (e) { e.stopPropagation(); });

    playerMain.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      togglePlay();
    });

    loadTrack(0, false);
    player.hidden = false;
    renderList();

    setTimeout(function () {
      audio.play().then(function () { setPlayingUI(true); }).catch(function () {
        setPlayingUI(false);
        armResume();
      });
    }, 350);
  }

  document.addEventListener('touchstart', function () {}, { passive: true });
})();