(function () {
  "use strict";

  /* Corner trim — ocean waves & seafoam (frame unchanged) */
  var FLORAL_SVG =
    '<svg viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M8 148 C28 118 48 128 62 98 C76 68 98 52 132 28" stroke="#6ba7a0" stroke-width="1.15" stroke-linecap="round"/>' +
    '<path d="M18 140 C34 112 52 108 72 82 C92 56 108 44 148 12" stroke="#b7d4e6" stroke-width="0.85" stroke-linecap="round"/>' +
    '<path d="M28 128 C44 108 58 104 78 88" stroke="#1e5a6e" stroke-width="0.65" stroke-linecap="round" opacity="0.55"/>' +
    '<path d="M12 120 C30 98 46 92 64 76" stroke="#dcc8aa" stroke-width="0.55" stroke-linecap="round" opacity="0.6"/>' +
    '<circle cx="62" cy="78" r="6" fill="#b7d4e6" opacity="0.45"/>' +
    '<circle cx="62" cy="78" r="2.8" fill="#1e5a6e" opacity="0.35"/>' +
    '<circle cx="96" cy="42" r="4.5" fill="#6ba7a0" opacity="0.4"/>' +
    '<circle cx="118" cy="28" r="3" fill="#dcc8aa" opacity="0.55"/>' +
    '<path d="M40 108 C48 96 58 94 68 86" stroke="#6ba7a0" stroke-width="0.7" stroke-linecap="round"/>' +
    "</svg>";

  var DIVIDER_SVG =
    '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="18" cy="18" r="16" stroke="#b7d4e6" stroke-width="0.8" opacity="0.65"/>' +
    '<path d="M6 20 C10 16 14 16 18 18 C22 20 26 20 30 16" stroke="#6ba7a0" stroke-width="1" stroke-linecap="round"/>' +
    '<path d="M8 22 C12 19 15 19 18 21 C21 23 24 23 28 20" stroke="#1e5a6e" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/>' +
    '<circle cx="18" cy="14" r="2.2" fill="#dcc8aa" opacity="0.65"/>' +
    "</svg>";

  var PEBBLE_SVGS = [
    '<svg viewBox="0 0 56 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="28" cy="19" rx="24" ry="13" fill="#b8a992"/><ellipse cx="25" cy="16" rx="16" ry="8" fill="#dcc8aa" opacity="0.55"/><path d="M10 21 Q28 28 46 17" stroke="#8a7d6e" stroke-width="0.7" fill="none" opacity="0.35"/></svg>',
    '<svg viewBox="0 0 44 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="22" cy="17" rx="19" ry="11" fill="#9aab9f"/><ellipse cx="20" cy="14" rx="12" ry="7" fill="#c8d4cf" opacity="0.45"/><circle cx="14" cy="18" r="1.2" fill="#6ba7a0" opacity="0.35"/></svg>',
    '<svg viewBox="0 0 62 38" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="31" cy="21" rx="27" ry="14" fill="#a89888"/><ellipse cx="28" cy="17" rx="18" ry="9" fill="#dcc8aa" opacity="0.5"/><path d="M14 23 Q31 31 48 19" stroke="#7a6f62" stroke-width="0.65" fill="none" opacity="0.3"/></svg>',
    '<svg viewBox="0 0 38 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="19" cy="14" rx="16" ry="10" fill="#8f9e98"/><ellipse cx="17" cy="12" rx="10" ry="6" fill="#b7d4e6" opacity="0.35"/><ellipse cx="24" cy="15" rx="4" ry="2.5" fill="#6ba7a0" opacity="0.25"/></svg>',
    '<svg viewBox="0 0 32 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="16" cy="12" rx="13" ry="8" fill="#c4b8a8"/><ellipse cx="14" cy="10" rx="8" ry="5" fill="#e8dfd0" opacity="0.5"/></svg>',
    '<svg viewBox="0 0 48 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="24" cy="15" rx="20" ry="11" fill="#7a8f8a"/><ellipse cx="22" cy="13" rx="13" ry="7" fill="#9bc4bf" opacity="0.4"/></svg>'
  ];

  var INSET = "var(--frame-inset)";

  var STONE_LAYOUT = [
    { bottom: "calc(" + INSET + " + 2px)", left: "calc(" + INSET + " + 2px)", width: 54, svg: 0, rotate: -12 },
    { bottom: "calc(" + INSET + " + 16px)", left: "calc(" + INSET + " + 34px)", width: 40, svg: 4, rotate: 8 },
    { bottom: "calc(" + INSET + " + 6px)", left: "calc(" + INSET + " + 62px)", width: 48, svg: 2, rotate: -5 },
    { bottom: "calc(" + INSET + " + 28px)", left: "calc(" + INSET + " + 8px)", width: 32, svg: 3, rotate: 14 },
    { bottom: "calc(" + INSET + " + 2px)", right: "calc(" + INSET + " + 2px)", width: 52, svg: 1, rotate: 10 },
    { bottom: "calc(" + INSET + " + 18px)", right: "calc(" + INSET + " + 30px)", width: 38, svg: 5, rotate: -7 },
    { bottom: "calc(" + INSET + " + 8px)", right: "calc(" + INSET + " + 58px)", width: 44, svg: 0, rotate: 4 },
    { bottom: "calc(" + INSET + " + 30px)", right: "calc(" + INSET + " + 6px)", width: 30, svg: 4, rotate: -16 },
    { top: "calc(" + INSET + " + 4px)", left: "calc(" + INSET + " + 4px)", width: 28, svg: 3, rotate: -20 },
    { top: "calc(" + INSET + " + 18px)", left: "calc(" + INSET + " + 24px)", width: 22, svg: 4, rotate: 12 },
    { top: "calc(" + INSET + " + 6px)", right: "calc(" + INSET + " + 4px)", width: 26, svg: 1, rotate: 18 },
    { top: "calc(" + INSET + " + 20px)", right: "calc(" + INSET + " + 22px)", width: 20, svg: 5, rotate: -10 }
  ];

  function injectShoreSandBand() {
    if (document.querySelector(".shore-sand-band")) return;
    var band = document.createElement("div");
    band.className = "shore-sand-band";
    band.setAttribute("aria-hidden", "true");
    document.body.insertBefore(band, document.body.firstChild);
  }

  function injectShoreStones() {
    if (document.querySelector(".shore-stones")) return;

    var wrap = document.createElement("div");
    wrap.className = "shore-stones";
    wrap.setAttribute("aria-hidden", "true");

    STONE_LAYOUT.forEach(function (stone, i) {
      var el = document.createElement("div");
      el.className = "shore-stone shore-stone--" + (i + 1);
      el.style.width = stone.width + "px";
      if (stone.bottom) el.style.bottom = stone.bottom;
      if (stone.top) el.style.top = stone.top;
      if (stone.left) el.style.left = stone.left;
      if (stone.right) el.style.right = stone.right;
      el.style.transform = "rotate(" + stone.rotate + "deg)";
      el.innerHTML = PEBBLE_SVGS[stone.svg % PEBBLE_SVGS.length];
      wrap.appendChild(el);
    });

    document.body.insertBefore(wrap, document.body.firstChild);
  }

  function injectShoreDecor() {
    injectShoreSandBand();
    injectShoreStones();
  }

  function isGuestPage() {
    var path = window.location.pathname;
    return !/\/admin(\/|$)/.test(path) && !/\/download\.html$/i.test(path);
  }

  function injectFrameDecor() {
    if (document.querySelector(".floral-frame")) return;

    var frame = document.createElement("div");
    frame.className = "floral-frame";
    frame.setAttribute("aria-hidden", "true");
    ["tl", "tr", "bl", "br"].forEach(function (pos) {
      var corner = document.createElement("div");
      corner.className = "floral-corner floral-corner--" + pos;
      corner.innerHTML = FLORAL_SVG;
      frame.appendChild(corner);
    });
    ["top", "bottom", "left", "right"].forEach(function (pos) {
      var edge = document.createElement("div");
      edge.className = "floral-edge floral-edge--" + pos;
      frame.appendChild(edge);
    });
    document.body.appendChild(frame);

    var curtain = document.createElement("div");
    curtain.className = "page-curtain";
    curtain.id = "pageCurtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.innerHTML = '<div class="page-curtain__monogram">G <span>&</span> A</div>';
    document.body.appendChild(curtain);

    setTimeout(function () {
      curtain.classList.remove("is-entering", "is-leaving");
      curtain.classList.add("is-revealed");
    }, 1000);
  }

  function samePageHashLink(anchor) {
    try {
      var url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (!url.hash) return false;
      var here = window.location.pathname.replace(/\/$/, "") || "/";
      var there = url.pathname.replace(/\/$/, "") || "/";
      var hereIndex = here === "/" || /\/index\.html$/i.test(here);
      var thereIndex = there === "/" || /\/index\.html$/i.test(there);
      return here === there || (hereIndex && thereIndex);
    } catch (e) {
      return false;
    }
  }

  function isPageLink(anchor) {
    var href = anchor.getAttribute("href");
    if (!href || href.charAt(0) === "#") return false;
    if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) return false;
    if (anchor.target === "_blank") return false;
    if (href.indexOf("/admin") !== -1) return false;
    /* Same-page hash (e.g. index.html#rsvp while already on home) → let scroll handler work */
    if (samePageHashLink(anchor)) return false;
    try {
      var url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/");
    } catch (e) {
      return href.endsWith(".html") || href === "/" || href === "index.html";
    }
  }

  function scrollToHash(hash, behavior) {
    if (!hash || hash === "#") return false;
    var id = decodeURIComponent(hash.replace(/^#/, ""));
    if (id === "attire" && window.WeddingUI && window.WeddingUI.setAttireExpanded) {
      window.WeddingUI.setAttireExpanded(true, false);
    }
    var el = document.getElementById(id);
    if (!el) return false;
    requestAnimationFrame(function () {
      el.scrollIntoView({ behavior: behavior || "smooth", block: "start" });
    });
    return true;
  }

  function navigateWithTransition(url) {
    var curtain = document.getElementById("pageCurtain");
    if (!curtain) {
      window.location.href = url;
      return;
    }
    curtain.classList.remove("is-revealed", "is-entering");
    curtain.classList.add("is-leaving");
    setTimeout(function () {
      window.location.href = url;
    }, 700);
  }

  function bindPageTransitions() {
    document.addEventListener("click", function (e) {
      var anchor = e.target.closest("a[href]");
      if (!anchor) return;

      var href = anchor.getAttribute("href") || "";

      /* In-page anchors */
      if (href.charAt(0) === "#" && href.length > 1) {
        e.preventDefault();
        if (history.pushState) {
          history.pushState(null, "", href);
        } else {
          window.location.hash = href;
        }
        scrollToHash(href, "smooth");
        return;
      }

      /* Same document with hash (index.html#rsvp while on home) */
      if (samePageHashLink(anchor)) {
        e.preventDefault();
        var url = new URL(anchor.href, window.location.href);
        if (history.pushState) {
          history.pushState(null, "", url.hash);
        }
        scrollToHash(url.hash, "smooth");
        return;
      }

      if (!isPageLink(anchor)) return;
      e.preventDefault();
      navigateWithTransition(anchor.href);
    });
  }

  function bindSectionAnimations() {
    if (document.querySelector(".reveal")) return;

    var sections = document.querySelectorAll("section, .page-hero, .dress-code-banner");
    if (!sections.length) return;

    sections.forEach(function (el, i) {
      el.classList.add("section-animate");
      if (i % 3 === 1) el.classList.add("delay-1");
      if (i % 3 === 2) el.classList.add("delay-2");
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );

    sections.forEach(function (el) {
      observer.observe(el);
    });
  }

  function injectSectionDividers() {
    var sections = document.querySelectorAll("section");
    sections.forEach(function (section, i) {
      if (i === 0) return;
      if (section.previousElementSibling && section.previousElementSibling.classList.contains("section-floral")) {
        return;
      }
      var divider = document.createElement("div");
      divider.className = "section-floral";
      divider.setAttribute("aria-hidden", "true");
      divider.innerHTML =
        '<span class="section-floral__line"></span>' +
        '<span class="section-floral__emblem">' + DIVIDER_SVG + "</span>" +
        '<span class="section-floral__line section-floral__line--right"></span>';
      section.parentNode.insertBefore(divider, section);
    });
  }

  function pinDockedNav(nav, docked, y) {
    if (!nav) return;
    if (!docked) {
      ["position", "top", "right", "left", "bottom", "margin", "width", "transform", "opacity", "visibility"].forEach(function (prop) {
        nav.style.removeProperty(prop);
      });
      nav.removeAttribute("data-dock-compensate");
      return;
    }

    y = Number(y) || 0;
    nav.style.setProperty("position", "fixed", "important");
    nav.style.setProperty("right", "16px", "important");
    nav.style.setProperty("left", "auto", "important");
    nav.style.setProperty("bottom", "auto", "important");
    nav.style.setProperty("margin", "0", "important");
    nav.style.setProperty("width", "auto", "important");
    nav.style.setProperty("transform", "none", "important");
    nav.style.setProperty("opacity", "1", "important");
    nav.style.setProperty("visibility", "visible", "important");

    var compensate = nav.getAttribute("data-dock-compensate") === "1";
    nav.style.setProperty("top", (compensate ? 16 + y : 16) + "px", "important");

    var rect = nav.getBoundingClientRect();
    if (rect.top < 4) {
      nav.setAttribute("data-dock-compensate", "1");
      nav.style.setProperty("top", (16 + y) + "px", "important");
    }
  }

  function bindStickyNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;

    var ticking = false;
    var DOCK_AT = 80;

    function closeMenuIfNeeded() {
      var toggle = document.getElementById("navToggle");
      var links = document.getElementById("navLinks");
      var overlay = document.getElementById("navOverlay");
      if (links) links.classList.remove("open");
      if (toggle) {
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
      if (overlay) overlay.classList.remove("open");
      nav.classList.remove("menu-open");
    }

    function updateNav() {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var links = document.getElementById("navLinks");
      var menuOpen = links && links.classList.contains("open");
      var shouldDock = y > DOCK_AT;
      var wasDocked = nav.classList.contains("nav-docked");

      nav.classList.toggle("scrolled", y > 24);
      nav.classList.toggle("nav-docked", shouldDock);
      if (menuOpen) nav.classList.add("menu-open");
      else nav.classList.remove("menu-open");

      pinDockedNav(nav, shouldDock, y);

      if (wasDocked && !shouldDock) closeMenuIfNeeded();
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(updateNav);
        ticking = true;
      }
    }

    updateNav();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateNav);
  }

  function bindBackToTop() {
    if (document.getElementById("backToTop")) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "backToTop";
    btn.className = "back-to-top";
    btn.setAttribute("aria-label", "Scroll to top");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    document.body.appendChild(btn);

    function updateButton() {
      var doc = document.documentElement;
      var scrollable = Math.max(doc.scrollHeight - window.innerHeight, 1);
      var progress = window.scrollY / scrollable;
      btn.classList.toggle("is-visible", progress >= 0.08);
    }

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    updateButton();
    window.addEventListener("scroll", updateButton, { passive: true });
    window.addEventListener("resize", updateButton);
  }

  function init() {
    injectShoreDecor();

    if (!isGuestPage()) return;

    injectFrameDecor();
    bindPageTransitions();
    injectSectionDividers();
    bindSectionAnimations();
    bindStickyNav();
    bindBackToTop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* Expose for index.html envelope + hash scroll */
  window.WeddingUI = window.WeddingUI || {};
  window.WeddingUI.scrollToHash = scrollToHash;
})();
