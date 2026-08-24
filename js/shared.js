(function () {
  "use strict";

  var FLORAL_SVG =
    '<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M6 94C24 72 44 80 58 62C72 44 88 36 94 18" stroke="#b8d4de" stroke-width="1.1" stroke-linecap="round"/>' +
    '<path d="M14 86C30 68 46 72 54 60" stroke="#7a8b6f" stroke-width="0.85" stroke-linecap="round"/>' +
    '<ellipse cx="60" cy="58" rx="5" ry="9" fill="#c5d4ba" opacity="0.5" transform="rotate(-32 60 58)"/>' +
    '<ellipse cx="42" cy="74" rx="4" ry="7" fill="#b8d4de" opacity="0.45" transform="rotate(18 42 74)"/>' +
    '<circle cx="66" cy="50" r="2.5" fill="#7a8b6f" opacity="0.55"/>' +
    '<path d="M78 38C82 32 88 28 94 24" stroke="#b8d4de" stroke-width="0.65" stroke-linecap="round"/>' +
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
