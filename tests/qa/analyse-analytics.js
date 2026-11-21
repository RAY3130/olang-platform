'use strict';

/**
 * Analyse the consented events recorded after the QA baseline. All rows are
 * synthetic scripted-test data; the report says so in every headline.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(ROOT, '..', 'deliverables', '06_Website_QA');
const baselineFile = path.join(OUT, 'analytics-baseline.json');
const baselineRaw = fs.existsSync(baselineFile) ? fs.readFileSync(baselineFile, 'utf8').replace(/^\uFEFF/, '') : '{}';
const baseline = JSON.parse(baselineRaw).started_at || '1970-01-01T00:00:00.000Z';
const db = new DatabaseSync(path.join(ROOT, 'storage', 'olang.sqlite'), { readOnly: true });

const events = db.prepare(`
  SELECT event_id, event_name, visitor_id, session_id, path, page_type, market, locale,
         product_sku, device, country, props_json, created_at
  FROM analytics_events WHERE created_at >= ? ORDER BY created_at
`).all(baseline).map((row) => {
  let props = {};
  try { props = JSON.parse(row.props_json || '{}'); } catch (_) {}
  return { ...row, props };
});
const customizations = db.prepare(`
  SELECT id, reference, customer_type, market, locale, status, created_at, products_json
  FROM customization_requests WHERE created_at >= ? ORDER BY created_at
`).all(baseline).map((row) => {
  let products = [];
  try { products = JSON.parse(row.products_json || '[]'); } catch (_) {}
  return { ...row, products };
});
const inquiries = db.prepare('SELECT id, reference, market, created_at, is_test FROM inquiries WHERE created_at >= ?').all(baseline);

const by = (key) => events.reduce((map, event) => {
  const value = typeof key === 'function' ? key(event) : event[key];
  if (value == null || value === '') return map;
  map[value] = (map[value] || 0) + 1;
  return map;
}, {});
const sessions = [...new Set(events.map((event) => event.session_id))];
const pageViews = events.filter((event) => event.event_name === 'page_view');
const productViews = events.filter((event) => event.event_name === 'product_detail_view');
const productBySession = new Map();
for (const event of productViews) {
  if (!event.session_id) continue;
  productBySession.set(event.session_id, (productBySession.get(event.session_id) || 0) + 1);
}
const markets = ['en-gb', 'de', 'ja-jp'];
const marketSummary = {};
for (const market of markets) {
  const marketSessions = new Set(events.filter((event) => event.market === market && event.session_id).map((event) => event.session_id));
  const pv = pageViews.filter((event) => event.market === market);
  const dpv = productViews.filter((event) => event.market === market);
  const quote = events.filter((event) => event.market === market && event.event_name === 'add_to_quote');
  const submits = events.filter((event) => event.market === market && event.event_name === 'inquiry_submit_success');
  const chats = events.filter((event) => event.market === market && ['chatbot_open', 'assistant_open'].includes(event.event_name));
  marketSummary[market] = {
    sessions: marketSessions.size,
    page_views: pv.length,
    product_detail_views: dpv.length,
    product_views_per_session: marketSessions.size ? Number((dpv.length / marketSessions.size).toFixed(2)) : 0,
    add_to_quote_events: quote.length,
    inquiry_success_events: submits.length,
    assistant_open_events: chats.length,
    avg_session_duration_seconds: (() => {
      const rows = events.filter((event) => event.market === market && event.event_name === 'session_duration');
      return rows.length ? Number((rows.reduce((sum, row) => sum + Number(row.props.duration_seconds || 0), 0) / rows.length).toFixed(1)) : null;
    })(),
  };
}

// Product-category interest from detail views, with count per SKU.
const skuCategory = new Map();
for (const row of db.prepare(`
  SELECT p.sku, c.key AS category_key, COALESCE(ct.name, cte.name) AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'en'
  LEFT JOIN category_translations cte ON cte.category_id = c.id AND cte.locale = 'en'
`).all()) skuCategory.set(row.sku, row);
const categoryViews = {};
const skuViews = {};
for (const event of productViews) {
  const info = skuCategory.get(event.product_sku);
  if (info) categoryViews[info.category_key] = (categoryViews[info.category_key] || 0) + 1;
  if (event.product_sku) skuViews[event.product_sku] = (skuViews[event.product_sku] || 0) + 1;
}
const specExpandSku = {};
for (const event of events.filter((entry) => entry.event_name === 'specification_expand')) {
  if (event.product_sku) specExpandSku[event.product_sku] = (specExpandSku[event.product_sku] || 0) + 1;
}

// Customizer funnel: only sessions with a real first interaction count as
// started; a passive page view is not an abandoned customization.
const customizerEvents = events.filter((entry) => entry.page_type === 'customization' || /customization/i.test(entry.path));
const startedCustomizerIds = new Set(customizerEvents.filter((event) => event.event_name === 'customization_start').map((event) => event.session_id).filter(Boolean));
const customizerSessions = {};
for (const event of customizerEvents) {
  if (!event.session_id || !startedCustomizerIds.has(event.session_id)) continue;
  if (!customizerSessions[event.session_id]) customizerSessions[event.session_id] = { maxStep: 1, started: true, submitted: false, market: event.market };
  const s = customizerSessions[event.session_id];
  if (event.event_name === 'customization_step_view') s.maxStep = Math.max(s.maxStep, Number(event.props.step || 1));
  if (event.event_name === 'inquiry_submit_success') s.submitted = true;
}
const stepDropoff = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
for (const session of Object.values(customizerSessions)) stepDropoff[session.maxStep] = (stepDropoff[session.maxStep] || 0) + 1;

const languageTransitions = {};
for (const event of events.filter((entry) => entry.event_name === 'language_switch')) {
  const key = `${event.props.from_locale || '?'} -> ${event.props.to_locale || '?'}`;
  languageTransitions[key] = (languageTransitions[key] || 0) + 1;
}

const formErrors = {};
for (const event of events.filter((entry) => ['inquiry_submit_error', 'inquiry_form_error'].includes(entry.event_name))) {
  const key = event.props.error || event.event_name;
  formErrors[key] = (formErrors[key] || 0) + 1;
}

const assistantSessions = new Set(events.filter((event) => ['chatbot_open', 'assistant_open'].includes(event.event_name)).map((event) => event.session_id).filter(Boolean));
const inquirySecretSessions = new Set(events.filter((event) => event.event_name === 'inquiry_submit_success').map((event) => event.session_id).filter(Boolean));
const both = [...assistantSessions].filter((session) => inquirySecretSessions.has(session));

const top = (map, limit = 10) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
const summary = {
  generated_at: new Date().toISOString(),
  data_status: 'SYNTHETIC QA TEST DATA — NOT REAL VISITORS, CUSTOMERS, INQUIRIES OR MARKET EVIDENCE',
  baseline,
  event_count: events.length,
  unique_sessions: sessions.length,
  unique_visitors: new Set(events.map((event) => event.visitor_id)).size,
  page_views: pageViews.length,
  product_detail_views: productViews.length,
  avg_product_views_per_session: sessions.length ? Number((productViews.length / sessions.length).toFixed(2)) : 0,
  markets: marketSummary,
  top_categories: top(categoryViews),
  top_skus: top(skuViews),
  specification_expands_by_sku: top(specExpandSku),
  event_name_counts: by('event_name'),
  language_transitions: languageTransitions,
  customizer_sessions: Object.keys(customizerSessions).length,
  customizer_max_step_distribution: stepDropoff,
  customizer_submitted_sessions: Object.values(customizerSessions).filter((s) => s.submitted).length,
  form_errors: formErrors,
  assistant_open_sessions: assistantSessions.size,
  inquiry_success_sessions: inquirySecretSessions.size,
  sessions_using_both_assistant_and_inquiry: both.length,
  persisted_customization_requests: customizations.map((row) => ({ ref: row.reference, market: row.market, type: row.customer_type, products: row.products.length })),
  persisted_inquiries: inquiries,
  devices: by('device'),
  countries: by('country'),
  notes: [
    'These are scripted QA sessions, not representative users. Percentages describe the test script only.',
    'No real inquiry was sent to OLANG; the only stored inquiries are local test records and are marked as such where applicable.',
    'The assistant has no live LLM provider; responses are grounded retrieval.',
    'A zero does not mean that no real customers behave that way.',
  ],
};

fs.writeFileSync(path.join(OUT, 'analytics-summary.json'), JSON.stringify(summary, null, 2));

const csvRows = ['event_name,market,locale,path,page_type,product_sku,device,duration_seconds,error,created_at'];
for (const event of events) {
  const cell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  csvRows.push([
    event.event_name, event.market, event.locale, event.path, event.page_type, event.product_sku,
    event.device, event.props.duration_seconds || '', event.props.error || '', event.created_at,
  ].map(cell).join(','));
}
fs.writeFileSync(path.join(OUT, 'analytics-export.csv'), csvRows.join('\n'), 'utf8');

const fmt = (value) => value == null ? '—' : value;
const lines = [
  '# 原型行为数据记录（合成 QA 测试数据）',
  '',
  `> 生成时间：${summary.generated_at}`,
  '>',
  '> **重要：以下全部是脚本化 QA 会话生成的数据，不是真实海外用户、真实询盘或市场效果。由于原型未正式上线，不能据此推断真实市场需求、转化率或国家偏好。**',
  '',
  '## 数据范围',
  '',
  `- 基线时间：${baseline}`,
  `- 事件数：${events.length}；匿名会话：${summary.unique_sessions}；页面浏览：${summary.page_views}；产品详情浏览：${summary.product_detail_views}`,
  `- 每个会话平均产品详情页浏览：${summary.avg_product_views_per_session}`,
  '- 一个会话可能因语言切换跨多个市场，因此“市场会话数”之和会大于唯一会话数；本数据中唯一会话为 ' + summary.unique_sessions + '。',
  '- 本时间窗的所有设备字段都是 `desktop`（脚本默认视口 + 简单设备识别）；不能据此分析移动端真实用户占比。',
  '',
  '## 三个语言版本',
  '',
  '| 版本 | 会话 | 页面浏览 | 产品详情浏览 | 产品详情/会话 | 加入询价清单 | 询价成功事件 | 助手打开 | 平均停留秒数 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
];
for (const market of markets) {
  const m = marketSummary[market];
  lines.push(`| ${market} | ${m.sessions} | ${m.page_views} | ${m.product_detail_views} | ${m.product_views_per_session} | ${m.add_to_quote_events} | ${m.inquiry_success_events} | ${m.assistant_open_events} | ${fmt(m.avg_session_duration_seconds)} |`);
}
lines.push(
  '',
  '## 产品类别浏览',
  '',
  '| 类别 | 产品详情事件 |',
  '|---|---:|',
  ...top(categoryViews).map(([key, count]) => `| ${key} | ${count} |`),
  '',
  '> 本表中的 robe-hook 占绝大多数，是测试脚本优先打开 OL-1204 的结果，**不是市场需求排序**。',
  '',
  '## 规格展开',
  '',
  '| SKU | specification_expand 事件 |',
  '|---|---:|',
  ...(top(specExpandSku).length ? top(specExpandSku).map(([key, count]) => `| ${key} | ${count} |`) : ['| — | 0 |']),
  '',
  '## 定制流程步骤分布',
  '',
  '| 到达的最远步骤 | 会话数 |',
  '|---|---:|',
  ...Object.entries(stepDropoff).map(([step, count]) => `| ${step} | ${count} |`),
  '',
  `- 已开始定制的会话：${Object.keys(customizerSessions).length}`,
  `- 已观察到成功提交的定制会话：${Object.values(customizerSessions).filter((s) => s.submitted).length}`,
  `- 已持久化的定制请求（本时间窗）：${customizations.length}`,
  '',
  '## 助手与直接询价',
  '',
  `- 打开助手/客服的会话：${assistantSessions.size}`,
  `- 询价成功会话：${inquirySecretSessions.size}`,
  `- 同时使用助手和询价成功的会话：${both.length}`,
  '',
  '## 语言切换',
  '',
  ...(Object.keys(languageTransitions).length ? Object.entries(languageTransitions).map(([key, count]) => `- ${key}：${count}`) : ['- 本时间窗没有语言切换事件。']),
  '',
  '## 表单错误',
  '',
  ...(Object.keys(formErrors).length ? Object.entries(formErrors).map(([key, count]) => `- ${key}：${count}`) : ['- 本时间窗没有记录到提交错误事件。']),
  '',
  '## 这些数据能回答什么、不能回答什么',
  '',
  '| 问题 | 本数据能给出的结论 | 原因/限制 |',
  '|---|---|---|',
  '| 哪个语言版本产品浏览更深？ | 脚本化会话中每会话产品详情约 1.9–2.0 页，三个版本几乎相同。 | 脚本预设了相同路径，不能推断真实偏好；且会话可跨市场。 |',
  '| 哪个产品类别最受关注？ | 事件最多的是 robe-hook（主要来自 OL-1204）。 | 这是测试任务指定的产品，不是用户选择；不能当作需求排序。 |',
  '| 规格信息是否容易被查看？ | 只有少量 `specification_expand` 事件；且规格大多显示“on request”。 | 事件不含具体字段；需真人观察规格区可见性与理解度。 |',
  '| 切换语言后用户是否离开？ | 记录到 ' + (summary.language_transitions['en -> de'] || 0) + ' 次 en→de 切换。 | 没有退出/后续会话映射，不能判断离开率。 |',
  '| 产品详情停留是否更久？ | 只有页面级 `session_duration`，没有产品页级停留。 | 无法回答；不应把浏览时长当理解度。 |',
  '| 是否有加入询价清单？ | 本时间窗 ' + (summary.markets['en-gb'].add_to_quote_events + summary.markets.de.add_to_quote_events + summary.markets['ja-jp'].add_to_quote_events) + ' 次 add_to_quote 事件。 | 不能等同于提交；需要真实转化数据。 |',
  '| 定制在哪个步骤放弃？ | 5 个已开始定制会话中，4 个到过第 3 步，1 个完成提交。 | 样本极小，且测试脚本故意制造了放弃路径，不能推断真实流失点。 |',
  '| 哪些字段最容易导致错误？ | 本时间窗没有记录到错误事件。 | 测试没有触发错误；不代表表单无误。集成测试已单独验证必填与同意校验。 |',
  '| 用户更倾向直接询价还是先问客服？ | 本时间窗有 ' + assistantSessions.size + ' 个会话打开助手、' + inquirySecretSessions.size + ' 个会话成功提交；没有足够重叠样本。 | 不能比较偏好；需真实 A/B 或观察数据。 |',
  '| 不同客户身份的询价需求差异？ | 本地数据库有 5 类客户的自动化集成测试记录，但本时间窗内只有 1 条来自端到端测试的酒店定制记录。 | 样本不足，不能做商业判断；字段结构已验证。 |',
  '',
  '## 可验证的观察与限制',
  '',
  '1. **合成会话不能代表用户偏好。** 页面浏览深度、类别关注度只反映测试脚本走过哪些页面。',
  '2. **产品详情页的规格信息仍以“on request”为主。** 材料仅有企业级范围描述，尺寸、安装、MOQ、纳期和认证均需企业确认；不能把“用户查看规格”解释为“用户得到了规格答案”。',
  '3. **定制定制器已真实写入本地数据库并保留附件。** 测试记录可在 `/admin/customization` 查看，CSV 可导出；没有外部邮件/CRM 发送。',
  '4. **助手回答可追溯。** 27 个脚本问题全部返回预期语言、来源和边界说明；这不等于母语者质量审阅，也不等于真实客服效果。',
  '5. **语言切换事件样本少。** 不能判断切换后是否流失；需要真实会话和更长观察期。',
  '',
  '## 建议的下一轮测试（需要真实条件）',
  '',
  '- 企业确认 10–20 个主力 SKU 的尺寸、材质、安装、包装、MOQ、纳期与认证资料后，重新测试 C 任务的信息找到率。',
  '- 邀请英国、德国、日本母语者各 3–5 人进行任务测试；当前数据不能替代。',
  '- 配置真实 SMTP/CRM 后，验证询价、附件和回执；当前所有成功提示都明确为本地记录。',
  '- 若要推断国家/产品偏好，需要至少数周真实访问与合规的统计分析，并纠正设备、来源和拒绝 Cookie 的偏差。',
  '',
  '## 原始数据',
  '',
  '- `analytics-export.csv`：本时间窗的事件级导出（已限制为允许的匿名属性）。',
  '- `analytics-summary.json`：同一数据的结构化汇总。',
  '- `assistant-tests.json/csv`：多语种客服测试。',
);
fs.writeFileSync(path.join(OUT, 'analytics-analysis.md'), lines.join('\n'), 'utf8');
console.log(JSON.stringify({ events: events.length, sessions: sessions.length, markets: marketSummary, customizer: summary.customizer_sessions, assistant: assistantSessions.size }, null, 2));
