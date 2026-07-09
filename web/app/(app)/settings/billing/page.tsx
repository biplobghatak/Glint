import { CheckIcon } from "lucide-react"

import { PLANS, getSubscription, listInvoices } from "@/lib/billing"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Leads scored</span>
        <span className="font-medium tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Leads scored against your plan limit"
        className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            pct >= 100 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default async function SettingsBillingPage() {
  const [subscription, invoices] = await Promise.all([
    getSubscription(),
    listInvoices(),
  ])
  const current = subscription.plan

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold">{current.name}</span>
            <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
              {subscription.status === "active" ? "Active" : subscription.status}
            </Badge>
            <span className="text-muted-foreground text-sm">
              {subscription.renewsAt
                ? `Renews ${new Date(subscription.renewsAt).toLocaleDateString()}`
                : "No renewal — the free plan does not expire."}
            </span>
          </div>
          <UsageMeter used={subscription.leadsUsed} limit={current.leadsLimit} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {Object.values(PLANS).map((plan) => {
          const isCurrent = plan.id === current.id
          return (
            <Card
              key={plan.id}
              className={cn(isCurrent && "border-primary ring-primary/20 ring-2")}
            >
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <p className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">{plan.priceLabel}</span>
                  <span className="text-muted-foreground text-sm">/ month</span>
                </p>
                <ul className="flex flex-col gap-2 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isCurrent ? "outline" : "default"}
                  disabled
                  className="w-full"
                >
                  {isCurrent ? "Current plan" : `Choose ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No invoices yet. They appear here after your first payment.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="border-border flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>{new Date(invoice.issuedAt).toLocaleDateString()}</span>
                  <span className="tabular-nums">{invoice.amountLabel}</span>
                  <Badge variant={invoice.status === "paid" ? "secondary" : "outline"}>
                    {invoice.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
