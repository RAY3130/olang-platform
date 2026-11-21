'use strict';

const path = require('node:path');
const ejs = require('ejs');
const config = require('../config');

const VIEWS = path.join(config.root, 'src', 'views');

function renderFile(file, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(file, data, { async: false, root: VIEWS, views: [VIEWS] }, (error, html) => {
      if (error) reject(error);
      else resolve(html);
    });
  });
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

async function renderView(res, view, data) {
  const file = path.join(VIEWS, `${view}.ejs`);
  const html = await renderFile(file, { ...res.locals, ...data });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
}

async function renderPage(res, view, data) {
  const file = path.join(VIEWS, 'pages', `${view}.ejs`);
  const body = await renderFile(file, { ...res.locals, ...data });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  return renderFile(path.join(VIEWS, 'layouts', 'public.ejs'), {
    ...res.locals,
    ...data,
    body,
    jsonForScript,
  }).then((html) => res.send(html));
}

async function renderAdmin(res, view, data) {
  const file = path.join(VIEWS, 'admin', `${view}.ejs`);
  const body = await renderFile(file, { ...res.locals, ...data });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  return renderFile(path.join(VIEWS, 'layouts', 'admin.ejs'), {
    ...res.locals,
    ...data,
    body,
  }).then((html) => res.send(html));
}

module.exports = { renderView, renderPage, renderAdmin, renderFile, jsonForScript, VIEWS };
