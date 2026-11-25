(function () {
  "use strict";

  var posts = [];
  var memoryToken = "";
  var warmed = {};
  var selecting = false;
  var picked = {};
  var viewerId = "";
  var uploading = false;
  var allowLeave = false;
  var activeXhr = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function previewSrc(src, width) {
    var value = String(src || "");
    if (value.indexOf("/api/media/drive/") !== 0 || /[?&]w=\d+/.test(value)) return value;
    return value + (value.indexOf("?") === -1 ? "?" : "&") + "w=" + (width || 720);
  }

  function guestToken() {
    var key = "wedding-guest-album";
    try {
      var existing = localStorage.getItem(key);
      if (existing && /^[a-zA-Z0-9_-]{16,80}$/.test(existing)) return existing;
      var bytes = new Uint8Array(18);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else bytes.forEach(function (_, i) { bytes[i] = Math.floor(Math.random() * 256); });
      var token = Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      localStorage.setItem(key, token);
      return token;
    } catch (err) {
      if (!memoryToken) memoryToken = "guest" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      return memoryToken;
    }
  }

  function albumHeaders(extra) {
    var headers = { "X-Guest-Token": guestToken() };
    if (extra) Object.keys(extra).forEach(function (key) { headers[key] = extra[key]; });
    return headers;
  }

  function setStatus(message, kind) {
    var status = document.getElementById("guestAlbumStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-ok", kind === "ok");
  }

  function postsForActive() {
    return posts;
  }

  function tileShape(index) {
    var spot = index % 8;
    if (spot === 0 || spot === 5) return " is-tall";
    if (spot === 2 || spot === 6) return " is-wide";
    return "";
  }

  function syncDownloadBar(total) {
    var bar = document.getElementById("guestAlbumToolbar");
    var selectBtn = document.getElementById("guestAlbumSelect");
    var selectedBtn = document.getElementById("guestAlbumDownloadSelected");
    var allBtn = document.getElementById("guestAlbumDownloadAll");
    var count = Object.keys(picked).length;
    if (bar) bar.hidden = total < 1;
    if (selectBtn) selectBtn.textContent = selecting ? "Done" : "Select";
    if (selectedBtn) {
      selectedBtn.hidden = !selecting;
      selectedBtn.textContent = count ? "Download selected (" + count + ")" : "Download selected";
      selectedBtn.disabled = !count;
    }
    if (allBtn) allBtn.hidden = total < 1;
  }

  function warmPost(post) {
    var src = previewSrc(post.src, post.type === "video" ? 900 : 720);
    if (!src || warmed[src]) return;
    warmed[src] = true;
    var img = new Image();
    img.decoding = "async";
    img.src = src;
  }

  var albumLine = {
    x: 0,
    vx: 0,
    dragging: false,
    pointerId: null,
    startX: 0,
    lastX: 0,
    lastT: 0,
    dragDistance: 0,
    dragArmed: false,
    suppressClick: false,
    auto: true,
    autoDir: -1,
    raf: 0,
    reduce: false,
    started: false
  };

  function albumLineBounds() {
    var strip = document.getElementById("guestAlbumStrip");
    var grid = document.getElementById("guestAlbumGrid");
    if (!strip || !grid || grid.classList.contains("is-empty")) return { min: 0, max: 0 };
    var extra = Math.max(0, grid.scrollWidth - strip.clientWidth);
    return { min: -extra, max: 0 };
  }

  function applyAlbumLine() {
    var grid = document.getElementById("guestAlbumGrid");
    if (!grid || grid.classList.contains("is-empty")) return;
    var bounds = albumLineBounds();
    albumLine.x = Math.max(bounds.min, Math.min(bounds.max, albumLine.x));
    grid.style.transform = "translate3d(" + albumLine.x.toFixed(2) + "px,0,0)";
  }

  function layoutAlbumLine() {
    var strip = document.getElementById("guestAlbumStrip");
    var grid = document.getElementById("guestAlbumGrid");
    if (!strip || !grid) return;
    if (grid.classList.contains("is-empty") || !grid.querySelector(".album-tile")) {
      grid.style.transform = "";
      return;
    }
    var view = window.visualViewport;
    var viewH = (view && view.height) || window.innerHeight || 700;
    var nav = document.getElementById("nav");
    var navH = Math.max(72, nav ? Math.min(96, nav.getBoundingClientRect().height || 72) : 72);
    var available = Math.max(150, viewH - navH - 80);
    var gap = 8;
    strip.style.setProperty("--album-fit", available.toFixed(2) + "px");
    var trial = Math.max(40, available / 4.2);
    strip.style.setProperty("--album-photo", trial.toFixed(2) + "px");
    strip.style.setProperty("--album-tile", (trial * 0.8 + 12).toFixed(2) + "px");
    var sample = grid.querySelector(".album-tile");
    var photoEl = sample && sample.querySelector(".album-tile-open");
    var extra = 52;
    if (sample && photoEl) extra = Math.max(24, sample.offsetHeight - photoEl.offsetHeight);
    var photo = (available - gap * 2 - extra * 3) / 3;
    if (photo < 28) photo = 28;
    var tile = photo * 0.8 + 12;
    strip.style.setProperty("--album-photo", photo.toFixed(2) + "px");
    strip.style.setProperty("--album-tile", tile.toFixed(2) + "px");
    var tilesNow = grid.querySelectorAll(".album-tile");
    var used = 0;
    if (tilesNow.length) {
      var minTop = Infinity;
      var maxBottom = -Infinity;
      Array.prototype.forEach.call(tilesNow, function (el) {
        var box = el.getBoundingClientRect();
        if (box.top < minTop) minTop = box.top;
        if (box.bottom > maxBottom) maxBottom = box.bottom;
      });
      used = maxBottom - minTop;
    }
    if (used > available - 8 && used > 0) {
      photo = Math.max(24, photo * ((available - 8) / used));
      tile = photo * 0.8 + 12;
      strip.style.setProperty("--album-photo", photo.toFixed(2) + "px");
      strip.style.setProperty("--album-tile", tile.toFixed(2) + "px");
    }
    applyAlbumLine();
  }

  function albumLineTick() {
    albumLine.raf = requestAnimationFrame(albumLineTick);
    if (albumLine.reduce || albumLine.dragging) return;
    var viewerOpen = false;
    try { viewerOpen = albumReelOpen(); } catch (err) { viewerOpen = false; }
    if (viewerOpen || selecting) return;
    if (Math.abs(albumLine.vx) > 0.05) {
      albumLine.x += albumLine.vx;
      albumLine.vx *= 0.94;
    } else {
      albumLine.vx = 0;
      var bounds = albumLineBounds();
      if (bounds.min < -8 && albumLine.auto) {
        albumLine.x += albumLine.autoDir * 0.1;
        if (albumLine.x <= bounds.min) {
          albumLine.x = bounds.min;
          albumLine.autoDir = 1;
        } else if (albumLine.x >= bounds.max) {
          albumLine.x = bounds.max;
          albumLine.autoDir = -1;
        }
      }
    }
    applyAlbumLine();
  }

  function startAlbumLine() {
    if (albumLine.started) return;
    var strip = document.getElementById("guestAlbumStrip");
    if (!strip) return;
    albumLine.started = true;
    albumLine.reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    albumLine.auto = !albumLine.reduce;

    function endDrag(event) {
      if (!albumLine.dragging) return;
      if (event && albumLine.pointerId != null && event.pointerId !== albumLine.pointerId) return;
      if (albumLine.dragArmed) albumLine.suppressClick = true;
      albumLine.dragging = false;
      albumLine.pointerId = null;
      strip.classList.remove("is-dragging");
      if (!albumLine.reduce) albumLine.auto = true;
    }

    strip.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest(".album-heart, .album-laugh, .album-save, .album-pick, input, label")) return;
      albumLine.dragging = true;
      albumLine.pointerId = event.pointerId;
      albumLine.startX = event.clientX;
      albumLine.lastX = event.clientX;
      albumLine.lastT = performance.now();
      albumLine.dragDistance = 0;
      albumLine.dragArmed = false;
      albumLine.suppressClick = false;
      albumLine.vx = 0;
      albumLine.auto = false;
    });

    window.addEventListener("pointermove", function (event) {
      if (!albumLine.dragging || event.pointerId !== albumLine.pointerId) return;
      var now = performance.now();
      var dx = event.clientX - albumLine.lastX;
      var dt = Math.max(8, now - albumLine.lastT);
      albumLine.dragDistance = Math.max(albumLine.dragDistance, Math.abs(event.clientX - albumLine.startX));
      if (!albumLine.dragArmed) {
        if (albumLine.dragDistance < 8) {
          albumLine.lastX = event.clientX;
          albumLine.lastT = now;
          return;
        }
        albumLine.dragArmed = true;
        strip.classList.add("is-dragging");
      }
      event.preventDefault();
      albumLine.x += dx;
      albumLine.vx = dx / dt * 16;
      albumLine.lastX = event.clientX;
      albumLine.lastT = now;
      applyAlbumLine();
    }, { passive: false });

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", layoutAlbumLine);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", layoutAlbumLine);
    }
    if (window.ResizeObserver) new ResizeObserver(layoutAlbumLine).observe(strip);
    albumLine.raf = requestAnimationFrame(albumLineTick);
  }

  function renderGrid() {
    var grid = document.getElementById("guestAlbumGrid");
    if (!grid) return;
    var visible = postsForActive();
    grid.classList.toggle("is-selecting", selecting);
    grid.classList.toggle("is-empty", !visible.length);
    if (!visible.length) {
      grid.innerHTML = '<p class="album-empty">Nothing in the album yet. Share a photo or video from the day.</p>';
      syncDownloadBar(0);
      layoutAlbumLine();
      return;
    }
    grid.innerHTML = visible.map(function (post, index) {
      warmPost(post);
      var shape = tileShape(index);
      var thumb = previewSrc(post.src, shape.indexOf("is-tall") !== -1 ? 900 : 640);
      var media = '<img src="' + escapeHtml(thumb) + '" alt="' + escapeHtml(post.caption || "Guest photo") + '" loading="eager" decoding="async" />' +
        (post.type === "video" ? '<span class="album-play">Film</span>' : "");
      var note = post.caption ? '<p class="album-polaroid-note">' + escapeHtml(post.caption) + "</p>" : "";
      return (
        '<article class="album-tile' + shape + '">' +
          '<button type="button" class="album-tile-open" data-open="' + escapeHtml(post.id) + '" aria-label="View moment">' +
            media +
          "</button>" +
          note +
          '<label class="album-pick"><input type="checkbox" data-pick="' + escapeHtml(post.id) + '"' + (picked[post.id] ? " checked" : "") + ' aria-label="Select this moment" /></label>' +
          '<button type="button" class="album-save" data-save="' + escapeHtml(post.id) + '" aria-label="Download this file">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "</button>" +
          '<div class="album-reacts">' +
            '<button type="button" class="album-heart' + (post.liked ? " is-on" : "") + '" data-heart="' + escapeHtml(post.id) + '" aria-pressed="' + (post.liked ? "true" : "false") + '" aria-label="Heart">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" stroke-width="1.6"/></svg>' +
              "<span>" + Number(post.heartCount || 0) + "</span>" +
            "</button>" +
            '<button type="button" class="album-laugh' + (post.laughed ? " is-on" : "") + '" data-laugh="' + escapeHtml(post.id) + '" aria-pressed="' + (post.laughed ? "true" : "false") + '" aria-label="Haha">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-width="1.6"/><path d="M8.6 13.2c.7 1.5 2 2.3 3.4 2.3s2.7-.8 3.4-2.3" stroke-width="1.6" stroke-linecap="round"/><circle cx="9.2" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="14.8" cy="10" r=".8" fill="currentColor" stroke="none"/></svg>' +
              "<span>" + Number(post.laughCount || 0) + "</span>" +
            "</button>" +
          "</div>" +
        "</article>"
      );
    }).join("");
    syncDownloadBar(visible.length);
    layoutAlbumLine();
  }

  function render() {
    renderGrid();
    warmReelWindow(reelIndex || 0);
  }

  function replacePost(next) {
    var found = false;
    posts = posts.map(function (post) {
      if (post.id !== next.id) return post;
      found = true;
      return next;
    });
    if (!found) posts.unshift(next);
    render();
  }

  async function loadAlbum() {
    var grid = document.getElementById("guestAlbumGrid");
    if (grid) grid.innerHTML = '<p class="album-empty">Gathering the album…</p>';
    var response = await fetch("/api/guest-album", { headers: albumHeaders() });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "The album could not be loaded.");
    posts = Array.isArray(data.posts) ? data.posts : [];
    render();
  }

  var reelIndex = 0;
  var reelZoom = 1;
  var reelPanX = 0;
  var reelPanY = 0;
  var reelPointers = new Map();
  var reelGesture = null;
  var reelLastTap = 0;
  var reelTapTimer = 0;
  var reelFrames = {};

  function reelPhotoSrc(post) {
    return previewSrc(post && post.src, 1200);
  }

  function warmUrl(src) {
    if (!src) return null;
    var frame = reelFrames[src];
    if (!frame) {
      frame = new Image();
      frame.decoding = "async";
      frame.src = src;
      reelFrames[src] = frame;
    }
    return frame;
  }

  function frameReady(src) {
    var frame = src && reelFrames[src];
    return !!(frame && frame.complete && frame.naturalWidth);
  }

  function warmReelWindow(index) {
    var list = albumReelList();
    var total = list.length;
    if (!total) return;
    [0, 1, 2, -1].forEach(function (offset) {
      var post = list[(index + offset + total) % total];
      if (!post || post.type === "video") return;
      warmUrl(reelPhotoSrc(post));
      if (post.src) warmUrl(post.src);
    });
  }

  function albumReelList() {
    return postsForActive();
  }

  function albumReelOpen() {
    var viewer = document.getElementById("guestAlbumViewer");
    return !!(viewer && viewer.classList.contains("open"));
  }

  function albumReelMedia() {
    var list = albumReelList();
    var post = list[reelIndex];
    if (post && post.type === "video") return document.getElementById("guestAlbumViewerVideo");
    return document.getElementById("guestAlbumViewerImg");
  }

  function resetAlbumZoom() {
    reelZoom = 1;
    reelPanX = 0;
    reelPanY = 0;
    applyAlbumZoom(true);
  }

  function clampAlbumPan() {
    var media = albumReelMedia();
    if (!media || reelZoom <= 1.01) {
      reelPanX = 0;
      reelPanY = 0;
      return;
    }
    var maxX = (media.clientWidth * (reelZoom - 1)) / 2;
    var maxY = (media.clientHeight * (reelZoom - 1)) / 2;
    reelPanX = Math.max(-maxX, Math.min(maxX, reelPanX));
    reelPanY = Math.max(-maxY, Math.min(maxY, reelPanY));
  }

  function applyAlbumZoom(instant) {
    var img = document.getElementById("guestAlbumViewerImg");
    var video = document.getElementById("guestAlbumViewerVideo");
    var active = albumReelMedia();
    var viewer = document.getElementById("guestAlbumViewer");
    [img, video].forEach(function (el) {
      if (!el) return;
      if (el !== active) {
        el.style.transform = "";
        el.style.transition = "";
        return;
      }
      el.style.transition = instant ? "none" : "transform 0.28s ease";
      el.style.transform = reelZoom <= 1.01
        ? ""
        : "translate3d(" + reelPanX.toFixed(1) + "px," + reelPanY.toFixed(1) + "px,0) scale(" + reelZoom.toFixed(3) + ")";
    });
    if (viewer) viewer.classList.toggle("is-zoomed", reelZoom > 1.01);
    var zoomBtn = document.getElementById("albumReelZoom");
    if (zoomBtn) zoomBtn.setAttribute("aria-pressed", reelZoom > 1.01 ? "true" : "false");
  }

  function setAlbumZoom(next, clientX, clientY) {
    next = Math.max(1, Math.min(4, next));
    var stage = document.getElementById("albumReelStage");
    if (next <= 1.01) {
      resetAlbumZoom();
      return;
    }
    if (stage && clientX != null && reelZoom > 0) {
      var rect = stage.getBoundingClientRect();
      var ox = clientX - (rect.left + rect.width / 2);
      var oy = clientY - (rect.top + rect.height / 2);
      var scale = next / reelZoom;
      reelPanX = ox - (ox - reelPanX) * scale;
      reelPanY = oy - (oy - reelPanY) * scale;
    }
    reelZoom = next;
    clampAlbumPan();
    applyAlbumZoom(false);
  }

  function hideAlbumStill(img) {
    if (!img) return;
    img.hidden = true;
    img.alt = "";
    img.removeAttribute("src");
  }

  function showAlbumStill(img) {
    if (!img) return;
    img.hidden = false;
  }

  function formatReelTime(seconds) {
    var value = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(value / 60);
    var remain = value % 60;
    return minutes + ":" + (remain < 10 ? "0" : "") + remain;
  }

  function paintAlbumProgress(video) {
    var bar = document.getElementById("albumReelBar");
    var fill = document.getElementById("albumReelFill");
    var time = document.getElementById("albumReelTime");
    var duration = video && isFinite(video.duration) ? video.duration : 0;
    var ratio = duration > 0 ? Math.max(0, Math.min(1, video.currentTime / duration)) : 0;
    var percent = (ratio * 100) + "%";
    if (bar) {
      bar.style.setProperty("--reel-progress", percent);
      bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
      bar.setAttribute("aria-valuetext", formatReelTime(video ? video.currentTime : 0) + " of " + formatReelTime(duration));
    }
    if (fill) fill.style.width = percent;
    if (time) time.textContent = formatReelTime(video ? video.currentTime : 0) + " / " + formatReelTime(duration);
  }

  function setAlbumVideoMode(on) {
    var bar = document.getElementById("albumReelBar");
    var hint = document.querySelector("#guestAlbumViewer .lightbox-swipe-hint");
    if (bar) {
      bar.classList.toggle("is-off", !on);
      bar.setAttribute("aria-hidden", on ? "false" : "true");
      bar.tabIndex = on ? 0 : -1;
    }
    if (hint) {
      hint.textContent = on
        ? "Drag the line to move through the video · swipe for the next"
        : "Swipe for the next · double-tap to zoom";
    }
  }

  function seekAlbumVideo(clientX) {
    var bar = document.getElementById("albumReelBar");
    var video = document.getElementById("guestAlbumViewerVideo");
    if (!bar || !video || video.hidden) return;
    if (!isFinite(video.duration) || video.duration <= 0) return;
    var rect = bar.getBoundingClientRect();
    if (!rect.width) return;
    var ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    var next = ratio * video.duration;
    if (Math.abs(video.currentTime - next) > 0.05) {
      try { video.currentTime = next; } catch (err) {}
    }
    paintAlbumProgress(video);
  }

  function syncAlbumPause() {
    var video = document.getElementById("guestAlbumViewerVideo");
    var button = document.getElementById("albumReelPause");
    var list = albumReelList();
    var post = list[reelIndex];
    var isVideo = !!(post && post.type === "video" && video && !video.hidden);
    if (button) button.hidden = !isVideo;
    if (!isVideo || !button || !video) return;
    var paused = video.paused || video.ended;
    button.textContent = paused ? "Play" : "Pause";
    button.setAttribute("aria-pressed", paused ? "true" : "false");
  }

  function playAlbumMotion(dir) {
    var stage = document.getElementById("albumReelStage");
    if (!stage) return;
    stage.classList.remove("reel-next", "reel-prev");
    void stage.offsetWidth;
    stage.classList.add(dir < 0 ? "reel-prev" : "reel-next");
  }

  function hideAlbumViewerNow(viewer) {
    if (!viewer) return;
    viewer.classList.remove("open", "is-zoomed");
    viewer.hidden = true;
    viewer.style.setProperty("display", "none", "important");
    viewer.style.setProperty("visibility", "hidden", "important");
    viewer.style.setProperty("opacity", "0", "important");
    viewer.style.setProperty("pointer-events", "none", "important");
  }

  function showAlbumViewerNow(viewer) {
    if (!viewer) return;
    viewer.style.removeProperty("display");
    viewer.style.removeProperty("visibility");
    viewer.style.removeProperty("opacity");
    viewer.style.removeProperty("pointer-events");
    viewer.hidden = false;
    viewer.classList.add("open");
  }

  function closeViewer() {
    var viewer = document.getElementById("guestAlbumViewer");
    var video = document.getElementById("guestAlbumViewerVideo");
    var img = document.getElementById("guestAlbumViewerImg");
    if (reelTapTimer) clearTimeout(reelTapTimer);
    reelTapTimer = 0;
    reelPointers.clear();
    reelGesture = null;
    resetAlbumZoom();
    if (video) {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.hidden = true;
    }
    hideAlbumStill(img);
    setAlbumVideoMode(false);
    hideAlbumViewerNow(viewer);
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }

  function navEventTarget(event) {
    var node = event.target;
    if (node && node.nodeType === 3) node = node.parentElement;
    return node && node.closest ? node : null;
  }

  function navAnchor(event) {
    var node = navEventTarget(event);
    return node ? node.closest("#nav a[href]") : null;
  }

  function visibleNavLinkAt(x, y) {
    if (x == null || y == null) return null;
    var links = document.querySelectorAll("#nav a[href]");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var style = window.getComputedStyle(link);
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
      if (parseFloat(style.opacity) < 0.05) continue;
      var rect = link.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return link;
    }
    return null;
  }

  window.WeddingUI = window.WeddingUI || {};
  window.WeddingUI.closeGuestAlbum = closeViewer;

  function showAlbumReel(index, animate) {
    var list = albumReelList();
    var viewer = document.getElementById("guestAlbumViewer");
    var video = document.getElementById("guestAlbumViewerVideo");
    var img = document.getElementById("guestAlbumViewerImg");
    var caption = document.getElementById("guestAlbumViewerCaption");
    var count = document.getElementById("albumReelCount");
    var bar = document.getElementById("albumReelBar");
    var fill = document.getElementById("albumReelFill");
    if (!list.length || !viewer || !video || !img) return;
    reelIndex = ((index % list.length) + list.length) % list.length;
    var post = list[reelIndex];
    viewerId = post.id;
    resetAlbumZoom();
    if (post.type === "video") {
      hideAlbumStill(img);
      video.hidden = false;
      video.removeAttribute("poster");
      video.preload = "auto";
      video.src = post.src;
      var start = video.play();
      if (start && start.catch) start.catch(function () {});
      setAlbumVideoMode(true);
      paintAlbumProgress(video);
    } else {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.hidden = true;
      showAlbumStill(img);
      setAlbumVideoMode(false);
      var full = post.src;
      var preview = reelPhotoSrc(post);
      warmReelWindow(reelIndex);
      img.alt = post.caption || "Guest photo";
      if (frameReady(full)) {
        img.src = full;
      } else {
        img.src = preview;
        if (preview !== full) {
          var shownId = post.id;
          var loader = warmUrl(full);
          var applyFull = function () {
            if (viewerId === shownId && !img.hidden) img.src = full;
          };
          if (loader && loader.complete && loader.naturalWidth) applyFull();
          else if (loader) loader.addEventListener("load", applyFull, { once: true });
        }
      }
      if (bar) bar.style.setProperty("--reel-progress", "0%");
      if (fill) fill.style.width = "0%";
    }
    if (caption) caption.textContent = post.caption || "";
    if (count) count.textContent = (reelIndex + 1) + " of " + list.length;
    var prev = document.getElementById("guestAlbumPrev");
    var next = document.getElementById("guestAlbumNext");
    if (prev) prev.hidden = list.length < 2;
    if (next) next.hidden = list.length < 2;
    showAlbumViewerNow(viewer);
    document.body.style.overflow = "hidden";
    if (animate) playAlbumMotion(animate);
    syncAlbumPause();
  }

  function openViewer(id) {
    var list = albumReelList();
    var index = list.findIndex(function (item) { return item.id === id; });
    if (index < 0) return;
    showAlbumReel(index, false);
  }

  function shiftAlbumReel(dir) {
    if (albumReelList().length < 2) return;
    showAlbumReel(reelIndex + (dir < 0 ? -1 : 1), dir < 0 ? -1 : 1);
  }

  function filenameFromResponse(response, fallback) {
    var header = response.headers.get("content-disposition") || "";
    var match = header.match(/filename="([^"]+)"/);
    return match ? match[1] : fallback;
  }

  async function saveResponse(response, fallback) {
    if (!response.ok) {
      var body = await response.json().catch(function () { return {}; });
      throw new Error(body.error || "The download could not be prepared.");
    }
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filenameFromResponse(response, fallback);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function downloadOne(id, button) {
    if (button) button.disabled = true;
    setStatus("Preparing the download…");
    try {
      var response = await fetch("/api/guest-album/" + encodeURIComponent(id) + "/file", { headers: albumHeaders() });
      await saveResponse(response, "guest-photo");
      setStatus("Download started.", "ok");
    } catch (err) {
      setStatus(err.message || "That file could not be downloaded.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function downloadMany(payload, button, label) {
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing…";
    }
    setStatus("Preparing the download…");
    try {
      var response = await fetch("/api/guest-album/download", {
        method: "POST",
        headers: albumHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload)
      });
      await saveResponse(response, "gio-augiela-guest-album.zip");
      setStatus("Download started.", "ok");
    } catch (err) {
      setStatus(err.message || "The download could not be prepared.", "error");
    } finally {
      if (button) button.disabled = false;
      if (label) button.textContent = label;
      syncDownloadBar(postsForActive().length);
    }
  }

  function bind() {
    var form = document.getElementById("guestAlbumForm");
    var grid = document.getElementById("guestAlbumGrid");
    var file = document.getElementById("guestAlbumFile");
    var viewer = document.getElementById("guestAlbumViewer");
    if (viewer && viewer.parentElement !== document.body) document.body.appendChild(viewer);
    if (!form || !grid) return;

    function selectionLabel(list) {
      if (!list || !list.length) return "Choose photos or videos";
      if (list.length === 1) return list[0].name;
      var photos = 0;
      var videos = 0;
      Array.prototype.forEach.call(list, function (item) {
        if (String(item.type || "").indexOf("video/") === 0) videos += 1;
        else photos += 1;
      });
      var parts = [];
      if (photos) parts.push(photos + (photos === 1 ? " photo" : " photos"));
      if (videos) parts.push(videos + (videos === 1 ? " video" : " videos"));
      return parts.join(" and ") + " selected";
    }

    function shareOne(mediaFile, fields, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        var data = new FormData();
        data.append("name", fields.name);
        data.append("album", fields.album);
        data.append("caption", fields.caption);
        data.append("media", mediaFile);
        xhr.open("POST", "/api/guest-album");
        xhr.setRequestHeader("X-Guest-Token", guestToken());
        activeXhr = xhr;
        xhr.upload.onprogress = function (event) {
          if (event.lengthComputable && onProgress) onProgress(event.loaded, event.total);
        };
        function finish() {
          if (activeXhr === xhr) activeXhr = null;
        }
        xhr.onload = function () {
          finish();
          var body = {};
          try { body = JSON.parse(xhr.responseText || "{}"); } catch (err) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error || "That moment could not be shared."));
        };
        xhr.onerror = function () {
          finish();
          reject(new Error("The upload was interrupted. Try again."));
        };
        xhr.onabort = function () {
          finish();
          reject(new Error("The upload was stopped."));
        };
        xhr.send(data);
      });
    }

    if (file) {
      file.addEventListener("change", function () {
        var label = document.getElementById("guestAlbumFileLabel");
        if (label) label.textContent = selectionLabel(file.files);
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submit = document.getElementById("guestAlbumSubmit");
      var chosen = file && file.files ? Array.prototype.slice.call(file.files) : [];
      if (!chosen.length) {
        setStatus("Choose photos or videos first.", "error");
        return;
      }
      var fields = {
        name: (document.getElementById("guestAlbumName") || {}).value || "",
        album: "main",
        caption: (document.getElementById("guestAlbumCaption") || {}).value || ""
      };
      uploading = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Preparing";
      }
      try {
        var prepared = [];
        for (var p = 0; p < chosen.length; p += 1) {
          prepared.push(await (window.prepareShareFile ? window.prepareShareFile(chosen[p]) : chosen[p]));
        }
        chosen = prepared;
      } catch (err) {
        uploading = false;
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Share";
        }
        setStatus(err.message || "That moment could not be shared.", "error");
        return;
      }
      var totalBytes = chosen.reduce(function (sum, item) { return sum + (item.size || 1); }, 0);
      var finishedBytes = 0;
      var saved = 0;
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Sharing 0%";
        submit.setAttribute("aria-busy", "true");
      }
      setStatus(chosen.length > 1 ? "Sharing 1 of " + chosen.length : "");
      try {
        for (var i = 0; i < chosen.length; i += 1) {
          var current = chosen[i];
          var currentSize = current.size || 1;
          if (chosen.length > 1) setStatus("Sharing " + (i + 1) + " of " + chosen.length);
          await shareOne(current, fields, function (loaded) {
            var pct = Math.round(((finishedBytes + Math.min(loaded, currentSize)) / totalBytes) * 100);
            if (submit) submit.textContent = "Sharing " + Math.min(99, Math.max(0, pct)) + "%";
          });
          finishedBytes += currentSize;
          saved += 1;
          if (submit) submit.textContent = "Sharing " + Math.min(100, Math.round((finishedBytes / totalBytes) * 100)) + "%";
        }
        form.reset();
        var label = document.getElementById("guestAlbumFileLabel");
        if (label) label.textContent = "Choose photos or videos";
        await loadAlbum();
        setStatus(saved === 1 ? "Shared. It is in the album now." : "Shared " + saved + " moments. They are in the album now.", "ok");
      } catch (err) {
        if (saved) await loadAlbum().catch(function () {});
        setStatus(
          (saved ? "Saved " + saved + " of " + chosen.length + ". " : "") + (err.message || "That moment could not be shared."),
          "error"
        );
      } finally {
        uploading = false;
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Share";
          submit.removeAttribute("aria-busy");
        }
      }
    });

    var leaveLayer = document.getElementById("albumLeave");
    var leaveKind = "";

    function openAlbumLeave(kind) {
      if (!leaveLayer || !uploading || allowLeave) return;
      leaveKind = kind || "reload";
      leaveLayer.hidden = false;
      leaveLayer.classList.add("is-on");
      var stay = document.getElementById("albumLeaveStay");
      if (stay) stay.focus();
    }

    function closeAlbumLeave() {
      leaveKind = "";
      if (!leaveLayer) return;
      leaveLayer.classList.remove("is-on");
      leaveLayer.hidden = true;
    }

    function blockAlbumUnload(event) {
      if (!uploading || allowLeave) return;
      var message = "Sharing is still in progress. Stay to let it finish.";
      event.preventDefault();
      event.returnValue = message;
      return message;
    }

    window.addEventListener("beforeunload", blockAlbumUnload);
    window.onbeforeunload = blockAlbumUnload;
    window.addEventListener("keydown", function (event) {
      if (!uploading || allowLeave) return;
      var key = event.key;
      var reloadKey = key === "F5" || ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "r" || key === "R"));
      if (!reloadKey) return;
      event.preventDefault();
      event.stopPropagation();
      openAlbumLeave("reload");
    }, true);

    var stayBtn = document.getElementById("albumLeaveStay");
    var goBtn = document.getElementById("albumLeaveGo");
    if (stayBtn) stayBtn.addEventListener("click", closeAlbumLeave);
    if (goBtn) {
      goBtn.addEventListener("click", function () {
        var kind = leaveKind;
        allowLeave = true;
        if (activeXhr) {
          try { activeXhr.abort(); } catch (err) {}
        }
        closeAlbumLeave();
        if (kind === "reload") window.location.reload();
      });
    }

    grid.addEventListener("change", function (event) {
      var box = event.target.closest("[data-pick]");
      if (!box) return;
      var id = box.getAttribute("data-pick");
      if (box.checked) picked[id] = true;
      else delete picked[id];
      syncDownloadBar(postsForActive().length);
    });

    grid.addEventListener("click", async function (event) {
      if (albumLine.suppressClick) {
        albumLine.suppressClick = false;
        return;
      }
      var save = event.target.closest("[data-save]");
      if (save) {
        downloadOne(save.getAttribute("data-save"), save);
        return;
      }
      var opener = event.target.closest("[data-open]");
      if (opener) {
        openViewer(opener.getAttribute("data-open"));
        return;
      }
      var heart = event.target.closest("[data-heart]");
      var laugh = event.target.closest("[data-laugh]");
      var reaction = heart || laugh;
      if (!reaction) return;
      var kind = heart ? "heart" : "laugh";
      reaction.disabled = true;
      try {
        var response = await fetch("/api/guest-album/" + encodeURIComponent(reaction.getAttribute(heart ? "data-heart" : "data-laugh")) + "/" + kind, {
          method: "POST",
          headers: albumHeaders({ "Content-Type": "application/json" }),
          body: "{}"
        });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "The reaction could not be saved.");
        replacePost(body);
      } catch (err) {
        setStatus(err.message, "error");
      } finally {
        reaction.disabled = false;
      }
    });

    var selectBtn = document.getElementById("guestAlbumSelect");
    var selectedBtn = document.getElementById("guestAlbumDownloadSelected");
    var allBtn = document.getElementById("guestAlbumDownloadAll");
    if (selectBtn) {
      selectBtn.addEventListener("click", function () {
        selecting = !selecting;
        if (!selecting) picked = {};
        render();
      });
    }
    if (selectedBtn) {
      selectedBtn.addEventListener("click", function () {
        var ids = Object.keys(picked);
        if (!ids.length) return;
        downloadMany({ ids: ids }, selectedBtn, "Download selected");
      });
    }
    if (allBtn) {
      allBtn.addEventListener("click", function () {
        downloadMany({}, allBtn, "Download all");
      });
    }
    var viewerSave = document.getElementById("guestAlbumViewerSave");
    if (viewerSave) {
      viewerSave.addEventListener("click", function () {
        if (viewerId) downloadOne(viewerId, viewerSave);
      });
    }

    var albumSection = document.getElementById("album");
    var galleryMore = document.getElementById("galleryViewMore");

    function setAlbumOpen(open) {
      if (!albumSection) return;
      albumSection.hidden = !open;
      if (galleryMore) {
        galleryMore.setAttribute("aria-expanded", open ? "true" : "false");
        galleryMore.textContent = open ? "View less" : "View more";
      }
      if (open) requestAnimationFrame(layoutAlbumLine);
    }

    var galleryLess = document.getElementById("galleryViewLess");

    if (galleryMore) {
      galleryMore.addEventListener("click", function () {
        var open = !!albumSection.hidden;
        setAlbumOpen(open);
        if (open && albumSection) {
          albumSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    if (galleryLess) {
      galleryLess.addEventListener("click", function () {
        setAlbumOpen(false);
        if (galleryMore) galleryMore.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[href]");
      if (!link) return;
      var href = link.getAttribute("href") || "";
      if (href === "#album" || href.slice(-6) === "#album") setAlbumOpen(true);
    }, true);

    if ((location.hash || "") === "#album") setAlbumOpen(true);
    startAlbumLine();

    var closeBtn = document.getElementById("guestAlbumViewerClose");
    var prevBtn = document.getElementById("guestAlbumPrev");
    var nextBtn = document.getElementById("guestAlbumNext");
    var pauseBtn = document.getElementById("albumReelPause");
    var zoomBtn = document.getElementById("albumReelZoom");
    var reelVideo = document.getElementById("guestAlbumViewerVideo");
    if (closeBtn) closeBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      closeViewer();
    });
    if (prevBtn) prevBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      shiftAlbumReel(-1);
    });
    if (nextBtn) nextBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      shiftAlbumReel(1);
    });
    if (pauseBtn) pauseBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (!reelVideo || reelVideo.hidden) return;
      if (reelVideo.paused || reelVideo.ended) {
        var play = reelVideo.play();
        if (play && play.catch) play.catch(function () {});
      } else {
        reelVideo.pause();
      }
      syncAlbumPause();
    });
    if (zoomBtn) zoomBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      if (reelZoom > 1.05) setAlbumZoom(1);
      else setAlbumZoom(2.4);
    });
    if (reelVideo) {
      reelVideo.addEventListener("timeupdate", function () { paintAlbumProgress(reelVideo); });
      reelVideo.addEventListener("loadedmetadata", function () { paintAlbumProgress(reelVideo); });
      reelVideo.addEventListener("seeked", function () { paintAlbumProgress(reelVideo); });
      var scrub = document.getElementById("albumReelBar");
      if (scrub) {
        var scrubbing = false;
        scrub.addEventListener("pointerdown", function (event) {
          if (reelVideo.hidden || (event.button != null && event.button !== 0)) return;
          event.preventDefault();
          event.stopPropagation();
          scrubbing = true;
          if (scrub.setPointerCapture) scrub.setPointerCapture(event.pointerId);
          seekAlbumVideo(event.clientX);
        });
        scrub.addEventListener("pointermove", function (event) {
          if (!scrubbing) return;
          event.preventDefault();
          seekAlbumVideo(event.clientX);
        });
        function endScrub(event) {
          if (!scrubbing) return;
          scrubbing = false;
          if (event) seekAlbumVideo(event.clientX);
        }
        scrub.addEventListener("pointerup", endScrub);
        scrub.addEventListener("pointercancel", function () { scrubbing = false; });
        scrub.addEventListener("keydown", function (event) {
          if (reelVideo.hidden || !isFinite(reelVideo.duration) || reelVideo.duration <= 0) return;
          var step = event.shiftKey ? 10 : 5;
          var next = null;
          if (event.key === "ArrowRight") next = Math.min(reelVideo.duration, reelVideo.currentTime + step);
          else if (event.key === "ArrowLeft") next = Math.max(0, reelVideo.currentTime - step);
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = reelVideo.duration;
          if (next == null) return;
          event.preventDefault();
          try { reelVideo.currentTime = next; } catch (err) {}
          paintAlbumProgress(reelVideo);
        });
      }
      reelVideo.addEventListener("play", syncAlbumPause);
      reelVideo.addEventListener("pause", syncAlbumPause);
      reelVideo.addEventListener("ended", syncAlbumPause);
    }
    if (viewer) {
      function reelControl(target) {
        return !!(target && target.closest && target.closest(".lightbox-close, .lightbox-prev, .lightbox-next, .reel-tools, .album-reel-save, .reel-bar"));
      }
      function onReelMedia(target) {
        return !!(target && target.closest && target.closest("#albumReelStage, #guestAlbumViewerImg, #guestAlbumViewerVideo"));
      }
      viewer.addEventListener("pointerdown", function (event) {
        if (!viewer.classList.contains("open")) return;
        if (event.button != null && event.button !== 0) return;
        if (reelControl(event.target)) return;
        reelPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (reelPointers.size === 1) {
          reelGesture = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            dx: 0,
            dy: 0,
            moved: false,
            pinch: false,
            pinchDist: 1,
            pinchZoom: reelZoom
          };
        } else if (reelPointers.size === 2 && reelGesture) {
          var pts = Array.from(reelPointers.values());
          reelGesture.pinch = true;
          reelGesture.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
          reelGesture.pinchZoom = Math.max(1, reelZoom);
        }
        if (onReelMedia(event.target)) event.preventDefault();
      });
      viewer.addEventListener("pointermove", function (event) {
        if (!reelPointers.has(event.pointerId)) return;
        reelPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        var gesture = reelGesture;
        if (!gesture) return;
        if (reelPointers.size >= 2 && gesture.pinch) {
          var pts = Array.from(reelPointers.values());
          var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          reelZoom = Math.max(1, Math.min(4, gesture.pinchZoom * (dist / gesture.pinchDist)));
          clampAlbumPan();
          applyAlbumZoom(true);
          return;
        }
        if (event.pointerId !== gesture.id) return;
        gesture.dx = event.clientX - gesture.x;
        gesture.dy = event.clientY - gesture.y;
        if (Math.hypot(gesture.dx, gesture.dy) > 8) gesture.moved = true;
        if (reelZoom > 1.01 && gesture.moved) {
          reelPanX += event.clientX - gesture.lastX;
          reelPanY += event.clientY - gesture.lastY;
          gesture.lastX = event.clientX;
          gesture.lastY = event.clientY;
          clampAlbumPan();
          applyAlbumZoom(true);
        }
      });
      function endAlbumPointer(event) {
        if (!reelPointers.has(event.pointerId)) return;
        reelPointers.delete(event.pointerId);
        var gesture = reelGesture;
        if (!gesture) return;
        if (reelPointers.size > 0) {
          var remaining = reelPointers.values().next().value;
          gesture.pinch = false;
          if (remaining) {
            gesture.lastX = remaining.x;
            gesture.lastY = remaining.y;
            gesture.x = remaining.x;
            gesture.y = remaining.y;
            gesture.dx = 0;
            gesture.dy = 0;
            gesture.moved = true;
          }
          return;
        }
        reelGesture = null;
        if (gesture.pinch) {
          if (reelZoom <= 1.05) setAlbumZoom(1);
          return;
        }
        if (reelZoom > 1.01 && gesture.moved) return;
        if (gesture.moved && reelZoom <= 1.01 && Math.abs(gesture.dx) >= 56 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2) {
          shiftAlbumReel(gesture.dx < 0 ? 1 : -1);
          return;
        }
        if (gesture.moved) return;
        if (!onReelMedia(event.target)) {
          if (event.target === viewer) closeViewer();
          return;
        }
        var now = performance.now();
        if (reelZoom > 1.01) {
          if (now - reelLastTap < 300) setAlbumZoom(1);
          reelLastTap = now;
          return;
        }
        if (now - reelLastTap < 300) {
          reelLastTap = 0;
          if (reelTapTimer) clearTimeout(reelTapTimer);
          reelTapTimer = 0;
          setAlbumZoom(2.4, event.clientX, event.clientY);
          return;
        }
        reelLastTap = now;
        if (!reelVideo || reelVideo.hidden) return;
        reelTapTimer = window.setTimeout(function () {
          reelTapTimer = 0;
          if (!albumReelOpen() || reelZoom > 1.01 || reelVideo.hidden) return;
          if (reelVideo.paused || reelVideo.ended) {
            var play = reelVideo.play();
            if (play && play.catch) play.catch(function () {});
          } else {
            reelVideo.pause();
          }
          syncAlbumPause();
        }, 280);
      }
      viewer.addEventListener("pointerup", endAlbumPointer);
      viewer.addEventListener("pointercancel", function (event) {
        reelPointers.delete(event.pointerId);
        if (!reelPointers.size) reelGesture = null;
      });
    }
    document.addEventListener("keydown", function (event) {
      if (!albumReelOpen()) return;
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") {
        if (reelZoom > 1.01) setAlbumZoom(1);
        else closeViewer();
        return;
      }
      if (event.key === "ArrowLeft") shiftAlbumReel(-1);
      if (event.key === "ArrowRight") shiftAlbumReel(1);
    });
    var navPress = null;
    var blockPageClick = false;
    function navLinkForEvent(event) {
      if (!albumReelOpen()) return null;
      if (event.button != null && event.button !== 0) return null;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
      var direct = navAnchor(event);
      var link = direct || visibleNavLinkAt(event.clientX, event.clientY);
      return link ? { link: link, direct: !!direct } : null;
    }
    document.addEventListener("pointerdown", function (event) {
      var hit = navLinkForEvent(event);
      navPress = null;
      if (!hit) return;
      navPress = { id: event.pointerId, x: event.clientX, y: event.clientY, link: hit.link, direct: hit.direct };
      blockPageClick = true;
      closeViewer();
      window.setTimeout(function () { blockPageClick = false; }, 500);
    }, true);
    document.addEventListener("click", function (event) {
      if (!blockPageClick || navAnchor(event)) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    document.addEventListener("pointerup", function (event) {
      var press = navPress;
      navPress = null;
      if (!press || press.id !== event.pointerId || press.direct) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) return;
      event.preventDefault();
      event.stopPropagation();
      press.link.click();
    }, true);
    document.addEventListener("pointercancel", function () {
      navPress = null;
    }, true);
    document.addEventListener("click", function (event) {
      if (navAnchor(event)) closeViewer();
    }, true);

    loadAlbum().catch(function () {
      grid.innerHTML = '<p class="album-error">The album could not be loaded. Refresh the page and try again.</p>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
