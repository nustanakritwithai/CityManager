import { Router } from 'express';
import { fail } from './security.js';

// Stable product identities are independent of market offers. Names are display
// metadata; the item_id is the existing inventory/listing item_code.
export const MARKET_CATALOG = Object.freeze([
  { item_id:'crop:rice', name:'ข้าว', category:'crop' },
  { item_id:'crop:vegetables', name:'ผัก', category:'crop' },
  { item_id:'crop:sugarcane', name:'อ้อย', category:'crop' },
  { item_id:'product:milled-rice', name:'ข้าวสาร', category:'product' },
  { item_id:'product:canned-food', name:'อาหารกระป๋อง', category:'product' },
  { item_id:'product:sugar', name:'น้ำตาล', category:'product' },
]);

function page(q) {
  const parse = (v, fallback, max) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^\d+$/.test(v)) throw fail(400,'invalid pagination');
    const n=Number(v); if (!Number.isSafeInteger(n) || n>max) throw fail(400,'invalid pagination'); return n;
  };
  const limit=parse(q.limit,20,100), offset=parse(q.cursor,0,10000);
  if(limit<1) throw fail(400,'invalid pagination'); return {limit,offset};
}
function filterNumber(q,key) {
  const v=q[key]; if(v===undefined || v==='') return null;
  if(typeof v!=='string' || !/^\d{1,19}$/.test(v) || BigInt(v)>9223372036854775807n) throw fail(400,`invalid ${key}`);
  return v;
}
function filters(q) {
  const min=filterNumber(q,'min_price'), max=filterNumber(q,'max_price'), quantity=filterNumber(q,'min_quantity');
  if(min!==null && max!==null && BigInt(min)>BigInt(max)) throw fail(400,'invalid price range');
  if(q.status!==undefined && q.status!=='open') throw fail(400,'invalid status');
  return {min,max,quantity};
}
function paged(rows, limit, offset) {
  const has=rows.length>limit, next=offset+limit;
  return {items:rows.slice(0,limit),next_cursor:has&&next<=10000?String(next):null,pagination_truncated:has&&next>10000};
}
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);

// Per-process, per-guest bound. This protects query load without treating all
// clients behind the same reverse proxy as one IP. It is not a distributed quota.
export function createMarketReadLimiter({limit=120,windowMs=60_000,maxGuests=4096,now=Date.now}={}) {
  const buckets=new Map();
  return (req,res,next)=>{
    const id=req.account.id,t=now();let b=buckets.get(id);
    if(!b||t>=b.resetAt)b={count:0,resetAt:t+windowMs};
    buckets.delete(id);buckets.set(id,b);
    if(buckets.size>maxGuests)buckets.delete(buckets.keys().next().value);
    if(b.count>=limit){res.set('Retry-After',String(Math.max(1,Math.ceil((b.resetAt-t)/1000))));return res.status(429).json({error:'market read rate limited'});}
    b.count++;next();
  };
}

export function marketReadRouter({pool,guest,catalog=MARKET_CATALOG}) {
  const router=Router(); const catalogJson=JSON.stringify(catalog); const byId=new Map(catalog.map(x=>[x.item_id,x]));
  router.use(guest,createMarketReadLimiter());
  router.get('/products',asyncRoute(async(req,res)=>{
    const {limit,offset}=page(req.query), f=filters(req.query);
    const {q='',category='',sort='name'}=req.query;
    if(typeof q!=='string' || q.length>100 || typeof category!=='string' || category.length>40) throw fail(400,'invalid search');
    const sorts={name:'c.name ASC,c.item_id ASC',price_asc:'a.min_price ASC NULLS LAST,c.item_id ASC',price_desc:'a.min_price DESC NULLS LAST,c.item_id ASC',quantity:'COALESCE(a.total_quantity,0) DESC,c.item_id ASC'};
    if(typeof sort!=='string' || !Object.hasOwn(sorts,sort)) throw fail(400,'invalid sort');
    const sql=`WITH c AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS c(item_id text,name text,category text)),
      a AS (SELECT item_code, MIN(unit_price) min_price,SUM(quantity) total_quantity,COUNT(*) offer_count FROM listings
        WHERE status='open' AND expires_at>now() AND quantity>0 AND ($2::bigint IS NULL OR unit_price >= $2) AND ($3::bigint IS NULL OR unit_price <= $3)
        AND ($4::bigint IS NULL OR quantity >= $4) GROUP BY item_code)
      SELECT c.item_id,c.name,c.category,a.min_price::text,COALESCE(a.total_quantity,0)::text total_quantity,COALESCE(a.offer_count,0)::text offer_count
      FROM c LEFT JOIN a ON a.item_code=c.item_id WHERE ($5='' OR c.category=$5) AND ($6='' OR position(lower($6) in lower(c.name))>0 OR position(lower($6) in lower(c.item_id))>0)
      ORDER BY ${sorts[sort]} LIMIT $7 OFFSET $8`;
    const r=await pool.query(sql,[catalogJson,f.min,f.max,f.quantity,category,q,limit+1,offset]); res.json(paged(r.rows,limit,offset));
  }));
  router.get('/products/:itemId/offers',asyncRoute(async(req,res)=>{
    if(!byId.has(req.params.itemId)) throw fail(404,'product not found');
    const {limit,offset}=page(req.query),f=filters(req.query),sort=req.query.sort||'price_asc';
    const sorts={price_asc:'listings.unit_price ASC,created_at ASC,id ASC',price_desc:'listings.unit_price DESC,created_at ASC,id ASC',quantity:'listings.quantity DESC,created_at ASC,id ASC',newest:'created_at DESC,id DESC'};
    if(typeof sort!=='string'||!Object.hasOwn(sorts,sort)) throw fail(400,'invalid sort');
    const r=await pool.query(`SELECT id AS listing_id,item_code AS item_id,unit_price::text,quantity::text,expires_at,(seller_id=$2::uuid) AS is_mine FROM listings WHERE item_code=$1 AND status='open' AND expires_at>now() AND quantity>0 AND ($3::bigint IS NULL OR unit_price >= $3) AND ($4::bigint IS NULL OR unit_price <= $4) AND ($5::bigint IS NULL OR quantity >= $5) ORDER BY ${sorts[sort]} LIMIT $6 OFFSET $7`,[req.params.itemId,req.account.id,f.min,f.max,f.quantity,limit+1,offset]);
    res.json(paged(r.rows,limit,offset));
  }));
  router.get('/history',asyncRoute(async(req,res)=>{
    const {limit,offset}=page(req.query),role=req.query.role||'buyer';
    if(role!=='buyer'&&role!=='seller') throw fail(400,'invalid role');
    const column=role==='buyer'?'buyer_id':'seller_id';
    const r=await pool.query(`SELECT p.operation_id,p.listing_id,l.item_code AS item_id,p.quantity::text,p.unit_price::text,p.total::text,p.created_at FROM purchases p JOIN listings l ON l.id=p.listing_id WHERE p.${column}=$1 ORDER BY p.created_at DESC,p.operation_id DESC LIMIT $2 OFFSET $3`,[req.account.id,limit+1,offset]);
    res.json(paged(r.rows,limit,offset));
  }));
  router.get('/products/:itemId/stats',asyncRoute(async(req,res)=>{
    if(!byId.has(req.params.itemId)) throw fail(404,'product not found');
    const r=await pool.query(`WITH trades AS (SELECT p.unit_price,p.quantity,p.total,p.created_at,p.operation_id FROM purchases p JOIN listings l ON l.id=p.listing_id WHERE l.item_code=$1 AND p.created_at>=now()-interval '30 days' AND p.created_at<=now()) SELECT COUNT(*)::text trade_count,COALESCE(SUM(quantity),0)::text volume,MIN(unit_price)::text min_price,MAX(unit_price)::text max_price,ROUND(SUM(total)::numeric/NULLIF(SUM(quantity),0),2)::text weighted_average_price,(SELECT unit_price::text FROM trades ORDER BY created_at DESC,operation_id DESC LIMIT 1) last_price,now() AS as_of,now()-interval '30 days' AS window_start FROM trades`,[req.params.itemId]);
    res.json({item_id:req.params.itemId,window_days:30,...r.rows[0]});
  }));
  return router;
}
