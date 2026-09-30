import type { AmazonWarehouseSetting } from "@/lib/partner-settings";
export function AmazonWarehouseSettings({
  rows,
  onChange,
  onSave,
  busy,
}: {
  rows: AmazonWarehouseSetting[];
  onChange: (rows: AmazonWarehouseSetting[]) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const update = (id: string, key: string, value: string | boolean) =>
    onChange(rows.map((w) => (w.id === id ? { ...w, [key]: value } : w)));
  return (
    <div>
      <p className="prs-note">
        仅作为加拿大亚马逊收货地址预设，不作为线路到货仓或快递发货仓。保存后，前端可按仓库代码、名称或地址搜索，确认后自动回填。仅启用的仓库可供客户选择。
      </p>
      <div className="prs-actions">
        <span>共 {rows.length} 个亚马逊仓库</span>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                id: crypto.randomUUID(),
                code: "",
                company: "",
                street: "",
                city: "",
                province: "" as AmazonWarehouseSetting["province"],
                postal: "",
                phone: "",
                enabled: true,
              },
            ])
          }
        >
          ＋ 新增亚马逊仓库
        </button>
      </div>
      {rows.map((w) => (
        <section className="prs-card" key={w.id}>
          <details>
            <summary>
              <h2>
                {w.code || "新亚马逊仓库"}
                {w.company ? ` · ${w.company}` : ""}
                {w.enabled ? "" : "（停用）"}
              </h2>
              <span className="prs-fold" />
            </summary>
            <div className="prs-card-body">
              <div className="prs-grid">
                {(
                  [
                    ["code", "仓库代码（如 YYZ1）"],
                    ["company", "仓库名称 / 公司"],
                    ["street", "详细地址"],
                    ["city", "城市（英文）"],
                    ["postal", "邮编"],
                    ["phone", "联系电话（选填）"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      value={w[key]}
                      onChange={(e) =>
                        update(
                          w.id,
                          key,
                          key === "code" || key === "postal"
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  省份
                  <select
                    value={w.province}
                    onChange={(e) => update(w.id, "province", e.target.value)}
                  >
                    <option value="">请选择省份</option>
                    {[
                      "AB",
                      "BC",
                      "MB",
                      "NB",
                      "NL",
                      "NS",
                      "NT",
                      "NU",
                      "ON",
                      "PE",
                      "QC",
                      "SK",
                      "YT",
                    ].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={String(w.enabled)}
                    onChange={(e) => update(w.id, "enabled", e.target.value === "true")}
                  >
                    <option value="true">启用</option>
                    <option value="false">停用</option>
                  </select>
                </label>
              </div>
              <button type="button" onClick={() => onChange(rows.filter((r) => r.id !== w.id))}>
                移除此条（保存后生效）
              </button>
            </div>
          </details>
        </section>
      ))}
      <div className="prs-actions">
        <button type="button" disabled={busy} onClick={onSave}>
          保存亚马逊收货地址预设
        </button>
      </div>
    </div>
  );
}
