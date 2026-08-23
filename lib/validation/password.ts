import { z } from "zod"

// Minimum length plus "not just letters" per SECURITY.md's hardening list —
// deliberately not requiring symbols/uppercase on top of that, since this
// clinic's shared-password-until-now baseline means the bar to clear is
// "meaningfully better than nothing," not a corporate-IT complexity rule
// nobody can remember.
const newPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/\d/, "Password must include at least one number")

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation don't match",
    path: ["confirmPassword"],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
