import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/shop/orders/$orderId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/admin/orders/$orderId", params: { orderId: params.orderId } });
  },
});
