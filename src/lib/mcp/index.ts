import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getCurrentCustomer from "./tools/get-current-customer";
import listMyOrders from "./tools/list-my-orders";
import listMyForwardings from "./tools/list-my-forwardings";
import getMyOrder from "./tools/get-my-order";
import getMyForwarding from "./tools/get-my-forwarding";
import trackWaybill from "./tools/track-waybill";
import listForwardingRoutes from "./tools/list-forwarding-routes";
import quoteForwarding from "./tools/quote-forwarding";
import saveForwardingDraft from "./tools/save-forwarding-draft";
import confirmForwardingDraft from "./tools/confirm-forwarding-draft";
import listMyAddresses from "./tools/list-my-addresses";
import getForwardingDraft from "./tools/get-forwarding-draft";
import cancelForwardingDraft from "./tools/cancel-forwarding-draft";
import getOwnerDashboard from "./tools/get-owner-dashboard";
import searchCustomersOwner from "./tools/search-customers-owner";
import listPendingForwardingsOwner from "./tools/list-pending-forwardings-owner";
import updateForwardingBasicInfoOwner from "./tools/update-forwarding-basic-info-owner";
import getForwardingOwner from "./tools/get-forwarding-owner";
import getWaybillAdmin from "./tools/get-waybill-admin";
import setWaybillStatusManager from "./tools/set-waybill-status-manager";
import listMyItems from "./tools/list-my-items";
import saveMyItem from "./tools/save-my-item";
import getMyWallet from "./tools/get-my-wallet";
import listMyInvoices from "./tools/list-my-invoices";
import deleteMyItem from "./tools/delete-my-item";
import getMyInvoice from "./tools/get-my-invoice";
import saveMyAddress from "./tools/save-my-address";
import deleteMyAddress from "./tools/delete-my-address";
import updateMyProfile from "./tools/update-my-profile";
import getMyInventory from "./tools/get-my-inventory";
import listMyBatches from "./tools/list-my-batches";
import searchOrdersAdmin from "./tools/search-orders-admin";
import getOrderAdmin from "./tools/get-order-admin";
import getCustomerAdmin from "./tools/get-customer-admin";
import searchInvoicesAdmin from "./tools/search-invoices-admin";
import getInvoiceAdmin from "./tools/get-invoice-admin";
import searchForwardingsAdmin from "./tools/search-forwardings-admin";
import searchWaybillsAdmin from "./tools/search-waybills-admin";
import searchBatchesAdmin from "./tools/search-batches-admin";
import getBatchAdmin from "./tools/get-batch-admin";
import searchAuditLogsAdmin from "./tools/search-audit-logs-admin";
import getAuditLogAdmin from "./tools/get-audit-log-admin";
import searchEplusKnowledge from "./tools/search-eplus-knowledge";
import listMySupportMessages from "./tools/list-my-support-messages";
import sendMySupportMessage from "./tools/send-my-support-message";
import sendCustomerSupportMessageAdmin from "./tools/send-customer-support-message-admin";
import diagnoseMyPendingIntake from "./tools/diagnose-my-pending-intake";
import correctMyPendingTracking from "./tools/correct-my-pending-tracking";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sinocargo-mcp",
  title: "SinoCargo",
  version: "0.2.1",
  instructions:
    "At the beginning of every new ChatGPT conversation, after the customer's first message and before any customer-facing reply or other EPLUS tool call, call get_current_customer exactly once. If OAuth is not connected, present the ChatGPT Connect EPLUS action and tell the customer to sign in to their own EPLUS account and approve access. If OAuth succeeds but get_current_customer reports that no EPLUS profile is connected, give only the account-binding guidance returned by that tool. If an account is connected, continue with the customer's request silently: do not announce the check, do not display a connection dialog, and do not ask them to connect again. " +
    "For general EPLUS policies and service procedures, call search_eplus_knowledge before answering; never use the knowledge base for live prices, permissions, balances, orders or tracking. Support messages are persistent EPLUS account messages, not private ChatGPT conversation messages; always show the exact recipient and message and obtain explicit confirmation before sending. " +
    "EPLUS tools use the signed-in account's existing website permissions. Identity always comes from EPLUS OAuth: never ask for, trust, or switch identity from a customer number, name, email, or account code typed in chat. If an operation is not permitted, reply only: 没有权限. Customer data is account-scoped; admin actions require the same role as the EPLUS backend. For a customer request to create a forwarding order, follow this fixed flow: (1) verify the signed-in EPLUS customer; (2) call list_my_addresses and automatically use the address marked is_default=true for recipient name, phone and full delivery address, without asking the customer to retype them; if no default address exists, ask the customer to create or select one; (3) call list_forwarding_routes and show only the returned routes, because those options are already filtered by the signed-in customer's permissions; (4) when a domestic tracking number was supplied, ask only for each item's name, quantity, unit price in CAD, and the customer's choice among those returned routes; warehouse defaults to YW and must not be requested; (5) save a draft, show its exact summary, and create the real order only after explicit confirmation. Never treat a domestic tracking number as an EPLUS waybill number unless the customer explicitly asks to track an existing EPLUS waybill. All customer-facing money is Canadian dollars (CAD). Never initiate payments, recharges, wallet deductions, refunds, or payment-status changes; direct the user to the EPLUS website for payment. Saving a draft never creates an order; create one only after explicit confirmation. Never infer, fabricate, or reuse a confirmation token: first show the current record and exact proposed change, then require the user to explicitly approve that change in the current conversation. Progressive disclosure is mandatory: if the request is ambiguous or a result contains more than 5 records, do not display every record or every field. Give only a short count/status summary and at most 3 identifiers, then ask one concise follow-up question to narrow by date range, status, order/invoice/waybill number, customer, or business type. Open full details only after the user selects a specific record. Never expose bulk personal data merely because the signed-in role can access it. For images, files, or spoken input, ChatGPT interprets the media and passes only structured text fields to EPLUS tools; EPLUS does not perform a second hidden AI interpretation. Never invent unreadable text. Repeat the extracted business fields to the user and ask about every missing, ambiguous, or low-confidence field. Before saving an address, saved item, or forwarding draft derived from media or speech, show the exact structured fields and obtain explicit confirmation. Copy tracking numbers, postal codes, quantities, dimensions, weights, HS codes, and CAD values exactly; do not silently correct or convert them. Raw media must not be stored by an EPLUS tool unless that tool explicitly declares a media field. If a read returns no record, state the search condition used and ask the user to verify the reference or broaden the date/status filter; never invent a match. If a tool fails temporarily, explain that no result or write was confirmed, suggest retrying later, and never automatically repeat a non-idempotent write.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getCurrentCustomer,
    listMyOrders,
    listMyForwardings,
    getMyOrder,
    getMyForwarding,
    trackWaybill,
    listForwardingRoutes,
    quoteForwarding,
    saveForwardingDraft,
    confirmForwardingDraft,
    listMyAddresses,
    getForwardingDraft,
    cancelForwardingDraft,
    getOwnerDashboard,
    searchCustomersOwner,
    listPendingForwardingsOwner,
    updateForwardingBasicInfoOwner,
    getForwardingOwner,
    getWaybillAdmin,
    setWaybillStatusManager,
    listMyItems,
    saveMyItem,
    getMyWallet,
    listMyInvoices,
    deleteMyItem,
    getMyInvoice,
    saveMyAddress,
    deleteMyAddress,
    updateMyProfile,
    getMyInventory,
    listMyBatches,
    searchOrdersAdmin,
    getOrderAdmin,
    getCustomerAdmin,
    searchInvoicesAdmin,
    getInvoiceAdmin,
    searchForwardingsAdmin,
    searchWaybillsAdmin,
    searchBatchesAdmin,
    getBatchAdmin,
    searchAuditLogsAdmin,
    getAuditLogAdmin,
    searchEplusKnowledge,
    listMySupportMessages,
    sendMySupportMessage,
    sendCustomerSupportMessageAdmin,
    diagnoseMyPendingIntake,
    correctMyPendingTracking,
  ],
});
