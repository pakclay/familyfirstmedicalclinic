import { z } from "zod"

/**
 * The app-wide product name (lib/branding.ts). Unlike every other name in
 * this app, blank is meaningful rather than invalid: clearing the field
 * stores NULL, which reads back as the built-in DEFAULT_APP_NAME. Without
 * that an admin who renamed the app has no way back to the default short
 * of retyping it exactly.
 *
 * The cap is there because this string lands in the <title> and in a
 * fixed-width header slot — long enough for a real clinic name, short
 * enough that neither becomes unreadable.
 */
export const editBrandingSchema = z.object({
  brandName: z
    .string()
    .trim()
    .max(80, "Keep the app name under 80 characters")
    .transform((value) => value || null),
})

export type EditBrandingInput = z.infer<typeof editBrandingSchema>
