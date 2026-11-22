(function () {
  "use strict";

  var ALBUMS = [
    { id: "main", label: "Main album" },
    { id: "photographer", label: "Photographer" },
    { id: "ceremony", label: "Ceremony" },
    { id: "reception", label: "Reception" }
  ];

  var activeAlbum = "main";
  var posts = [];
  var memoryToken = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    return posts.filter(function (post) { return post.album === activeAlbum; });
  }

  function renderTabs() {
    var tabs = document.getElementById("guestAlbumTabs");
    if (!tabs) return;
    var counts = {};
    ALBUMS.forEach(function (album) { counts[album.id] = 0; });
    posts.forEach(function (post) {
      if (counts[post.album] != null) counts[post.album] += 1;
    });
    tabs.innerHTML = ALBUMS.map(function (album) {
      var selected = album.id === activeAlbum;
      return '<button type="button" class="album-tab' + (selected ? " is-active" : "") + '" role="tab" aria-selected="' + (selected ? "true" : "false") + '" data-album="' + album.id + '">' +
        escapeHtml(album.label) + " (" + counts[album.id] + ")</button>";
    }).join("");
  }

  function renderGrid() {
    var grid = document.getElementById("guestAlbumGrid");
    if (!grid) return;
    var visible = postsForActive();
    var album = ALBUMS.find(function (item) { return item.id === activeAlbum; });
    if (!visible.length) {
      grid.innerHTML = '<p class="album-empty">Nothing in the ' + escapeHtml(album ? album.label : "album") + ' yet. Share a photo or short film from that part of the day.</p>';
      return;
    }
    grid.innerHTML = visible.map(function (post) {
      var media = post.type === "video"
        ? '<video src="' + escapeHtml(post.src) + '" muted playsinline preload="metadata"></video><span class="album-play">Play film</span>'
        : '<img src="' + escapeHtml(post.src) + '" alt="' + escapeHtml(post.caption || post.name || "Guest photo") + '" loading="lazy" />';
      var comments = (post.comments || []).map(function (comment) {
        return '<p class="album-comment"><strong>' + escapeHtml(comment.name) + '</strong> ' + escapeHtml(comment.text) + "</p>";
      }).join("");
      return (
        '<article class="album-card" data-post="' + escapeHtml(post.id) + '">' +
          '<button type="button" class="album-media" data-open="' + escapeHtml(post.id) + '" aria-label="View ' + escapeHtml(post.name || "moment") + '">' + media + "</button>" +
          '<div class="album-body">' +
            '<h3 class="album-name">' + escapeHtml(post.name || "Guest") + "</h3>" +
            (post.caption ? '<p class="album-caption">' + escapeHtml(post.caption) + "</p>" : '<p class="album-caption"></p>') +
            '<div class="album-actions">' +
              '<button type="button" class="album-heart' + (post.liked ? " is-on" : "") + '" data-heart="' + escapeHtml(post.id) + '" aria-pressed="' + (post.liked ? "true" : "false") + '" aria-label="Heart this moment">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" stroke-width="1.6"/></svg>' +
                "<span>" + Number(post.heartCount || 0) + "</span>" +
              "</button>" +
            "</div>" +
            '<div class="album-comments">' + comments + "</div>" +
            '<form class="album-comment-form" data-comment="' + escapeHtml(post.id) + '">' +
              '<input class="form-input" name="name" maxlength="60" placeholder="Your name" required />' +
              '<input class="form-input" name="text" maxlength="400" placeholder="Leave a note" required />' +
              '<button class="album-comment-submit" type="submit">Comment</button>' +
            "</form>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function render() {
    renderTabs();
    renderGrid();
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

  function closeViewer() {
    var viewer = document.getElementById("guestAlbumViewer");
    var video = document.getElementById("guestAlbumViewerVideo");
    var img = document.getElementById("guestAlbumViewerImg");
    if (video) {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      video.hidden = true;
    }
    if (img) {
      img.removeAttribute("src");
      img.hidden = true;
    }
    if (viewer) viewer.hidden = true;
  }

  function openViewer(id) {
    var post = posts.find(function (item) { return item.id === id; });
    var viewer = document.getElementById("guestAlbumViewer");
    var video = document.getElementById("guestAlbumViewerVideo");
    var img = document.getElementById("guestAlbumViewerImg");
    var caption = document.getElementById("guestAlbumViewerCaption");
    if (!post || !viewer || !video || !img) return;
    if (post.type === "video") {
      img.hidden = true;
      img.removeAttribute("src");
      video.hidden = false;
      video.src = post.src;
    } else {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      video.hidden = true;
      img.hidden = false;
      img.src = post.src;
      img.alt = post.caption || post.name || "Guest photo";
    }
    if (caption) caption.textContent = [post.name, post.caption].filter(Boolean).join(" — ");
    viewer.hidden = false;
  }

  function bind() {
    var form = document.getElementById("guestAlbumForm");
    var grid = document.getElementById("guestAlbumGrid");
    var tabs = document.getElementById("guestAlbumTabs");
    var file = document.getElementById("guestAlbumFile");
    var viewer = document.getElementById("guestAlbumViewer");
    if (!form || !grid) return;

    if (file) {
      file.addEventListener("change", function () {
        var label = document.getElementById("guestAlbumFileLabel");
        var picked = file.files && file.files[0];
        if (label) label.textContent = picked ? picked.name : "Choose a photo or short film";
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var submit = document.getElementById("guestAlbumSubmit");
      var data = new FormData(form);
      if (!file || !file.files || !file.files[0]) {
        setStatus("Choose a photo or short film first.", "error");
        return;
      }
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Sharing…";
      }
      setStatus("");
      try {
        var response = await fetch("/api/guest-album", { method: "POST", headers: albumHeaders(), body: data });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "That moment could not be shared.");
        activeAlbum = body.album || activeAlbum;
        form.reset();
        var label = document.getElementById("guestAlbumFileLabel");
        if (label) label.textContent = "Choose a photo or short film";
        var pick = document.getElementById("guestAlbumPick");
        if (pick) pick.value = activeAlbum;
        await loadAlbum();
        setStatus("Shared. It is in the album now.", "ok");
      } catch (err) {
        setStatus(err.message || "That moment could not be shared.", "error");
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Share";
        }
      }
    });

    if (tabs) {
      tabs.addEventListener("click", function (event) {
        var button = event.target.closest("[data-album]");
        if (!button) return;
        activeAlbum = button.getAttribute("data-album");
        render();
      });
    }

    grid.addEventListener("click", async function (event) {
      var opener = event.target.closest("[data-open]");
      if (opener) {
        openViewer(opener.getAttribute("data-open"));
        return;
      }
      var heart = event.target.closest("[data-heart]");
      if (!heart) return;
      heart.disabled = true;
      try {
        var response = await fetch("/api/guest-album/" + encodeURIComponent(heart.getAttribute("data-heart")) + "/heart", {
          method: "POST",
          headers: albumHeaders({ "Content-Type": "application/json" }),
          body: "{}"
        });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "The heart could not be saved.");
        replacePost(body);
      } catch (err) {
        setStatus(err.message, "error");
      } finally {
        heart.disabled = false;
      }
    });

    grid.addEventListener("submit", async function (event) {
      var commentForm = event.target.closest("[data-comment]");
      if (!commentForm) return;
      event.preventDefault();
      var payload = {
        name: commentForm.elements.name.value,
        text: commentForm.elements.text.value
      };
      var button = commentForm.querySelector("button");
      if (button) button.disabled = true;
      try {
        var response = await fetch("/api/guest-album/" + encodeURIComponent(commentForm.getAttribute("data-comment")) + "/comments", {
          method: "POST",
          headers: albumHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload)
        });
        var body = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(body.error || "The note could not be saved.");
        replacePost(body);
      } catch (err) {
        setStatus(err.message, "error");
        if (button) button.disabled = false;
      }
    });

    var closeBtn = document.getElementById("guestAlbumViewerClose");
    if (closeBtn) closeBtn.addEventListener("click", closeViewer);
    if (viewer) {
      viewer.addEventListener("click", function (event) {
        if (event.target === viewer) closeViewer();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeViewer();
    });
    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("#navLinks a, #navLogo");
      if (link) closeViewer();
    });

    loadAlbum().catch(function () {
      grid.innerHTML = '<p class="album-error">The album could not be loaded. Refresh the page and try again.</p>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
