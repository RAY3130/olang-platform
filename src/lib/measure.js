'use strict';

const MEASURE_FIELDS = {
  // Two decimals for the inch conversion: 60 mm is 2.36 in, and rounding to 2.4 in loses
  // 0.04 in (1 mm) on a fixing centre, which is the kind of error a fitter notices.
  dimensions: { metric: 'mm', imperial: 'in', factor: 1 / 25.4, decimals: 2 },
  weight: { metric: 'kg', imperial: 'lb', factor: 2.2046226218, decimals: 2 },
};

function normalizeUnit(value) {
  const unit = String(value || '').toLowerCase().replace(/\./g, '');
  if (['mm', 'millimetre', 'millimeter'].includes(unit)) return 'mm';
  if (['cm', 'centimetre', 'centimeter'].includes(unit)) return 'cm';
  if (['m', 'metre', 'meter'].includes(unit)) return 'm';
  if (['in', 'inch', 'inches'].includes(unit)) return 'in';
  if (['kg', 'kilogram', 'kilograms'].includes(unit)) return 'kg';
  if (['g', 'gram', 'grams'].includes(unit)) return 'g';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) return 'lb';
  return '';
}

function toMetric(value, unit, field) {
  if (field === 'dimensions') {
    if (unit === 'cm') return value * 10;
    if (unit === 'm') return value * 1000;
    if (unit === 'in') return value * 25.4;
    return value;
  }
  if (field === 'weight') {
    if (unit === 'g') return value / 1000;
    if (unit === 'lb') return value / 2.2046226218;
    return value;
  }
  return value;
}

function fromMetric(value, field, target) {
  const spec = MEASURE_FIELDS[field];
  if (!spec) return value;
  return target === 'imperial' ? value * spec.factor : value;
}

function round(value, decimals) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(decimals));
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Measurements print a fixed number of decimals: 165 mm is 6.50 in, and dropping the trailing
 * zero would read as a rounding of 6.5.
 */
function formatFixed(value, decimals) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(decimals);
}

function extractNumbers(text, fallbackUnit, field) {
  const source = String(text || '');
  const spec = MEASURE_FIELDS[field];
  if (!spec) return null;
  const tokens = [...source.matchAll(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m|in|inch|inches|kg|g|lb|lbs)?/gi)];
  if (!tokens.length) return null;
  const values = [];
  for (const token of tokens) {
    const raw = Number(String(token[1]).replace(',', '.'));
    if (!Number.isFinite(raw)) continue;
    const unit = normalizeUnit(token[2]) || normalizeUnit(fallbackUnit);
    if (!unit) continue;
    values.push({ raw, unit, metric: toMetric(raw, unit, field) });
  }
  if (!values.length) return null;
  return { values, source };
}

function buildText(values, targetUnit, field, original) {
  const target = targetUnit === 'in' || targetUnit === 'lb' ? 'imperial' : 'metric';
  const decimals = MEASURE_FIELDS[field] ? MEASURE_FIELDS[field].decimals : 2;
  const numbers = values.map((entry) => (target === 'imperial'
    ? formatFixed(round(fromMetric(entry.metric, field, target), decimals), decimals)
    : formatNumber(round(fromMetric(entry.metric, field, target), decimals))));
  if (field === 'dimensions') {
    if (numbers.length === 1) return `${numbers[0]} ${targetUnit}`;
    return `${numbers.join(' × ')} ${targetUnit}`;
  }
  return `${numbers.join(' / ')} ${targetUnit}`;
}

function measurementVariants(attr, field) {
  if (!attr || !String(attr.value || '').trim()) return null;
  const spec = MEASURE_FIELDS[field];
  if (!spec) return null;
  const unit = normalizeUnit(attr.unit) || normalizeUnit(String(attr.value).match(/(mm|cm|m|in|inch|inches|kg|g|lb|lbs)\b/i)?.[1]);
  if (!unit) return null;
  const extracted = extractNumbers(attr.value, unit, field);
  if (!extracted) return null;
  return {
    metric: buildText(extracted.values, spec.metric, field),
    imperial: buildText(extracted.values, spec.imperial, field),
    metricUnit: spec.metric,
    imperialUnit: spec.imperial,
  };
}

function specValue(attr, field, market) {
  if (!attr) return null;
  const variants = measurementVariants(attr, field);
  if (!variants) {
    const raw = String(attr.value || '').trim();
    if (!raw) return null;
    return { text: raw, metric: raw, imperial: raw, convertible: false };
  }
  const preferred = market && market.unitSystem === 'imperial' ? variants.imperial : variants.metric;
  return {
    text: preferred,
    metric: variants.metric,
    imperial: variants.imperial,
    convertible: variants.metric !== variants.imperial,
  };
}

module.exports = { MEASURE_FIELDS, normalizeUnit, measurementVariants, specValue, formatNumber };
