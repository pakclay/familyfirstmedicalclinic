import { z } from "zod"

export const expenseSchema = z.object({
  category: z.string().trim().min(1, "Category is required"),
  description: z.string().trim().optional(),
  amount: z.coerce.number().int().positive("Amount must be greater than 0"),
  expenseDate: z.coerce.date({ error: "Enter a valid date" }),
})
export type ExpenseInput = z.infer<typeof expenseSchema>
