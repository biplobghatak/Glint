import { Landing } from "@/components/landing"

// The marketing page is public and identical for everyone, signed in or not.
// Auth-aware routing happens at /login and /signup, not here — which also keeps
// this route free of a per-request Supabase call.
export default function Home() {
  return <Landing />
}
