"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/auth"
import { loginSchema } from "@/lib/validation/auth"

export type LoginState = { error?: string }

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) {
    return { error: "Enter a valid email and password." }
  }

  const callbackUrl = (formData.get("callbackUrl") as string) || "/console/dashboard"

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    })
    return {}
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." }
    }
    throw error
  }
}
