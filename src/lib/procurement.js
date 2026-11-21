'use strict';

const { specValue } = require('./measure');
const { displayAttributeValue } = require('../i18n/glossary');

const FIELD_DEFS = [
  { key: 'material', labelKey: 'proc.baseMaterial', attrKey: 'material', extraAttrKeys: ['brass_grade', 'steel_grade'] },
  { key: 'dimensions', labelKey: 'proc.dimensions', attrKey: 'dimensions', measure: 'dimensions' },
  { key: 'weight', labelKey: 'proc.netWeight', attrKey: 'weight', measure: 'weight' },
  { key: 'finish', labelKey: 'proc.surfaceFinish', attrKey: 'finish', useFinishes: true },
  { key: 'installation', labelKey: 'proc.installation', attrKey: 'installation', extraAttrKeys: ['included_accessories'] },
  { key: 'application', labelKey: 'proc.application', attrKey: 'applicable_environment' },
  { key: 'packaging', labelKey: 'proc.packaging', attrKey: 'packaging', extraAttrKeys: ['inner_box', 'master_carton'] },
  { key: 'moq', labelKey: 'proc.moq', attrKey: 'moq' },
  { key: 'lead_time', labelKey: 'proc.leadTime', attrKey: 'lead_time' },
  { key: 'certification', labelKey: 'proc.certification', attrKey: 'certification' },
  { key: 'technical_documents', labelKey: 'proc.technicalDocuments', documents: true },
  { key: 'oem_capability', labelKey: 'proc.oemCapability', attrKey: 'customization' },
];

const STATUS_KEYS = {
  verified: 'confirmed',
  company_provided: 'confirmed',
  confirmed: 'confirmed',
  illustrative: 'illustrative',
  reference: 'reference',
  pending_verification: 'pending_verification',
  available_on_request: 'available_on_request',
  not_applicable: 'not_applicable',
  customizable: 'customizable',
};

function customerStatus(status) {
  return STATUS_KEYS[status] || 'available_on_request';
}

function visible(attr) {
  return !attr || Number(attr.visible_frontend) !== 0;
}

function attrDisplay(attr, field, market) {
  if (!attr) return { value: null, status: 'available_on_request', convertible: false };
  if (!visible(attr)) return null;
  const status = (attr.data_source === 'illustrative' || attr.data_source === 'reference_assumption')
    ? 'reference'
    : (attr.status === 'reference' ? 'reference' : customerStatus(attr.status));
  if (!String(attr.value || '').trim() && status !== 'not_applicable' && status !== 'customizable') {
    return { value: null, status, convertible: false };
  }
  if (status === 'not_applicable') return { value: null, status, convertible: false };
  if (status === 'customizable' && !String(attr.value || '').trim()) {
    return { value: null, status, convertible: false };
  }
  const spec = field && field.measure ? specValue(attr, field.measure, market) : null;
  const displayValue = spec ? spec.text : displayAttributeValue(String(attr.value || ''), market && market.locale);
  return {
    value: displayValue,
    metric: spec ? spec.metric : displayValue,
    imperial: spec ? spec.imperial : displayValue,
    convertible: Boolean(spec && spec.convertible),
    status,
  };
}

function buildProcurementRows(product, market) {
  return FIELD_DEFS.map((field) => {
    if (field.documents) {
      const docAttr = product.attrMap.technical_documents;
      const shown = docAttr ? attrDisplay(docAttr, null, market) : null;
      return {
        key: field.key,
        labelKey: field.labelKey,
        status: shown ? shown.status : 'reference',
        values: shown
          ? [{ labelKey: null, ...shown }]
          : [{ labelKey: null, value: 'Specification, installation and packing PDFs', status: 'reference', convertible: false }],
      };
    }

    if (field.key === 'certification') {
      const certAttr = product.attrMap.certification;
      if (certAttr && certAttr.value) {
        const shown = attrDisplay(certAttr, null, market);
        return {
          key: field.key,
          labelKey: field.labelKey,
          status: shown ? shown.status : 'reference',
          values: [{ labelKey: null, ...shown }],
        };
      }
    }

    if (field.literal) {
      const raw = field.literal === 'sku' ? product.sku
        : field.literal === 'category_name' ? product.category_name
          : field.literal === 'series' ? (product.series || null) : null;
      return {
        key: field.key,
        labelKey: field.labelKey,
        status: 'confirmed',
        values: raw ? [{ labelKey: null, value: raw, metric: raw, imperial: raw, status: 'confirmed', convertible: false }] : [],
      };
    }

    if (field.useFinishes) {
      const names = (product.colors || []).map((color) => color.localized_label || color.display_label).filter(Boolean);
      const status = names.length ? 'company_provided' : 'available_on_request';
      return {
        key: field.key,
        labelKey: field.labelKey,
        status,
        values: names.length
          ? [{ labelKey: null, value: names.join(' · '), metric: names.join(' · '), imperial: names.join(' · '), status, convertible: false }]
          : [{ labelKey: null, value: null, status, convertible: false }],
      };
    }

    const attr = product.attrMap[field.attrKey];
    if (attr && !visible(attr)) {
      return { key: field.key, labelKey: field.labelKey, status: 'available_on_request', values: [], hidden: true };
    }
    const primary = attrDisplay(attr, field, market);
    const values = [];
    if (primary) {
      values.push({ labelKey: null, ...primary });
    } else {
      values.push({ labelKey: null, value: null, status: 'available_on_request', convertible: false });
    }

    if (field.extraAttrKeys) {
      for (const extraKey of field.extraAttrKeys) {
        const extra = product.attrMap[extraKey];
        if (!visible(extra)) continue;
        const display = attrDisplay(extra, null, market);
        if (!display) continue;
        // A grade already stated in the primary value is not repeated as a second row.
        const alreadyStated = values.some((entry) => entry.value && display.value
          && String(entry.value).toLowerCase().includes(String(display.value).toLowerCase()));
        if (display.value && !alreadyStated) {
          values.push({ labelKey: `attr.${extraKey}`, ...display });
        }
      }
    }
    return {
      key: field.key,
      labelKey: field.labelKey,
      status: values[0].status,
      values,
    };
  }).filter((row) => !row.hidden);
}

module.exports = { FIELD_DEFS, STATUS_KEYS, customerStatus, buildProcurementRows };
