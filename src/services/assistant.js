'use strict';

const config = require('../config');
const { getDictionary, localeFor } = require('../i18n');
const { getMarket } = require('../i18n/markets');
const { getMarketSettings } = require('./market-config');
const { getSetting } = require('./settings');
const { listProducts, getProductBySku, getRelatedProducts } = require('./products');
const { listDocuments } = require('./documents');
const { nowIso, truncate, normalizeText } = require('../lib/util');
const { specValue } = require('../lib/measure');
const { localizedSeries, displayAttributeValue } = require('../i18n/glossary');

const ASSIST = {
  en: {
    onRequest: 'This is not published for the SKU. The approved answer is: available on request. Request the SKU specification or quotation; I will not estimate it.',
    finish: 'The public product page lists these finish names: {finishes}. Availability, coating specification and test evidence are confirmed for the exact order.',
    materialPending: 'The material grade is not confirmed in the approved records. Public OLANG pages and company positioning are not consistent enough to state a grade. Request the SKU material declaration before specifying it.',
    dimensions: 'Published dimensions: {value}.',
    attr: '{label}: {value} ({status}).',
    status: 'Status',
    noProduct: 'I could not match that to a published SKU. The published range has {count} products. Give me an SKU such as OL-1204, or a product name.',
    productIntro: '{name} ({sku}). {short}',
    productLink: 'Product record',
    faqSource: 'FAQ',
    resourcesSource: 'Resource centre',
    specSource: 'Specification and documents',
    moq: 'No verified MOQ is published. MOQ is confirmed for the exact SKU, finish, packing and order mix after the buying list is reviewed. I will not estimate a number.',
    lead: 'No verified production or delivery lead time is published. Timing depends on the SKU, finish, quantity, packing and shipping route, and is confirmed after that review.',
    sample: 'Sample availability, sample cost and courier terms are not published. Submit the product, finish, quantity and destination so the team can confirm.',
    cert: 'No blanket certification is claimed. CE, UKCA, WaterMark, ADA, WRAS, REACH and other rules apply to specific products and markets. Ask for the document covering the exact SKU.',
    price: 'No price is published for this SKU. A quotation is prepared against the confirmed specification, quantity, finish, packing and delivery terms; I cannot provide or estimate a price.',
    documents: 'Document metadata is tracked per SKU. There is no downloadable public file for this request unless the resource record says “Public”. Submit a document request with the SKU and intended use.',
    custom: 'OLANG publicly describes OEM/ODM support, but every change is confirmed for the project. Share the target product, change, quantity and market; do not upload confidential drawings until the NDA route is agreed.',
    wholesale: 'The wholesale route lets you build a mixed-SKU buying list with quantities, packing and destination. MOQ, price and lead time are confirmed against that list.',
    project: 'For a hotel, commercial or residential project, send the project name, location, product groups, estimated quantities, finish and any BOQ or drawing. The project team will review product mapping and documentation.',
    addConfirm: 'I have added {name} ({sku}) to your procurement list. You can set the quantity and submit the list from the procurement page.',
    quantityConfirm: 'Quantity for {sku} is now {quantity}. Open the procurement list to review it and submit the inquiry.',
    quantityMissing: 'Tell me the quantity you need for {sku}, for example “quantity 500 for OL-1204”.',
    handoff: 'For a formal quotation, MOQ confirmation or technical document, the OLANG team should review your requirement directly. Use the procurement or project form and the team will follow up.',
    procurementSource: 'Procurement list',
    quoteSource: 'Contact and quotation',
    projectSource: 'Project procurement',
    market: 'This is the {market} edition. Units, trade terms, compliance prompts and quotation currency change by market; the product record stays the same. You can switch edition without losing the current page.',
    fallback: 'I cannot confirm that from the approved product, FAQ or company records available to me. I will not guess. Submit an inquiry so the team can confirm it.',
    productList: 'Published products include: {list}.',
    sourceNotice: 'Sources are shown below. This answer is retrieval from approved records, not a quotation.',
    marketSource: 'Market edition',
    wholesaleSource: 'Wholesale & distribution',
    oemSource: 'OEM & ODM',
    compareNeedTwo: 'Give me two published SKUs to compare, for example “compare OL-1204 and OL-1205”.',
    compareNote: 'Only published facts can be compared here. Dimensions, material grade, fixing and packing remain on request for each SKU.',
    compareLine: '{name} ({sku}) — category: {category}; series: {series}; published finishes: {finishes}; dimensions: {dimensions}; material: {material}.',
  },
  de: {
    onRequest: 'Dieser Wert ist für den Artikel nicht veröffentlicht. Die freigegebene Antwort lautet: auf Anfrage. Fordern Sie Datenblatt oder Angebot an; ich schätze den Wert nicht.',
    finish: 'Die öffentliche Produktseite nennt diese Oberflächen: {finishes}. Verfügbarkeit, Beschichtungsspezifikation und Prüfnachweis werden für den exakten Auftrag bestätigt.',
    materialPending: 'Die Werkstoffgüte ist in den freigegebenen Datensätzen nicht bestätigt. Öffentliche OLANG-Seiten und Unternehmenspositionierung sind nicht eindeutig genug, um eine Güte zu nennen. Fordern Sie vor der Spezifikation die Materialerklärung für den Artikel an.',
    dimensions: 'Veröffentlichte Maße: {value}.',
    attr: '{label}: {value} ({status}).',
    status: 'Status',
    noProduct: 'Ich konnte das keinem veröffentlichten Artikel zuordnen. Die veröffentlichte Auswahl umfasst {count} Produkte. Nennen Sie eine Artikelnummer wie OL-1204 oder einen Produktnamen.',
    productIntro: '{name} ({sku}). {short}',
    productLink: 'Produktdatensatz',
    faqSource: 'FAQ',
    resourcesSource: 'Ressourcenzentrum',
    specSource: 'Spezifikation und Dokumente',
    moq: 'Es ist keine geprüfte Mindestmenge veröffentlicht. Die MOQ wird für den exakten Artikel, die Oberfläche, Verpackung und den Auftragsmix nach Prüfung der Bestellliste bestätigt. Ich schätze keine Zahl.',
    lead: 'Es ist keine geprüfte Produktions- oder Lieferzeit veröffentlicht. Der Termin hängt von Artikel, Oberfläche, Menge, Verpackung und Transportweg ab und wird nach dieser Prüfung bestätigt.',
    sample: 'Verfügbarkeit, Kosten und Versand von Mustern sind nicht veröffentlicht. Senden Sie Produkt, Oberfläche, Menge und Zielort, damit das Team bestätigen kann.',
    cert: 'Es wird keine pauschale Zertifizierung behauptet. CE, UKCA, WaterMark, ADA, WRAS, REACH und andere Regeln gelten für bestimmte Produkte und Märkte. Fordern Sie das Dokument für den exakten Artikel an.',
    price: 'Für diesen Artikel ist kein Preis veröffentlicht. Ein Angebot wird auf Basis der bestätigten Spezifikation, Menge, Oberfläche, Verpackung und Lieferbedingungen erstellt; ich kann keinen Preis nennen oder schätzen.',
    documents: 'Dokumentmetadaten werden je Artikel geführt. Es gibt keinen öffentlichen Download, sofern der Ressourceneintrag nicht „Öffentlich“ ausweist. Senden Sie eine Dokumentenanfrage mit Artikel und Verwendungszweck.',
    custom: 'OLANG beschreibt öffentlich OEM-/ODM-Unterstützung; jede Änderung wird jedoch für das Projekt bestätigt. Nennen Sie Zielprodukt, Änderung, Menge und Markt. Laden Sie vertrauliche Zeichnungen erst nach vereinbartem NDA-Weg hoch.',
    wholesale: 'Im Großhandelsweg erstellen Sie eine gemischte Einkaufsliste mit Mengen, Verpackung und Zielort. Mindestmenge, Preis und Lieferzeit werden dafür bestätigt.',
    project: 'Für ein Hotel-, Gewerbe- oder Wohnbauprojekt senden Sie Projektname, Standort, Produktgruppen, geschätzte Mengen, Oberfläche und vorhandene Stückliste oder Zeichnung. Das Projektteam prüft Produktzuordnung und Dokumente.',
    addConfirm: 'Ich habe {name} ({sku}) zur Beschaffungsliste hinzugefügt. Menge festlegen und die Liste auf der Beschaffungsseite senden.',
    quantityConfirm: 'Die Menge für {sku} ist jetzt {quantity}. Öffnen Sie die Beschaffungsliste zur Prüfung und zum Absenden.',
    quantityMissing: 'Nennen Sie die gewünschte Menge für {sku}, zum Beispiel „Menge 500 für OL-1204“.',
    handoff: 'Für ein förmliches Angebot, die Bestätigung der Mindestmenge oder technische Unterlagen sollte das OLANG-Team Ihre Anforderung direkt prüfen. Nutzen Sie das Beschaffungs- oder Projektformular.',
    procurementSource: 'Beschaffungsliste',
    quoteSource: 'Kontakt und Angebot',
    projectSource: 'Projektbeschaffung',
    market: 'Dies ist die Ausgabe {market}. Einheiten, Lieferbedingungen, Compliance-Hinweise und Angebotswährung ändern sich je Markt; der Produktdatensatz bleibt gleich. Sie können die Ausgabe wechseln, ohne die aktuelle Seite zu verlieren.',
    fallback: 'Ich kann das anhand der freigegebenen Produkt-, FAQ- oder Unternehmensdaten nicht bestätigen. Ich rate nicht. Senden Sie eine Anfrage, damit das Team es prüfen kann.',
    productList: 'Veröffentlichte Produkte: {list}.',
    sourceNotice: 'Quellen stehen unten. Die Antwort ist ein Abruf aus freigegebenen Daten, kein Angebot.',
    marketSource: 'Marktausgabe',
    wholesaleSource: 'Großhandel & Distribution',
    oemSource: 'OEM & ODM',
    compareNeedTwo: 'Nennen Sie zwei veröffentlichte Artikel zum Vergleich, z. B. „OL-1204 und OL-1205 vergleichen“.',
    compareNote: 'Hier lassen sich nur veröffentlichte Angaben vergleichen. Maße, Werkstoffgüte, Befestigung und Verpackung bleiben für jeden Artikel auf Anfrage.',
    compareLine: '{name} ({sku}) — Kategorie: {category}; Serie: {series}; veröffentlichte Oberflächen: {finishes}; Maße: {dimensions}; Werkstoff: {material}.',
  },
  it: {
    onRequest: 'Questo dato non è pubblicato per l’articolo. La risposta approvata è: su richiesta. Richiedi scheda tecnica o preventivo; non stimo il valore.',
    finish: 'La pagina pubblica del prodotto indica queste finiture: {finishes}. Disponibilità, specifica del rivestimento e prove vengono confermate per l’ordine esatto.',
    materialPending: 'La qualità del materiale non è confermata nei record approvati. Le pagine pubbliche OLANG e il posizionamento aziendale non sono sufficientemente coerenti per indicare una qualità. Richiedi la dichiarazione materiale prima della specifica.',
    dimensions: 'Dimensioni pubblicate: {value}.',
    attr: '{label}: {value} ({status}).',
    status: 'Stato',
    noProduct: 'Non ho trovato un articolo pubblicato corrispondente. La gamma pubblicata comprende {count} prodotti. Indica un codice come OL-1204 o un nome prodotto.',
    productIntro: '{name} ({sku}). {short}',
    productLink: 'Scheda prodotto',
    faqSource: 'FAQ',
    resourcesSource: 'Centro risorse',
    specSource: 'Specifica e documenti',
    moq: 'Non è pubblicato un MOQ verificato. Il minimo viene confermato per articolo, finitura, imballaggio e mix d’ordine dopo la verifica della lista. Non stimo un numero.',
    lead: 'Non è pubblicato un tempo di produzione o consegna verificato. Dipende da articolo, finitura, quantità, imballaggio e rotta, e viene confermato dopo la verifica.',
    sample: 'Disponibilità, costo e spedizione dei campioni non sono pubblicati. Invia prodotto, finitura, quantità e destinazione per la conferma.',
    cert: 'Non viene dichiarata una certificazione generalizzata. CE, UKCA, WaterMark, ADA, WRAS, REACH e altre norme si applicano a prodotti e mercati specifici. Richiedi il documento riferito all’articolo esatto.',
    price: 'Per questo articolo non è pubblicato un prezzo. Il preventivo viene preparato su specifica, quantità, finitura, imballaggio e resa confermati; non posso fornire o stimare un prezzo.',
    documents: 'I metadati documentali sono tracciati per articolo. Non esiste un download pubblico salvo che il record risorse indichi “Pubblico”. Invia una richiesta documenti con articolo e uso previsto.',
    custom: 'OLANG descrive pubblicamente il supporto OEM/ODM, ma ogni modifica è confermata per il progetto. Indica prodotto target, modifica, quantità e mercato. Non caricare disegni riservati prima di concordare l’NDA.',
    wholesale: 'Il percorso ingrosso consente di creare una lista mista con quantità, imballaggio e destinazione. MOQ, prezzo e tempi vengono confermati su quella lista.',
    project: 'Per un progetto alberghiero, commerciale o residenziale invia nome e località del progetto, gruppi prodotto, quantità stimate, finitura ed eventuale BOQ o disegno. Il team progetto verificherà mappatura prodotti e documentazione.',
    addConfirm: 'Ho aggiunto {name} ({sku}) alla lista di acquisto. Puoi impostare la quantità e inviare la lista dalla pagina dedicata.',
    quantityConfirm: 'La quantità per {sku} è ora {quantity}. Apri la lista di acquisto per verificarla e inviare la richiesta.',
    quantityMissing: 'Indica la quantità per {sku}, ad esempio “quantità 500 per OL-1204”.',
    handoff: 'Per un preventivo formale, la conferma del MOQ o documenti tecnici, il team OLANG deve esaminare direttamente la richiesta. Usa il modulo acquisti o progetto.',
    procurementSource: 'Lista di acquisto',
    quoteSource: 'Contatti e preventivo',
    projectSource: 'Acquisti di progetto',
    market: 'Questa è l’edizione {market}. Unità, resa, note di conformità e valuta del preventivo cambiano per mercato; il record prodotto resta lo stesso. Puoi cambiare edizione senza perdere la pagina corrente.',
    fallback: 'Non posso confermarlo dai record prodotto, FAQ o aziendali approvati disponibili. Non ipotizzo. Invia una richiesta affinché il team possa verificare.',
    productList: 'Prodotti pubblicati: {list}.',
    sourceNotice: 'Le fonti sono indicate sotto. La risposta è un recupero da record approvati, non un preventivo.',
    marketSource: 'Edizione di mercato',
    wholesaleSource: 'Ingrosso e distribuzione',
    oemSource: 'OEM e ODM',
    compareNeedTwo: 'Indica due articoli pubblicati da confrontare, ad esempio “confronta OL-1204 e OL-1205”.',
    compareNote: 'Qui è possibile confrontare solo i dati pubblicati. Dimensioni, qualità del materiale, fissaggio e imballaggio restano su richiesta per ogni articolo.',
    compareLine: '{name} ({sku}) — categoria: {category}; serie: {series}; finiture pubblicate: {finishes}; dimensioni: {dimensions}; materiale: {material}.',
  },
  ja: {
    onRequest: 'この品番については公開されていません。確認できる回答は「お問い合わせください」です。推測値はお伝えしません。仕様書またはお見積りをご請求ください。',
    finish: '公開製品ページに記載されている仕上げ名は次のとおりです：{finishes}。在庫、皮膜仕様、試験内容はご注文時に確認します。',
    materialPending: 'この品番の材質グレードは確認できていません。推測せず、品番を明記した材料証明のご請求をご案内します。',
    dimensions: '公開されている寸法：{value}。',
    attr: '{label}：{value}（{status}）。',
    status: '状態',
    noProduct: '公開品番に一致しませんでした。公開ラインナップは{count}点です。OL-1204のような品番、または製品名をご指定ください。',
    productIntro: '{name}（{sku}）。{short}',
    productLink: '製品情報',
    faqSource: 'よくある質問',
    resourcesSource: '資料・技術情報',
    specSource: '仕様書・資料',
    moq: '確認済みのMOQは公開されていません。品番、仕上げ、梱包、注文構成を確認したうえでご案内します。数値を推測することはありません。',
    lead: '確認済みの生産・納期は公開されていません。品番、仕上げ、数量、梱包、輸送経路により異なるため、確認後にご案内します。',
    sample: 'サンプルの可否、費用、配送条件は公開されていません。品番、仕上げ、数量、納入先をお知らせください。担当者が確認します。',
    cert: '包括的な認証表示は行いません。CE、UKCA、WaterMark、ADA、WRAS、REACHなどは、対象製品・市場によって適用が異なります。品番と用途を明記して、正式資料をご請求ください。',
    price: 'この品番の価格は公開されていません。確定仕様、数量、仕上げ、梱包、納入条件に基づいてお見積りします。価格の推測はできません。',
    documents: '資料は品番単位で管理しています。公開承認済みのファイルがある場合のみダウンロードできます。品番と用途を明記して資料請求をお送りください。',
    custom: 'OLANGはOEM/ODM対応を公開していますが、すべての変更が可能とは限りません。対象製品、変更内容、数量、市場をお知らせください。機密図面はNDAの方法を合意する前にアップロードしないでください。',
    wholesale: '卸売ルートでは、複数品番のお問い合わせリストに数量・梱包・納入先を添えて送信できます。MOQ、価格、納期はその内容に対して確認します。',
    project: 'ホテル・商業施設・住宅プロジェクトでは、物件名、所在地、対象カテゴリー、想定数量、希望仕上げ、BOQや図面をお知らせください。製品候補と資料を確認します。',
    addConfirm: '{name}（{sku}）をお問い合わせリストに追加しました。数量を設定し、リストから送信できます。',
    quantityConfirm: '{sku}の数量を{quantity}に更新しました。お問い合わせリストで確認して送信してください。',
    quantityMissing: '{sku}の数量をご指定ください。例：「OL-1204を500個」',
    handoff: '正式なお見積り、MOQ、技術資料については、OLANGの担当者が内容を確認する必要があります。カスタマイズまたはお問い合わせフォームをご利用ください。',
    procurementSource: 'お問い合わせリスト',
    quoteSource: 'お問い合わせ・お見積り',
    projectSource: 'プロジェクト調達',
    market: 'このページは{market}版です。単位、取引条件、適合性の案内、見積通貨は地域版で変わりますが、製品情報は共通です。現在のページを保ったまま切り替えられます。',
    fallback: '公開製品情報、FAQ、会社情報の範囲では確認できませんでした。推測せず、担当者へのお問い合わせをご案内します。',
    productList: '公開製品の例：{list}。',
    sourceNotice: '出典を以下に表示します。この回答は公開・承認済み情報の検索結果であり、お見積りではありません。',
    marketSource: '地域版',
    wholesaleSource: '卸売・流通',
    oemSource: 'カスタマイズ',
    compareNeedTwo: '比較する2つの公開品番をご指定ください。例：「OL-1204とOL-1205を比較」。',
    compareNote: 'ここでは公開情報のみを比較できます。寸法、材質グレード、取付、梱包は品番ごとにお問い合わせください。',
    compareLine: '{name}（{sku}）— カテゴリー：{category}、シリーズ：{series}、公開仕上げ：{finishes}、寸法：{dimensions}、材質：{material}。',
  },
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'what', 'which', 'for', 'of', 'to', 'and', 'or', 'do', 'does',
  'can', 'i', 'you', 'we', 'me', 'my', 'your', 'with', 'on', 'in', 'it', 'this', 'that', 'about',
  'der', 'die', 'das', 'ist', 'sind', 'was', 'welche', 'für', 'und', 'oder', 'ich', 'sie', 'mit',
  'ein', 'eine', 'zu', 'von', 'auf', 'im', 'den', 'dem', 'des', 'il', 'la', 'lo', 'che', 'cosa',
  'sono', 'per', 'di', 'e', 'o', 'con', 'un', 'una', 'del', 'della', 'dei', 'come', 'posso',
]);

function normalizeSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    // Preserve Japanese kana and CJK ideographs; removing them used to turn a
    // Japanese product question into an empty string.
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JA_TERMS = {
  'タオルリング': 'towel ring', 'タオルバー': 'towel bar', 'ローブフック': 'robe hook',
  'バスローブフック': 'robe hook', 'ペーパーホルダー': 'toilet paper holder',
  'トイレットペーパーホルダー': 'toilet paper holder', 'タンブラーホルダー': 'tumbler holder',
  '石けん皿': 'soap dish', 'ソープディッシュ': 'soap dish', 'トイレブラシホルダー': 'toilet brush holder',
  '手すり': 'grab bar', 'グラブバー': 'grab bar', 'コーナーシェルフ': 'corner shelf',
  'タオルラック': 'towel rack', 'シリーズ': 'series',
};

function tokens(value) {
  const normalized = normalizeSearch(value);
  const base = normalized.split(' ').filter((token) => token.length > 1 && !STOPWORDS.has(token));
  const extra = [];
  for (const [term, canonical] of Object.entries(JA_TERMS)) {
    if (normalized.includes(term)) extra.push(canonical);
  }
  return [...new Set([...base, ...extra])];
}

function scoreProduct(product, queryTokens) {
  const name = normalizeSearch(product.name);
  const sku = normalizeSearch(product.sku);
  const category = normalizeSearch(product.category_name);
  const series = normalizeSearch(product.series || '');
  const short = normalizeSearch(product.short_description || '');
  let score = 0;
  for (const token of queryTokens) {
    if (sku.includes(token)) score += 10;
    if (name.includes(token)) score += 6;
    if (category.includes(token)) score += 4;
    if (series.includes(token)) score += 2;
    if (short.includes(token)) score += 1;
  }
  return score;
}

function inferIntent(question) {
  const q = normalizeSearch(question);
  // Japanese has no spaces between words. Check the Japanese terms first so a
  // short question is not swallowed by the generic search fallback.
  if (/追加|リストに入れ|問い合わせリスト|調達リスト/.test(q)) return 'procurement';
  if (/数量|個数|何個|いくつ/.test(q) && /\d/.test(q)) return 'quantity';
  if (/比較|比べ|違い|どちら/.test(q)) return 'compare';
  if (/担当者|営業|人と話|電話|連絡先/.test(q)) return 'human';
  if (/価格|値段|いくら|見積|費用/.test(q)) return 'price';
  if (/moq|最小|ロット|最低数量/.test(q)) return 'moq';
  if (/納期|リードタイム|いつ届|生産期間|納入/.test(q)) return 'lead';
  if (/サンプル|見本|試作/.test(q)) return 'sample';
  if (/認証|証明|適合|規格|試験|検査/.test(q)) return 'cert';
  if (/資料|仕様書|図面|ダウンロード|カタログ/.test(q)) return 'documents';
  if (/oem|odm|カスタマイズ|別注|特注|pb|プライベートブランド/.test(q)) return 'custom';
  if (/卸売|販売店|輸入|代理店|問屋/.test(q)) return 'wholesale';
  if (/プロジェクト|ホテル|物件|工事|建築|設計|boq/.test(q)) return 'project';
  if (/仕上げ|表面|色|カラー|メッキ/.test(q)) return 'finish';
  if (/材質|材料|真鍮|ステンレス|ブラス/.test(q)) return 'material';
  if (/寸法|サイズ|大きさ|長さ|幅|高さ/.test(q)) return 'dimensions';
  if (/取付|設置|固定|施工/.test(q)) return 'installation';
  if (/梱包|箱|カートン|包装/.test(q)) return 'packaging';
  if (/地域|市場|言語|版|単位/.test(q)) return 'market';
  if (/\b(add|put|include|procurement list|buying list|hinzufugen|hinzufuegen|beschaffungsliste|aggiungi|lista di acquisto)\b/.test(q)) return 'procurement';
  if (/\b(quantity|qty|menge|quantita|quantità)\b/.test(q) && /\d/.test(q)) return 'quantity';
  if (/\b(compare|comparison|difference|versus|vergleich\w*|confront\w*|differenza)\b/.test(q)) return 'compare';
  if (/\b(human|sales|representative|speak|contact|kontakt|mitarbeiter|parlare|contatto)\b/.test(q)) return 'human';
  if (/\b(price|cost|preis|kosten|prezzo|costo|quotation|quote|angebot|preventivo)\b/.test(q)) return 'price';
  if (/\b(moq|minimum|mindestmenge|mindestbestellmenge|quantitativo minimo|minimo d ordine)\b/.test(q)) return 'moq';
  if (/\b(lead time|delivery time|lieferzeit|tempo di consegna|tempi di consegna|production time)\b/.test(q)) return 'lead';
  if (/\b(sample|muster|campione|campioni)\b/.test(q)) return 'sample';
  if (/\b(certif\w*|certificate|zertifik\w*|watermark|ukca|wras|reach|ada|conform\w*|konform\w*)\b/.test(q)) return 'cert';
  if (/\b(document\w*|dokument\w*|scheda|datenblatt|spec sheet|specification sheet|pdf|download)\b/.test(q)) return 'documents';
  if (/\b(oem|odm|custom\w*|individ\w*|personalizz\w*|private label)\b/.test(q)) return 'custom';
  if (/\b(wholesale|grosshandel|ingrosso|distribut|buying list|einkaufsliste|lista d acquisto)\b/.test(q)) return 'wholesale';
  if (/\b(project|boq|hotel|hospitality|contractor|architect|projekt|progetto|albergo|commessa)\b/.test(q)) return 'project';
  if (/\b(finish|finishes|finitura|finiture|oberflache|oberflachen|surface|color|colour|farbe)\b/.test(q)) return 'finish';
  if (/\b(material|werkstoff|materiale|brass|messing|ottone|stainless|edelstahl|acciaio)\b/.test(q)) return 'material';
  if (/\b(dimension|dimensions|size|measurements|mass|masse|misure|misura|width|height|length)\b/.test(q)) return 'dimensions';
  if (/\b(install|montage|montaggio|fixing|befestigung|fissaggio)\b/.test(q)) return 'installation';
  if (/\b(pack|packing|verpackung|imballaggio|carton|karton|cartone)\b/.test(q)) return 'packaging';
  if (/\b(market|markt|mercato|edition|ausgabe|edizione|unit|einheit|unita|language|sprache|lingua)\b/.test(q)) return 'market';
  return 'search';
}

function productAction(product, marketObj) {
  return {
    type: 'add_to_list',
    sku: product.sku,
    name: product.name,
    category: product.category_name,
    url: `/${marketObj.prefix}/products/${product.slug}`,
    image: product.image_path ? `/${product.image_path.replace(/^\/+/, '')}` : '/assets/placeholder.svg',
  };
}

function quantityFromQuestion(question) {
  const withoutSku = String(question || '').replace(/\bOL[-\s]?\d{4}[A-Z]?\b/gi, ' ');
  const match = withoutSku.match(/\b(\d{1,7})\b/);
  return match ? Number(match[1]) : null;
}

function linkAction(type, label, url) {
  return { type, label, url };
}

function findMentionedSkus(question) {
  return [...new Set([...String(question || '').toUpperCase().matchAll(/\bOL[-\s]?(\d{4}[A-Z]?)\b/g)].map((match) => `OL-${match[1]}`))].slice(0, 4);
}

function findMentionedProduct(db, question, locale, allProducts) {
  const skuMatch = String(question).toUpperCase().match(/\bOL[-\s]?(\d{4}[A-Z]?)\b/);
  if (skuMatch) {
    const product = getProductBySku(db, `OL-${skuMatch[1]}`, locale);
    if (product) return product;
  }
  const rawQuestion = normalizeSearch(question);
  const queryTokens = tokens(question);
  const scored = allProducts.map((product) => {
    let score = scoreProduct(product, queryTokens);
    const name = normalizeSearch(product.name);
    const category = normalizeSearch(product.category_name);
    const series = normalizeSearch(product.series || '');
    // Direct Japanese phrase matching: a sentence can contain the product or
    // category name without whitespace, so token matching alone is insufficient.
    if (name && rawQuestion.includes(name)) score += 9;
    if (category && rawQuestion.includes(category)) score += 5;
    if (series && rawQuestion.includes(series)) score += 3;
    return { product, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 4 ? scored[0].product : null;
}

function source(title, url) {
  return { title, url };
}

function productSource(product, marketPrefix, assist) {
  return source(`${product.name} · ${product.sku}`, `/${marketPrefix}/products/${product.slug}`);
}

function statusText(status, dict) {
  return dict.status[status] || status;
}

function attrAnswer(product, attrKey, dict, assist, marketObj) {
  const attr = product.attrMap[attrKey];
  const label = dict.proc?.[{
    dimensions: 'dimensions', weight: 'netWeight', material: 'baseMaterial',
    installation: 'installation', packaging: 'packaging', finish: 'surfaceFinish',
  }[attrKey]] || dict.attr[attrKey] || attrKey;
  if (!attr) return assist.onRequest;
  if (!attr.value) {
    if (attr.status === 'customizable') return `${label}: ${dict.status.customizable}. ${dict.statusHelp.customizable}`;
    return assist.onRequest;
  }
  const display = (attrKey === 'dimensions' || attrKey === 'weight') ? specValue(attr, attrKey, marketObj) : null;
  const value = display ? display.text : attr.value;
  const status = statusText(attr.status, dict);
  return assist.attr.replace('{label}', label).replace('{value}', value).replace('{status}', status);
}

function faqSource(locale, marketPrefix, assist) {
  return source(assist.faqSource, `/${marketPrefix}/resources#faq`);
}

function answerFor(db, { question, market, locale }) {
  const lang = localeFor(locale);
  const dict = getDictionary(lang);
  const marketObj = getMarketSettings(db, market, lang);
  const assist = ASSIST[lang] || ASSIST.en;
  const allProducts = listProducts(db, { locale: lang });
  const product = findMentionedProduct(db, question, lang, allProducts);
  const intent = inferIntent(question);
  const sources = [];
  const actions = [];
  let answer = '';
  let matchedType = 'fallback';
  let matchedRef = null;

  if (product && intent === 'procurement') {
    matchedType = 'procurement_action';
    matchedRef = product.sku;
    sources.push(productSource(product, marketObj.prefix, assist));
    actions.push(productAction(product, marketObj));
    actions.push(linkAction('open_list', assist.procurementSource, `/${marketObj.prefix}/inquiry`));
    answer = assist.addConfirm.replace('{name}', product.name).replace('{sku}', product.sku);
    return { answer, sources, actions, matchedType, matchedRef, suggestions: [] };
  }

  if (product && intent === 'quantity') {
    matchedType = 'procurement_action';
    matchedRef = product.sku;
    sources.push(productSource(product, marketObj.prefix, assist));
    const quantity = quantityFromQuestion(question);
    if (quantity && quantity >= 1 && quantity <= 1000000) {
      actions.push({
        ...productAction(product, marketObj),
        type: 'set_quantity',
        quantity,
      });
      actions.push(linkAction('open_list', assist.procurementSource, `/${marketObj.prefix}/inquiry`));
      answer = assist.quantityConfirm.replace('{sku}', product.sku).replace('{quantity}', String(quantity));
    } else {
      actions.push(productAction(product, marketObj));
      answer = assist.quantityMissing.replace('{sku}', product.sku);
    }
    return { answer, sources, actions, matchedType, matchedRef, suggestions: [] };
  }

  if (intent === 'human') {
    matchedType = 'handoff';
    matchedRef = 'contact';
    actions.push(linkAction('contact', dict.assistant.contactCta, `/${marketObj.prefix}/contact`));
    actions.push(linkAction('wholesale', assist.wholesaleSource, `/${marketObj.prefix}/wholesale`));
    sources.push(source(assist.quoteSource, `/${marketObj.prefix}/contact`));
    return {
      answer: getSetting(db, `assistant.handoff.${lang}`, '') || assist.handoff,
      sources,
      actions,
      matchedType,
      matchedRef,
      suggestions: [],
    };
  }

  if (intent === 'compare') {
    const skus = findMentionedSkus(question);
    const compared = skus.map((sku) => getProductBySku(db, sku, lang)).filter(Boolean);
    if (compared.length < 2) {
      return {
        answer: assist.compareNeedTwo,
        sources: [],
        actions: [linkAction('products', dict.footer?.products || 'Products', `/${marketObj.prefix}/products`)],
        matchedType: 'compare_help',
        matchedRef: null,
        suggestions: [],
      };
    }
    const attrValue = (item, key) => {
      const attr = item.attrMap[key];
      if (attr && attr.value) return displayAttributeValue(attr.value, lang);
      return dict.status[(attr && attr.status) || 'available_on_request'];
    };
    answer = compared.map((item) => assist.compareLine
      .replace('{name}', item.name)
      .replace('{sku}', item.sku)
      .replace('{category}', item.category_name)
      .replace('{series}', localizedSeries(item.series, lang) || '—')
      .replace('{finishes}', (item.colors || []).map((color) => color.localized_label || color.display_label).join(', ') || dict.status.available_on_request)
      .replace('{dimensions}', attrValue(item, 'dimensions'))
      .replace('{material}', attrValue(item, 'material'))).join('\n') + '\n\n' + assist.compareNote;
    compared.forEach((item) => {
      sources.push(productSource(item, marketObj.prefix, assist));
      actions.push({
        type: 'add_to_list', sku: item.sku, name: item.name, category: item.category_name,
        url: `/${marketObj.prefix}/products/${item.slug}`,
        image: item.image_path ? `/${item.image_path.replace(/^\/+/, '')}` : '/assets/placeholder.svg',
      });
    });
    matchedType = 'comparison';
    matchedRef = compared.map((item) => item.sku).join(',');
    return { answer, sources, actions, matchedType, matchedRef, suggestions: [] };
  }

  if (product && ['finish', 'material', 'dimensions', 'installation', 'packaging', 'moq', 'lead', 'sample', 'cert', 'price', 'documents'].includes(intent)) {
    matchedType = 'product_attribute';
    matchedRef = product.sku;
    sources.push(productSource(product, marketObj.prefix, assist));
    if (intent === 'finish') {
      const finishes = (product.colors || []).map((color) => color.localized_label || color.display_label).join(', ');
      answer = assist.finish.replace('{finishes}', finishes || assist.onRequest);
    } else if (intent === 'documents') {
      const docs = listDocuments(db, { locale: lang, market: marketObj.code, productId: product.id });
      const publicDocs = docs.filter((doc) => doc.hasFile);
      answer = publicDocs.length
        ? publicDocs.map((doc) => `${doc.title} (${dict.docTypes[doc.doc_type] || doc.doc_type})`).join('; ')
        : assist.documents;
      sources.push(source(assist.resourcesSource, `/${marketObj.prefix}/resources?product=${encodeURIComponent(product.sku)}`));
    } else if (intent === 'moq') {
      answer = assist.moq;
      sources.push(faqSource(lang, marketObj.prefix, assist));
    } else if (intent === 'lead') {
      answer = assist.lead;
      sources.push(faqSource(lang, marketObj.prefix, assist));
    } else if (intent === 'sample') {
      answer = assist.sample;
      sources.push(faqSource(lang, marketObj.prefix, assist));
    } else if (intent === 'cert') {
      answer = assist.cert;
      sources.push(faqSource(lang, marketObj.prefix, assist));
    } else if (intent === 'price') {
      answer = assist.price;
      sources.push(faqSource(lang, marketObj.prefix, assist));
      actions.push(linkAction('quote', dict.assistant.contactCta, `/${marketObj.prefix}/wholesale#inquiry-form`));
    } else if (intent === 'documents') {
      actions.push(linkAction('documents', assist.resourcesSource, `/${marketObj.prefix}/resources?product=${encodeURIComponent(product.sku)}`));
    } else if (intent === 'material') {
      answer = product.attrMap.material?.value
        ? attrAnswer(product, 'material', dict, assist, marketObj)
        : assist.materialPending;
    } else if (intent === 'dimensions') {
      answer = attrAnswer(product, 'dimensions', dict, assist, marketObj);
    } else if (intent === 'installation') {
      answer = attrAnswer(product, 'installation', dict, assist, marketObj);
    } else if (intent === 'packaging') {
      answer = attrAnswer(product, 'packaging', dict, assist, marketObj);
    }
    actions.push(productAction(product, marketObj));
    return { answer, sources, actions, matchedType, matchedRef, suggestions: [] };
  }

  if (product && ['search', 'finish'].includes(intent)) {
    matchedType = 'product';
    matchedRef = product.sku;
    sources.push(productSource(product, marketObj.prefix, assist));
    answer = assist.productIntro
      .replace('{name}', product.name)
      .replace('{sku}', product.sku)
      .replace('{category}', product.category_name)
      .replace('{short}', product.short_description || '');
    actions.push(productAction(product, marketObj));
    return { answer, sources, actions, matchedType, matchedRef, suggestions: [] };
  }

  if (intent === 'moq') {
    answer = assist.moq;
    sources.push(faqSource(lang, marketObj.prefix, assist));
    matchedType = 'faq'; matchedRef = 'moq';
  } else if (intent === 'lead') {
    answer = assist.lead;
    sources.push(faqSource(lang, marketObj.prefix, assist));
    matchedType = 'faq'; matchedRef = 'lead-time';
  } else if (intent === 'sample') {
    answer = assist.sample;
    sources.push(faqSource(lang, marketObj.prefix, assist));
    matchedType = 'faq'; matchedRef = 'samples';
  } else if (intent === 'cert') {
    answer = assist.cert;
    sources.push(faqSource(lang, marketObj.prefix, assist));
    matchedType = 'faq'; matchedRef = 'certification';
  } else if (intent === 'price') {
    answer = assist.price;
    sources.push(faqSource(lang, marketObj.prefix, assist));
    matchedType = 'faq'; matchedRef = 'prices';
    actions.push(linkAction('quote', dict.assistant.contactCta, `/${marketObj.prefix}/wholesale#inquiry-form`));
  } else if (intent === 'documents') {
    answer = assist.documents;
    sources.push(source(assist.resourcesSource, `/${marketObj.prefix}/resources`));
    matchedType = 'page'; matchedRef = 'resources';
    actions.push(linkAction('documents', assist.resourcesSource, `/${marketObj.prefix}/resources#document-request`));
  } else if (intent === 'cert') {
    answer = assist.cert;
    sources.push(source(assist.specSource, `/${marketObj.prefix}/resources`));
    matchedType = 'faq'; matchedRef = 'certification';
    actions.push(linkAction('documents', assist.specSource, `/${marketObj.prefix}/resources#document-request`));
  } else if (intent === 'custom') {
    answer = assist.custom;
    sources.push(source(assist.oemSource, `/${marketObj.prefix}/customization`));
    matchedType = 'page'; matchedRef = 'customization';
    actions.push(linkAction('oem', assist.oemSource, `/${marketObj.prefix}/customization`));
  } else if (intent === 'wholesale') {
    answer = assist.wholesale;
    sources.push(source(assist.wholesaleSource, `/${marketObj.prefix}/wholesale`));
    matchedType = 'page'; matchedRef = 'wholesale';
    actions.push(linkAction('wholesale', assist.wholesaleSource, `/${marketObj.prefix}/wholesale#inquiry-form`));
  } else if (intent === 'project') {
    answer = assist.project;
    sources.push(source(assist.projectSource, `/${marketObj.prefix}/projects`));
    matchedType = 'page'; matchedRef = 'projects';
    actions.push(linkAction('project', assist.projectSource, `/${marketObj.prefix}/customization?audience=hotel`));
  } else if (intent === 'market') {
    answer = assist.market.replace('{market}', marketObj.name);
    sources.push(source(assist.marketSource, `/${marketObj.prefix}`));
    matchedType = 'page'; matchedRef = 'market';
  } else if (intent === 'finish') {
    const finishNames = [...new Set(allProducts.flatMap((p) => (p.colors || []).map((color) => color.localized_label || color.display_label)))];
    answer = assist.finish.replace('{finishes}', finishNames.join(', '));
    sources.push(source(assist.resourcesSource, `/${marketObj.prefix}/products`));
    matchedType = 'catalogue'; matchedRef = 'finishes';
  } else if (intent === 'material') {
    answer = assist.materialPending;
    sources.push(source(assist.specSource, `/${marketObj.prefix}/resources#document-request`));
    matchedType = 'page'; matchedRef = 'material-declaration';
    actions.push(linkAction('documents', assist.specSource, `/${marketObj.prefix}/resources#document-request`));
  } else if (['dimensions', 'installation', 'packaging', 'lead'].includes(intent)) {
    answer = assist.onRequest;
    sources.push(source(assist.specSource, `/${marketObj.prefix}/resources#document-request`));
    matchedType = 'page'; matchedRef = intent;
    actions.push(linkAction('documents', assist.specSource, `/${marketObj.prefix}/resources#document-request`));
  } else {
    const qTokens = tokens(question);
    let best = null;
    let bestScore = 0;
    const faqs = db.prepare(`
      SELECT q.key, t.question, t.answer FROM faq_translations t
      JOIN faqs q ON q.id = t.faq_id
      WHERE t.locale = ? AND q.published = 1
    `).all(lang);
    for (const faq of faqs) {
      const haystack = normalizeSearch(`${faq.question} ${faq.answer}`);
      let score = 0;
      for (const token of qTokens) if (haystack.includes(token)) score += 1;
      if (score > bestScore) { bestScore = score; best = faq; }
    }
    if (best && bestScore >= 2) {
      answer = best.answer;
      sources.push(faqSource(lang, marketObj.prefix, assist));
      matchedType = 'faq'; matchedRef = best.key;
    } else {
      // Last attempt: product name or category words.
      const queryTokens = tokens(question);
      const scored = allProducts.map((p) => ({ product: p, score: scoreProduct(p, queryTokens) }))
        .filter((entry) => entry.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      if (scored.length) {
        answer = assist.productList.replace('{list}', scored.map((entry) => `${entry.product.name} (${entry.product.sku})`).join(', '));
        sources.push(source(assist.productLink, `/${marketObj.prefix}/products`));
        matchedType = 'product_list';
        matchedRef = scored[0].product.sku;
      } else {
        answer = assist.fallback;
        matchedType = 'fallback';
      }
    }
  }

  if (!actions.length && matchedType === 'fallback') {
    actions.push(linkAction('contact', dict.assistant.contactCta, `/${marketObj.prefix}/contact`));
  }
  if (matchedType === 'fallback') {
    answer = getSetting(db, `assistant.fallback.${lang}`, '') || answer;
  }

  return { answer, sources: sources.slice(0, 4), actions, matchedType, matchedRef, suggestions: [] };
}

function redactQuestion(question) {
  return truncate(
    String(question || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, '[number]')
      .replace(/https?:\/\/\S+/gi, '[link]')
      .replace(/\s+/g, ' ')
      .trim(),
    300,
  );
}

function logQuestion(db, { question, market, locale, result }) {
  db.prepare(`
    INSERT INTO assistant_queries (
      question_redacted, market, locale, matched_type, matched_ref, answer_mode, needs_human, answered, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    redactQuestion(question), market || null, locale || null, result.matchedType,
    result.matchedRef || null, result.mode || 'rules',
    result.matchedType === 'fallback' || result.matchedType === 'handoff' ? 1 : 0,
    result.matchedType === 'fallback' ? 0 : 1, nowIso(),
  );
}

function ask(db, input = {}) {
  const question = normalizeText(input.question, 400);
  const market = getMarket(input.market || 'en');
  if (question.length < 2) {
    return { ok: false, code: 'empty', ...answerFor(db, { question: 'unknown', market: market.code, locale: market.locale }) };
  }
  const result = answerFor(db, { question, market: market.code, locale: market.locale });
  result.mode = 'rules';
  try { logQuestion(db, { question, market: market.code, locale: market.locale, result }); } catch (_) { /* logging is non-critical */ }
  return {
    ok: true,
    answer: result.answer,
    sources: result.sources,
    actions: result.actions || [],
    matchedType: result.matchedType,
    matchedRef: result.matchedRef || null,
    mode: 'rules',
    disclaimer: (ASSIST[market.locale] || ASSIST.en).sourceNotice,
  };
}

async function askWithOptionalLlm(db, input = {}) {
  const base = ask(db, input);
  if (!base.ok || !config.assistant.enabled) return base;
  const market = getMarket(input.market || 'en');
  const question = normalizeText(input.question, 400);
  const language = market.locale === 'de' ? 'German' : market.locale === 'ja' ? 'Japanese' : market.locale === 'it' ? 'Italian' : 'English';
  const context = [
    `Market edition: ${market.name} (${market.code}). Units: ${market.unitSystem}.`,
    `Rule-based approved answer: ${base.answer}`,
    base.sources.length ? `Sources: ${base.sources.map((entry) => `${entry.title} — ${entry.url}`).join('; ')}` : 'No source was retrieved.',
    'Only the published product record and the approved answer are available. Values not present there are not confirmed.',
  ].join('\n');
  try {
    const response = await fetch(`${config.assistant.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.assistant.apiKey}`,
      },
      body: JSON.stringify({
        model: config.assistant.model,
        temperature: 0.2,
        max_tokens: config.assistant.maxTokens,
        messages: [
          {
            role: 'system',
            content: `You are the OLANG bathroom hardware product assistant. Reply in ${language}. Use only the approved context supplied by the website. Do not invent or infer dimensions, material grades, MOQ, lead times, prices, stock, certifications, test results, clients or project claims. Do not claim to be an employee. Keep the answer concise, natural and commercial. If the approved answer says a value is available on request or unconfirmed, say so clearly and offer the inquiry route. Never create a quotation.`,
          },
          { role: 'user', content: `Buyer question: ${redactQuestion(question)}\n\nApproved context:\n${context}` },
        ],
      }),
      signal: AbortSignal.timeout(config.assistant.timeoutMs),
    });
    if (!response.ok) throw new Error(`assistant provider HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? String(payload.choices[0].message.content || '').trim()
      : '';
    if (!content) throw new Error('empty assistant response');
    return { ...base, answer: truncate(content, 1600), mode: 'llm' };
  } catch (error) {
    console.warn('[assistant] LLM unavailable, using approved rule answer:', error.message);
    return { ...base, mode: 'rules_fallback' };
  }
}

function topQuestions(db, limit = 20) {
  return db.prepare(`
    SELECT question_redacted, matched_type, matched_ref, answered, COUNT(*) AS count
    FROM assistant_queries
    GROUP BY question_redacted, matched_type, matched_ref, answered
    ORDER BY count DESC, question_redacted
    LIMIT ?
  `).all(Math.min(100, Math.max(1, Number(limit) || 20)));
}

function unanswered(db, limit = 20) {
  return db.prepare(`
    SELECT question_redacted, market, locale, created_at
    FROM assistant_queries WHERE answered = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(Math.min(100, Math.max(1, Number(limit) || 20)));
}

module.exports = {
  ask, askWithOptionalLlm, topQuestions, unanswered, redactQuestion, inferIntent, ASSIST, config,
};


