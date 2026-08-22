import { z } from "zod"

export const medicineCatalogSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  genericName: z.string().trim().optional(),
  form: z.enum(["TABLET", "CAPSULE", "SYRUP", "INJECTION", "OINTMENT", "OTHER"]),
  strength: z.string().trim().optional(),
  unit: z.enum(["PIECE", "BOTTLE", "VIAL", "SACHET", "BOX"]),
  reorderLevel: z.coerce.number().int().min(0),
  unitCost: z.coerce.number().int().min(0, "Unit cost can't be negative"),
  sellingPrice: z.coerce.number().int().min(0, "Selling price can't be negative"),
  isActive: z.boolean().default(true),
})
export type MedicineCatalogInput = z.infer<typeof medicineCatalogSchema>

export const receiveStockSchema = z.object({
  medicineId: z.string().uuid(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  unitCost: z.coerce.number().int().min(0, "Unit cost can't be negative"),
  expiryDate: z.union([z.literal(""), z.coerce.date()]).optional(),
  updateExpiryDate: z.boolean().default(false),
})
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>

export const physicalCountSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required for a physical count"),
  counts: z.array(
    z.object({
      medicineId: z.string().uuid(),
      countedQuantity: z.coerce.number().int().min(0),
    })
  ),
})
export type PhysicalCountInput = z.infer<typeof physicalCountSchema>
