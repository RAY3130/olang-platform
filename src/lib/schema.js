'use strict';

const config = require('../config');

function absolute(pathname) {
  if (!pathname) return config.siteUrl;
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${config.siteUrl}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

function organization() {
  return {
    '@type': 'Organization',
    '@id': `${config.siteUrl}/#organization`,
    name: 'OLANG',
    legalName: 'Foshan Langhao Hardware',
    url: config.siteUrl,
    description: 'OLANG designs and manufactures brass bathroom hardware in Foshan, China, serving importers, brands and hospitality projects.',
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'sales',
      email: config.publicContact.email,
      telephone: config.publicContact.phone,
      availableLanguage: ['English', 'German', 'Japanese'],
    }],
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Chancheng, Foshan',
      addressRegion: 'Guangdong',
      addressCountry: 'CN',
    },
    sameAs: ['https://en.olang.cn/'],
  };
}

function website() {
  return {
    '@type': 'WebSite',
    '@id': `${config.siteUrl}/#website`,
    url: config.siteUrl,
    name: 'OLANG Bathroom Hardware',
    publisher: { '@id': `${config.siteUrl}/#organization` },
    inLanguage: ['en-GB', 'de-DE', 'ja-JP'],
  };
}

function breadcrumbList(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absolute(item.url),
    })),
  };
}

function productSchema(product, market) {
  const images = product.image_path ? [absolute(`/${String(product.image_path).replace(/^\/+/, '')}`)] : [];
  const additional = [];
  if (product.series) {
    // Series names are rendered in the language of the page that carries the structured data.
    const { localizedSeries } = require('../i18n/glossary');
    additional.push({ '@type': 'PropertyValue', name: 'Series', value: localizedSeries(product.series, market.locale) });
  }

  // The values below are the same strings the card, the spec table and the meta description
  // print. scripts/check-consistency.js compares all four places, so they must not diverge.
  const { displayAttributeValue } = require('../i18n/glossary');
  const material = product.attrMap && product.attrMap.material ? displayAttributeValue(String(product.attrMap.material.value || '').trim(), market.locale) : '';
  if (material) additional.push({ '@type': 'PropertyValue', name: 'Material', value: material });
  const dimensions = product.attrMap && product.attrMap.dimensions ? String(product.attrMap.dimensions.value || '').trim() : '';
  if (dimensions) additional.push({ '@type': 'PropertyValue', name: 'Dimensions', value: dimensions });
  const finishNames = (product.colors || []).map((color) => color.localized_label || color.display_label).filter(Boolean);
  if (finishNames.length) {
    additional.push({ '@type': 'PropertyValue', name: 'Finish names', value: finishNames.join(', ') });
  }
  const schema = {
    '@type': 'Product',
    '@id': `${config.siteUrl}/${market.prefix}/products/${product.slug}#product`,
    name: product.name,
    sku: product.sku,
    description: product.short_description || product.description,
    image: images,
    category: product.category_name,
    brand: { '@type': 'Brand', name: 'OLANG' },
    manufacturer: { '@id': `${config.siteUrl}/#organization` },
    url: absolute(`/${market.prefix}/products/${product.slug}`),
    additionalProperty: additional,
  };
  if (product.attrMap.material && product.attrMap.material.value && ['verified', 'company_provided', 'confirmed', 'reference'].includes(product.attrMap.material.status)) {
    schema.material = product.attrMap.material.value;
  }
  // No offers, price, stock, rating or review: none of these is verified.
  return schema;
}

function collectionSchema(name, url, products) {
  return {
    '@type': 'CollectionPage',
    name,
    url: absolute(url),
    isPartOf: { '@id': `${config.siteUrl}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: products.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absolute(`/${product.marketPrefix || 'en-gb'}/products/${product.slug}`),
        name: `${product.name} (${product.sku})`,
      })),
    },
  };
}

function serviceSchema(name, url, description, market) {
  return {
    '@type': 'Service',
    name,
    description,
    url: absolute(url),
    provider: { '@id': `${config.siteUrl}/#organization` },
    areaServed: market,
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: absolute(url),
    },
  };
}

module.exports = { absolute, organization, website, breadcrumbList, productSchema, collectionSchema, serviceSchema };
