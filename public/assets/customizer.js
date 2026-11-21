'use strict';

(function () {
  var form = document.querySelector('[data-customizer-form]');
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll('[data-wizard-step]'));
  var next = form.querySelector('[data-wizard-next]');
  var back = form.querySelector('[data-wizard-back]');
  var controls = form.querySelector('[data-wizard-controls]');
  var currentLabel = document.querySelector('[data-wizard-current]');
  var alertBox = form.querySelector('[data-customizer-alert]');
  var current = Number(form.getAttribute('data-start-step') || 1);
  var maxProducts = Number(form.getAttribute('data-max-products') || 10);
  var started = false;
  var summarySeen = false;
  var submitted = false;

  function track(name, props) {
    if (typeof window.olangTrack === 'function') window.olangTrack(name, props || {});
  }
  function customerType() {
    var checked = form.querySelector('input[name="customer_type"]:checked');
    return checked ? checked.value : '';
  }
  function showError(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.hidden = false;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    if (alertBox) { alertBox.hidden = true; alertBox.textContent = ''; }
  }
  function selectedProducts() {
    return Array.prototype.slice.call(form.querySelectorAll('[data-product-check]:checked')).map(function (box) {
      var row = box.closest('[data-custom-product]');
      return {
        row: row,
        sku: box.value,
        name: (row.querySelector('.custom-product-check strong') || {}).textContent || box.value,
        qty: (row.querySelector('[data-product-qty]') || {}).value || '',
        finish: (row.querySelector('[data-product-finish]') || {}).value || '',
      };
    });
  }
  function renderSelected() {
    var list = form.querySelector('[data-selected-list]');
    if (!list) return;
    var selected = selectedProducts();
    list.textContent = '';
    if (!selected.length) {
      var empty = document.createElement('p');
      empty.className = 'small-note';
      empty.textContent = form.getAttribute('data-empty-label') || 'No product selected yet.';
      list.appendChild(empty);
      return;
    }
    selected.forEach(function (product) {
      var row = document.createElement('div');
      row.className = 'selected-product-row';
      var name = document.createElement('strong');
      name.textContent = product.name;
      var meta = document.createElement('small');
      meta.textContent = [product.sku, product.qty ? 'Qty ' + product.qty : '', product.finish].filter(Boolean).join(' · ');
      row.appendChild(name);
      row.appendChild(meta);
      list.appendChild(row);
    });
    var counter = form.querySelector('[data-selected-count]');
    if (counter) counter.textContent = String(selected.length);
  }
  function updateCustomerPanel() {
    var type = customerType();
    form.querySelectorAll('[data-buyer-panel]').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.getAttribute('data-buyer-panel') === type);
    });
  }
  function updateStep(nextStep) {
    current = Math.max(1, Math.min(steps.length, nextStep));
    steps.forEach(function (step, index) {
      step.classList.toggle('is-active', index + 1 === current);
      step.hidden = index + 1 !== current;
    });
    form.querySelectorAll('[data-wizard-indicator]').forEach(function (item) {
      var number = Number(item.getAttribute('data-wizard-indicator'));
      item.classList.toggle('is-active', number === current);
      item.classList.toggle('is-done', number < current);
    });
    if (currentLabel) currentLabel.textContent = String(current);
    if (back) back.disabled = current === 1;
    if (next) next.hidden = current === steps.length;
    if (controls) controls.hidden = current === steps.length;
    track('customization_step_view', { step: current });
    if (current === 5 && !summarySeen) { summarySeen = true; renderSummary(); track('quote_summary_view', {}); }
    var focusTarget = steps[current - 1].querySelector('legend');
    if (focusTarget) focusTarget.setAttribute('tabindex', '-1');
  }
  function fieldValue(name) {
    var field = form.querySelector('[name="' + name + '"]');
    return field ? String(field.value || '').trim() : '';
  }
  function checkedOptions() {
    return Array.prototype.slice.call(form.querySelectorAll('[data-custom-option]:checked')).map(function (box) {
      return box.closest('.custom-option-card').querySelector('strong').textContent;
    });
  }
  function renderSummary() {
    var box = form.querySelector('[data-customizer-summary]');
    if (!box) return;
    box.textContent = '';
    var type = customerType();
    var typeTitle = type ? (form.querySelector('input[name="customer_type"][value="' + type + '"]').closest('.customer-type-card').querySelector('strong').textContent) : '—';
    var selected = selectedProducts();
    var options = checkedOptions();
    var buyerLines = [];
    var panel = form.querySelector('[data-buyer-panel="' + type + '"]');
    if (panel) {
      panel.querySelectorAll('input, textarea, select').forEach(function (field) {
        if (field.value && field.type !== 'file') {
          var label = field.closest('label') ? field.closest('label').querySelector('span') : null;
          buyerLines.push((label ? label.textContent.trim() : field.name) + ': ' + field.value);
        }
      });
    }
    var files = form.querySelector('[data-file-upload]');
    function addSection(title, items) {
      var section = document.createElement('section');
      var heading = document.createElement('h3');
      heading.textContent = title;
      section.appendChild(heading);
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'small-note';
        empty.textContent = '—';
        section.appendChild(empty);
      } else {
        var list = document.createElement('ul');
        items.forEach(function (item) {
          var li = document.createElement('li');
          li.textContent = item;
          list.appendChild(li);
        });
        section.appendChild(list);
      }
      box.appendChild(section);
    }
    addSection(form.getAttribute('data-summary-type') || 'Buyer type', [typeTitle]);
    addSection(form.getAttribute('data-summary-products') || 'Products', selected.map(function (p) {
      return p.name + ' (' + p.sku + ')' + (p.qty ? ' · ' + p.qty + ' pcs' : '') + (p.finish ? ' · ' + p.finish : '');
    }));
    addSection(form.getAttribute('data-summary-custom') || 'Customization', options);
    addSection(form.getAttribute('data-summary-buyer') || 'Buying context', buyerLines);
    addSection(form.getAttribute('data-summary-files') || 'Files', files && files.files.length ? Array.prototype.map.call(files.files, function (f) { return f.name; }) : []);
  }
  function validate(step) {
    clearError();
    if (step === 1 && !customerType()) { showError(form.getAttribute('data-msg-type') || 'Choose a buyer type.'); return false; }
    if (step === 2 && selectedProducts().length === 0) { showError(form.getAttribute('data-msg-products') || 'Select at least one product.'); return false; }
    if (step === 3) {
      var hasOption = form.querySelectorAll('[data-custom-option]:checked').length > 0;
      var hasText = Array.prototype.some.call(form.querySelectorAll('[data-wizard-step="3"] textarea'), function (field) { return field.value.trim(); });
      if (!hasOption && !hasText) { showError(form.getAttribute('data-msg-custom') || 'Describe at least one customization request.'); return false; }
    }
    if (step === 6) {
      if (!fieldValue('contact_name') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldValue('email')) || !fieldValue('country')) {
        showError(form.getAttribute('data-msg-contact') || 'Enter your name, business email and country.'); return false;
      }
      if (!form.querySelector('input[name="consent"]').checked) {
        showError(form.getAttribute('data-msg-consent') || 'Please agree to the storage of the request.'); return false;
      }
      if (selectedProducts().length === 0) { updateStep(2); showError(form.getAttribute('data-msg-products') || 'Select at least one product.'); return false; }
    }
    return true;
  }
  function firstInteraction() {
    if (started) return;
    started = true;
    track('customization_start', {});
    track('inquiry_form_start', { form_type: 'customization' });
  }
  form.addEventListener('input', firstInteraction, { once: true });
  form.addEventListener('change', function (event) {
    firstInteraction();
    if (event.target.name === 'customer_type') {
      updateCustomerPanel();
      track('customer_type_select', { customer_type: customerType() });
    }
    if (event.target.matches('[data-custom-option]')) {
      track('customization_option_select', { option: event.target.name.replace('custom_', ''), selected: event.target.checked });
    }
    if (event.target === form.querySelector('[data-file-upload]')) {
      var count = event.target.files ? event.target.files.length : 0;
      track('drawing_upload', { file_count: count });
      if (count > 5) { showError(form.getAttribute('data-msg-files') || 'Maximum 5 files.'); event.target.value = ''; }
    }
    renderSelected();
  });
  form.addEventListener('click', function (event) {
    firstInteraction();
    if (event.target.matches('[data-wizard-next]')) {
      if (!validate(current)) return;
      track('customizer_step_complete', { step: current });
      updateStep(current + 1);
    }
    if (event.target.matches('[data-wizard-back]')) updateStep(current - 1);
  });
  form.querySelectorAll('[data-product-check]').forEach(function (box) {
    box.addEventListener('change', function () {
      var selected = selectedProducts();
      if (selected.length > maxProducts) {
        box.checked = false;
        showError(form.getAttribute('data-msg-max') || 'Maximum 10 products.');
      }
      renderSelected();
    });
  });
  var search = form.querySelector('[data-product-search]');
  var categoryFilter = form.querySelector('[data-product-category]');
  var seriesFilter = form.querySelector('[data-product-series]');
  function filterRows() {
    var query = (search ? search.value : '').toLowerCase().trim();
    var category = categoryFilter ? categoryFilter.value : '';
    var series = seriesFilter ? seriesFilter.value : '';
    form.querySelectorAll('[data-custom-product]').forEach(function (row) {
      var matchesQuery = !query || (row.getAttribute('data-search') || '').indexOf(query) !== -1;
      var matchesCategory = !category || row.getAttribute('data-category') === category;
      var matchesSeries = !series || row.getAttribute('data-series') === series;
      row.hidden = !(matchesQuery && matchesCategory && matchesSeries);
    });
  }
  [search, categoryFilter, seriesFilter].forEach(function (field) { if (field) field.addEventListener('input', filterRows); });
  [categoryFilter, seriesFilter].forEach(function (field) { if (field) field.addEventListener('change', filterRows); });

  // A product page can hand its selected SKU to this form through ?sku=.
  try {
    var stored = JSON.parse(window.localStorage.getItem('olang_inquiry_v1') || '[]');
    if (Array.isArray(stored)) {
      stored.forEach(function (item) {
        var box = form.querySelector('[data-product-check][value="' + item.sku + '"]');
        if (!box) return;
        box.checked = true;
        var row = box.closest('[data-custom-product]');
        var qty = row.querySelector('[data-product-qty]');
        var finish = row.querySelector('[data-product-finish]');
        if (qty && item.quantity) qty.value = item.quantity;
        if (finish && item.finish) finish.value = item.finish;
      });
    }
  } catch (_) { /* localStorage can be blocked */ }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    for (var i = 1; i <= 6; i += 1) if (!validate(i)) { updateStep(i); return; }
    if (submitted) return;
    submitted = true;
    var submit = form.querySelector('[data-wizard-submit]');
    if (submit) { submit.disabled = true; submit.classList.add('is-loading'); }
    renderSummary();
    track('inquiry_submit', { form_type: 'customization' });
    var data = new FormData(form);
    fetch(form.action, {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
    }).then(function (response) {
      return response.json().then(function (payload) { return { ok: response.ok, payload: payload }; });
    }).then(function (result) {
      if (!result.ok || !result.payload.ok) {
        submitted = false;
        if (submit) { submit.disabled = false; submit.classList.remove('is-loading'); }
        track('inquiry_submit_error', { error: (result.payload && result.payload.error) || 'unknown' });
        showError((result.payload && result.payload.message) || form.getAttribute('data-msg-error') || 'The request could not be saved.');
        return;
      }
      track('inquiry_submit_success', { form_type: 'customization' });
      track('inquiry_success', { form_type: 'customization' });
      window.location.href = result.payload.redirect;
    }).catch(function () {
      submitted = false;
      if (submit) { submit.disabled = false; submit.classList.remove('is-loading'); }
      track('inquiry_submit_error', { error: 'network' });
      showError(form.getAttribute('data-msg-error') || 'The request could not be saved.');
    });
  });

  var startStep = Number(form.getAttribute('data-start-step') || 1);
  updateCustomerPanel();
  updateStep(startStep);
  renderSelected();
  renderSummary();
})();
