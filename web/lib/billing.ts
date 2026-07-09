import { createClient } from "@/lib/supabase/server"

type PlanId = "free" | "pro" | "scale"

type Plan = {
  id: PlanId
  name: string
  priceLabel: string
  blurb: string
  leadsLimit: number
  features: string[]
}

type Subscription = {
  plan: Plan
  status: "active" | "cancelled" | "past_due"
  renewsAt: string | null
  leadsUsed: number
}

type Invoice = {
  id: string
  issuedAt: string
  amountLabel: string
  status: "paid" | "open" | "void"
}

// The catalogue the billing UI renders. When Dodo is wired up these gain a
// `dodoProductId` and the prices come from the Dodo product, not from here.
const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    blurb: "Score leads by hand while you find your profile.",
    leadsLimit: 100,
    features: ["100 scored leads a month", "One ideal customer profile", "Browser extension"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$49",
    blurb: "For a founder doing outbound every week.",
    leadsLimit: 1000,
    features: [
      "1,000 scored leads a month",
      "Contact enrichment",
      "Drafted openers",
      "Folders",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceLabel: "$149",
    blurb: "For a team running outbound as a system.",
    leadsLimit: 5000,
    features: [
      "5,000 scored leads a month",
      "Everything in Pro",
      "Priority scoring queue",
    ],
  },
}

// The single boundary the billing UI reads. Today every user is on the free
// plan and usage is counted straight from the leads table, so the number on
// screen is real even though nothing has been paid for. Wiring Dodo means
// replacing this body — reading the subscriptions row — not the callers.
async function getSubscription(): Promise<Subscription> {
  const supabase = await createClient()

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })

  return {
    plan: PLANS.free,
    status: "active",
    renewsAt: null,
    leadsUsed: count ?? 0,
  }
}

// Dodo is the source of invoices; until it is connected there are none to show.
async function listInvoices(): Promise<Invoice[]> {
  return []
}

export { PLANS, getSubscription, listInvoices }
export type { Invoice, Plan, PlanId, Subscription }
