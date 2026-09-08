import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/orders/procurement")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/shop/orders/procurement" });
  },
});
