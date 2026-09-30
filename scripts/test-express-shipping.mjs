import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      console,
      process: { env: {} },
      Buffer,
      URLSearchParams,
      AbortSignal,
      ...globals,
    },
    { filename: path },
  );
  return module.exports;
}
const core = load("src/lib/express.ts");
test('Chinese labels distinguish peak charges and UPS rules stay carrier-specific', () => {
  const {DeliveryRateDetails,deliveryChargeLabel} = load('src/components/partner/DeliveryRateDetails.tsx');
  assert.equal(deliveryChargeLabel('LARGE PACKAGE'),'大型包裹附加费');
  assert.equal(deliveryChargeLabel('PEAK SEASON SURCHARGE – LARGE PACKAGE'),'旺季大型包裹附加费');
  assert.equal(deliveryChargeLabel('PEAK SEASON SURCHARGE – ADDITIONAL HANDLING'),'旺季额外操作附加费');
  assert.equal(deliveryChargeLabel('GST'),'商品及服务税（GST）');
  const {renderToStaticMarkup} = require('react-dom/server');
  const {createElement} = require('react');
  const rate = {carrier:'UPS Canada & Export',currency:'CAD',price:681.19,chargeDetails:[{name:'LARGE PACKAGE',price:94.16},{name:'ADDITIONAL HANDLING',price:26.92}]};
  const html = renderToStaticMarkup(createElement(DeliveryRateDetails,{rate}));
  for(const text of ['122 cm','330 cm','标准示例']) assert.ok(html.includes(text));
  assert.ok(!html.includes('<details'));
  assert.ok(!renderToStaticMarkup(createElement(DeliveryRateDetails,{rate:{...rate,carrier:'FedEx'}})).includes('122 cm'));
});
test('delivery detail UI shows surcharges and missing values, including legacy quotes', () => {
  const {DeliveryRateDetails} = load('src/components/partner/DeliveryRateDetails.tsx');
  const {renderToStaticMarkup} = require('react-dom/server');
  const {createElement} = require('react');
  const rate = {carrier:'Test',service:'Ground',currency:'CAD',price:100,tax:5,
    freight:70,chargeDetails:[{name:'Overlength',code:'L',price:10},{name:'Remote area',price:15},{name:'Unknown',price:null}],message:'Carrier notice'};
  const html = renderToStaticMarkup(createElement(DeliveryRateDetails,{rate}));
  for(const text of ['超长附加费','偏远／延伸地区附加费','Overlength','CAD 10.00','CAD 100.00','未提供','Carrier notice']) assert.ok(html.includes(text),text);
  const legacy = renderToStaticMarkup(createElement(DeliveryRateDetails,{rate:{...rate,chargeDetails:undefined,freight:undefined}}));
  assert.ok(legacy.includes('接口未提供附加费明细'));
});
test('delivery breakdown preserves provider details without double charging', () => {
  const [rate] = core.normalizeRates([{carrier_id:1,currency:{code:'CAD'},services:[{
    id:1,charge:'40.43',freight:'33.77',tax:'4.65',
    charge_details:[{code:'FUELSC',name:'Fuel surcharge',price:'2.01'},
      {code:'LONG',name:'Overlength',price:0},{name:'Remote area',price:null},
      {name:'Credit',price:'-1.00'},{name:'Invalid',price:'NaN'}],
    tax_details:[{name:'HST',price:'4.65'}],message:'Carrier note',token:'must-not-leak'
  }]}]);
  assert.equal(rate.price,40.43);
  assert.equal(rate.freight,33.77);
  assert.equal(rate.chargeDetails[0].price,2.01);
  assert.equal(rate.chargeDetails[1].price,0);
  assert.equal(rate.chargeDetails[2].price,null);
  assert.equal(rate.chargeDetails[3].price,-1);
  assert.equal(rate.chargeDetails[4].price,null);
  assert.equal(rate.taxDetails[0].price,4.65);
  assert.equal(rate.message,'Carrier note');
  assert.equal(rate.token,undefined);
  const [missing] = core.normalizeRates([{carrier_id:1,currency:{code:'CAD'},services:[{id:1,charge:10}]}]);
  assert.equal(missing.freight,null);
  assert.equal(missing.chargeDetails.length,0);
});
const addr = {
  ...core.emptyAddress,
  name: "Test",
  mobile_phone: "4165550123",
  province: "ON",
  city: "Toronto",
  postalcode: "M5V1A1",
  address: "1 Test Street",
};
const source = { kind: "waybill", id: "11111111-1111-4111-8111-111111111111" };
const draft = core.draftSchema.parse({
  source,
  leg: "last_mile",
  from: addr,
  to: addr,
  packageType: "parcel",
  packages: [{ weightKg: 1, lengthCm: 25.4, widthCm: 12.7, heightCm: 2.54 }],
});
const rates = core.normalizeRates([
  {
    carrier_id: 1,
    name: "UPS",
    currency: { code: "CAD" },
    services: [
      { id: 11, name: "Ground", charge: "20.00", tax: "2.60", eta: "2026-10-04" },
      { id: 12, name: "Express", charge: 30, eta: "2026-10-01" },
    ],
  },
  {
    carrier_id: 2,
    name: "Other",
    currency: { code: "USD" },
    services: [{ id: 21, name: "Foreign", charge: 1, eta: "2026-09-30" }],
  },
  {
    carrier_id: 3,
    name: "Unknown",
    currency: { code: "CAD" },
    services: [{ id: 31, name: "No ETA", charge: 5, eta: "not guaranteed" }],
  },
]);
test("cheapest filters currency; tax is not silently double-added", () => {
  assert.equal(rates[0].price, 20);
  assert.equal(rates[0].tax, 2.6);
  assert.equal(core.chooseRate(rates, core.defaultRule).rate.serviceId, "31");
});
test("earliest uses explicit date, never guesses from service name", () => {
  assert.equal(
    core.chooseRate(rates, { ...core.defaultRule, strategy: "earliest" }).rate.serviceId,
    "12",
  );
  assert.equal(
    core.chooseRate(rates, { ...core.defaultRule, latestDelivery: "2026-10-02", maxPrice: 25 })
      .rate,
    null,
  );
});
test("carrier/service/max-price constraints all apply without fallback", () => {
  assert.equal(
    core.chooseRate(rates, {
      ...core.defaultRule,
      carrierIds: ["1"],
      serviceIds: ["11"],
      maxPrice: 20,
    }).rate.serviceId,
    "11",
  );
  assert.equal(
    core.chooseRate(rates, { ...core.defaultRule, carrierIds: ["1"], maxPrice: 19 }).rate,
    null,
  );
});
test("malformed monetary values do not become free services", () => {
  const response = [
    {
      carrier_id: 1,
      currency: { code: "CAD" },
      services: [null, "", -1, "bad", false].map((charge, id) => ({ id: id + 1, charge })),
    },
  ];
  assert.equal(core.normalizeRates(response).length, 0);
  assert.throws(() => core.normalizeRates({ services: [] }), /格式/);
});
test("kg/cm conversion uses real account units and never understates weight", () => {
  const metric = core.convertedPackages(draft, { weight: "kg", length: "cm" })[0];
  const imperial = core.convertedPackages(draft, { weight: "lb", length: "in" })[0];
  assert.equal(metric.weight, 1);
  assert.equal(imperial.dimension.length, 10);
  assert.equal(imperial.dimension.width, 5);
  assert.equal(imperial.dimension.height, 1);
  assert.ok(imperial.weight >= 1 / 0.45359237);
});
test("reject missing measurements, malformed source ids and infinite amounts", () => {
  assert.throws(() =>
    core.draftSchema.parse({ ...draft, packages: [{ ...draft.packages[0], weightKg: 0 }] }),
  );
  assert.throws(() => core.sourceSchema.parse({ ...source, id: "other" }));
  assert.throws(() => core.ruleSchema.parse({ ...core.defaultRule, maxPrice: Infinity }));
});
test("source address mapping preserves postal/contact fields", () => {
  const a = core.mapAddress({
    recipient: "Name",
    phone: "123",
    country: "Canada",
    line1: "street",
    postal_code: "X",
    province: "ON",
  });
  assert.equal(a.region_id, "CA");
  assert.equal(a.name, "Name");
  assert.equal(a.postalcode, "X");
});
const apiPath = "src/lib/verykship.server.ts";
const env = {
  VERYKSHIP_ENV: "sandbox",
  VERYKSHIP_SANDBOX_APP_ID: "test-id",
  VERYKSHIP_SANDBOX_APP_SECRET: "test-secret",
};
test("signature matches canonical PHP rawurlencode + HMAC SHA256", () => {
  const api = load(apiPath, { "./express": core });
  const query = {
    Action: "shipment/quote",
    id: "a b~!",
    timestamp: "123",
    format: "json",
    sign: "ignored",
  };
  const canonical = "action=shipment%2Fquote&format=json&id=a%20b~%21&timestamp=123";
  assert.equal(
    api.signParameters(query, "secret"),
    crypto.createHmac("sha256", "secret").update(canonical).digest("base64"),
  );
});
test("provider uses POST, timestamp signature, sandbox credentials, no redirects", async () => {
  let request;
  const api = load(
    apiPath,
    { "./express": core },
    {
      process: { env },
      fetch: async (url, init) => {
        request = { url, init };
        return { ok: true, json: async () => ({ status: 1, response: { ok: true } }) };
      },
    },
  );
  await api.verykRequest("shipment/quote", { test: 1 });
  assert.ok(request.url.startsWith("https://3hlrnj-shipper.veryk.dev/api?"));
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "manual"); // Workers rejects "error"; 3xx fails via !res.ok
  assert.equal(request.init.body, '{"test":1}');
  assert.ok(!request.url.includes("test-secret"));
});
test("false status and network errors never expose credentials or signed URLs", async () => {
  const api = load(
    apiPath,
    { "./express": core },
    {
      process: { env },
      fetch: async () => ({
        ok: true,
        json: async () => ({
          status: "0",
          message: "test-secret https://test.invalid/?sign=hidden",
        }),
      }),
    },
  );
  await assert.rejects(
    api.verykRequest("account"),
    (e) => !e.message.includes("test-secret") && !e.message.includes("sign="),
  );
  const offline = load(
    apiPath,
    { "./express": core },
    {
      process: { env },
      fetch: async () => {
        throw new Error("https://private?sign=hidden");
      },
    },
  );
  await assert.rejects(offline.verykRequest("shipment/create"), /操作结果不确定/);
});
test("provider HTTP failures are distinguishable without disclosing response bodies", async () => {
  const api = load(apiPath, { "./express": core }, {
    process: { env },
    fetch: async () => ({ ok: false, status: 403, json: async () => { throw Error("test-secret"); } }),
  });
  await assert.rejects(api.verykRequest("account"), e => e.message.includes("HTTP 403") && !e.message.includes("test-secret"));
});
test("unrecognized provider units stop instead of falling back to pounds", async () => {
  const api = load(
    apiPath,
    { "./express": core },
    {
      process: { env },
      fetch: async () => ({
        ok: true,
        json: async () => ({ status: 1, response: { weightUnit: "stone", lengthunit: "in" } }),
      }),
    },
  );
  await assert.rejects(api.accountUnits(), /单位无法识别/);
});
test("official void response is the success string, not an order object", async () => {
  const api = load(
    apiPath,
    { "./express": core },
    {
      process: { env },
      fetch: async () => ({ ok: true, json: async () => ({ status: 1, response: "success" }) }),
    },
  );
  assert.equal(
    (await api.verykRequest("shipment/void", { id: "test", reason: "test only" })).success,
    true,
  );
});
test("UPS labels and signature flags map to carrier-specific fields", () => {
  const api = load(apiPath, { "./express": core });
  const p = api.providerPayload(
    { ...draft, signature: true },
    { weight: "lb", length: "in" },
    rates[0],
  );
  assert.equal(p.option.label_format, "6X4_thermal_PDF");
  assert.equal(p.package.packages[0].additional.DC.type, 2);
  assert.throws(
    () =>
      api.providerPayload({ ...draft, signature: true }, { weight: "kg", length: "cm" }, rates[3]),
    /暂不支持/,
  );
});
test("cross-border blocks until customs integration rather than sending incomplete declarations", () => {
  const api = load(apiPath, { "./express": core });
  assert.throws(
    () =>
      api.providerPayload(
        { ...draft, to: { ...addr, region_id: "US" } },
        { weight: "kg", length: "cm" },
      ),
    /跨境/,
  );
});

function serviceHarness({ staff = true, owner = "customer", fail = false, changed = false } = {}) {
  const qid = "22222222-2222-4222-8222-222222222222",
    sid = "33333333-3333-4333-8333-333333333333";
  const quote = {
    id: qid,
    user_id: "staff",
    account_key: "sandbox:test",
    draft,
    rates: [rates[0]],
    coverage: [core.sourceKey(source)],
    context_hash: "same",
    expires_at: new Date(Date.now() + 600000).toISOString(),
  };
  const shipment = {
    id: sid,
    provider_id: null,
    account_key: "sandbox:test",
    owner_id: owner,
    user_id: "staff",
    status: "submitting",
    rate: rates[0],
    reference: "EP-test",
  };
  let calls = 0,
    reserved = false;
  const db = {
    from: () => ({
      update(p) {
        Object.assign(shipment, p);
        return this;
      },
      eq() {
        return this;
      },
      then(resolve) {
        resolve({ error: null });
      },
    }),
    rpc: async () => {
      if (reserved) return { error: { message: "货物已创建" } };
      reserved = true;
      return { data: sid };
    },
  };
  const provider = {
    accountKey: () => "sandbox:test",
    providerConfig: () => ({ purchasing: true }),
    accountUnits: async () => ({ weight: "kg", length: "cm" }),
    providerPayload: () => ({ option: {} }),
    verykRequest: async (action) => {
      if (action === "shipment/quote")
        return [
          {
            carrier_id: 1,
            name: "UPS",
            currency: { code: "CAD" },
            services: [{ id: 11, name: "Ground", charge: changed ? 21 : 20, eta: "2026-10-04" }],
          },
        ];
      calls++;
      if (fail) throw new Error("timeout");
      return { id: "remote-1", waybill_number: "TRACK", state: { code: "submitted" } };
    },
  };
  const context = {
    expressDb: db,
    dbOne: async (table) => (table === "express_quotes" ? quote : shipment),
    expressContext: async () => ({
      allowedToShip: true,
      contextHash: "same",
      coverage: quote.coverage,
    }),
  };
  const svc = load("src/lib/express-service.server.ts", {
    "./express": core,
    "./verykship.server": provider,
    "./express-context.server": context,
  });
  return {
    svc,
    shipment,
    c: {
      userId: staff ? "staff" : "intruder",
      supabase: { rpc: async () => ({ data: staff, error: null }) },
    },
    args: { quoteId: qid, rateKey: "1:11", confirmed: true },
    calls: () => calls,
  };
}
test("customers cannot purchase even with another user's valid quote ID", async () => {
  const h = serviceHarness({ staff: false });
  await assert.rejects(h.svc.buyExpress(h.args, h.c), /仅员工/);
  assert.equal(h.calls(), 0);
});
test("price changes require a new quote and never call create", async () => {
  const h = serviceHarness({ changed: true });
  await assert.rejects(h.svc.buyExpress(h.args, h.c), /价格或时效已变化/);
  assert.equal(h.calls(), 0);
});
test("two concurrent purchases reserve once and create once", async () => {
  const h = serviceHarness();
  const outcomes = await Promise.allSettled([
    h.svc.buyExpress(h.args, h.c),
    h.svc.buyExpress(h.args, h.c),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(h.calls(), 1);
  assert.equal(h.shipment.status, "created");
  assert.equal(h.shipment.tracking_numbers[0], "TRACK");
});
test("ambiguous create is persisted as unknown and not retried", async () => {
  const h = serviceHarness({ fail: true });
  await h.svc.buyExpress(h.args, h.c);
  assert.equal(h.shipment.status, "unknown");
  await assert.rejects(h.svc.buyExpress(h.args, h.c), /已创建/);
  assert.equal(h.calls(), 1);
});
test("foreign customer cannot fetch or refresh a shipment", async () => {
  const h = serviceHarness({ staff: false });
  await assert.rejects(h.svc.labelExpress({ id: h.shipment.id }, h.c), /无权/);
  await assert.rejects(h.svc.refreshExpress({ id: h.shipment.id }, h.c), /无权/);
  assert.equal(h.calls(), 0);
});

function contextHarness(mixed = false) {
  const ids = { order: "o1", carton: "c1", pallet: "p1", waybill: "w1", batch: "b1" };
  const rows = {
    orders: [{ id: ids.order, user_id: "customer", address_snapshot: addr }],
    forwarding_orders: [],
    waybills: [{ id: ids.waybill, order_id: ids.order, carton_id: ids.carton, status: "packed", weight_kg: 1, length_cm: 10, width_cm: 10, height_cm: 10 }],
    cartons: [{ id: ids.carton, pallet_id: ids.pallet, customer_user_id: mixed ? "other" : "customer", address_snapshot: addr }],
    pallets: [{ id: ids.pallet, batch_id: ids.batch, customer_user_id: "customer", address_snapshot: addr }],
    batches: [{ id: ids.batch }],
  };
  const db = { from(table) {
    let selected = rows[table] ?? [];
    return { select() { return this; }, eq(k,v) { selected = selected.filter(row => row[k] === v); return this; },
      limit() { return this; }, async maybeSingle() { return {data:selected[0] ?? null}; },
      then(resolve) { resolve({data:selected,count:selected.length}); } };
  } };
  const ctx = load("src/lib/express-context.server.ts", {
    "@/integrations/supabase/client.server": {supabaseAdmin:db}, "./express":core,
    "./verykship.server": {fingerprint:v=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex")},
  });
  return { ctx, ids };
}
test("a waybill shares history with its order, carton, pallet and effective batch", async () => {
  const {ctx,ids}=contextHarness();
  const result=await ctx.expressContext({kind:"waybill",id:ids.waybill},"customer",false);
  for(const kind of ["order","carton","pallet","batch"]) assert.ok(result.links.includes(`${kind}:${ids[kind]}`));
  assert.equal(result.coverage.length,1); assert.equal(result.coverage[0],"waybill:w1");
});
test("whole pallet reservations cover cartons and individual waybills", async () => {
  const {ctx,ids}=contextHarness();
  const result=await ctx.expressContext({kind:"pallet",id:ids.pallet},"staff",true);
  for(const key of ["pallet:p1","carton:c1","waybill:w1"]) assert.ok(result.coverage.includes(key));
  assert.equal(result.ownerId,"customer");
});
test("orders with physical waybills must select a unit instead of buying duplicate aggregate labels", async () => {
  const {ctx,ids}=contextHarness();const r=await ctx.expressContext({kind:"order",id:ids.order},"customer",false);
  assert.equal(r.allowedToShip,false);assert.equal(r.units.length,1);assert.equal(r.units[0].source.kind,"waybill");
});
test("mixed ownership containers never expose other customers' contents", async () => {
  const {ctx,ids}=contextHarness(true);
  await assert.rejects(ctx.expressContext({kind:"pallet",id:ids.pallet},"customer",false), /归属/);
  await assert.rejects(ctx.expressContext({kind:"waybill",id:ids.waybill},"intruder",false), /无权/);
});
test('429 honors provider cooldown and does not send another read request',async()=>{let calls=0;const api=load(apiPath,{'./express':core},{process:{env},fetch:async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '90'}};}});await assert.rejects(api.verykRequest('shipment/quote',{}),/90 秒/);await assert.rejects(api.verykRequest('account'),/429/);assert.equal(calls,1);});
test('identical concurrent quote requests share one provider call',async()=>{let calls=0;const api=load(apiPath,{'./express':core},{process:{env},fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>({status:1,response:{rates:[]}})};}});await Promise.all([api.verykRequest('shipment/quote',{test:1}),api.verykRequest('shipment/quote',{test:1})]);assert.equal(calls,1);await api.verykRequest('shipment/quote',{test:2});assert.equal(calls,2);});
