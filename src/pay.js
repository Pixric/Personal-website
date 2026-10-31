import crypto from 'node:crypto';
import * as store from './store.js';

const KAMI_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genKami(len) {
  const n = Math.max(8, Math.min(32, parseInt(len, 10) || 16));
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += KAMI_ALPHABET[bytes[i] % KAMI_ALPHABET.length];
  return out;
}

export function buildSign(params, key, signType) {
  const type = String(signType || 'MD5').toUpperCase();
  const filtered = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'sign' || k === 'sign_type') continue;
    if (v === null || v === undefined || v === '') continue;
    filtered[k] = String(v);
  }
  const keys = Object.keys(filtered).sort();
  const base = keys.map((k) => k + '=' + filtered[k]).join('&');

  if (type === 'RSA') return null;

  const plain = base + '&key=' + key;
  return crypto.createHash('md5').update(plain, 'utf8').digest('hex').toUpperCase();
}

export function verifySign(params, key, signType) {
  const given = String(params.sign || '').toUpperCase();
  if (!given) return false;
  const expect = buildSign(params, key, signType);
  if (!expect) return false;
  if (given.length !== expect.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expect));
  } catch {
    return false;
  }
}

export function payConfig() {
  const s = store.getSettings();
  return {
    enabled: s.pay_enabled === '1',
    apiUrl: String(s.pay_api_url || '').replace(/\/+$/, ''),
    pid: s.pay_pid || '',
    key: s.pay_key || '',
    notifyUrl: s.pay_notify_url || '',
    returnUrl: s.pay_return_url || '',
    entryDonate: s.pay_entry_donate === '1',
    entryPage: s.pay_entry_page === '1',
    entryPost: s.pay_entry_post === '1',
    donateTitle: s.donate_title || '赞赏一下',
    donateDesc: s.donate_desc || '',
    donatePresets: String(s.donate_presets || '5,10,20,50')
      .split(',').map((x) => x.trim()).filter((x) => /^\d+(\.\d{1,2})?$/.test(x)),
    kamiTitle: s.kami_title || '购买卡密',
    kamiDesc: s.kami_desc || '',
  };
}

export function publicPayConfig() {
  const c = payConfig();
  return {
    enabled: c.enabled,
    entryDonate: c.entryDonate,
    entryPage: c.entryPage,
    entryPost: c.entryPost,
    donateTitle: c.donateTitle,
    donateDesc: c.donateDesc,
    donatePresets: c.donatePresets,
    kamiTitle: c.kamiTitle,
    kamiDesc: c.kamiDesc,
  };
}

function fmtAmount(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

async function callApi(action, params) {
  const c = payConfig();
  if (!c.apiUrl || !c.pid || !c.key) {
    throw new Error('支付参数未配置完整');
  }

  const full = Object.assign({}, params, {
    pid: c.pid,
    timestamp: String(Math.floor(Date.now() / 1000)),
    sign_type: 'MD5',
  });
  full.sign = buildSign(full, c.key, 'MD5');

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(full)) {
    if (v === null || v === undefined || v === '') continue;
    body.append(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let resp;
  try {
    resp = await fetch(c.apiUrl + action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('支付平台返回格式异常: ' + text.slice(0, 120)); }

  if (Number(data.code) !== 1) {
    throw new Error(data.msg || '支付平台返回失败');
  }
  return data.data || {};
}

export function nextOutTradeNo(prefix) {
  const p = prefix || 'PW';
  const ts = Date.now();
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return p + ts + rnd;
}

export function createOrder(data) {
  const s = store.load();
  s.seq.payOrders = (s.seq.payOrders || 0) + 1;
  const row = Object.assign({
    id: s.seq.payOrders,
    kind: 'donate',
    status: 'WAIT_BUYER_PAY',
    kami: '',
    created_at: Date.now(),
    paid_at: 0,
  }, data);
  s.payOrders.push(row);
  store.save();
  return row;
}

export function findOrderByOutTradeNo(no) {
  return (store.load().payOrders || []).find((o) => o.out_trade_no === no) || null;
}

export function findOrderByTradeNo(no) {
  return (store.load().payOrders || []).find((o) => o.trade_no === no) || null;
}

export function allOrders() {
  return (store.load().payOrders || []).slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export function updateOrder(id, patch) {
  const s = store.load();
  const o = (s.payOrders || []).find((x) => x.id === Number(id));
  if (!o) return null;
  Object.assign(o, patch);
  store.save();
  return o;
}

export function addKamiStock(count, price, batch, note, goodsId, codes) {
  const s = store.load();
  if (!Array.isArray(s.kamiStock)) s.kamiStock = [];

  const gid = Number(goodsId) || 0;
  let list = [];

  if (Array.isArray(codes) && codes.length) {
    list = codes.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 50000);
  } else {
    const n = Math.max(1, Math.min(50000, parseInt(count, 10) || 1));
    for (let i = 0; i < n; i++) list.push(genKami(16));
  }

  const amount = fmtAmount(price) || '0.00';
  const made = [];

  for (const code of list) {
    s.seq.kamiStock = (s.seq.kamiStock || 0) + 1;
    const row = {
      id: s.seq.kamiStock,
      code: code.slice(0, 200),
      price: amount,
      batch: String(batch || '').slice(0, 60),
      note: String(note || '').slice(0, 200),
      goods_id: gid,
      status: 'available',
      issued_to: '',
      created_at: Date.now(),
      used_at: 0,
    };
    s.kamiStock.push(row);
    made.push(row);
  }

  store.save();
  return made;
}

export function removeKami(id) {
  const s = store.load();
  const before = (s.kamiStock || []).length;
  s.kamiStock = (s.kamiStock || []).filter((k) => k.id !== Number(id));
  if (s.kamiStock.length === before) return false;
  store.save();
  return true;
}

export function listKami(goodsId) {
  const list = (store.load().kamiStock || []).slice();
  const filtered = goodsId
    ? list.filter((k) => Number(k.goods_id) === Number(goodsId))
    : list;
  return filtered.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export function kamiStats(goodsId) {
  const list = listKami(goodsId);
  const available = list.filter((k) => k.status === 'available');
  const used = list.filter((k) => k.status === 'used');
  return {
    total: list.length,
    available: available.length,
    used: used.length,
    price: available.length ? available[0].price : '',
  };
}

export function allocateKami(orderId, goodsId) {
  const s = store.load();
  if (!Array.isArray(s.kamiStock)) s.kamiStock = [];
  const gid = Number(goodsId) || 0;
  const free = s.kamiStock.find((k) =>
    k.status === 'available' && (gid ? Number(k.goods_id) === gid : true)
  );
  if (!free) return null;
  free.status = 'used';
  free.issued_to = String(orderId);
  free.used_at = Date.now();
  store.save();
  return free;
}

export function findKamiByCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return (store.load().kamiStock || []).find((k) => k.code === c) || null;
}

export function allCategories() {
  return (store.load().goodsCategories || []).slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.id - b.id));
}

export function findCategory(id) {
  return (store.load().goodsCategories || []).find((c) => c.id === Number(id)) || null;
}

export function createCategory(data) {
  const s = store.load();
  if (!Array.isArray(s.goodsCategories)) s.goodsCategories = [];
  s.seq.goodsCategories = (s.seq.goodsCategories || 0) + 1;
  const row = {
    id: s.seq.goodsCategories,
    name: String(data.name || '').slice(0, 60),
    enabled: data.enabled === '0' ? '0' : '1',
    sort: Number(data.sort) || 0,
    created_at: Date.now(),
  };
  s.goodsCategories.push(row);
  store.save();
  return row;
}

export function updateCategory(id, patch) {
  const s = store.load();
  const c = (s.goodsCategories || []).find((x) => x.id === Number(id));
  if (!c) return null;
  if ('name' in patch) c.name = String(patch.name || '').slice(0, 60);
  if ('enabled' in patch) c.enabled = patch.enabled === '0' ? '0' : '1';
  if ('sort' in patch) c.sort = Number(patch.sort) || 0;
  store.save();
  return c;
}

export function deleteCategory(id) {
  const s = store.load();
  const before = (s.goodsCategories || []).length;
  s.goodsCategories = (s.goodsCategories || []).filter((c) => c.id !== Number(id));
  if (s.goodsCategories.length === before) return false;
  for (const g of (s.goods || [])) {
    if (Number(g.category_id) === Number(id)) g.category_id = 0;
  }
  store.save();
  return true;
}

export function allGoods() {
  return (store.load().goods || []).slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export function findGoods(id) {
  return (store.load().goods || []).find((g) => g.id === Number(id)) || null;
}

export function createGoods(data) {
  const s = store.load();
  if (!Array.isArray(s.goods)) s.goods = [];
  s.seq.goods = (s.seq.goods || 0) + 1;
  const row = {
    id: s.seq.goods,
    title: String(data.title || '').slice(0, 120),
    category_id: Number(data.category_id) || 0,
    price: fmtAmount(data.price) || '0.00',
    cover_key: String(data.cover_key || ''),
    desc: String(data.desc || '').slice(0, 2000),
    kind: 'kami',
    enabled: data.enabled === '0' ? '0' : '1',
    sales: 0,
    sort: Number(data.sort) || 0,
    created_at: Date.now(),
  };
  s.goods.push(row);
  store.save();
  return row;
}

export function updateGoods(id, patch) {
  const s = store.load();
  const g = (s.goods || []).find((x) => x.id === Number(id));
  if (!g) return null;
  if ('title' in patch) g.title = String(patch.title || '').slice(0, 120);
  if ('category_id' in patch) g.category_id = Number(patch.category_id) || 0;
  if ('price' in patch) g.price = fmtAmount(patch.price) || g.price;
  if ('cover_key' in patch) g.cover_key = String(patch.cover_key || '');
  if ('desc' in patch) g.desc = String(patch.desc || '').slice(0, 2000);
  if ('enabled' in patch) g.enabled = patch.enabled === '0' ? '0' : '1';
  if ('sort' in patch) g.sort = Number(patch.sort) || 0;
  store.save();
  return g;
}

export function deleteGoods(id) {
  const s = store.load();
  const before = (s.goods || []).length;
  s.goods = (s.goods || []).filter((g) => g.id !== Number(id));
  if (s.goods.length === before) return false;
  s.kamiStock = (s.kamiStock || []).filter((k) => Number(k.goods_id) !== Number(id));
  store.save();
  return true;
}

export function bumpSales(goodsId) {
  const s = store.load();
  const g = (s.goods || []).find((x) => x.id === Number(goodsId));
  if (!g) return;
  g.sales = (Number(g.sales) || 0) + 1;
  store.save();
}

export function goodsWithStock() {
  const cats = allCategories();
  const catMap = {};
  for (const c of cats) catMap[c.id] = c.name;

  return allGoods().map((g) => {
    const st = kamiStats(g.id);
    return Object.assign({}, g, {
      category_name: catMap[g.category_id] || '未分类',
      stock: st.available,
      sold: st.used,
      kami_total: st.total,
    });
  });
}

export function publicGoodsList() {
  const cats = allCategories().filter((c) => c.enabled !== '0');
  const catMap = {};
  for (const c of cats) catMap[c.id] = c.name;

  return allGoods()
    .filter((g) => g.enabled !== '0')
    .map((g) => {
      const st = kamiStats(g.id);
      return {
        id: g.id,
        title: g.title,
        price: g.price,
        desc: g.desc,
        cover_url: g.cover_key ? '/uploads/' + g.cover_key : '',
        category_name: catMap[g.category_id] || '未分类',
        stock: st.available,
        sales: Number(g.sales) || 0,
      };
    })
    .filter((g) => g.stock > 0);
}

export async function createPayment(opts) {
  const c = payConfig();
  const amount = fmtAmount(opts.amount);
  if (!amount) throw new Error('金额不正确');
  if (Number(amount) <= 0) throw new Error('金额必须大于 0');

  const outTradeNo = opts.outTradeNo || nextOutTradeNo('PW');

  const data = await callApi('/openapi/pay/create', {
    out_trade_no: outTradeNo,
    total_amount: amount,
    subject: String(opts.subject || '订单').slice(0, 100),
    paytype_code: String(opts.paytype || 'alipay'),
    notify_url: c.notifyUrl,
    return_url: opts.returnUrl || c.returnUrl,
    attach: String(opts.attach || '').slice(0, 200),
    client_ip: opts.clientIp || '127.0.0.1',
  });

  return {
    outTradeNo,
    tradeNo: data.trade_no || '',
    payUrl: data.pay_url || '',
    amount,
  };
}

export async function queryPayment(outTradeNo) {
  const data = await callApi('/openapi/pay/query', { out_trade_no: outTradeNo });
  return {
    tradeNo: data.trade_no || '',
    outTradeNo: data.out_trade_no || outTradeNo,
    totalAmount: data.total_amount || '',
    status: data.trade_status || '',
  };
}

export function markPaid(order, notifyParams) {
  if (order.status === 'TRADE_SUCCESS') {
    return { already: true, order };
  }

  const patch = {
    status: 'TRADE_SUCCESS',
    paid_at: Date.now(),
    trade_no: notifyParams.trade_no || order.trade_no || '',
  };

  let kami = order.kami || '';
  if (order.kind === 'kami' && !kami) {
    const got = allocateKami(order.id, order.goods_id);
    if (got) kami = got.code;
  }
  if (kami) patch.kami = kami;

  const updated = updateOrder(order.id, patch);

  if (order.kind === 'kami' && order.goods_id) {
    bumpSales(order.goods_id);
  }

  return { already: false, order: updated, kami };
}

export function tradeOverview(days) {
  const n = Math.max(1, Math.min(90, parseInt(days, 10) || 14));
  const orders = allOrders();
  const paid = orders.filter((o) => o.status === 'TRADE_SUCCESS');

  const today = new Date();
  const dayKey = (d) => {
    const dt = d ? new Date(d) : new Date();
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
  };

  const buckets = {};
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    buckets[dayKey(d)] = { date: dayKey(d), orders: 0, amount: 0 };
  }

  let totalAmount = 0;
  for (const o of paid) {
    const amt = Number(o.amount) || 0;
    totalAmount += amt;
    const k = dayKey(o.paid_at || o.created_at);
    if (buckets[k]) {
      buckets[k].orders += 1;
      buckets[k].amount = Number((buckets[k].amount + amt).toFixed(2));
    }
  }

  const tKey = dayKey();
  const yD = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yKey = dayKey(yD);

  const todayOrders = orders.filter((o) => dayKey(o.created_at) === tKey);
  const yOrders = orders.filter((o) => dayKey(o.created_at) === yKey);

  const todayPaid = paid.filter((o) => dayKey(o.paid_at || o.created_at) === tKey);
  const yPaid = paid.filter((o) => dayKey(o.paid_at || o.created_at) === yKey);

  const sum = (arr) => arr.reduce((a, o) => a + (Number(o.amount) || 0), 0);

  const kami = kamiStats();
  const waitPay = orders.filter((o) => o.status === 'WAIT_BUYER_PAY').length;

  return {
    series: Object.values(buckets),
    today: {
      amount: Number(sum(todayPaid).toFixed(2)),
      orders: todayOrders.length,
      paid: todayPaid.length,
    },
    yesterday: {
      amount: Number(sum(yPaid).toFixed(2)),
      orders: yOrders.length,
      paid: yPaid.length,
    },
    total: {
      amount: Number(totalAmount.toFixed(2)),
      orders: orders.length,
      paid: paid.length,
    },
    pending: {
      wait_pay: waitPay,
      kami_available: kami.available,
      kami_used: kami.used,
      kami_total: kami.total,
    },
  };
}

export function resetAllTrade() {
  const s = store.load();
  s.payOrders = [];
  s.kamiStock = [];
  s.kamiIssued = [];
  s.seq.payOrders = 0;
  s.seq.kamiStock = 0;
  store.save();
  return true;
}
