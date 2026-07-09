import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { signedInDestination } from "@/lib/post-auth"

export default async function SignupPage() {
  const destination = await signedInDestination()
  if (destination) redirect(destination)

  return <AuthForm mode="signup" />
}
