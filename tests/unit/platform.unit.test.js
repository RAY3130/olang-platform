'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, passwordProblems } = require('../../src/auth/passwords');
const { makeFormStamp, verifyFormStamp } = require('../../src/middleware/public-context');
const { parseCsv, buildCsv } = require('../../src/lib/csv');
const { inspectFiles } = require('../../src/services/uploads');
const { specValue } = require('../../src/lib/measure');
const { buildProcurementRows } = require('../../src/lib/procurement');
const { cleanProps, sanitizePath } = require('../../src/services/analytics');
const { normalizeText, slugify, safeEqual } = require('../../src/lib/util');
const { redactQuestion, inferIntent } = require('../../src/services/assistant');

test('passwords use salted scrypt and enforce policy', () => {
  const hash = hashPassword('StrongPassword!2026');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('StrongPassword!2026', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
  assert.notEqual(hashPassword('StrongPassword!2026'), hash);
  assert.ok(passwordProblems('short').length > 0);
  assert.ok(passwordProblems('alllettersonly').some((problem) => /number/i.test(problem)));
  assert.ok(passwordProblems('AdminPassword!2026', 'admin').some((problem) => /username/i.test(problem)));
});

test('one-time form stamps expire when too fast and verify after the minimum age', async () => {
  const visitor = 'visitor_test_token_1234567890';
  const salt = 'test-salt-value';
  const stamp = makeFormStamp(visitor, salt);
  assert.equal(verifyFormStamp(stamp, visitor, salt).reason, 'too_fast');
  await new Promise((resolve) => setTimeout(resolve, 1250));
  assert.equal(verifyFormStamp(stamp, visitor, salt).ok, true);
  assert.equal(verifyFormStamp(stamp, 'different-visitor', salt).ok, false);
  assert.equal(verifyFormStamp('not-a-stamp', visitor, salt).ok, false);
});

test('CSV parser handles quoted commas, quotes and newlines', () => {
  const rows = parseCsv('sku,name,notes\nOL-1,"Robe, Hook","Line one\nLine two"\nOL-2,Towel,"A ""quoted"" note"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sku, 'OL-1');
  assert.equal(rows[0].name, 'Robe, Hook');
  assert.equal(rows[0].notes, 'Line one\nLine two');
  assert.equal(rows[1].notes, 'A "quoted" note');
  const csv = buildCsv(rows, [{ label: 'SKU', key: 'sku' }, { label: 'Name', key: 'name' }]);
  assert.match(csv, /^\uFEFFSKU,Name/);
});

test('upload inspector checks extension and magic bytes', () => {
  const pdf = { originalname: 'a.pdf', buffer: Buffer.from('%PDF-1.4 test') };
  const png = { originalname: 'a.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
  assert.equal(inspectFiles([pdf]).length, 1);
  assert.equal(inspectFiles([png]).length, 1);
  assert.throws(() => inspectFiles([{ originalname: 'a.exe', buffer: Buffer.from('MZ') }]), (error) => error.code === 'file_type');
  assert.throws(() => inspectFiles([{ originalname: 'fake.pdf', buffer: Buffer.from('not a pdf') }]), (error) => error.code === 'file_type');
  assert.equal(inspectFiles([{ originalname: '', buffer: Buffer.alloc(0), size: 0 }]).length, 0);
  assert.equal(inspectFiles([{ originalname: 'boq.csv', buffer: Buffer.from('sku,quantity\nOL-1204,500\n') }]).length, 1);
  assert.equal(inspectFiles([{ originalname: 'list.xlsx', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }]).length, 1);
  assert.throws(() => inspectFiles([{ originalname: 'bad.xlsx', buffer: Buffer.from('PKnope') }]), (error) => error.code === 'file_type');
});

test('measurement conversion preserves metric source values', () => {
  const metric = { value: '600 × 50 × 80', unit: 'mm' };
  const dimsMetric = specValue(metric, 'dimensions', { unitSystem: 'metric' });
  const dimsImperial = specValue(metric, 'dimensions', { unitSystem: 'imperial' });
  assert.equal(dimsMetric.text, '600 × 50 × 80 mm');
  // Two decimals keep the fitting centres usable: 50 mm is 1.97 in, not 2 in.
  assert.equal(dimsImperial.text, '23.62 × 1.97 × 3.15 in');
  assert.equal(dimsImperial.metric, '600 × 50 × 80 mm');
  const robeHook = specValue({ value: '60 × 45 × 110', unit: 'mm' }, 'dimensions', { unitSystem: 'imperial' });
  assert.equal(robeHook.text, '2.36 × 1.77 × 4.33 in');
  const weight = specValue({ value: '1.2', unit: 'kg' }, 'weight', { unitSystem: 'imperial' });
  assert.equal(weight.text, '2.65 lb');
  assert.equal(weight.metric, '1.2 kg');
});

test('procurement rows always expose twelve independent fields', () => {
  const product = {
    sku: 'OL-TEST', category_name: 'Robe Hooks', series: '1200 Series',
    finishes: [], attrMap: {
      material: { value: null, status: 'pending_verification', visible_frontend: 1 },
      finish: { value: null, status: 'available_on_request', visible_frontend: 1 },
      dimensions: { value: null, status: 'available_on_request', visible_frontend: 1 },
      weight: { value: null, status: 'available_on_request', visible_frontend: 1 },
      installation: { value: null, status: 'available_on_request', visible_frontend: 1 },
      included_accessories: { value: null, status: 'available_on_request', visible_frontend: 1 },
      applicable_environment: { value: null, status: 'available_on_request', visible_frontend: 1 },
      packaging: { value: null, status: 'available_on_request', visible_frontend: 1 },
      moq: { value: null, status: 'available_on_request', visible_frontend: 1 },
      lead_time: { value: null, status: 'available_on_request', visible_frontend: 1 },
      certification: { value: null, status: 'available_on_request', visible_frontend: 1 },
      customization: { value: null, status: 'available_on_request', visible_frontend: 1 },
    },
  };
  const rows = buildProcurementRows(product, { unitSystem: 'metric' });
  assert.equal(rows.length, 12);
  assert.equal(rows[0].key, 'material');
  assert.equal(rows[0].status, 'pending_verification');
  assert.equal(rows[10].key, 'technical_documents');
  assert.equal(rows[11].key, 'oem_capability');
});

test('analytics cleaning drops unapproved properties and unsafe paths', () => {
  const props = cleanProps({
    filter_type: 'category', sku: 'OL-1204', email: 'should-not-be-stored',
    query: 'robe hook', depth: 50, nested: { a: 1 }, long: 'x'.repeat(1000),
  });
  assert.equal(props.filter_type, 'category');
  assert.equal(props.sku, 'OL-1204');
  assert.equal(props.query, 'robe hook');
  assert.equal(props.depth, 50);
  assert.equal(props.email, undefined);
  assert.equal(props.nested, undefined);
  assert.equal(props.long, undefined);
  assert.equal(sanitizePath('https://evil.example'), '/');
  assert.equal(sanitizePath('//evil.example'), '/');
  assert.equal(sanitizePath('/en/products'), '/en/products');
});

test('assistant logs redacted text and routes intents', () => {
  assert.equal(redactQuestion('Contact me at buyer@example.com or +86 138 0000 0000'), 'Contact me at [email] or [number]');
  assert.equal(inferIntent('What is the MOQ?'), 'moq');
  assert.equal(inferIntent('What finish options are available?'), 'finish');
  assert.equal(inferIntent('Can I request a specification sheet?'), 'documents');
  assert.equal(inferIntent('How do I start an OEM project?'), 'custom');
  assert.equal(inferIntent('Add OL-1204 to my procurement list'), 'procurement');
  assert.equal(inferIntent('Set quantity 500 for OL-1204'), 'quantity');
  assert.equal(inferIntent('I need a hotel project BOQ review'), 'project');
});

test('small utility guards are stable', () => {
  assert.equal(slugify('Bademantelhaken OL-1204'), 'bademantelhaken-ol-1204');
  assert.equal(normalizeText('  hello\u0000  '), 'hello');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
});

