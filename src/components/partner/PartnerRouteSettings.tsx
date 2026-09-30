import { useEffect, useState, type ReactNode } from "react";
import { PartnerDeliveryTest, type DeliveryApi } from "./PartnerDeliveryTest";
import {
  settingInput,
  emptyGeneral,
  emptyTransport,
  emptyRoute,
  type Settings,
  type Warehouse,
} from "@/lib/partner-settings";
import type { PartnerRouteDraft } from "@/lib/partner-quote";
import "./partner-route-settings.css";
type RecordRow = { id: string; config: PartnerRouteDraft };
type Storage = {
  list: () => Promise<RecordRow[]>;
  save: (data: unknown) => Promise<RecordRow>;
  settings: () => Promise<Settings>;
  saveSettings: (data: unknown) => Promise<unknown>;
};
const initial: Settings = { general: emptyGeneral, transport: emptyTransport, warehouses: [] };
const tabs = ["基础设置", "运输方式设置", "仓库地址设置", "线路设置", "使用权限"];
const currencies = [
  ["USD", "USD"],
  ["CAD", "CAD"],
];
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prs-card">
      <details>
        <summary>
          <h2>{title}</h2>
          <span className="prs-fold" />
        </summary>
        <div className="prs-card-body">{children}</div>
      </details>
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  options,
  unit,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: string[][];
  unit?: string;
  numeric?: boolean;
}) {
  return (
    <label>
      {label}
      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ) : (
        <div className="prs-input">
          <input
            type={numeric ? "number" : "text"}
            min="0"
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {unit && <span>{unit}</span>}
        </div>
      )}
    </label>
  );
}
export function PartnerRouteSettings({
  embedded = false,
  storage,
  deliveryApi,
}: {
  embedded?: boolean;
  storage?: Storage;
  deliveryApi?: DeliveryApi;
}) {
  const [settings, setSettings] = useState<Settings>(initial),
    [records, setRecords] = useState<RecordRow[]>([]),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (storage) {
          const [s, r] = await Promise.all([storage.settings(), storage.list()]);
          if (active) {
            setSettings(s);
            setRecords(r);
          }
        } else {
          const v = JSON.parse(localStorage.getItem("partner-settings-v2-preview") || "null");
          if (v && active) {
            setSettings(v.settings);
            setRecords(v.records);
          }
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [storage]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      setNotice(storage ? "已保存到后台" : "已保存本地草稿");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const saveSection = (section: keyof Settings) =>
    run(async () => {
      const data = settingInput.parse({ section, value: settings[section] });
      if (storage) await storage.saveSettings(data);
      else {
        const old = JSON.parse(localStorage.getItem("partner-settings-v2-preview") || "null") || {
          settings: initial,
          records: [],
        };
        old.settings[section] = settings[section];
        localStorage.setItem("partner-settings-v2-preview", JSON.stringify(old));
      }
    });
  const saveRoute = (row: RecordRow) =>
    run(async () => {
      if (!row.config.name.trim() || !row.config.code.trim() || !row.config.originId)
        throw Error("请填写线路名称、编号并选择起始仓库");
      const config = {
        ...row.config,
        rounding: row.config.rounding || "0.5",
        shared: true,
        audience: "全部同行客户" as const,
        customers: "",
        allowQuote: true,
        allowOrder: false as const,
      };
      if (storage) {
        const saved = await storage.save({
          id: row.id.startsWith("new:") ? undefined : row.id,
          config,
        });
        setRecords((rs) => rs.map((r) => (r.id === row.id ? saved : r)));
      } else {
        const old = JSON.parse(localStorage.getItem("partner-settings-v2-preview") || "null") || {
          settings: initial,
          records: [],
        };
        const saved = { id: row.id, config };
        const i = old.records.findIndex((r: RecordRow) => r.id === row.id);
        if (i < 0) old.records.push(saved);
        else old.records[i] = saved;
        localStorage.setItem("partner-settings-v2-preview", JSON.stringify(old));
      }
    });
  const fields = (section: "general" | "transport", specs: string[][]) => (
    <div className="prs-grid">
      {specs.map(([k, label, unit]) => (
        <Field
          key={k}
          label={label}
          unit={unit}
          value={String((settings[section] as any)[k])}
          options={k.endsWith("Currency") ? currencies : undefined}
          numeric={!k.endsWith("Currency")}
          onChange={(v) => setSettings((s) => ({ ...s, [section]: { ...s[section], [k]: v } }))}
        />
      ))}
    </div>
  );
  const updateWarehouse = (id: string, patch: Partial<Warehouse>) =>
    setSettings((s) => ({
      ...s,
      warehouses: s.warehouses.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  const button = (section: keyof Settings) => (
    <div className="prs-actions">
      <button type="button" disabled={busy} onClick={() => saveSection(section)}>
        保存{tabs[section === "general" ? 0 : section === "transport" ? 1 : 2]}
      </button>
    </div>
  );
  return (
    <div className={`prs ${embedded ? "prs-embedded" : ""}`}>
      <header>
        <a href="/partner-shipping">
          eplus<span>+</span>
          <small>同行业务后台</small>
        </a>
      </header>
      <div className="prs-shell">
        <nav>
          <div className="prs-nav-title">同行线路管理</div>
          {tabs.map((t, i) => (
            <button
              key={t}
              className={tab === i ? "active" : ""}
              onClick={() => {
                setTab(i);
                setNotice("");
              }}
            >
              {String(i + 1).padStart(2, "0")}　{t}
            </button>
          ))}
        </nav>
        <main>
          <div className="prs-heading">
            <div>
              <div className="prs-eyebrow">PARTNER / SETTINGS</div>
              <h1>{tabs[tab]}</h1>
              <p>公共价格统一管理，每一步独立保存。</p>
            </div>
          </div>
          {loading ? (
            <p>正在读取设置…</p>
          ) : error ? (
            <p role="alert">{error}。未加载完成前不能保存。</p>
          ) : (
            <fieldset disabled={busy} className="prs-settings-fields">
              <div hidden={tab !== 0}>
                <Card title="国内操作费用">
                  {fields("general", [
                    ["domesticRate", "每立方单价", "/m³"],
                    ["domesticCurrency", "币种"],
                    ["domesticDensity", "每立方折算 kg 数", "kg/m³"],
                  ])}
                  <p className="prs-formula">max（实际总体积，总实重 ÷ 每立方 kg 数）× 单价</p>
                </Card>
                <Card title="目的港费用">
                  {fields("general", [
                    ["portRate", "每立方单价", "/m³"],
                    ["portCurrency", "币种"],
                  ])}
                  <p>实际总体积 × 单价</p>
                </Card>
                <Card title="汇率">
                  {fields("general", [["fx", "1 USD 折合 CAD", "CAD"]])}
                  <p>报价统一换算为 CAD。</p>
                </Card>
                {button("general")}
              </div>
              <div hidden={tab !== 1}>
                <Card title="海运基础设置">
                  {fields("transport", [
                    ["seaRate", "每立方单价", "/m³"],
                    ["seaCurrency", "币种"],
                    ["seaMinKg", "单包最低计费重量", "kg/包"],
                    ["seaDivisor", "体积重除数", "cm³/kg"],
                    ["seaMaxKgPerM3", "每立方最大 kg 数", "kg/m³"],
                  ])}
                  <p className="prs-formula">
                    单包体积重 = 长 × 宽 × 高 ÷ 体积重除数。
                    <br />
                    收费立方 = max（实际总体积，总实重 ÷ 每立方最大 kg 数），按 0.1 m³ 向上进位。
                    <br />
                    例：1 m³、400 kg、300 kg/m³ → 按 1.4 m³ 收费。
                  </p>
                </Card>
                <Card title="空运基础设置">
                  {fields("transport", [
                    ["airRate", "每 kg 单价", "/kg"],
                    ["airCurrency", "币种"],
                    ["airMinKg", "单包最低计费重量", "kg/包"],
                    ["airDivisor", "体积重除数", "cm³/kg"],
                  ])}
                  <p className="prs-formula">
                    逐包取实重与体积重的较大值，按线路进位后与最低计费重量取大值，再合计 × 单价。
                  </p>
                </Card>
                {button("transport")}
              </div>
              <div hidden={tab !== 2}>
                <div className="prs-actions">
                  <span>仓库地址用于实际快递发货；每个仓库均可设置对外转运价格。</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        warehouses: [
                          ...s.warehouses,
                          {
                            id: crypto.randomUUID(),
                            label: "新仓库",
                            name: "",
                            company: "",
                            phone: "",
                            street: "",
                            unit: "",
                            city: "",
                            province: "",
                            postal: "",
                            density: "",
                            currency: "CAD",
                            transfers: [],
                          },
                        ],
                      }))
                    }
                  >
                    ＋ 新增仓库
                  </button>
                </div>
                {settings.warehouses.map((w) => (
                  <Card key={w.id} title={w.label}>
                    <div className="prs-grid">
                      {[
                        ["label", "仓库名称"],
                        ["name", "发货人姓名"],
                        ["company", "公司"],
                        ["phone", "电话"],
                        ["street", "详细地址"],
                        ["unit", "地址补充"],
                        ["city", "城市"],
                        ["province", "省份代码"],
                        ["postal", "邮编"],
                      ].map(([k, l]) => (
                        <Field
                          key={k}
                          label={l}
                          value={String(w[k as keyof Warehouse])}
                          onChange={(v) => updateWarehouse(w.id, { [k]: v })}
                        />
                      ))}
                    </div>
                    <h3>仓库转运总参数</h3>
                    <div className="prs-grid">
                      <Field
                        label="每立方折算 kg 数"
                        numeric
                        value={w.density}
                        onChange={(density) => updateWarehouse(w.id, { density })}
                      />
                      <Field
                        label="币种"
                        value={w.currency}
                        options={currencies}
                        onChange={(currency) =>
                          updateWarehouse(w.id, { currency: currency as "CAD" | "USD" })
                        }
                      />
                    </div>
                    <h3>各目的仓转运价格</h3>
                    {w.transfers.map((t, i) => (
                      <div className="prs-note" key={i}>
                        <div className="prs-grid">
                          <Field
                            label="目的仓库"
                            value={t.target}
                            options={[
                              ["", "请选择目的仓"],
                              ...settings.warehouses
                                .filter((x) => x.id !== w.id)
                                .map((x) => [x.id, x.label]),
                            ]}
                            onChange={(target) =>
                              updateWarehouse(w.id, {
                                transfers: w.transfers.map((x, j) =>
                                  j === i ? { ...x, target } : x,
                                ),
                              })
                            }
                          />
                          <Field
                            label="每立方单价"
                            numeric
                            value={t.rate}
                            onChange={(rate) =>
                              updateWarehouse(w.id, {
                                transfers: w.transfers.map((x, j) =>
                                  j === i ? { ...x, rate } : x,
                                ),
                              })
                            }
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateWarehouse(w.id, {
                              transfers: w.transfers.filter((_, j) => j !== i),
                            })
                          }
                        >
                          删除此转运价格
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateWarehouse(w.id, {
                          transfers: [...w.transfers, { target: "", rate: "" }],
                        })
                      }
                    >
                      ＋ 添加目的仓库及价格
                    </button>
                    <p className="prs-formula">
                      max（实际 m³，实重 kg ÷ 本仓每立方 kg 数）× 目的仓单价。正反向分别设置。
                    </p>
                    <PartnerDeliveryTest
                      api={deliveryApi}
                      origin={{
                        name: w.name,
                        company: w.company,
                        mobile_phone: w.phone,
                        region_id: "CA",
                        province: w.province,
                        city: w.city,
                        postalcode: w.postal,
                        address: w.street,
                        address2: w.unit,
                        email: "",
                        type: "commercial",
                      }}
                    />
                  </Card>
                ))}
                {button("warehouses")}
              </div>
              <div hidden={tab !== 3}>
                <div className="prs-actions">
                  <span>线路 {records.length} 条 · 各自保存</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRecords((rs) => [
                        ...rs,
                        { id: "new:" + crypto.randomUUID(), config: { ...emptyRoute } },
                      ])
                    }
                  >
                    ＋ 新增线路
                  </button>
                </div>
                {records.map((row) => {
                  const d = row.config;
                  const update = (key: string, value: unknown) =>
                    setRecords((rs) =>
                      rs.map((r) =>
                        r.id === row.id ? { ...r, config: { ...r.config, [key]: value } } : r,
                      ),
                    );
                  return (
                    <Card key={row.id} title={d.name || "新增线路"}>
                      {!d.shared && (
                        <p className="prs-note">
                          旧版线路：原配置已保留。选择仓库后保存，将切换为公共价格。
                        </p>
                      )}
                      <div className="prs-grid">
                        <Field
                          label="线路名称"
                          value={d.name}
                          onChange={(v) => update("name", v)}
                        />
                        <Field
                          label="线路编号"
                          value={d.code}
                          onChange={(v) => update("code", v)}
                        />
                        <Field
                          label="运输方式"
                          value={d.method}
                          options={[
                            ["sea", "海运"],
                            ["air", "空运"],
                          ]}
                          onChange={(v) => update("method", v)}
                        />
                        <Field
                          label="货物类型"
                          value={d.cargo}
                          options={[
                            ["general", "普货"],
                            ["sensitive", "敏感货"],
                          ]}
                          onChange={(v) => update("cargo", v)}
                        />
                        <Field
                          label="线路状态"
                          value={String(d.enabled)}
                          options={[
                            ["false", "停用"],
                            ["true", "启用"],
                          ]}
                          onChange={(v) => update("enabled", v === "true")}
                        />
                        <Field
                          label="包裹重量进位方式"
                          value={d.rounding || "0.5"}
                          options={[
                            ["0.5", "每 0.5 kg 向上进位"],
                            ["1", "每 1 kg 向上进位"],
                            ["none", "不进位"],
                          ]}
                          onChange={(v) => update("rounding", v)}
                        />
                        <Field
                          label="起始仓库（到货仓库）"
                          value={d.originId || ""}
                          options={[
                            ["", "请选择已保存仓库"],
                            ...settings.warehouses.map((w) => [w.id, w.label]),
                          ]}
                          onChange={(v) => update("originId", v)}
                        />
                      </div>
                      <p className="prs-note">
                        统一使用公共价格。请先保存仓库及公共参数，再启用线路。
                      </p>
                      <div className="prs-actions">
                        <button type="button" onClick={() => saveRoute(row)}>
                          保存此线路
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
              <div hidden={tab !== 4}>
                <Card title="使用权限">
                  <p>后台仅 owner 可设置；客户登录后可查询已启用线路。</p>
                  <p>所有线路使用公共价格。快递服务及附加费由 API 返回。</p>
                </Card>
              </div>
            </fieldset>
          )}
          <p role="status">{notice}</p>
        </main>
      </div>
    </div>
  );
}
