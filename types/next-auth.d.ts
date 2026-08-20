import type { Role } from "@/lib/permissions/ability"
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Role
      homeBranchId: string | null
      mustChangePassword: boolean
      isActive: boolean
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role
    homeBranchId?: string | null
    mustChangePassword?: boolean
    isActive?: boolean
  }
}
