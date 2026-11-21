(function () {
  'use strict';

  var body = document.body;
  var consent = body.dataset.consent === '1';
  var market = body.dataset.market || 'en';
  var marketPrefix = body.dataset.marketPrefix || market;
  var locale = body.dataset.locale || 'en';
  var pageType = body.dataset.pageType || 'page';
  var productSku = body.dataset.productSku || '';
  var csrf = body.dataset.csrf || '';
  var currentPath = body.dataset.currentPath || (window.location.pathname || '/');
  var INQUIRY_KEY = 'olang_inquiry_v1';
  var COMPARE_KEY = 'olang_compare_v1';
  var SESSION_KEY = 'olang_session_v1';

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function readList(key) {
    try {
      var raw = window.localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) { return []; }
  }
  function writeList(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage may be blocked */ }
  }
  function inquiryList() { return readList(INQUIRY_KEY).filter(function (item) { return item && item.sku; }); }
  function saveInquiry(items) { writeList(INQUIRY_KEY, items.slice(0, 10)); }
  function compareList() { return readList(COMPARE_KEY).filter(function (item) { return item && item.sku; }).slice(0, 4); }
  function saveCompare(items) { writeList(COMPARE_KEY, items.slice(0, 4)); }
  function randomId(prefix) {
    var bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    var value = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return (prefix || 'e') + '_' + value + Date.now().toString(36);
  }
  function sessionId() {
    try {
      var id = window.sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        window.sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (error) { return 's_anon'; }
  }

  function toast(message) {
    var existing = $('.toast');
    if (existing) existing.remove();
    var node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(function () {
      node.classList.add('toast-out');
      window.setTimeout(function () { node.remove(); }, 300);
    }, 2600);
  }

  // ---------------------------------------------------------------------
  // Consent-gated first-party events
  // ---------------------------------------------------------------------
  function track(eventName, props) {
    if (!consent) return;
    var payload = {
      event_id: randomId('e'),
      event_name: eventName,
      session_id: sessionId(),
      path: currentPath,
      page_type: pageType,
      market: market,
      locale: locale,
      product_sku: productSku || null,
      referrer: document.referrer || '',
      props: props || {}
    };
    var bodyText = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([bodyText], { type: 'application/json' });
        navigator.sendBeacon('/api/events', blob);
      } else {
        fetch('/api/events', {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: bodyText
        }).catch(function () {});
      }
    } catch (error) { /* analytics must not break the site */ }
  }

  // Other modules (gallery, customizer, assistant) use the same consent gate.
  window.olangTrack = track;

  track('page_view', {});
  if (pageType === 'product' && productSku) {
    track('product_detail_view', { sku: productSku });
    track('product_view', { sku: productSku });
  }
  if (pageType === 'product_category') track('product_category_view', { category: document.body.getAttribute('data-page-category') || '' });
  if (pageType === 'success') track('inquiry_success', {});
  if (pageType === 'customization_success') track('inquiry_submit_success', { form_type: 'customization' });
  if (body.dataset.formError) track('inquiry_submit_error', { form_type: pageType, error: body.dataset.formError.slice(0, 80) });

  // Scroll depth is recorded once per threshold and per page. It is a
  // consented, first-party event like every other item in this file.
  (function initScrollDepth() {
    if (!consent) return;
    var marks = {};
    var thresholds = [25, 50, 75, 100];
    function measure() {
      var height = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var depth = Math.min(100, Math.round((window.scrollY / height) * 100));
      thresholds.forEach(function (threshold) {
        if (depth >= threshold && !marks[threshold]) {
          marks[threshold] = true;
          track('scroll_depth', { depth: threshold });
        }
      });
    }
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    window.setTimeout(measure, 500);
  })();

  // ---------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------
  var menuToggle = $('[data-menu-toggle]');
  var nav = $('[data-nav]');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      $$('.nav-sub[open]').forEach(function (details) { details.open = false; });
    }
  });
  document.addEventListener('click', function (event) {
    $$('.nav-sub[open]').forEach(function (details) {
      if (!details.contains(event.target)) details.open = false;
    });
  });

  // ---------------------------------------------------------------------
  // Inquiry list
  // ---------------------------------------------------------------------
  function itemFromButton(button) {
    return {
      sku: button.getAttribute('data-sku') || '',
      name: button.getAttribute('data-name') || '',
      url: button.getAttribute('data-url') || '',
      image: button.getAttribute('data-image') || '',
      category: button.getAttribute('data-category') || '',
      quantity: button.getAttribute('data-quantity') || '',
      notes: button.getAttribute('data-notes') || '',
      finish: button.getAttribute('data-finish') || ''
    };
  }

  function updateCounts() {
    var items = inquiryList();
    $$('[data-inquiry-count], [data-compare-list-count]').forEach(function (node) {
      node.textContent = String(items.length);
    });
    var empty = $('[data-inquiry-empty]');
    if (empty) empty.hidden = items.length > 0;
    var controls = $('[data-inquiry-controls]');
    if (controls) controls.hidden = items.length === 0;
  }

  function itemForSummary(item) {
    var row = document.createElement('div');
    row.className = 'inquiry-item';
    row.setAttribute('data-summary-sku', item.sku);
    if (item.image && item.image.charAt(0) === '/') {
      var img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.width = 56;
      img.height = 56;
      row.appendChild(img);
    } else {
      var spacer = document.createElement('span');
      row.appendChild(spacer);
    }
    var info = document.createElement('div');
    var link = document.createElement('a');
    link.href = item.url && item.url.charAt(0) === '/' ? item.url : '#';
    var strong = document.createElement('strong');
    strong.textContent = item.name || item.sku;
    link.appendChild(strong);
    info.appendChild(link);
    var small = document.createElement('small');
    small.textContent = item.sku + (item.category ? ' · ' + item.category : '');
    info.appendChild(small);
    var rowControls = document.createElement('div');
    rowControls.className = 'inquiry-item-controls';
    var qtyLabel = document.createElement('label');
    qtyLabel.className = 'sr-only';
    qtyLabel.textContent = body.dataset.labelQuantity || 'Quantity';
    var qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = '1000000';
    qty.placeholder = body.dataset.labelQuantity || 'Quantity';
    qty.value = item.quantity || '';
    qty.setAttribute('data-summary-qty', '');
    qtyLabel.appendChild(qty);
    var note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 500;
    note.placeholder = body.dataset.labelNotes || 'Notes';
    note.value = item.notes || '';
    note.setAttribute('data-summary-notes', '');
    rowControls.appendChild(qtyLabel);
    rowControls.appendChild(note);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-button';
    remove.textContent = body.dataset.labelRemove || 'Remove';
    remove.setAttribute('data-summary-remove', '');
    rowControls.appendChild(remove);
    row.appendChild(info);
    row.appendChild(rowControls);
    return row;
  }

  function renderSummary() {
    var container = $('[data-inquiry-items]');
    if (!container) return;
    var items = inquiryList();
    container.textContent = '';
    items.forEach(function (item) { container.appendChild(itemForSummary(item)); });
    updateCounts();
  }

  function addInquiryItem(item, announce) {
    var items = inquiryList();
    var existing = items.find(function (entry) { return entry.sku === item.sku; });
    if (existing) {
      if (announce) toast(body.dataset.msgExists || 'This SKU is already in the inquiry list.');
      return false;
    }
    if (items.length >= 10) {
      toast(body.dataset.msgListFull || 'Maximum reached.');
      return false;
    }
    items.push(item);
    saveInquiry(items);
    syncPickerFromStore();
    renderSummary();
    updateCounts();
    if (announce) toast(body.dataset.msgAdded || 'Added to inquiry list.');
    track('add_to_inquiry', { sku: item.sku, item_count: items.length });
    track('add_to_quote', { sku: item.sku, item_count: items.length, source: productSku ? 'product' : 'catalogue' });
    return true;
  }

  function removeInquiryItem(sku) {
    var items = inquiryList().filter(function (item) { return item.sku !== sku; });
    saveInquiry(items);
    syncPickerFromStore();
    renderSummary();
    updateCounts();
    toast(body.dataset.msgRemoved || 'Removed from the list.');
    track('remove_from_inquiry', { sku: sku, item_count: items.length });
  }

  function updateItem(sku, changes) {
    var items = inquiryList();
    var item = items.find(function (entry) { return entry.sku === sku; });
    if (!item) return;
    Object.assign(item, changes);
    saveInquiry(items);
    updateCounts();
  }

  function syncPickerFromStore() {
    var items = inquiryList();
    var map = {};
    items.forEach(function (item) { map[item.sku] = item; });
    $$('[data-picker-row]').forEach(function (row) {
      var sku = row.getAttribute('data-sku');
      var check = $('[data-picker-check]', row);
      var qty = $('[data-picker-qty]', row);
      var note = $('[data-picker-note]', row);
      if (!check) return;
      if (map[sku]) {
        check.checked = true;
        if (qty && document.activeElement !== qty) qty.value = map[sku].quantity || '';
        if (note && document.activeElement !== note) note.value = map[sku].notes || '';
      } else {
        check.checked = false;
        if (qty) qty.value = '';
        if (note) note.value = '';
      }
    });
  }

  function pickerRowItem(row) {
    return {
      sku: row.getAttribute('data-sku') || '',
      name: row.getAttribute('data-name') || '',
      url: row.getAttribute('data-url') || '',
      image: row.getAttribute('data-image') || '',
      category: row.getAttribute('data-category') || '',
      quantity: ($('[data-picker-qty]', row) || {}).value || '',
      notes: ($('[data-picker-note]', row) || {}).value || ''
    };
  }

  function initPickers() {
    $$('[data-picker-row]').forEach(function (row) {
      var check = $('[data-picker-check]', row);
      var qty = $('[data-picker-qty]', row);
      var note = $('[data-picker-note]', row);
      if (!check) return;
      check.addEventListener('change', function () {
        if (check.checked) {
          addInquiryItem(pickerRowItem(row), false);
        } else {
          removeInquiryItem(row.getAttribute('data-sku'));
        }
      });
      [qty, note].forEach(function (input) {
        if (!input) return;
        input.addEventListener('input', function () {
          if (check.checked) {
            updateItem(row.getAttribute('data-sku'), {
              quantity: qty ? qty.value : '',
              notes: note ? note.value : ''
            });
            renderSummary();
          }
        });
      });
    });
    syncPickerFromStore();
  }

  $$('[data-add-inquiry]').forEach(function (button) {
    button.addEventListener('click', function () {
      addInquiryItem(itemFromButton(button), true);
      button.textContent = button.textContent.replace(/Add to inquiry list|Zur Anfrageliste|Aggiungi alla lista/i, body.dataset.msgAdded || '');
    });
  });

  document.addEventListener('click', function (event) {
    var remove = event.target.closest && event.target.closest('[data-summary-remove]');
    if (remove) {
      var row = remove.closest('[data-summary-sku]');
      if (row) removeInquiryItem(row.getAttribute('data-summary-sku'));
    }
    var clear = event.target.closest && event.target.closest('[data-inquiry-clear]');
    if (clear) {
      if (window.confirm(body.dataset.msgClearConfirm || 'Clear all products from this browser list?')) {
        saveInquiry([]);
        syncPickerFromStore();
        renderSummary();
        updateCounts();
        toast(body.dataset.msgRemoved || 'List cleared.');
      }
    }
  });

  document.addEventListener('input', function (event) {
    var row = event.target.closest && event.target.closest('[data-summary-sku]');
    if (!row) return;
    if (!event.target.matches('[data-summary-qty], [data-summary-notes]')) return;
    var qty = $('[data-summary-qty]', row);
    var notes = $('[data-summary-notes]', row);
    updateItem(row.getAttribute('data-summary-sku'), {
      quantity: qty ? qty.value : '',
      notes: notes ? notes.value : ''
    });
    syncPickerFromStore();
  });

  initPickers();
  renderSummary();
  updateCounts();

  // ---------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------
  function updateCompareUI() {
    var items = compareList();
    $$('[data-compare-count]').forEach(function (node) { node.textContent = String(items.length); });
    var skus = items.map(function (item) { return item.sku; }).join(',');
    var url = '/' + marketPrefix + '/compare' + (skus ? '?skus=' + encodeURIComponent(skus) : '');
    $$('[data-compare-link]').forEach(function (link) { link.setAttribute('href', url); });
    $$('[data-compare-bar]').forEach(function (bar) { bar.hidden = items.length === 0; });
    document.body.classList.toggle('compare-active', items.length > 0);
  }

  function setCompareFromQuery() {
    var page = $('[data-compare-page]');
    if (!page) return;
    var initial = (page.getAttribute('data-initial-skus') || '').split(',').map(function (sku) { return sku.trim(); }).filter(Boolean);
    if (initial.length) {
      saveCompare(initial.map(function (sku) {
        var existing = compareList().find(function (item) { return item.sku === sku; });
        return existing || { sku: sku, name: sku };
      }));
    } else if (compareList().length) {
      window.location.replace('/' + marketPrefix + '/compare?skus=' + encodeURIComponent(compareList().map(function (item) { return item.sku; }).join(',')));
    }
  }

  $$('[data-compare-sku]').forEach(function (checkbox) {
    var sku = checkbox.getAttribute('data-compare-sku');
    var name = checkbox.getAttribute('data-compare-name') || sku;
    checkbox.checked = compareList().some(function (item) { return item.sku === sku; });
    checkbox.addEventListener('change', function () {
      var items = compareList();
      if (checkbox.checked) {
        if (!items.some(function (item) { return item.sku === sku; })) {
          if (items.length >= 4) {
            checkbox.checked = false;
            toast(body.dataset.msgCompareMax || 'You can compare up to 4 products.');
            return;
          }
          items.push({ sku: sku, name: name });
        }
      } else {
        items = items.filter(function (item) { return item.sku !== sku; });
      }
      saveCompare(items);
      updateCompareUI();
      track('product_compare', { sku: sku, item_count: items.length });
    });
  });

  document.addEventListener('click', function (event) {
    var clear = event.target.closest && event.target.closest('[data-compare-clear]');
    if (clear) {
      saveCompare([]);
      updateCompareUI();
      if (event.target.closest('[data-compare-page]')) {
        window.location.href = '/' + marketPrefix + '/compare';
      }
    }
    var remove = event.target.closest && event.target.closest('[data-compare-remove]');
    if (remove) {
      var sku = remove.getAttribute('data-compare-remove');
      saveCompare(compareList().filter(function (item) { return item.sku !== sku; }));
      updateCompareUI();
    }
  });

  // ---------------------------------------------------------------------
  // Conversion paths that are not form submissions
  // ---------------------------------------------------------------------
  // Two actions had no measurement before this release: taking the catalogue and starting a
  // WhatsApp conversation. Both are recorded with the location that produced the click, so the
  // funnel can tell a product-page tap from a footer tap.
  document.addEventListener('click', function (event) {
    if (!event.target.closest) return;
    var catalogueLink = event.target.closest('[data-catalogue-download]');
    if (catalogueLink) {
      track('catalogue_download', {
        asset: catalogueLink.getAttribute('data-catalogue-download') || 'catalogue',
        location: catalogueLink.getAttribute('data-catalogue-location') || 'unknown',
      });
    }
    var whatsappLink = event.target.closest('[data-whatsapp-cta]');
    if (whatsappLink) {
      track('whatsapp_click', {
        location: whatsappLink.getAttribute('data-whatsapp-location') || 'unknown',
        sku: productSku || null,
      });
    }
    var finishRequest = event.target.closest('[data-finish-sample]');
    if (finishRequest) {
      track('finish_sample_request', {
        sku: finishRequest.getAttribute('data-finish-sample') || productSku || null,
        finish: finishRequest.getAttribute('data-finish-label') || null,
      });
    }
  });

  setCompareFromQuery();
  updateCompareUI();

  // ---------------------------------------------------------------------
  // Cookie consent forms
  // ---------------------------------------------------------------------
  $$('[data-consent-form]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.fetch || !window.FormData) return;
      event.preventDefault();
      var value = event.submitter && event.submitter.value ? event.submitter.value : '0';
      var data = new URLSearchParams(new FormData(form));
      data.set('analytics', value);
      fetch('/api/consent', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: data.toString()
      }).then(function (response) { return response.json(); })
        .then(function (result) {
          if (result && result.ok) window.location.reload();
          else window.alert(result && result.message ? result.message : 'The preference could not be saved.');
        })
        .catch(function () { window.alert('The preference could not be saved. Please try again.'); });
    });
  });

  // ---------------------------------------------------------------------
  // Inquiry forms
  // ---------------------------------------------------------------------
  function formAlert(form, message) {
    var alert = $('[data-form-alert]', form);
    if (!alert) return;
    alert.textContent = message;
    alert.hidden = false;
    alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function validatePicker(form) {
    if (!$('[data-picker]', form)) return true;
    var checks = $$('[data-picker-check]', form).filter(function (input) { return input.checked; });
    var fallback = $('input[name="product_categories"]', form) || $('input[name="product_interests"]', form);
    if (!checks.length && fallback && fallback.value.trim()) return true;
    if (!checks.length) {
      formAlert(form, body.dataset.msgNoItems || 'Add at least one product before submitting.');
      return false;
    }
    var bad = checks.some(function (input) {
      var row = input.closest('[data-picker-row]');
      var qty = row ? $('[data-picker-qty]', row) : null;
      return !qty || !qty.value || Number(qty.value) < 1;
    });
    if (bad) {
      formAlert(form, body.dataset.msgQtyMissing || 'Enter a quantity for each selected product.');
      return false;
    }
    return true;
  }

  function initForm(form) {
    var formType = form.getAttribute('data-form-type') || 'general';
    var started = false;
    var submit = $('button[type="submit"]', form);
    form.addEventListener('focusin', function () {
      if (started) return;
      started = true;
      track('inquiry_form_start', { form_type: formType });
      if (formType === 'oem') track('oem_brief_start', { form_type: formType });
    });
    var fileInput = $('[data-file-input]', form);
    if (fileInput) {
      var fileTrigger = $('[data-file-trigger]', form);
      var fileName = $('[data-file-name]', form);
      if (fileTrigger) fileTrigger.addEventListener('click', function () { fileInput.click(); });
      var updateFileName = function () {
        var count = fileInput.files ? fileInput.files.length : 0;
        if (!fileName) return;
        fileName.textContent = count
          ? count + ' ' + (fileInput.getAttribute('data-file-selected-label') || 'file(s) selected')
          : (fileInput.getAttribute('data-no-files-label') || 'No files selected');
      };
      fileInput.addEventListener('change', function () {
        updateFileName();
        if (fileInput.files && fileInput.files.length) {
          track('file_upload', { file_count: fileInput.files.length, form_type: formType });
        }
      });
    }
    if (!form.hasAttribute('data-ajax-form')) return;
    form.addEventListener('submit', function (event) {
      if (form._validateAllSteps && !form._validateAllSteps()) {
        event.preventDefault();
        return;
      }
      if (!validatePicker(form)) {
        event.preventDefault();
        return;
      }
      var attachmentInput = $('[data-file-input]', form);
      var noUsableFiles = !attachmentInput || !attachmentInput.files || !attachmentInput.files.length
        || (attachmentInput.files.length === 1 && attachmentInput.files[0].size === 0 && !attachmentInput.files[0].name);
      if (attachmentInput && noUsableFiles) {
        attachmentInput.disabled = true;
        window.setTimeout(function () { attachmentInput.disabled = false; }, 0);
      }
      if (!window.fetch || !window.FormData) return;
      event.preventDefault();
      var alert = $('[data-form-alert]', form);
      if (alert) alert.hidden = true;
      var original = submit ? submit.textContent : '';
      if (submit) { submit.disabled = true; submit.textContent = body.dataset.msgFormStart || 'Sending…'; }
      var data = new FormData(form);
      track('inquiry_form_submit', { form_type: formType });
      track('inquiry_submit', { form_type: formType });
      if (formType === 'oem') track('oem_inquiry', { form_type: formType });
      fetch(form.getAttribute('action') || '/api/inquiries', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Accept': 'application/json' },
        body: data
      }).then(function (response) {
        return response.json().then(function (result) { return { ok: response.ok, result: result }; });
      }).then(function (payload) {
        if (payload.ok && payload.result && payload.result.ok) {
          track('inquiry_submit_success', { form_type: formType });
          if (payload.result.reference) {
            try { window.sessionStorage.setItem('olang_last_reference', payload.result.reference); } catch (error) {}
          }
          window.location.href = payload.result.redirect || ('/' + marketPrefix + '/success');
          return;
        }
        var message = payload.result && (payload.result.message || payload.result.error)
          ? payload.result.message || body.dataset.msgFormError
          : body.dataset.msgFormError || 'The form could not be submitted.';
        formAlert(form, message);
        track('inquiry_form_error', { form_type: formType });
        track('inquiry_submit_error', { form_type: formType, error: (payload.result && payload.result.error) || 'unknown' });
        if (submit) { submit.disabled = false; submit.textContent = original; }
      }).catch(function () {
        formAlert(form, body.dataset.msgFormError || 'The form could not be submitted. Please try again.');
        track('inquiry_form_error', { form_type: formType });
        track('inquiry_submit_error', { form_type: formType, error: 'network' });
        if (submit) { submit.disabled = false; submit.textContent = original; }
      });
    });
  }

  $$('form[data-ajax-form], form[data-form-type]').forEach(initForm);

  // Product gallery: the main image and its caption follow the selected thumb.
  $$('[data-product-gallery]').forEach(function (gallery) {
    var main = $('[data-gallery-main]', gallery);
    var caption = $('[data-gallery-caption-main]', gallery);
    $$('[data-gallery-src]', gallery).forEach(function (button) {
      button.addEventListener('click', function () {
        if (!main) return;
        main.src = button.getAttribute('data-gallery-src') || main.src;
        main.alt = button.getAttribute('data-gallery-alt') || main.alt;
        if (caption) caption.textContent = button.getAttribute('data-gallery-caption') || '';
        $$('[data-gallery-src]', gallery).forEach(function (item) { item.classList.remove('is-active'); });
        button.classList.add('is-active');
        track('gallery_view', { target: main.alt });
      });
    });
  });

  // Product finish chips preselect the finish field in the quote form.
  $$('[data-finish-choice]').forEach(function (button) {
    button.addEventListener('click', function () {
      var value = button.getAttribute('data-finish-choice') || '';
      $$('[data-finish-choice]').forEach(function (item) { item.setAttribute('aria-pressed', 'false'); });
      button.setAttribute('aria-pressed', 'true');
      var select = document.querySelector('#inquiry-form select[name="requested_finish"]');
      if (select) select.value = value;
      track('finish_select', { value: value });
    });
  });

  $$('[data-filter-form]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var data = new FormData(form);
      var q = String(data.get('q') || '').trim();
      if (q) track('product_search', { query: q.slice(0, 100), result_count: null });
      track('product_filter', {
        filter_type: 'catalogue',
        filter_value: [
          data.get('category'), data.get('series'), data.get('finish'), data.get('material'), data.get('oem'), data.get('sort')
        ].filter(Boolean).join('|').slice(0, 200)
      });
    });
  });

  // ---------------------------------------------------------------------
  // OEM step wizard
  // ---------------------------------------------------------------------
  $$('form[data-wizard]').forEach(function (form) {
    var steps = $$('[data-wizard-step]', form);
    if (!steps.length) return;
    var progress = $('[data-wizard-progress]', form);
    var submit = $('button[type="submit"]', form);
    var current = 0;
    var nav = document.createElement('div');
    nav.className = 'wizard-nav';
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-ghost';
    back.textContent = body.dataset.msgBack || 'Back';
    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-primary';
    next.textContent = body.dataset.msgNext || 'Next';
    nav.appendChild(back);
    nav.appendChild(next);
    steps[steps.length - 1].parentNode.insertBefore(nav, steps[steps.length - 1].nextSibling);
    form.noValidate = true;

    function buildProgress() {
      if (!progress) return;
      progress.textContent = '';
      steps.forEach(function (step, index) {
        var legend = $('legend', step);
        var item = document.createElement('li');
        item.textContent = legend ? legend.textContent.trim().replace(/^\d+\s*/, '') : String(index + 1);
        if (index === current) item.classList.add('active');
        progress.appendChild(item);
      });
    }

    function show(index) {
      current = Math.max(0, Math.min(steps.length - 1, index));
      steps.forEach(function (step, idx) { step.hidden = idx !== current; });
      buildProgress();
      back.disabled = current === 0;
      next.hidden = current === steps.length - 1;
      if (submit) submit.hidden = current !== steps.length - 1;
      var heading = $('legend', steps[current]);
      if (heading) heading.setAttribute('tabindex', '-1');
    }

    function validateStep(index) {
      var fields = $$('input, select, textarea', steps[index]).filter(function (field) {
        return field.willValidate && !field.disabled;
      });
      for (var i = 0; i < fields.length; i += 1) {
        if (!fields[i].checkValidity()) {
          fields[i].reportValidity();
          return false;
        }
      }
      return true;
    }

    form._validateAllSteps = function () {
      for (var i = 0; i < steps.length; i += 1) {
        if (!validateStep(i)) {
          show(i);
          return false;
        }
      }
      return true;
    };

    next.addEventListener('click', function () {
      if (!validateStep(current)) return;
      show(current + 1);
    });
    back.addEventListener('click', function () { show(current - 1); });
    show(0);
  });

  // ---------------------------------------------------------------------
  // Measurement-unit switch (market default, visitor override)
  // ---------------------------------------------------------------------
  (function initUnits() {
    var buttons = $$('[data-unit-toggle]');
    if (!buttons.length) return;
    var UNIT_KEY = 'olang_units_v1';
    var stored = '';
    try { stored = window.localStorage.getItem(UNIT_KEY) || ''; } catch (error) { stored = ''; }
    var initial = stored === 'metric' || stored === 'imperial' ? stored : (body.dataset.unitSystem || 'metric');
    body.dataset.unitSystem = initial;
    function applyUnits(system) {
      body.dataset.unitSystem = system;
      $$('[data-measure-metric]').forEach(function (node) {
        node.classList.toggle('measure-hidden', system !== 'metric');
      });
      $$('[data-measure-imperial]').forEach(function (node) {
        node.classList.toggle('measure-hidden', system !== 'imperial');
      });
      buttons.forEach(function (button) {
        if (button.getAttribute('data-unit-current') === system) return;
        var labels = button.querySelectorAll('[data-unit-label], [data-unit-target]');
        if (labels.length === 2) {
          var first = labels[0].textContent;
          labels[0].textContent = labels[1].textContent;
          labels[1].textContent = first;
        }
        button.setAttribute('data-unit-current', system);
        button.setAttribute('aria-pressed', system === 'imperial' ? 'true' : 'false');
      });
      try { window.localStorage.setItem(UNIT_KEY, system); } catch (error) { /* storage may be blocked */ }
      window.dispatchEvent(new CustomEvent('olang:units', { detail: { system: system } }));
      track('unit_switch', { system: system });
    }
    applyUnits(initial);
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        applyUnits(body.dataset.unitSystem === 'metric' ? 'imperial' : 'metric');
      });
    });
  })();

  // ---------------------------------------------------------------------
  // Assistant
  // ---------------------------------------------------------------------
  var assistant = $('[data-assistant]');
  if (assistant) {
    var openButton = $('[data-assistant-open]');
    var panel = $('[data-assistant-panel]');
    var closeButton = $('[data-assistant-close]');
    var assistantForm = $('[data-assistant-form]');
    var answerBox = $('[data-assistant-answer]');
    var input = $('#assistant-question');
    var nudge = $('[data-assistant-nudge]');
    var backdrop = $('[data-assistant-backdrop]');
    var previousFocus = null;
    var nudgeTimer = null;
    var NUDGE_KEY = 'olang.assistant.nudge.v1';

    function hideNudge() {
      if (nudgeTimer) { window.clearTimeout(nudgeTimer); nudgeTimer = null; }
      if (nudge) nudge.hidden = true;
    }
    function markNudgeSeen() {
      try { window.localStorage.setItem(NUDGE_KEY, '1'); } catch (error) { /* storage may be blocked */ }
    }
    function showNudge() {
      if (!nudge || panel.hidden === false) return;
      try { if (window.localStorage.getItem(NUDGE_KEY) === '1') return; } catch (error) { /* ignore */ }
      nudge.hidden = false;
      markNudgeSeen();
      nudgeTimer = window.setTimeout(hideNudge, 8000);
    }
    var protectAssistant = function () {
      if (!openButton || !panel.hidden) return;
      var suppressed = openButton.classList.contains('assistant-suppressed');
      var rect = suppressed && lastAssistantRect ? lastAssistantRect : openButton.getBoundingClientRect();
      if (!suppressed) lastAssistantRect = rect;
      var hit = $$('a, button, input, select, textarea').some(function (element) {
        if (element === openButton || element.closest('[data-assistant-panel]')) return false;
        var other = element.getBoundingClientRect();
        return other.width > 0 && other.height > 0
          && Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 4
          && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 4;
      });
      if (hit) { openButton.classList.add('assistant-suppressed'); hideNudge(); }
      else if (suppressed) { openButton.classList.remove('assistant-suppressed'); }
    };
    var lastAssistantRect = null;
    var protectFrame = 0;
    function scheduleProtection() {
      if (protectFrame) return;
      protectFrame = window.requestAnimationFrame(function () { protectFrame = 0; protectAssistant(); });
    }
    window.addEventListener('scroll', scheduleProtection, { passive: true });
    window.addEventListener('resize', scheduleProtection);
    window.setTimeout(protectAssistant, 100);
    window.setInterval(protectAssistant, 400);
    if (nudge) {
      window.setTimeout(showNudge, 1500);
      document.addEventListener('scroll', function () {
        if (window.scrollY > 300) hideNudge();
      }, { passive: true });
    }

    function openAssistant() {
      hideNudge();
      previousFocus = document.activeElement;
      panel.hidden = false;
      if (backdrop) backdrop.hidden = false;
      openButton.setAttribute('aria-expanded', 'true');
      body.classList.add('assistant-open');
      if (input) input.focus();
      track('assistant_open', {});
      track('chatbot_open', {});
    }
    function closeAssistant() {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
      openButton.setAttribute('aria-expanded', 'false');
      body.classList.remove('assistant-open');
      scheduleProtection();
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
      else openButton.focus();
    }
    openButton.addEventListener('click', function () { panel.hidden ? openAssistant() : closeAssistant(); });
    closeButton.addEventListener('click', closeAssistant);
    if (backdrop) backdrop.addEventListener('click', closeAssistant);
    panel.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab' || panel.hidden) return;
      var focusable = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', panel)
        .filter(function (element) { return !element.disabled && element.getClientRects().length > 0; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (nudge && !nudge.hidden) hideNudge();
        if (!panel.hidden) closeAssistant();
      }
    });

    function assistantError(message) {
      answerBox.textContent = '';
      var p = document.createElement('p');
      p.className = 'answer-text';
      p.textContent = message;
      answerBox.appendChild(p);
    }

    function askAssistant(question) {
      if (!question.trim()) return;
      answerBox.textContent = '';
      var loading = document.createElement('p');
      loading.className = 'answer-text';
      loading.textContent = body.dataset.msgAssistantThinking || 'Searching…';
      answerBox.appendChild(loading);
      track('assistant_question', { question_length: question.trim().length });
      track('chatbot_question', { question_length: question.trim().length });
      fetch('/api/assistant', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ question: question.trim(), market: market })
      }).then(function (response) { return response.json().then(function (result) { return { status: response.status, result: result }; }); })
        .then(function (payload) {
          if (!payload.result || !payload.result.ok) {
            if (payload.status === 429) assistantError(body.dataset.msgAssistantRate || 'Too many questions.');
            else assistantError(body.dataset.msgAssistantError || 'The assistant is unavailable.');
            return;
          }
          answerBox.textContent = '';
          track('assistant_answer', { matched_type: payload.result.matched_type || 'answer' });
          track('chatbot_answer', { matched_type: payload.result.matched_type || 'answer' });
          if (payload.result.matched_type === 'handoff') track('chatbot_handoff', { matched_type: 'handoff' });
          var answer = document.createElement('p');
          answer.className = 'answer-text';
          answer.textContent = payload.result.answer;
          answerBox.appendChild(answer);
          if (payload.result.actions && payload.result.actions.length) {
            var actions = document.createElement('div');
            actions.className = 'assistant-actions';
            payload.result.actions.forEach(function (action) {
              if (!action || typeof action.type !== 'string') return;
              if (action.type === 'add_to_list') {
                var addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.className = 'chip';
                addButton.textContent = (body.dataset.msgAddToList || 'Add to procurement list') + ' · ' + action.sku;
                addButton.addEventListener('click', function () {
                  var added = addInquiryItem({
                    sku: action.sku,
                    name: action.name,
                    url: action.url,
                    image: action.image,
                    category: action.category,
                    quantity: '',
                    notes: ''
                  });
                  if (added) toast(body.dataset.msgAdded || 'Added to the procurement list.');
                  else toast(body.dataset.msgExists || 'This SKU is already in the list.');
                });
                actions.appendChild(addButton);
                return;
              }
              if (action.type === 'set_quantity' && action.sku) {
                var items = inquiryList();
                var target = items.find(function (entry) { return entry.sku === action.sku; });
                if (target) {
                  target.quantity = String(action.quantity);
                  saveInquiry(items);
                  renderSummary();
                  updateCounts();
                  toast(body.dataset.msgQuantitySet || ('Quantity set: ' + action.quantity));
                } else if (action.name) {
                  addInquiryItem({
                    sku: action.sku,
                    name: action.name,
                    url: action.url,
                    image: action.image,
                    category: action.category,
                    quantity: String(action.quantity),
                    notes: ''
                  });
                  toast(body.dataset.msgQuantitySet || ('Quantity set: ' + action.quantity));
                }
                return;
              }
              if (typeof action.url === 'string' && action.url.charAt(0) === '/') {
                var link = document.createElement('a');
                link.className = 'chip';
                link.href = action.url;
                link.textContent = action.label || action.url;
                actions.appendChild(link);
              }
            });
            answerBox.appendChild(actions);
          }
          if (payload.result.sources && payload.result.sources.length) {
            var sources = document.createElement('div');
            sources.className = 'sources';
            var strong = document.createElement('strong');
            strong.textContent = body.dataset.msgAssistantSources || 'Sources';
            sources.appendChild(strong);
            payload.result.sources.forEach(function (source) {
              if (!source || typeof source.url !== 'string' || source.url.charAt(0) !== '/') return;
              var a = document.createElement('a');
              a.href = source.url;
              a.textContent = source.title || source.url;
              sources.appendChild(a);
            });
            answerBox.appendChild(sources);
          }
          var feedback = document.createElement('div');
          feedback.className = 'assistant-feedback';
          var prompt = document.createElement('span');
          prompt.textContent = body.dataset.msgAssistantFeedback || 'Was this answer useful?';
          feedback.appendChild(prompt);
          [['yes', body.dataset.msgAssistantYes || 'Yes'], ['no', body.dataset.msgAssistantNo || 'No']].forEach(function (option) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'chip';
            button.textContent = option[1];
            button.addEventListener('click', function () {
              track('chatbot_feedback', { helpful: option[0] === 'yes' });
              feedback.textContent = body.dataset.msgAssistantThanks || 'Thank you for the feedback.';
            });
            feedback.appendChild(button);
          });
          answerBox.appendChild(feedback);
          var contact = document.createElement('div');
          contact.className = 'sources';
          var cta = document.createElement('a');
          cta.href = '/' + marketPrefix + '/contact';
          cta.textContent = body.dataset.msgAssistantContact || 'Submit an inquiry';
          cta.addEventListener('click', function () {
            track('assistant_handoff', {});
            track('chatbot_handoff', {});
          });
          contact.appendChild(cta);
          answerBox.appendChild(contact);
        })
        .catch(function () { assistantError(body.dataset.msgAssistantError || 'The assistant is unavailable.'); });
    }

    assistantForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var question = input.value;
      if (!question.trim()) {
        assistantError(body.dataset.msgAssistantEmpty || 'Enter a question.');
        return;
      }
      askAssistant(question);
    });
    $$('[data-assistant-suggestion]').forEach(function (button) {
      button.addEventListener('click', function () {
        input.value = button.textContent;
        askAssistant(button.textContent);
      });
    });
    $$('[data-open-assistant]').forEach(function (button) {
      button.addEventListener('click', function () {
        openAssistant();
        if (!input.value.trim() && productSku) {
          input.value = (body.dataset.msgAssistantProduct || 'Tell me about') + ' ' + productSku;
        }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Reference copy
  // ---------------------------------------------------------------------
  var copyReference = $('[data-copy-reference]');
  if (copyReference) {
    copyReference.addEventListener('click', function () {
      var ref = $('[data-reference]');
      if (!ref) return;
      var value = ref.textContent.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () { toast(body.dataset.msgCopied || 'Copied'); }).catch(function () {});
      }
    });
  }

  // ---------------------------------------------------------------------
  // Event tracking for navigation and contact
  // ---------------------------------------------------------------------
  $$('[data-market-switch]').forEach(function (link) {
    link.addEventListener('click', function () {
      var target = link.getAttribute('data-locale-target') || '';
      track('market_switch', { from_market: market, to_market: link.getAttribute('data-market-switch'), from_locale: locale, to_locale: target });
      if (target && target !== locale) {
        track('language_switch', { from_locale: locale, to_locale: target });
      }
    });
  });
  $$('.btn-primary').forEach(function (link) {
    link.addEventListener('click', function () { track('CTA_click', { cta: (link.textContent || '').trim().slice(0, 80) }); });
  });
  $$('a[href^="mailto:"], a[href^="tel:"]').forEach(function (link) {
    link.addEventListener('click', function () { track('contact_click', { target: link.getAttribute('href') || '' }); });
  });
  // Quote/contact CTAs and outbound links are tracked separately so the
  // funnel can distinguish a navigation click from an actual form start.
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('/contact') !== -1 || href.indexOf('/inquiry') !== -1 || href.indexOf('/customization') !== -1 || href.indexOf('#inquiry-form') !== -1) {
      track('inquiry_click', { cta: (link.textContent || '').trim().slice(0, 80), target: href.slice(0, 200) });
    }
    if (link.closest('.site-header') || link.closest('.site-footer')) {
      track('navigation_click', { target: href.slice(0, 200), location: link.closest('.site-header') ? 'header' : 'footer' });
    }
    if (/\.pdf($|\?)/i.test(href) || link.hasAttribute('data-technical-document')) {
      track('technical_document_download', { asset: (link.textContent || 'PDF').trim().slice(0, 100), target: href.slice(0, 200) });
    }
    if (!/^https?:\/\//i.test(href)) return;
    try {
      var target = new URL(href, window.location.href);
      if (target.origin !== window.location.origin) {
        track('outbound_click', { target: target.href.slice(0, 300) });
      }
    } catch (error) { /* malformed link */ }
  });

  // Specification sections are <details>; record the first expand per page.
  $$('.product-accordion').forEach(function (details) {
    details.addEventListener('toggle', function () {
      if (details.open) {
        track('specification_expand', { asset: (details.querySelector('summary') || {}).textContent || '', section: 'accordion' });
      }
    });
  });

  // Consented session duration. Not a heartbeat: one value per page view.
  (function initSessionDuration() {
    if (!consent) return;
    var startedAt = Date.now();
    var sent = false;
    function sendDuration() {
      if (sent) return;
      var seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds < 3) return;
      sent = true;
      track('session_duration', { duration_seconds: Math.min(seconds, 7200) });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendDuration();
    });
    window.addEventListener('pagehide', sendDuration);
  })();
  // Document downloads are recorded server-side after access control, so the
  // client does not send a second specification_download event.
  if (pageType === 'resources') {
    $$('[data-document-request]').forEach(function (link) {
      link.addEventListener('click', function () { track('document_request', { sku: link.getAttribute('data-sku') || '', document_type: link.getAttribute('data-type') || '' }); });
    });
  }
})();


(function () {
  var cta = document.querySelector('[data-mobile-cta]');
  if (!cta) return;
  function update() { cta.classList.toggle('is-visible', window.scrollY > Math.min(520, window.innerHeight * .72)); }
  window.addEventListener('scroll', update, { passive: true });
  update();
}());


(function () {
  if (document.body.getAttribute('data-page-type') !== 'product') return;
  var revealed = false;
  function maybeReveal() {
    if (revealed) return;
    if (window.scrollY > Math.min(680, window.innerHeight * .9)) {
      revealed = true;
      document.body.classList.add('cookie-delayed-visible');
    }
  }
  window.addEventListener('scroll', maybeReveal, { passive: true });
  maybeReveal();
}());
