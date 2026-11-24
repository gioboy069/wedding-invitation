(function () {
  "use strict";

  var ALBUMS = [
    { id: "main", label: "Main album" },
    { id: "photographer", label: "Photographer" },
    { id: "ceremony", label: "Ceremony" },
    { id: "reception", label: "Reception" }
  ];

  var PREVIEW_COUNT = 9;
  var activeAlbum = "main";
  var posts = [];
  var memoryToken = "";
  var shown = PREVIEW_COUNT;
  var selecting = false;
  var picked = {};
  var viewerId = "";

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

  function tileShape(index) {
    var spot = index % 6;
    if (spot === 0) return " is-feature";
    if (spot === 3) return " is-wide";
    return "";
  }

  function syncDownloadBar(total) {
    var bar = document.getElementById("guestAlbumToolbar");
    var selectBtn = document.getElementById("guestAlbumSelect");
    var selectedBtn = document.getElementById("guestAlbumDownloadSelected");
    var allBtn = document.getElementById("guestAlbumDownloadAll");
    var more = document.getElementById("guestAlbumMore");
    var count = Object.keys(picked).length;
    if (bar) bar.hidden = total < 1;
    if (selectBtn) selectBtn.textContent = selecting ? "Done" : "Select";
    if (selectedBtn) {
      selectedBtn.hidden = !selecting;
      selectedBtn.textContent = count ? "Download selected (" + count + ")" : "Download selected";
      selectedBtn.disabled = !count;
    }
    if (allBtn) allBtn.hidden = total < 1;
    if (more) {
      var hidden = total <= shown;
      more.hidden = hidden;
      if (!hidden) more.textContent = "View more · " + (total - shown);
    }
  }

  function renderGrid() {
    var grid = document.getElementById("guestAlbumGrid");
    if (!grid) return;
    var visible = postsForActive();
    var album = ALBUMS.find(function (item) { return item.id === activeAlbum; });
    grid.classList.toggle("is-selecting", selecting);
    if (!visible.length) {
      grid.innerHTML = '<p class="album-empty">Nothing in the ' + escapeHtml(album ? album.label : "album") + ' yet. Share a photo or video from that part of the day.</p>';
      syncDownloadBar(0);
      return;
    }
    var slice = visible.slice(0, shown);
    grid.innerHTML = slice.map(function (post, index) {
      var media = post.type === "video"
        ? '<video src="' + escapeHtml(post.src) + '" muted playsinline preload="metadata"></video><span class="album-play">Film</span>'
        : '<img src="' + escapeHtml(post.src) + '" alt="' + escapeHtml(post.caption || post.name || "Guest photo") + '" loading="lazy" />';
      var caption = escapeHtml(post.name || "Guest") + (post.caption ? " · " + escapeHtml(post.caption) : "");
      return (
        '<article class="album-tile' + tileShape(index) + '">' +
          '<button type="button" class="album-tile-open" data-open="' + escapeHtml(post.id) + '" aria-label="View ' + escapeHtml(post.name || "moment") + '">' +
            media +
            '<span class="album-tile-caption">' + caption + "</span>" +
          "</button>" +
          '<label class="album-pick"><input type="checkbox" data-pick="' + escapeHtml(post.id) + '"' + (picked[post.id] ? " checked" : "") + ' aria-label="Select ' + escapeHtml(post.name || "moment") + '" /></label>' +
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
    viewerId = post.id;
    viewer.hidden = false;
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
    var tabs = document.getElementById("guestAlbumTabs");
    var file = document.getElementById("guestAlbumFile");
    var viewer = document.getElementById("guestAlbumViewer");
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
        xhr.upload.onprogress = function (event) {
          if (event.lengthComputable && onProgress) onProgress(event.loaded, event.total);
        };
        xhr.onload = function () {
          var body = {};
          try { body = JSON.parse(xhr.responseText || "{}"); } catch (err) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error || "That moment could not be shared."));
        };
        xhr.onerror = function () {
          reject(new Error("The upload was interrupted. Try again."));
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
        album: (document.getElementById("guestAlbumPick") || {}).value || "main",
        caption: (document.getElementById("guestAlbumCaption") || {}).value || ""
      };
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
          var body = await shareOne(current, fields, function (loaded) {
            var pct = Math.round(((finishedBytes + Math.min(loaded, currentSize)) / totalBytes) * 100);
            if (submit) submit.textContent = "Sharing " + Math.min(99, Math.max(0, pct)) + "%";
          });
          finishedBytes += currentSize;
          saved += 1;
          activeAlbum = body.album || fields.album;
          if (submit) submit.textContent = "Sharing " + Math.min(100, Math.round((finishedBytes / totalBytes) * 100)) + "%";
        }
        form.reset();
        var label = document.getElementById("guestAlbumFileLabel");
        if (label) label.textContent = "Choose photos or videos";
        var pick = document.getElementById("guestAlbumPick");
        if (pick) pick.value = activeAlbum;
        await loadAlbum();
        setStatus(saved === 1 ? "Shared. It is in the album now." : "Shared " + saved + " moments. They are in the album now.", "ok");
      } catch (err) {
        if (saved) await loadAlbum().catch(function () {});
        setStatus(
          (saved ? "Saved " + saved + " of " + chosen.length + ". " : "") + (err.message || "That moment could not be shared."),
          "error"
        );
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Share";
          submit.removeAttribute("aria-busy");
        }
      }
    });

    if (tabs) {
      tabs.addEventListener("click", function (event) {
        var button = event.target.closest("[data-album]");
        if (!button) return;
        activeAlbum = button.getAttribute("data-album");
        shown = PREVIEW_COUNT;
        selecting = false;
        picked = {};
        render();
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
    var more = document.getElementById("guestAlbumMore");
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
        downloadMany({ album: activeAlbum }, allBtn, "Download all");
      });
    }
    if (more) {
      more.addEventListener("click", function () {
        shown += PREVIEW_COUNT;
        render();
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
    }

    if (galleryMore) {
      galleryMore.addEventListener("click", function () {
        var open = !!albumSection.hidden;
        setAlbumOpen(open);
        if (open && albumSection) {
          albumSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[href]");
      if (!link) return;
      var href = link.getAttribute("href") || "";
      if (href === "#album" || href.slice(-6) === "#album") setAlbumOpen(true);
    }, true);

    if ((location.hash || "") === "#album") setAlbumOpen(true);

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
