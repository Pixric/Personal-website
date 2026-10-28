(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + ' 年 ' + m + ' 月 ' + day + ' 日';
  }

  function applyBackground(site) {
    var bg = $('bg');
    if (!bg) return;

    var src = '';
    if (site.bg_api_enabled) {
      src = site.bg_api_preset || 'https://api.yppp.net/api';
      src += (src.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now();
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
    } else {
      bg.style.backgroundImage = 'radial-gradient(1000px 600px at 15% -10%, #f3f3f4 0%, transparent 60%), radial-gradient(900px 500px at 95% 5%, #ededef 0%, transparent 55%), linear-gradient(180deg,#fafafa 0%,#f2f2f3 100%)';
      bg.style.filter = 'none';
    }
  }

  function applyTheme(site) {
    var dark = !!site.dark_mode;
    document.documentElement.classList.toggle('dark', dark);
    document.body.classList.toggle('dark', dark);

    var round = Number(site.ui_round || 0);
    if (isFinite(round) && round > 0) {
      var k = round / 100;
      var root = document.documentElement;
      root.style.setProperty('--radius', Math.round(12 + 20 * k) + 'px');
      root.style.setProperty('--radius-lg', Math.round(16 + 26 * k) + 'px');
      root.style.setProperty('--radius-sm', Math.round(8 + 16 * k) + 'px');
      root.classList.add('ui-round');
    } else {
      document.documentElement.classList.remove('ui-round');
    }

    var old = document.getElementById('bgDimLayer');
    if (old) old.remove();

    var dim = Number(site.dark_bg_dim || 0);
    if (dark && dim > 0) {
      var layer = document.createElement('div');
      layer.id = 'bgDimLayer';
      layer.style.cssText =
        'position:fixed;inset:0;z-index:1;pointer-events:none;' +
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
      'body,button,input,textarea,select{font-family:"' + site.font_family + '",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif !important;}';
    document.head.appendChild(style);
  }

  function setupParallax(site) {
    var bgEl = $('bg');
    if (!bgEl) return;

    var anim = site.animations || {};
    if (!anim.background) return;

    var strength = Number(anim.bg_strength);
    if (!isFinite(strength) || strength <= 0) strength = 1;

    var img = bgEl.style.backgroundImage;
    if (!img || img === 'none') return;

    var pos = site.bg_position || 'center center';
    var sizeDesktop = site.bg_size_desktop || 'cover';
    var sizeMobile = site.bg_size_mobile || 'cover';

    bgEl.style.backgroundImage = 'none';
    bgEl.style.filter = 'none';

    var inner = document.createElement('div');
    inner.style.cssText =
      'position:absolute;top:0;left:0;right:0;bottom:0;' +
      'background-image:' + img + ';' +
      'background-position:' + pos + ';' +
      'background-repeat:no-repeat;' +
      'background-size:' + (window.matchMedia('(max-width: 768px)').matches ? sizeMobile : sizeDesktop) + ';' +
      'transform:translate3d(0,0,0);will-change:transform;';
    bgEl.appendChild(inner);

    var targetShift = 0;
    var currentShift = 0;
    var targetScale = 1;
    var currentScale = 1;

    function compute() {
      var maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var progress = Math.min(1, Math.max(0, (window.scrollY || 0) / maxScroll));
      targetShift = progress * 40 * strength;
      targetScale = 1 + 0.06 * strength * progress;
    }

    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute, { passive: true });

    (function loop() {
      currentShift += (targetShift - currentShift) * 0.08;
      currentScale += (targetScale - currentScale) * 0.08;
      inner.style.transform =
        'translate3d(0,' + currentShift.toFixed(2) + 'px,0) scale(' + currentScale.toFixed(4) + ')';
      requestAnimationFrame(loop);
    })();
  }

  function applyAnimations(site) {
    var anim = site.animations || {};

    if (anim.intro) {
      var dur = Number(anim.intro_duration);
      if (!isFinite(dur) || dur <= 0) dur = 1;
      document.documentElement.style.setProperty('--intro-dur', dur + 's');
      document.body.classList.add('intro-anim');
    }

    var dist = Number(anim.reveal_distance);
    if (!isFinite(dist)) dist = 18;
    document.documentElement.style.setProperty('--reveal-dist', dist + 'px');

    var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!anim.reveal) {
      items.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    setTimeout(function () {
      items.forEach(function (el) { el.classList.add('in-view'); });
    }, 80);
  }

  function renderMarkdown(text) {
    var src = String(text || '');
    var blocks = [];

    src = src.replace(/```([\s\S]*?)```/g, function (m, code) {
      blocks.push('<pre><code>' + esc(code.replace(/^\n/, '')) + '</code></pre>');
      return '\u0000BLOCK' + (blocks.length - 1) + '\u0000';
    });

    var lines = src.split('\n');
    var out = [];
    var inList = false;

    function closeList() {
      if (inList) { out.push('</ul>'); inList = false; }
    }

    function inline(s) {
      var t = esc(s);
      t = t.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, function (m, alt, url) {
        return '<img src="' + url + '" alt="' + alt + '" loading="lazy" />';
      });
      t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, function (m, label, url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      });
      t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
      return t;
    }

    lines.forEach(function (line) {
      var t = line.trim();

      if (!t) { closeList(); return; }

      if (/^\u0000BLOCK\d+\u0000$/.test(t)) { closeList(); out.push(t); return; }

      if (/^###\s+/.test(t)) { closeList(); out.push('<h3>' + inline(t.replace(/^###\s+/, '')) + '</h3>'); return; }
      if (/^##\s+/.test(t)) { closeList(); out.push('<h2>' + inline(t.replace(/^##\s+/, '')) + '</h2>'); return; }
      if (/^#\s+/.test(t)) { closeList(); out.push('<h2>' + inline(t.replace(/^#\s+/, '')) + '</h2>'); return; }

      if (/^>\s?/.test(t)) {
        closeList();
        out.push('<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>');
        return;
      }

      if (/^[-*]\s+/.test(t)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>');
        return;
      }

      if (/^\d+\.\s+/.test(t)) {
        closeList();
        out.push('<p>' + inline(t) + '</p>');
        return;
      }

      closeList();
      out.push('<p>' + inline(t) + '</p>');
    });

    closeList();

    var html = out.join('\n');
    html = html.replace(/\u0000BLOCK(\d+)\u0000/g, function (m, i) { return blocks[Number(i)] || ''; });

    return html;
  }

  function getSlugFromPath() {
    var path = location.pathname;
    try { path = decodeURIComponent(path); } catch (e) {}

    var m = /^\/(?:posts?|帖子)\/([^/?#]+)/.exec(path);
    if (m) return m[1];

    var seg = path.replace(/^\/+|\/+$/g, '');
    if (seg && seg.indexOf('/') < 0) return seg;

    return '';
  }

  var currentPost = null;
  var pendingDownloadUrl = '';

  function loadPost() {
    var slug = getSlugFromPath();
    if (!slug) {
      showNotFound();
      return;
    }

    fetch('/api/posts/' + encodeURIComponent(slug), { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false }; }).then(function (d) {
          if (!r.ok || d.ok === false) throw new Error(d.error || '加载失败');
          return d;
        });
      })
      .then(function (d) {
        currentPost = d.post;
        if (d.site) {
          applyBackground(d.site);
          applyTheme(d.site);
          applyFont(d.site);
          applyAnimations(d.site);
          renderBrand(d.site);
          if (d.site.animations && d.site.animations.background) setupParallax(d.site);
        }
        renderPost(d.post);
      })
      .catch(function () {
        showNotFound();
      });
  }

  function showNotFound() {
    $('boot').classList.add('hide');
    $('notFound').hidden = false;
  }

  function renderBrand(site) {
    var displayName = site.site_name || '我的主页';
    var navName = $('navName');
    var navLogo = $('navLogo');
    if (navName) navName.textContent = displayName;

    if (navLogo) {
      if (site.avatar_url) {
        navLogo.style.backgroundImage = 'url("' + site.avatar_url.replace(/"/g, '%22') + '")';
        navLogo.style.backgroundSize = 'cover';
        navLogo.style.backgroundPosition = 'center';
        navLogo.textContent = '';
      } else {
        navLogo.textContent = displayName.slice(0, 1);
      }
    }

    var navHome = $('navHome');
    if (navHome) navHome.setAttribute('title', displayName);
  }

  function renderPost(p) {
    document.title = p.title + ' · 文章';
    var md = $('metaDesc');
    if (md) md.setAttribute('content', String(p.content || '').slice(0, 120));

    $('postTitle').textContent = p.title;
    $('postDate').textContent = fmtDate(p.created_at);

    if (p.cover_url) {
      $('postCover').style.backgroundImage = 'url("' + p.cover_url.replace(/"/g, '%22') + '")';
      $('postCover').hidden = false;
    }

    $('postBody').innerHTML = renderMarkdown(p.content);

    if (p.file_url && p.file_name) {
      pendingDownloadUrl = p.file_url;

      var isVideo = p.file_kind === 'video';
      if (isVideo) {
        renderVideo(p);
      } else {
        $('postFile').hidden = false;
        $('pfName').textContent = p.file_name;
        $('pfSize').textContent = fmtSize(p.file_size);
        if (p.file_icon_url) {
          $('pfIcon').innerHTML = '<img src="' + esc(p.file_icon_url) + '" alt="" />';
        }
      }
    }

    updateLikeUI(p.likes, p.liked);

    $('page').hidden = false;
    $('boot').classList.add('hide');
  }

  function renderVideo(p) {
    var box = $('postVideo');
    var video = $('videoPlayer');
    box.hidden = false;

    $('pvName').textContent = p.file_name;
    $('pvSize').textContent = fmtSize(p.file_size);

    if (p.file_mime) video.setAttribute('type', p.file_mime);
    video.src = p.file_url;
    video.setAttribute('controlsList', 'nodownload');

    video.addEventListener('error', function () {
      $('pvName').textContent = p.file_name + '（浏览器无法播放该格式，请下载后观看）';
      video.hidden = true;
    }, { once: true });
  }

  function updateLikeUI(likes, liked) {
    $('likeCount').textContent = String(likes || 0);
    $('likeBtn').classList.toggle('liked', !!liked);
    $('likeBtn').setAttribute('aria-pressed', liked ? 'true' : 'false');
  }

  $('likeBtn').addEventListener('click', function () {
    if (!currentPost) return;
    var btn = $('likeBtn');
    btn.disabled = true;
    fetch('/api/posts/' + currentPost.id + '/like', {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '操作失败');
        updateLikeUI(d.likes, d.liked);
      })
      .catch(function (e) {
        alert(e.message);
      })
      .finally(function () { btn.disabled = false; });
  });

  var captchaPassed = false;

  function openCaptcha(url) {
    if (captchaPassed) {
      triggerDownload(url);
      return;
    }
    pendingDownloadUrl = url;
    resetCaptcha();
    $('captchaMask').hidden = false;
  }

  function triggerDownload(url) {
    var a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  var captchaState = { dragging: false, startX: 0, moved: 0, max: 0 };

  function resetCaptcha() {
    captchaState.moved = 0;
    $('captchaThumb').style.transform = 'translateX(0)';
    $('captchaThumb').classList.remove('done');
    $('captchaFill').style.width = '0';
    $('captchaLabel').textContent = '按住滑块拖动';
    $('captchaLabel').style.opacity = '1';
  }

  function captchaMax() {
    var track = $('captchaTrack');
    var thumb = $('captchaThumb');
    return track.clientWidth - thumb.offsetWidth - 4;
  }

  function onCaptchaMove(clientX) {
    if (!captchaState.dragging) return;
    var dx = clientX - captchaState.startX;
    var max = captchaState.max;
    var v = Math.max(0, Math.min(max, dx));
    captchaState.moved = v;
    $('captchaThumb').style.transform = 'translateX(' + v + 'px)';
    $('captchaFill').style.width = (v + 48) + 'px';
    $('captchaLabel').style.opacity = String(Math.max(0, 1 - v / 40));
  }

  function onCaptchaEnd() {
    if (!captchaState.dragging) return;
    captchaState.dragging = false;
    var max = captchaState.max;
    if (captchaState.moved >= max - 4) {
      $('captchaThumb').classList.add('done');
      $('captchaThumb').style.transform = 'translateX(' + max + 'px)';
      $('captchaFill').style.width = '100%';
      $('captchaLabel').textContent = '验证通过';
      $('captchaLabel').style.opacity = '1';
      captchaPassed = true;
      setTimeout(function () {
        $('captchaMask').hidden = true;
        triggerDownload(pendingDownloadUrl);
      }, 420);
    } else {
      resetCaptcha();
    }
  }

  (function bindCaptcha() {
    var thumb = $('captchaThumb');

    thumb.addEventListener('mousedown', function (e) {
      e.preventDefault();
      captchaState.dragging = true;
      captchaState.startX = e.clientX - captchaState.moved;
      captchaState.max = captchaMax();
    });

    document.addEventListener('mousemove', function (e) {
      if (captchaState.dragging) onCaptchaMove(e.clientX);
    });

    document.addEventListener('mouseup', function () {
      if (captchaState.dragging) onCaptchaEnd();
    });

    thumb.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      captchaState.dragging = true;
      captchaState.startX = t.clientX - captchaState.moved;
      captchaState.max = captchaMax();
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!captchaState.dragging) return;
      onCaptchaMove(e.touches[0].clientX);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', function () {
      if (captchaState.dragging) onCaptchaEnd();
    });

    $('captchaCancel').addEventListener('click', function () {
      $('captchaMask').hidden = true;
      resetCaptcha();
    });
  })();

  $('pfDownload').addEventListener('click', function () {
    if (pendingDownloadUrl) openCaptcha(pendingDownloadUrl);
  });

  loadPost();
})();
