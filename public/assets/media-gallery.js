'use strict';

// Product gallery: one official overview plus real official finish photographs,
// with a zoomable lightbox. No CSS crop, duplicated "detail" view or generated
// image is used here.
(function () {
  var main = document.querySelector('[data-photo-main]');
  var lightbox = document.querySelector('[data-photo-lightbox]');
  if (!main || !lightbox) return;
  var frame = document.querySelector('[data-photo-frame]');
  var large = lightbox.querySelector('[data-photo-large]');
  var lightboxFrame = lightbox.querySelector('.lightbox-frame');
  var close = lightbox.querySelector('[data-photo-close]');
  var caption = document.querySelector('[data-photo-caption]');
  var zoom = 1;
  var x = 0;
  var y = 0;
  var dragging = false;
  var sx = 0;
  var sy = 0;
  var lastFocus = null;

  function track(name, props) {
    if (typeof window.olangTrack === 'function') window.olangTrack(name, props || {});
  }

  function apply() {
    if (!lightboxFrame) return;
    lightboxFrame.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + zoom + ')';
  }

  function open() {
    lastFocus = document.activeElement;
    large.src = main.getAttribute('data-photo-full') || main.currentSrc || main.src;
    large.alt = main.alt || '';
    zoom = 1;
    x = 0;
    y = 0;
    apply();
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    close.focus();
    track('product_image_zoom', { view: frame ? frame.getAttribute('data-view') : 'full' });
  }

  function hide() {
    lightbox.hidden = true;
    document.body.classList.remove('lightbox-open');
    if (lastFocus) lastFocus.focus();
  }

  function setZoom(next) {
    zoom = Math.max(1, Math.min(4, next));
    if (zoom === 1) { x = 0; y = 0; }
    apply();
  }

  function setCaption(text) {
    if (caption) caption.textContent = text;
  }

  function selectThumb(thumb) {
    var src = thumb.getAttribute('data-photo-thumb-src');
    var full = thumb.getAttribute('data-photo-thumb-full');
    var label = thumb.getAttribute('data-thumb-label') || '';
    var finish = thumb.getAttribute('data-finish-label') || '';
    if (!src) return;
    var picture = main.closest('picture');
    if (picture) picture.querySelectorAll('source').forEach(function (s) { s.remove(); });
    main.src = src;
    main.setAttribute('data-photo-full', full || src);
    if (frame) frame.setAttribute('data-view', 'full');
    document.querySelectorAll('[data-photo-thumb]').forEach(function (item) {
      item.classList.toggle('is-active', item === thumb);
      item.setAttribute('aria-pressed', item === thumb ? 'true' : 'false');
    });
    if (finish) {
      var target = document.querySelector('[data-color-label="' + finish.replace(/"/g, '\\"') + '"]');
      document.querySelectorAll('[data-color-image]').forEach(function (chip) {
        chip.classList.toggle('is-active', chip === target);
      });
    }
    setCaption(label);
    track(finish ? 'finish_select' : 'product_image_switch', {
      view: 'full',
      finish: finish || '',
      asset: label.slice(0, 60),
    });
  }

  document.querySelectorAll('[data-photo-thumb]').forEach(function (thumb) {
    thumb.setAttribute('aria-pressed', thumb.classList.contains('is-active') ? 'true' : 'false');
    thumb.addEventListener('click', function () { selectThumb(thumb); });
  });

  // Finish buttons without a thumbnail remain selectable; they always map to a real official photo.
  document.querySelectorAll('[data-color-image]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var finish = chip.getAttribute('data-color-label') || '';
      var thumb = Array.prototype.find.call(document.querySelectorAll('[data-photo-thumb]'), function (item) {
        return item.getAttribute('data-finish-label') === finish;
      });
      if (thumb) selectThumb(thumb);
      else {
        var src = chip.getAttribute('data-color-image');
        if (!src) return;
        var picture = main.closest('picture');
        if (picture) picture.querySelectorAll('source').forEach(function (s) { s.remove(); });
        main.src = src;
        main.setAttribute('data-photo-full', src);
        if (frame) frame.setAttribute('data-view', 'full');
        var text = chip.getAttribute('data-color-caption') || chip.getAttribute('data-color-label') || '';
        setCaption(text);
        document.querySelectorAll('[data-color-image]').forEach(function (item) { item.classList.toggle('is-active', item === chip); });
        document.querySelectorAll('[data-photo-thumb]').forEach(function (item) { item.classList.toggle('is-active', false); });
        track('finish_select', { finish: finish });
      }
    });
  });

  main.addEventListener('click', open);
  var trigger = document.querySelector('[data-photo-zoom]');
  if (trigger) trigger.addEventListener('click', open);
  close.addEventListener('click', hide);
  lightbox.addEventListener('click', function (event) { if (event.target === lightbox) hide(); });
  document.addEventListener('keydown', function (event) {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') hide();
    if (event.key === '+' || event.key === '=') setZoom(zoom + 0.25);
    if (event.key === '-') setZoom(zoom - 0.25);
  });
  lightboxFrame.addEventListener('wheel', function (event) {
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });
  lightboxFrame.addEventListener('pointerdown', function (event) {
    if (zoom <= 1) return;
    dragging = true;
    sx = event.clientX - x;
    sy = event.clientY - y;
    lightboxFrame.setPointerCapture(event.pointerId);
  });
  lightboxFrame.addEventListener('pointermove', function (event) {
    if (!dragging) return;
    x = event.clientX - sx;
    y = event.clientY - sy;
    apply();
  });
  lightboxFrame.addEventListener('pointerup', function () { dragging = false; });
  lightboxFrame.addEventListener('dblclick', function () { setZoom(zoom > 1 ? 1 : 2); });
})();
