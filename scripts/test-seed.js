process.env.DB_PATH='./storage/upgrade-test.sqlite';
const {openDatabase}=require('../src/db');
const {seedAll}=require('../src/db/seed');
const db=openDatabase();
seedAll(db,console);
console.log('products',db.prepare('SELECT COUNT(*) c FROM products').get());
console.log('attrs',db.prepare('SELECT status,COUNT(*) c FROM product_attributes GROUP BY status').all());
console.log('news',db.prepare('SELECT COUNT(*) c FROM news_articles').get());
console.log('cases',db.prepare('SELECT COUNT(*) c FROM case_studies').get());
console.log('market rows',db.prepare('SELECT COUNT(*) c FROM market_settings').get());
console.log('featured',db.prepare('SELECT COUNT(*) c FROM market_featured_products').get());
console.log('docs',db.prepare('SELECT COUNT(*) c FROM documents').get());
console.log('sample',db.prepare("SELECT p.sku,p.collection,p.series,pt.name,p.image_path FROM products p JOIN product_translations pt ON pt.product_id=p.id AND pt.locale='de' WHERE p.sku IN ('OL-1204','OL-11301','OL-5201B')").all());

