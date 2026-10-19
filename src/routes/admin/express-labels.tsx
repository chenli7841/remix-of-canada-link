import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/lib/admin-shared";
import { ExpressDispatchList } from "@/components/admin/ExpressDispatchList";

export const Route = createFileRoute("/admin/express-labels")({ component: ExpressLabelsPage });

function ExpressLabelsPage() {
  return (
    <Page title="快递面单打印">
      <ExpressDispatchList printOnly />
    </Page>
  );
}
