(function () {
  "use strict";

  var FLORAL_SVG =
    '<svg viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M8 148C28 118 18 96 42 78C66 60 58 36 88 22C108 12 128 18 148 8" stroke="#7a8b6f" stroke-width="1.15" stroke-linecap="round"/>' +
    '<path d="M18 140C32 116 28 98 48 84C68 70 64 48 90 36" stroke="#b8d4de" stroke-width="0.9" stroke-linecap="round"/>' +
    '<ellipse cx="52" cy="92" rx="8" ry="16" fill="#c5d4ba" opacity="0.72" transform="rotate(-38 52 92)"/>' +
    '<ellipse cx="44" cy="108" rx="6.5" ry="13" fill="#7a8b6f" opacity="0.38" transform="rotate(-18 44 108)"/>' +
    '<ellipse cx="68" cy="70" rx="7" ry="14" fill="#b8d4de" opacity="0.55" transform="rotate(24 68 70)"/>' +
    '<ellipse cx="86" cy="48" rx="6" ry="12" fill="#c5d4ba" opacity="0.7" transform="rotate(-42 86 48)"/>' +
    '<ellipse cx="108" cy="32" rx="5.5" ry="11" fill="#b8d4de" opacity="0.5" transform="rotate(18 108 32)"/>' +
    '<circle cx="62" cy="78" r="5.5" fill="#5fa8b8" opacity="0.45"/>' +
    '<circle cx="62" cy="78" r="2.4" fill="#1b4965" opacity="0.28"/>' +
    '<circle cx="96" cy="42" r="4.2" fill="#7a8b6f" opacity="0.4"/>' +
    '<path d="M36 124C42 112 54 110 62 100" stroke="#7a8b6f" stroke-width="0.7" stroke-linecap="round"/>' +
    '<path d="M120 22C128 16 138 14 148 10" stroke="#b8d4de" stroke-width="0.7" stroke-linecap="round"/>' +
    "</svg>";

  var DIVIDER_SVG =
    '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="18" cy="18" r="16" stroke="#b8d4de" stroke-width="0.8" opacity="0.6"/>' +
    '<path d="M18 6C18 6 12 14 12 18C12 22 15 26 18 28C21 26 24 22 24 18C24 14 18 6 18 6Z" fill="#7a8b6f" opacity="0.35"/>' +
    '<path d="M18 10C18 10 14 16 14 18C14 20 16 23 18 24C20 23 22 20 22 18C22 16 18 10 18 10Z" fill="#b8d4de" opacity="0.4"/>' +
    "</svg>";

  function injectDecorations() {
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

    /* Safety: never leave a dark curtain stuck on screen */
    setTimeout(function () {
      curtain.classList.remove("is-entering", "is-leaving");
      curtain.classList.add("is-revealed");
    }, 1200);
  }

  function isPageLink(anchor) {
    var href = anchor.getAttribute("href");
    if (!href || href.charAt(0) === "#") return false;
    if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) return false;
    if (anchor.target === "_blank") return false;
    if (href.indexOf("/admin") !== -1) return false;
    try {
      var url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/");
    } catch (e) {
      return href.endsWith(".html") || href === "/" || href === "index.html";
    }
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
    }, 850);
  }

  function bindPageTransitions() {
    document.addEventListener("click", function (e) {
      var anchor = e.target.closest("a[href]");
      if (!anchor || !isPageLink(anchor)) return;
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function bindStickyNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;

    function updateNav() {
      nav.classList.toggle("scrolled", window.scrollY > 24);
    }

    updateNav();
    window.addEventListener("scroll", updateNav, { passive: true });
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
    injectDecorations();
    bindPageTransitions();
    injectSectionDividers();
    bindSectionAnimations();
    bindStickyNav();
    bindBackToTop();
  }
})();
