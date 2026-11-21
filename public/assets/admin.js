(function () {
  'use strict';
  var body = document.body;
  var csrf = body.getAttribute('data-admin-csrf') || '';

  // Any dynamically submitted admin form must carry the session CSRF token.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.matches('form[method="post"],form[method="POST"]')) return;
    if (!form.querySelector('input[name="_csrf"]') && csrf) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = csrf;
      form.appendChild(input);
    }
  });

  document.querySelectorAll('[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.getAttribute('data-confirm') || 'Are you sure?')) event.preventDefault();
    });
  });
})();
