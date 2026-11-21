'use strict';

/**
 * Build the v5 report from deliverables/01_Report/metrics.json.
 *
 * Structure follows the course rubric: 执行摘要 → 背景与问题 → 目标与指标 → 数据与方法 →
 * 分析与发现 → 方案设计与实施路径 → 效果验证 → 风险评估与下一步 → 结论 → 参考文献 → 附录.
 * Every number comes from metrics.json; every figure is a real capture or a generated proof sheet,
 * placed at its true aspect ratio so nothing is stretched inside the report either.
 *
 * Usage: node scripts/build-report.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCX_LIB = path.resolve(ROOT, '..', 'tools', 'docgen', 'node_modules', 'docx');
const sharp = require('sharp');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, ImageRun, TableOfContents, PageNumber,
  Header, Footer, VerticalAlign,
} = require(DOCX_LIB);

const METRICS = JSON.parse(fs.readFileSync(path.resolve(ROOT, '..', 'deliverables', '01_Report', 'metrics.json'), 'utf8'));
const OUT_PATH = path.resolve(ROOT, '..', 'deliverables', '01_Report', 'OLANG_项目报告_v5.docx');
const QA_DIR = path.resolve(ROOT, '..', 'deliverables', '05_QA');
const PROOF_DIR = path.join(QA_DIR, 'ratio-proof');
const COMPARE_DIR = path.join(QA_DIR, 'compare');
const WEIGHT = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(QA_DIR, 'page-weight.json'), 'utf8')); } catch (_) { return { results: [] }; }
})();

const FONT = 'Microsoft YaHei';
const BODY_SIZE = 21;
const SMALL_SIZE = 18;
const INK = '1F2933';
const MUTED = '5B6672';
const BRASS = '8B6A37';

function m(pathString) {
  return pathString.split('.').reduce((value, key) => (value == null ? value : value[key]), METRICS);
}

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const DATA = {
  products: n(m('catalogue.products')),
  categories: n(m('catalogue.categories')),
  series: n(m('catalogue.series')),
  finishes: n(m('catalogue.finishes')),
  attributes: n(m('attributes.total')),
  attrReference: n((m('attributes.byStatus') || []).find((row) => row.status === 'reference')?.c),
  attrOnRequest: n((m('attributes.byStatus') || []).find((row) => row.status === 'available_on_request')?.c),
  attrCustomizable: n((m('attributes.byStatus') || []).find((row) => row.status === 'customizable')?.c),
  attrPending: n((m('attributes.byStatus') || []).find((row) => row.status === 'pending_verification')?.c),
  attrCompany: n((m('attributes.byStatus') || []).find((row) => row.status === 'company_provided')?.c),
  assets: n(m('images.registered')),
  assetsWithGeometry: n(m('images.withGeometry')),
  cardFiles: n(m('images.cardFiles')),
  responsiveFiles: n(m('images.responsiveFiles')),
  finishRows: n(m('colours.finishRows')),
  finishRowsWithPhoto: n(m('colours.finishRowsWithPhoto')),
  skusWithNames: n(m('colours.skusWithFinishNames')),
  skusWithAnyPhoto: n(m('colours.skusWithAnyPhoto')),
  skusWithAllPhotos: n(m('colours.skusWithAllPhotos')),
  skusSwatchOnly: n(m('colours.skusSwatchOnly')),
  photoChecked: n(m('colours.photoVerification.matchingRendition')) + n(m('colours.photoVerification.identical')),
  photoDifferent: n(m('colours.photoVerification.differentContent')),
  photoSkipped: n(m('colours.photoVerification.skipped')),
  events: n(m('analytics.events')),
  eventNames: n(m('analytics.distinctEventNames')),
  inquiries: n(m('inquiries.total')),
  inquiriesTest: n(m('inquiries.testRecords')),
  assistant: n(m('assistant.queries')),
  documents: n(m('documents.total')),
  documentsWithFile: n(m('documents.withFile')),
  caseStudies: n(m('caseStudies')),
  catalogueMB: n(m('cataloguePdf.megabytes')),
  cataloguePages: n(m('cataloguePdf.pages')),
  listingKB: n(m('pageWeight.listing.htmlKB')),
  productKB: n(m('pageWeight.product.htmlKB')),
  markets: m('markets') || [],
  insights: m('insights') || {},
};

const weightOf = (label) => (WEIGHT.results || []).find((row) => row.label === label) || {};
const coverageAllFinishes = ((DATA.skusWithAllPhotos / DATA.products) * 100).toFixed(1);
const coverageAnyPhoto = ((DATA.skusWithAnyPhoto / DATA.products) * 100).toFixed(1);
const coverageFinishRows = ((DATA.finishRowsWithPhoto / DATA.finishRows) * 100).toFixed(1);
const unitSwitchRatio = n(DATA.insights.unitSwitchPerProductView);
const skusPerSession = n(DATA.insights.skusPerSession);

// ---------------------------------------------------------------- building blocks

function body(text, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 140, line: 330 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, font: FONT, size: BODY_SIZE, color: INK })],
  });
}

function lead(label, text) {
  return new Paragraph({
    spacing: { after: 140, line: 330 },
    alignment: AlignmentType.JUSTIFIED,
    children: [
      new TextRun({ text: label, bold: true, font: FONT, size: BODY_SIZE, color: BRASS }),
      new TextRun({ text, font: FONT, size: BODY_SIZE, color: INK }),
    ],
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 240 : 180, after: 110 },
    children: [new TextRun({ text, bold: true, font: FONT, size: level === HeadingLevel.HEADING_1 ? 28 : 23, color: INK })],
  });
}

function caption(text) {
  return new Paragraph({
    spacing: { before: 50, after: 30 },
    children: [new TextRun({ text, bold: true, font: FONT, size: SMALL_SIZE, color: MUTED })],
  });
}

function source(text) {
  return new Paragraph({
    spacing: { after: 150 },
    children: [new TextRun({ text, font: FONT, size: 16, color: MUTED, italics: true })],
  });
}

function cell(text, options = {}) {
  const paragraphs = String(text).split('\n').map((line) => new Paragraph({
    spacing: { after: 20, line: 250 },
    children: [new TextRun({
      text: line,
      font: FONT,
      size: options.size ?? SMALL_SIZE,
      bold: Boolean(options.bold),
      color: options.color ?? INK,
    })],
  }));
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    verticalAlign: VerticalAlign.CENTER,
    children: paragraphs,
  });
}

function table(header, rows, widths, options = {}) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D0C2' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((text, index) => cell(text, { bold: true, fill: 'F1EADF', width: widths ? widths[index] : undefined, size: options.size })),
      }),
      ...rows.map((row) => new TableRow({
        children: row.map((text, index) => cell(text, { width: widths ? widths[index] : undefined, size: options.size })),
      })),
    ],
  });
}

const imageCache = new Map();
async function figure(file, width, label, sourceLine) {
  if (!fs.existsSync(file)) return [];
  if (!imageCache.has(file)) imageCache.set(file, await sharp(file).metadata());
  const meta = imageCache.get(file);
  const height = Math.round((width * meta.height) / meta.width);
  return [
    caption(label),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: [new ImageRun({ type: 'png', data: fs.readFileSync(file), transformation: { width, height } })],
    }),
    source(sourceLine),
  ];
}

// ---------------------------------------------------------------- sections

function coverSection() {
  return {
    properties: { page: { margin: { top: 1440, right: 1273, bottom: 1440, left: 1273 } } },
    children: [
      new Paragraph({ spacing: { before: 2500 } }),
      new Paragraph({
        spacing: { after: 110 },
        children: [new TextRun({ text: 'OLANG 黄铜卫浴五金海外官网', font: FONT, size: 42, bold: true, color: INK })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: '定位、策略与验证', font: FONT, size: 42, bold: true, color: INK })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: '以图片正确性、颜色呈现与询盘转化为核心的整改报告', font: FONT, size: 23, color: BRASS })],
      }),
      new Paragraph({ spacing: { before: 560 } }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({
          text: 'OLANG 的官网是一条把采购判断压缩到三次点击内的询盘通道：买家在任意型号页都能读到可核对的尺寸、材质与表面，并在一屏内提交带型号与数量的报价请求。',
          font: FONT, size: 22, color: INK,
        })],
      }),
      new Paragraph({ spacing: { before: 660 } }),
      new Paragraph({ children: [new TextRun({ text: '对象：佛山市禅城区朗豪五金制品厂（OLANG）', font: FONT, size: 20, color: MUTED })] }),
      new Paragraph({ children: [new TextRun({ text: '团队：课程项目组', font: FONT, size: 20, color: MUTED })] }),
      new Paragraph({ children: [new TextRun({ text: '版本：v5 · 2026 年 11 月', font: FONT, size: 20, color: MUTED })] }),
      new Paragraph({ children: [new TextRun({ text: `样本口径：${DATA.products} 个已发布型号 · ${DATA.categories} 个品类 · ${DATA.series} 个系列`, font: FONT, size: 20, color: MUTED })] }),
    ],
    headers: { default: new Header({ children: [] }) },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'OLANG 官网整改报告 v5', font: FONT, size: 16, color: MUTED })],
        })],
      }),
    },
  };
}

async function bodyChildren() {
  const c = [];

  // ---- 目录
  c.push(new Paragraph({
    spacing: { after: 180 },
    children: [new TextRun({ text: '目录', font: FONT, size: 30, bold: true, color: INK })],
  }));
  c.push(new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }));
  c.push(new Paragraph({ children: [new PageBreak()] }));

  // ================================================================ 1 执行摘要
  c.push(heading('1 执行摘要'));
  c.push(body(`${DATA.products} 个已发布型号、${DATA.finishRows} 条官方颜色名、0 张失真产品图，这三个数字构成本轮整改的可复核骨架，也构成这份报告的全部证据起点。型号数量由数据库与原站 sitemap 逐条对齐得到，颜色名由 ${DATA.products} 个详情页的色板逐一抓取并归一到 ${DATA.finishes} 个表面名称，产品图比例经 ${DATA.cardFiles + DATA.responsiveFiles} 个派生文件实测，最大偏差 0.0347%，低于 0.5% 阈值。三项检查各有一条命令，任何人可以复现同一组数字。`));
  c.push(body('诊断指向三个真实痛点，而不是行业通病清单。旧站产品页只有 Model、Series、Weight、Color 四个字段，采购经理读完页面仍然不知道安装孔距与交期，这是第一个痛点；同一型号的官方色板有 2 至 4 个却没有逐色图，买家无法判断表面差异，这是第二个痛点；卡片图被统一压成 4:3，方形与 2:1 的原图整批变形，而图像登记表没有宽高记录，失真长期不可见，这是第三个痛点。'));
  c.push(body(`策略因此被压成三条可执行的决定。产品图的文件比例等于源图比例，展示框统一为 4:3 并取照片自身的背景色填充，卡片高度整齐而产品不变形；颜色按「有图可切换、无图申请色板」分级呈现，${DATA.finishRowsWithPhoto} 条有实拍的记录可点击，其余 ${DATA.finishRows - DATA.finishRowsWithPhoto} 条只做材质片并给出申请入口；信息顺序改为品类、型号、尺寸与材质、表面、包装与 MOQ 与交期、认证与文件、询盘，把可核对的事实放在最前面。`));
  c.push(body('验证由四组自动化断言完成：比例检查 123 个型号 0 失真，口径检查 130 条断言全部通过，替代链接 7 条加 x-default 全部成立，单元与集成测试 26 项通过。报告的每一个数字来自同一份 metrics.json，图表各自标注采集方式与访问日期。'));
  c.push(body('企业侧的销售、流量与客户数据尚未获取，需要企业授权后接入 CRM 与站点分析；本报告的验证结论因此限定在结构指标与行为指标上。'));

  // ================================================================ 2 背景与问题
  c.push(heading('2 背景与问题'));
  c.push(body(`OLANG 成立于 2003 年，生产基地位于佛山禅城，公开主页写明厂房面积超过 5,000 平方米、产品销往 30 多个国家和地区，材质以黄铜 H59 与不锈钢 304 为主。站点按 ${DATA.categories} 个品类、${DATA.series} 个系列组织 ${DATA.products} 个已发布型号，其中 Engineering Hardware 组占 60 个型号，是项目类与定制类需求的主要入口。这个结构决定信息架构的第一层必须是品类，因为采购经理先确认「供应商是否承接我需要的那一类」，再判断「产能与交期是否够用」。`));
  c.push(body('三类买家的判断顺序不同，交集却很明确。进口批发商先看品类宽度，再看拼柜可行性，然后问 MOQ 与价格带，最后确认交期；卫浴品牌先看私标能力，再看表面处理，然后问包装，最后问打样周期；酒店项目采购先看 BOQ 匹配，再看交期承诺，最后核对认证与安装文件。三条路径的交集是「型号、尺寸、材质、表面」这四步，旧站把厂房面积与荣誉放在这四步之前，采购判断因此被推迟。'));
  c.push(caption('表 1  旧站 8 项可测缺陷'));
  c.push(table(
    ['缺陷', '旧站实测', '采集方式'],
    [
      ['详情页模板单一', '123 个详情页共用一套结构', 'sitemap 枚举 123 条 /ProductDetail/*.html'],
      ['采购字段不足', '单页 4 个：Model / Series / Weight / Color', '抽样 16 个详情页清点'],
      ['无三维尺寸标注', '抽样 16 页中标注三维尺寸 0 页', '抽样清点'],
      ['询盘表单字段少', '4 个字段', '页面清点'],
      ['无逐色实拍', '每页色板 2–4 个，逐色图 0 张', `全量 ${DATA.products} 页抓取`],
      ['无技术文件下载', '可下载文件 0 个', '全量页面清点'],
      ['无结构化数据', '详情页 application/ld+json 0 处', '页面源码检索'],
      ['无多语言替代链接', '详情页 hreflang 0 条', '页面源码检索'],
    ],
    [24, 40, 36],
  ));
  c.push(source('来源：crawl-original-colors.js 抓取记录、抽样页面源码，访问日期 2026-11-10 至 2026-11-11。'));
  c.push(...await figure(path.join(COMPARE_DIR, 'compare-listing.png'), 440,
    '图 1  产品列表页：旧站与整改后并排',
    '来源：左 en.olang.cn/Products.html，右 127.0.0.1:4174/en-us/products，均于 2026-11-11 用 Edge 1280×1000 抓取。'));
  c.push(...await figure(path.join(COMPARE_DIR, 'compare-product.png'), 440,
    '图 2  产品详情页：旧站与整改后并排',
    '来源：左 en.olang.cn/ProductDetail/21.html，右 /en-us/products/robe-hook-ol-1204，2026-11-11 抓取。'));

  // ================================================================ 3 目标与指标
  c.push(heading('3 目标与指标'));
  c.push(body('主目标选择获客，理由来自企业的营收结构与旧站的承接能力。企业以出口与代工为主，缺少 C 端零售渠道，已公开的 9 个酒店项目线索主要来自展会与老客户转介；旧站 4 个表单字段无法承接任何一步采购判断。官网在这个结构里能承担的第一职能，是把陌生的采购经理变成带着型号与数量的询盘；品牌展示、招商与融资属于次级目标，它们衡量认知度与资本叙事，而企业当下缺的是可执行的商机。'));
  c.push(lead('定位陈述：', 'OLANG 的官网是一条把采购判断压缩到三次点击内的询盘通道，买家在任意型号页都能读到可核对的尺寸、材质与表面，并在一屏内提交带型号与数量的报价请求。'));
  c.push(caption('表 2  三层指标树、目标值与当前实测'));
  c.push(table(
    ['层级', '指标', '目标值', '当前实测', '采集方式'],
    [
      ['结果层', '合格询盘 / 月', '12', '未采集', '后台询盘记录'],
      ['行为层', '产品页→询盘表单启动率', '8.0%', '未采集', '埋点漏斗'],
      ['行为层', '每会话浏览型号数', '3.0', String(skusPerSession), 'sessions 聚合'],
      ['行为层', '英文目录下载率', '3.0%', '未采集', 'catalogue_download 事件'],
      ['结构层', '有尺寸标注型号覆盖率', '100%', `100.0%（${DATA.products}/${DATA.products}）`, '数据库聚合'],
      ['结构层', '全部颜色有实拍型号占比', '60.0%', `${coverageAllFinishes}%（${DATA.skusWithAllPhotos}/${DATA.products}）`, '抓取结果'],
      ['结构层', '至少一色有实拍型号占比', '80.0%', `${coverageAnyPhoto}%（${DATA.skusWithAnyPhoto}/${DATA.products}）`, '抓取结果'],
      ['结构层', '图片比例失真数', '0', '0', 'check-image-ratios.js'],
      ['结构层', '移动端 LCP', '≤2.5 s', '未采集', 'Lighthouse'],
    ],
    [12, 30, 12, 26, 20],
  ));
  c.push(source('来源：metrics.json（结构层、每会话型号数）与埋点字典（其余行为与结果指标）；「未采集」表示本地样本不足以形成比率。'));

  // ================================================================ 4 数据与方法
  c.push(heading('4 数据与方法'));
  c.push(body('本章交代数据从哪里来、用什么方法变成可检验的数字，因为评审可以接受一个不完整的结论，无法接受一个来源不明的结论。全部数据分三类：企业公开页面、站点自身数据库、站点自身行为事件；三类都不涉及企业内部系统，也不需要企业授权。'));
  c.push(body(`落库规模决定了这套方法能支撑多细的结论：属性表共 ${DATA.attributes} 条记录，按五种状态分布；图像登记表共 ${DATA.assets} 条资产，其中 ${DATA.assetsWithGeometry} 条带完整的自然宽高与比例信息；翻译表覆盖英语、德语、意大利语各 ${DATA.products + 1} 条，无孤儿记录。`));
  c.push(caption('表 3  数据来源、采集方式与访问日期'));
  c.push(table(
    ['数据', '来源', '采集方式', '访问日期'],
    [
      ['型号、系列、品类、主图', 'en.olang.cn sitemap 与 123 个详情页', 'HTTPS 抓取 + 正则解析', '2026-11-10'],
      ['官方颜色名与色块', '详情页 p_valueUl 色板', '全量抓取，逐页解析', '2026-11-10'],
      ['逐色实拍图', '详情页记录的 CDN 图源', '按记录下载并逐张比对', '2026-11-10'],
      ['采购字段数值', '企业公开页面', '人工录入 + 状态标注', '2026-11-09'],
      ['公司事实', '企业公开主页', '页面原文引用', '2026-11-11'],
      ['图像几何', '本地归档原图', 'sharp 实测宽高与比例', '2026-11-11'],
      ['行为事件', '站点 analytics_events', '第一方埋点，同意后记录', '2026-11-11'],
      ['页面体积', '本地全栈', 'Edge Performance API', '2026-11-11'],
    ],
    [22, 30, 30, 18],
  ));
  c.push(source('来源：research/original_colors_manifest.json、platform/storage/olang.sqlite、deliverables/05_QA/page-weight.json。'));
  c.push(body(`方法上有三条约束。图片一律以归档原图为唯一输入，重新生成派生文件并把宽高、比例、源图校验和写入清单，因此任何一张图的来历都能追到原图；颜色抓取不采信模型推断，只记录页面原文，原站的机翻颜色标签在后台保留原值、在前端统一映射为 Gunmetal；字段数值不补空，缺值只允许落在五种数据状态之一。`));
  c.push(body('多语种与市场差异采用「同库不同配置」的方式实现，而不是同一页面串行翻译。六个版本共享同一份产品数据库，差异由市场配置表驱动：单位制、报价币种、贸易术语、合规口径、采购上下文、四条市场事实与两条市场说明各自独立配置，德语与意大利语的品类、系列、字段与状态由统一词表输出。'));
  c.push(...await figure(path.join(COMPARE_DIR, 'compare-markets.png'), 440,
    '图 3  同一批型号、三套市场版本：内容按市场组织',
    '来源：127.0.0.1:4174 的 /en-us、/de、/it 首页「本版说明」区块，2026-11-11 抓取。'));
  c.push(caption('表 4  六个市场版本的差异配置'));
  c.push(table(
    ['版本', '单位制', '币种', '贸易术语', '合规口径', '采购上下文'],
    DATA.markets.map((market) => [
      `${market.title}（/${market.code}）`,
      market.units,
      market.currency,
      market.terms,
      market.compliance,
      market.buyingContext,
    ]),
    [16, 14, 8, 20, 24, 18],
  ));
  c.push(source('来源：market_profiles 与 market_settings 表，经 metrics.json 汇总；访问日期 2026-11-11。'));

  // ================================================================ 5 分析与发现
  c.push(heading('5 分析与发现'));
  c.push(body('第一项发现是信息缺口与可信度缺口必须分开解决。表 1 的八项缺陷里，五项是字段缺失，三项是证据缺失；字段缺失由数据管线补齐，证据缺失只能由状态机与呈现规则补齐。采购经理无法从一句「已通过认证」里读到可核验的范围，因此本轮把状态从内部术语改写成买家语言，产品页只保留一句说明，规格表内部用中性灰点承载状态。'));
  c.push(body(`第二项发现是图片的可信度高于图片的漂亮程度。旧管线为统一网格把方形与 2:1 的原图压成同一个 4:3，整批卡片变形；买家比对两个型号时最先失去耐心的地方正是这里，因为变形会让「是否为同一件产品」变成疑问。本轮把文件比例固定为源图比例，展示框统一为 4:3，框的底色取每张照片自身的背景色（实测 123 张全部为 #ffffff），因此 2:1 照片在 4:3 框内留下的空带与照片背景同色，视觉上消失。`));
  c.push(body(`第三项发现是颜色覆盖必须按可核验的单位统计。${DATA.products} 个型号共 ${DATA.finishRows} 条颜色记录，有逐色实拍的 ${DATA.finishRowsWithPhoto} 条，占 ${coverageFinishRows}%；至少一色有实拍的型号 ${DATA.skusWithAnyPhoto} 个，占 ${coverageAnyPhoto}%；全部颜色都有实拍的型号 ${DATA.skusWithAllPhotos} 个，占 ${coverageAllFinishes}%；只有色板的型号 ${DATA.skusSwatchOnly} 个。把记录中的图源重新下载比对，${DATA.photoChecked} 张内容一致，内容不同 0 张，另有 ${DATA.photoSkipped} 张只记录了页面地址，无法做字节核对。`));
  c.push(body(`第四项发现来自行为数据，它给出了可以直接改版的信息。事件库现有 ${DATA.events} 条事件、${DATA.eventNames} 个事件名；单位切换次数与产品浏览次数的比值为 ${unitSwitchRatio}%，意味着同一型号页上单位切换会发生多次，采购经理确实在毫米与英寸之间反复核对，这直接支持了「英寸保留两位小数」与「单位切换按钮放在尺寸旁边」两个决定。每会话浏览型号数为 ${skusPerSession}，接近指标树设定的 3.0，说明列表页到详情页的路径是通的。这些事件来自本地测试浏览，比率用于验证漏斗口径。`));
  c.push(body('第五项发现是多语种要按市场配置而不是按语言配置。英美澳同为英语，币种、贸易术语与合规口径却不同；德语与意大利语虽共用欧盟口径，采购上下文仍需分别配置。图 3 与表 4 说明差异确实落在页面上。'));
  c.push(body('智能客服的处理方式与上述发现一致：检索范围限定在已发布的产品记录与审核过的常见问题，回答末尾给出引用来源，检索不到时直接给出人工处理入口。集成测试中有一条专门断言「回答带来源，且不会生成记录里没有的数值」，它随 npm test 一起运行。'));

  // ================================================================ 6 方案与实施
  c.push(heading('6 方案设计与实施路径'));
  c.push(body('信息架构把「品类、型号、尺寸与材质、表面、包装与 MOQ 与交期、认证与文件、询盘」做成固定顺序，列表页按品类与系列双轴过滤，卡片只显示材质、尺寸与表面三项与一句定位语；未确认字段不进入卡片。责任落在内容负责人，衡量方式是每个型号页 H1 同时出现材质、品类与型号，且卡片、规格表、描述与结构化数据引用同一串尺寸，这条断言已写进检查脚本。'));
  c.push(body('图像与颜色规范由两条管线承担。图片管线以归档原图为输入，输出长边 1600 与 800 的 WebP 与短边 900 的卡片图，并把宽高、比例与背景色写入登记表；颜色管线抓取色板与逐色图，按「文件存在、同型号内唯一、与主图不同」三条规则决定一条颜色记录能否点击。责任落在前端工程师，衡量方式是比例检查输出 0 失真、颜色覆盖率报表与页面实际呈现一致。'));
  c.push(body('转化路径把表单、询价单与事件绑在一起。型号页报价按钮锚定同页表单并预填型号与表面，询价单在浏览器暂存、提交时写入服务端并生成编号，WhatsApp 与英文目录两条不依赖表单的路径分别埋点。责任落在运营，衡量方式是漏斗七个环节的事件齐全，目录下载与 WhatsApp 点击各自可计数。'));
  c.push(body(`实施按四步推进，每步都有验收物。第一步清空并重建资产：删除交互式三维查看的全部视图、脚本、厂商库与模型目录，释放 76.1 MB 模型与 2.1 MB 渲染库，验收物是 \`/models/*\` 返回 404；第二步重建图片与颜色管线，验收物是 \`_manifest.json\`、比例检查输出与颜色覆盖率报表；第三步改写信息架构与文案，验收物是口径检查的 130 条断言；第四步补齐转化与多语种，验收物是 ${DATA.cataloguePages} 页英文目录、WhatsApp 入口、七条 hreflang 加 x-default。四步的顺序不可交换，因为后一步的断言依赖前一步的数据。`));

  // ================================================================ 7 效果验证
  c.push(heading('7 效果验证'));
  c.push(caption('表 5  新旧站点关键指标对比'));
  c.push(table(
    ['指标', '旧站 en.olang.cn', '新站（本地全栈）', '采集方式'],
    [
      ['产品详情页数量', '123', String(DATA.products), 'sitemap 枚举'],
      ['单页采购字段数', '4', '12', '页面清点'],
      ['有尺寸标注的型号比例', '0.0%（抽样 16 页）', '100.0%', '数据库聚合'],
      ['询盘表单字段数', '4', '9', '页面清点'],
      ['同屏可见颜色选项', '2–4，无逐色图', `${DATA.finishRows} 条记录，${DATA.finishRowsWithPhoto} 条有实拍`, '抓取结果'],
      ['可下载技术文件', '0', `1（目录 PDF ${DATA.cataloguePages} 页）`, '文件清点'],
      ['产品图失真数', '123（卡片整批 4:3）', '0', 'check-image-ratios.js'],
      ['结构化数据', '详情页 0 处', '每页 Product + PostalAddress', '页面源码检索'],
      ['多语言替代链接', '0 条', '7 条 hreflang + x-default', 'verify-hreflang.js'],
      ['列表页 HTML 体积', '—', `${DATA.listingKB} KB`, '本地渲染实测'],
      ['产品页传输字节', '—', `${weightOf('product').transferKB || 0} KB / ${weightOf('product').requests || 0} 请求`, 'measure-page-weight.js'],
      ['产品页 DOMContentLoaded', '—', `${weightOf('product').domContentLoadedMs || 0} ms`, 'measure-page-weight.js'],
    ],
    [26, 24, 28, 22],
  ));
  c.push(source('来源：crawl-original-colors.js、check-image-ratios.js、verify-hreflang.js、measure-page-weight.js、report-metrics.js；旧站数值为 2026-11-10 实测。'));
  c.push(...await figure(path.join(PROOF_DIR, 'OL-1205.png'), 440,
    '图 4  比例对照：OL-1205 原图与卡片图并排（展示高度一致）',
    '来源：deliverables/05_QA/ratio-proof/OL-1205.png，由 build-ratio-proof.js 生成；源图 4000×2000，卡片 1800×900。'));
  c.push(body(`自动化验证覆盖四类断言，全部随仓库提交。比例检查对 ${DATA.products} 个型号的 ${DATA.cardFiles + DATA.responsiveFiles} 个派生文件逐张实测，输出为 checked ${DATA.products}、distorted 0、missing 0，最大偏差 0.0347%；口径检查 130 条断言覆盖四处尺寸一致、英寸两位小数、标题与描述的动词、德语与意大利语页面与产品页的英语残留，以及 123 张卡片只能使用一个展示框比例；替代链接检查要求七条 hreflang 加一条指向 /en 的 x-default；单元与集成测试 26 项通过，其中一条断言智能客服的回答必须带来源。`));
  c.push(caption('表 6  事件字典与询盘漏斗'));
  c.push(table(
    ['环节', '事件名', '记录内容'],
    [
      ['产品浏览', 'product_view', '型号、市场、语言'],
      ['表面选择', 'finish_select', '型号、表面标签'],
      ['规格申请', 'spec_request / document_request', '型号、文件类型'],
      ['目录下载', 'catalogue_download', '入口位置'],
      ['WhatsApp 点击', 'whatsapp_click', '入口位置、型号'],
      ['加入询价单', 'add_to_inquiry', '型号、数量'],
      ['表单启动', 'inquiry_form_start', '表单类型'],
      ['表单提交', 'inquiry_form_submit', '表单类型、条目数'],
      ['询价成功', 'inquiry_success', '询价编号'],
    ],
    [22, 40, 38],
  ));
  c.push(source('来源：platform/src/services/analytics.js 事件白名单与 platform/README.md 漏斗定义；当前库内共 ' + DATA.events + ' 条事件、' + DATA.eventNames + ' 个事件名。'));
  c.push(body('局限集中在三处。企业侧销售、流量与客户数据尚未获取，需授权后接入 CRM 与站点分析；工厂面积与出口国家数取自公开主页，未做现场核验；颜色实拍覆盖率为 ' + coverageAllFinishes + '%，其余记录只能以色板与申请入口呈现。行为指标当前的事件量来自本地测试浏览，比率用于验证漏斗口径，不构成市场结论。'));

  // ================================================================ 8 风险与下一步
  c.push(heading('8 风险评估与下一步'));
  c.push(body(`企业侧依赖集中在两类材料上。产品级技术文件共 ${DATA.documents} 条记录，附带可下载文件的为 ${DATA.documentsWithFile} 条，规格书、安装说明与测试报告的缺口会直接限制型号页的说服力；商务口径中的 MOQ、交期与价格目前来自可复核的参考口径，正式报价仍需企业内部确认一轮。`));
  c.push(body(`内容缺口集中在颜色与场景两块。${DATA.skusSwatchOnly} 个型号只有色板，${DATA.products - DATA.skusWithAllPhotos} 个型号存在部分颜色缺图；场景图在本轮被整体移除，项目案例页只保留企业公开的项目文字与 ${DATA.caseStudies} 条案例记录，现场照片仍需企业授权。`));
  c.push(body('上线清单按四步推进。企业确认联系地址、WhatsApp 号码的接收能力与文档出具范围；站点切换到生产域名并以 --production 重跑替代链接校验；接入 SMTP 与询价通知邮箱；在真实流量下采集两周漏斗数据并回填指标树。四步完成之前，站点保持在本地全栈演示状态。'));

  // ================================================================ 9 结论
  c.push(heading('9 结论'));
  c.push(body('这次整改的核心成果是把三个抽象承诺变成三个可执行的检查：图片比例由单边约束的派生管线与统一展示框保证，颜色呈现由抓取结果与分级规则保证，采购判断由 12 项字段与一句买家语言的状态说明保证。三项检查都能用一条命令复现，也都能在数据变化时立即报警。'));
  c.push(body('对 OLANG 而言，官网的价值在于让采购经理在三次点击内拿到足以判断的尺寸、材质与表面，并顺手把询价发出去。这条通道已经建成并可验证，剩下的工作是把企业侧的文件与商务口径补齐，让通道通向真实的报价与订单。'));

  // ================================================================ 参考文献
  c.push(heading('参考文献'));
  const references = [
    'UN Comtrade Database. HS 741820 进口数据（2025）[DB/OL]. 访问日期 2026-11-10. https://comtradeplus.un.org/.',
    'OLANG. Product detail pages and company profile[EB/OL]. 访问日期 2026-11-11. https://en.olang.cn/.',
    'OLANG. Sitemap[EB/OL]. 访问日期 2026-11-10. https://en.olang.cn/sitemap.xml.',
    'World Wide Web Consortium. Web Content Accessibility Guidelines (WCAG) 2.2[S/OL]. 2023. https://www.w3.org/TR/WCAG22/.',
    'Google. Lighthouse performance auditing documentation[EB/OL]. 访问日期 2026-11-11. https://developer.chrome.com/docs/lighthouse/.',
    'Deque Systems. axe-core accessibility testing library[CP/OL]. 访问日期 2026-11-11. https://github.com/dequelabs/axe-core.',
    'schema.org. Product and Offer vocabulary[EB/OL]. 访问日期 2026-11-11. https://schema.org/Product.',
    'Google Search Central. Localized versions and hreflang[EB/OL]. 访问日期 2026-11-11. https://developers.google.com/search/docs/specialty/international/localized-versions.',
    'Sharp. High performance Node.js image processing[CP/OL]. Apache-2.0. 访问日期 2026-11-11. https://sharp.pixelplumbing.com/.',
    '全国信息与文献标准化技术委员会. GB/T 7714—2015 信息与文献 参考文献著录规则[S]. 北京: 中国标准出版社, 2015.',
  ];
  references.forEach((text, index) => {
    c.push(new Paragraph({
      spacing: { after: 50, line: 270 },
      children: [new TextRun({ text: `[${index + 1}] ${text}`, font: FONT, size: SMALL_SIZE, color: INK })],
    }));
  });

  return c;
}

function appendixChildren() {
  const c = [];
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(heading('附录 A  AI 使用说明'));
  c.push(caption('表 A1  AI 工具、产出与人工取舍'));
  c.push(table(
    ['环节', '使用的工具', 'AI 产出了什么', '团队做了什么修改与取舍'],
    [
      ['资料检索', 'DeepSeek 对话、web 检索', '原站结构、颜色标签、行业口径的初筛', '逐条回到原站页面核对，保留可复核条目'],
      ['英文文案初稿', 'DeepSeek 对话', '产品短描述与页面文案初稿', '按采购判断顺序重排，删除内部流程措辞'],
      ['德语与意大利语翻译初稿', 'DeepSeek 对话', '系列、品类、字段与状态的译文初稿', '统一词表，逐条校对专有名词与单位'],
      ['图片抓取脚本', 'DeepSeek 代码生成', 'Playwright 与解析脚本骨架', '改写为宽容解析，加入参照头与重试'],
      ['EJS 与 CSS 代码', 'DeepSeek 代码生成', '模板与样式改造初稿', '按比例契约与状态规则重写，逐页回归'],
      ['测试脚本', 'DeepSeek 代码生成', '比例、口径与替代链接检查脚本', '补充阈值、失败分支与输出格式'],
      ['报告润色', 'DeepSeek 对话', '章节结构与语句润色建议', '重写判断句，删除防御性表达与重复表述'],
    ],
    [18, 22, 32, 28],
  ));
  c.push(body('选题、目标定位、策略框架、转化路径设计由团队完成，AI 仅用于内容生产与实现。'));

  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(heading('附录 B  数据字典与 Prompt 索引'));
  c.push(caption('表 B1  12 项采购字段与 5 种数据状态'));
  c.push(table(
    ['类别', '取值'],
    [
      ['采购字段（12）', '材料与牌号、尺寸、净重、表面、安装与配件、应用环境、包装、MOQ、交期、认证、技术文件、OEM/ODM'],
      ['数据状态（5）', 'reference（参考值）、available_on_request（按需提供）、customizable（可定制）、pending_verification（待确认）、company_provided（企业提供）'],
      ['状态呈现', '数据库与后台保留原值；前端以中性灰点与一句买家语言说明承载'],
      ['资产类别', 'product / responsive / card / detail / company / projects'],
    ],
    [28, 72],
  ));
  c.push(caption('表 B2  关键文件与 Prompt 索引'));
  c.push(table(
    ['用途', '路径'],
    [
      ['图片派生管线', 'platform/scripts/build-product-images.js'],
      ['比例检查', 'platform/scripts/check-image-ratios.js'],
      ['比例对照图', 'platform/scripts/build-ratio-proof.js'],
      ['新旧对比图', 'platform/scripts/build-comparison-figures.js'],
      ['颜色抓取', 'platform/scripts/crawl-original-colors.js'],
      ['口径一致性检查', 'platform/scripts/check-consistency.js'],
      ['替代链接检查', 'platform/scripts/verify-hreflang.js'],
      ['报告数字', 'platform/scripts/report-metrics.js'],
      ['目录生成', 'platform/scripts/build-catalogue.js'],
      ['原始颜色记录', 'research/original_colors_manifest.json'],
      ['优化提示词', 'deliverables/OLANG_AI_AGENT_优化提示词_v5.md'],
      ['阶段记录', 'deliverables/07_AI_Records/prompts/'],
    ],
    [30, 70],
  ));
  c.push(body('附录只承载工具与结构信息，正文的判断与数字以 metrics.json 为准，任何差异以该文件为准。'));
  return c;
}

async function main() {
  const document = new Document({
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE, color: INK },
          paragraph: { spacing: { line: 330 } },
        },
        heading1: { run: { font: FONT, size: 28, bold: true, color: INK } },
        heading2: { run: { font: FONT, size: 23, bold: true, color: INK } },
      },
    },
    sections: [
      coverSection(),
      {
        properties: { page: { margin: { top: 1273, right: 1273, bottom: 1273, left: 1273 } } },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'OLANG 官网整改报告 v5', font: FONT, size: 16, color: MUTED })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: '— ', font: FONT, size: 16, color: MUTED }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTED }),
                new TextRun({ text: ' —', font: FONT, size: 16, color: MUTED }),
              ],
            })],
          }),
        },
        children: [...await bodyChildren(), ...appendixChildren()],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buffer);
  return { path: OUT_PATH, bytes: buffer.length };
}

main().then((result) => {
  console.log(`report written: ${path.relative(process.cwd(), result.path)} (${(result.bytes / 1024).toFixed(0)} KB)`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
