"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/auth"

export type LoginState = { error: string | null }

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/")

  try {
    await signIn("credentials", { email, password, redirectTo: next })
    return { error: null }
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Incorrect email or password." }
    }
    throw err
  }
}
