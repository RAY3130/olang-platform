'use strict';

/**
 * SKU-level introductions for the demo. The catalogue has six soap-dish variants whose public
 * category name is identical; these lines give each model a distinct form story while keeping
 * the shared category facts honest. Values remain demo-level.
 */
const INTROS = {
  'OL-1701B': {
    en: 'Classic wall-mounted soap dish with a raised rim, sized for guest washrooms and hotel bathrooms. Four finishes; concealed fixing and a removable tray for cleaning.',
    de: 'Klassische Wandseifenschale mit erhöhtem Rand für Gäste- und Hotelbäder. Vier Oberflächen; verdeckte Befestigung und herausnehmbare Ablage.',
    ja: 'ゲスト用洗面所やホテル浴室向けの、縁付き壁付けソープディッシュ。4色展開、隠しねじ固定、取り外し可能なトレイ。',
  },
  'OL-1205': {
    en: 'Wall-mounted brass towel bar for hand towels, in four finishes. Concealed fixing and a clean single-bar form for guest bathrooms and hotel rooms.',
    de: 'Wandmontierte Handtuchstange aus Messing für Handtücher, in vier Oberflächen. Verdeckte Befestigung und eine klare Einzelstangenform für Gäste- und Hotelbäder.',
    ja: 'ハンドタオル用の壁付けタオルバー（真鍮製・4色展開）。隠しねじ固定と、ゲスト浴室・ホテル客室向けのシンプルな一本バー形状です。',
  },
  'OL-6601A': {
    en: 'Compact wall-mounted soap dish for cloakrooms and small basins, with a slim profile and a simple drop-in tray. Four finishes; concealed fixing.',
    de: 'Kompakte Wandseifenschale für Gäste-WC und kleine Waschbecken, mit schlankem Profil und einfacher Einlage. Vier Oberflächen; verdeckte Befestigung.',
    ja: 'トイレ・洗面所や小さな洗面ボウル向けのコンパクトな壁付けソープディッシュ。スリムな形状と取り外し式トレイ。4色展開、隠しねじ固定。',
  },
  'OL-6601B': {
    en: 'Wall-mounted soap dish with a ventilated tray, designed for daily family bathrooms and hospitality housekeeping. Four finishes; concealed fixing.',
    de: 'Wandseifenschale mit belüfteter Ablage für Familienbäder und Hotel-Housekeeping. Vier Oberflächen; verdeckte Befestigung.',
    ja: '家族用浴室やホテルのハウスキーピング向け、通気性のあるトレイ付き壁付けソープディッシュ。4色展開、隠しねじ固定。',
  },
  'OL-6601C': {
    en: 'Soap dish with a removable insert and a deeper rim, for shower rooms and wet areas where rinsing is part of the daily routine. Four finishes.',
    de: 'Seifenschale mit herausnehmbarer Einlage und höherem Rand für Duschräume und Nassbereiche. Vier Oberflächen.',
    ja: 'シャワールームや湿気の多い空間向け、取り外し式インサートと深い縁を持つソープディッシュ。4色展開。',
  },
  'OL-7201A': {
    en: 'Angled corner soap dish that uses the unused corner of a basin or shower. Four finishes; the corner bracket and concealed fixing are supplied together.',
    de: 'Schräge Eckseifenschale für die ungenutzte Ecke von Waschbecken oder Dusche. Vier Oberflächen; Eckhalter und verdeckte Befestigung im Lieferumfang.',
    ja: '洗面ボウルやシャワーの角を活用する斜め配置のソープディッシュ。4色展開、コーナーブラケットと隠しねじ固定具付き。',
  },
  'OL-7201B': {
    en: 'Linear soap dish for a double-basin vanity, with a long tray that keeps two soaps separate. Four finishes; concealed fixing and a removable tray.',
    de: 'Lineare Seifenschale für Doppelwaschbecken mit langer Ablage für zwei Seifen. Vier Oberflächen; verdeckte Befestigung und herausnehmbare Ablage.',
    ja: 'ダブル洗面ボウル向けのロングトレイ付きソープディッシュ。2つの石けんを分けて置けます。4色展開、隠しねじ固定、取り外し式トレイ。',
  },
};

function productIntroFor(sku, locale = 'en') {
  const entry = INTROS[String(sku || '').toUpperCase()];
  if (!entry) return '';
  return entry[locale] || entry.en;
}

module.exports = { INTROS, productIntroFor };
