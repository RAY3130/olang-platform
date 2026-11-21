'use strict';

const NAV = {
  en: {
    home: 'Home', products: 'Products', projects: 'Projects', customization: 'Customization',
    manufacturing: 'Manufacturing & Quality', about: 'About OLANG', resources: 'Resources',
    news: 'News', contact: 'Contact', trade: 'Wholesale & trade', range: 'All products',
    byCategory: 'Shop by product type', bySeries: 'Shop by series', factory: 'Factory & production',
    quality: 'Quality control', company: 'Company profile', culture: 'Culture', development: 'Development',
    honor: 'Honors & documents', catalogue: 'Product catalogue', documents: 'Specification & documents',
    process: 'Customization process', quote: 'Request a quote', inquiry: 'Inquiry list', language: 'Language',
    edition: 'Market / language', menu: 'Menu',
  },
  de: {
    home: 'Startseite', products: 'Produkte', projects: 'Projekte', customization: 'Individualisierung',
    manufacturing: 'Fertigung & Qualität', about: 'Über OLANG', resources: 'Ressourcen',
    news: 'News', contact: 'Kontakt', trade: 'Großhandel', range: 'Alle Produkte',
    byCategory: 'Nach Produkttyp', bySeries: 'Nach Serie', factory: 'Werk & Fertigung',
    quality: 'Qualitätskontrolle', company: 'Unternehmensprofil', culture: 'Kultur', development: 'Entwicklung',
    honor: 'Auszeichnungen & Unterlagen', catalogue: 'Produktkatalog', documents: 'Datenblätter & Dokumente',
    process: 'Individualisierungsprozess', quote: 'Angebot anfordern', inquiry: 'Anfrageliste', language: 'Sprache',
    edition: 'Markt / Sprache', menu: 'Menü',
  },
  ja: {
    home: 'ホーム', products: '製品', projects: 'プロジェクト', customization: 'カスタマイズ',
    manufacturing: '製造・品質', about: '会社情報', resources: '資料',
    news: 'ニュース', contact: 'お問い合わせ', trade: '卸売・流通', range: '製品一覧',
    byCategory: 'カテゴリーから探す', bySeries: 'シリーズから探す', factory: '工場・生産',
    quality: '品質管理', company: '会社概要', culture: '企業文化', development: '沿革',
    honor: '受賞・資料', catalogue: '製品カタログ', documents: '仕様書・資料',
    process: 'カスタマイズの流れ', quote: 'お見積りを依頼', inquiry: 'お問い合わせリスト', language: '言語',
    edition: '地域・言語', menu: 'メニュー',
  },
};

function navLabels(locale) {
  return NAV[locale] || NAV.en;
}

module.exports = { NAV, navLabels };
