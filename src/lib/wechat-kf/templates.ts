/** 固定话术模板（全部服务器生成，不调用语言模型） */

export const T = {
  imageReceived: "已收到图片，正在识别单号…",
  noTrackingFound:
    "未能从图片中识别出有效单号。请重新拍摄完整、清晰的快递面单，确保条形码和单号没有被遮挡。",
  chooseTracking: "请选择需要查询的单号：",
  bindRequired:
    "创建运单前需要先绑定您的 EPLUS 账户。请登录网站「个人资料」生成 6 位绑定码，并把绑定码直接发给我。",
  bindInvalid: "绑定码无效或已过期，请重新在网站「个人资料」生成 6 位绑定码。",
  bindSuccess: "绑定成功，已继续为您办理刚才的创建运单流程。",
  cancelled: "已取消本次操作。",
  askItemName: "请回复物品名称（例如：衣服）。",
  askQuantity: "请回复件数（数字，例如：2）。",
  askUnitPrice: "请回复单价（人民币，例如：89）。",
  askDomestic: "请回复国内快递单号。",
  chooseRoute: "请选择线路：",
  routeUnavailable: "当前没有可用线路，请联系人工客服。",
  createFailed: "创建失败，请联系人工客服。",
  etaDisclaimer: "以上为预计时间，实际以海关及派送情况为准。",
  actionMenuHead: (no: string) => `已识别到单号：${no}\n请选择需要办理的操作：`,
  actionItems: [
    { id: "act_track", content: "查询物流状态" },
    { id: "act_billing", content: "查询运费及计费重量" },
    { id: "act_eta", content: "查询预计到达时间" },
    { id: "act_create", content: "使用该单号创建运单" },
    { id: "act_wrong", content: "单号识别错误" },
  ],
  confirmItems: [
    { id: "cfm_yes", content: "确认创建" },
    { id: "cfm_edit", content: "修改信息" },
    { id: "cfm_no", content: "取消" },
  ],
};

export function confirmText(d: {
  domestic_tracking_no?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  route_name?: string | null;
}) {
  return [
    "已从图片识别到：",
    `国内单号：${d.domestic_tracking_no ?? "-"}`,
    `品名：${d.item_name ?? "-"}`,
    `数量：${d.quantity ?? "-"}`,
    `单价：¥${d.unit_price != null ? Number(d.unit_price).toFixed(2) : "-"}`,
    `线路：${d.route_name ?? "-"}`,
    "仓库：义乌",
    "地址：您的默认地址",
    "请确认信息是否正确。",
  ].join("\n");
}
