'use strict';

/**
 * Rebuild the report once the DOCX is not held open by an editor.
 *
 * WPS Office keeps a write-deny handle on an open document, so `Packer.toBuffer` succeeds but the
 * final write fails with EBUSY. This guard waits for the handle to disappear, then writes the file
 * and re-runs the verification, so the report on disk always matches metrics.json.
 *
 * Usage: node scripts/rebuild-report-when-free.js [--timeout 1200]
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.resolve(ROOT, '..', 'deliverables', '01_Report', 'OLANG_项目报告_v5.docx');
const argv = process.argv.slice(2);
const timeoutSeconds = argv.includes('--timeout') ? Number(argv[argv.indexOf('--timeout') + 1]) : 1200;

function isLocked(file) {
  try {
    const handle = fs.openSync(file, 'r+');
    fs.closeSync(handle);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    return error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES';
  }
}

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let waited = 0;
  while (isLocked(TARGET) && Date.now() < deadline) {
    if (waited % 60 === 0) console.log(`${stamp()} waiting for the report file to be closed (${waited}s)`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    waited += 5;
  }

  if (isLocked(TARGET)) {
    console.error(`${stamp()} still locked after ${timeoutSeconds}s; report not rebuilt`);
    process.exitCode = 2;
    return;
  }

  try {
    console.log(execFileSync(process.execPath, [path.join(__dirname, 'build-report.js')], { encoding: 'utf8' }).trim());
    console.log(execFileSync(process.execPath, [path.join(__dirname, 'verify-report.js')], { encoding: 'utf8' })
      .split('\n').filter((line) => /estimatedPages|passed|failed/.test(line)).join(' ').replace(/\s+/g, ' '));
    console.log(`${stamp()} report rebuilt`);
  } catch (error) {
    console.error(error.stdout || error.message);
    process.exitCode = 1;
  }
}

main();
