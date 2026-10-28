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

  function renderPost(p) {
    document.title = p.title + ' · 文章';
    var md = $('metaDesc');
    if (md) md.setAttribute('content', String(p.content || '').slice(0, 120));

    $('navName').textContent = p.title;
    $('navLogo').textContent = (p.title || '文').slice(0, 1);
    $('postTitle').textContent = p.title;
    $('postDate').textContent = fmtDate(p.created_at);

    if (p.cover_url) {
      $('postCover').style.backgroundImage = 'url("' + p.cover_url.replace(/"/g, '%22') + '")';
      $('postCover').hidden = false;
    }

    $('postBody').innerHTML = renderMarkdown(p.content);

    if (p.file_url && p.file_name) {
      $('postFile').hidden = false;
      $('pfName').textContent = p.file_name;
      $('pfSize').textContent = fmtSize(p.file_size);
      if (p.file_icon_url) {
        $('pfIcon').innerHTML = '<img src="' + esc(p.file_icon_url) + '" alt="" />';
      }
      pendingDownloadUrl = p.file_url;
    }

    updateLikeUI(p.likes, p.liked);

    $('page').hidden = false;
    $('boot').classList.add('hide');
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
