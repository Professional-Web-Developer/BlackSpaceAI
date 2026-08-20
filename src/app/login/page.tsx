import { redirect } from "next/navigation";

import { getCurrentUser } from "@/auth/service";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in: nothing to do here.
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="page auth-page">
      <header className="page-header">
        <h1>BlackSpace AI</h1>
        <p>Sign in to continue</p>
      </header>
      <AuthForm />
    </main>
  );
}
