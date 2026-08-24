import type { Role } from "@prisma/client"
import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: Role
      branchId: string | null
      holdingCompanyId: string | null
      mustChangePassword: boolean
    } & DefaultSession["user"]
  }

  interface User {
    role: Role
    branchId: string | null
    holdingCompanyId: string | null
    mustChangePassword: boolean
  }
}

// next-auth/jwt.d.ts re-exports from @auth/core/jwt, which is where the
// JWT interface TypeScript actually resolves the callback's `token`
// parameter against — augmenting "next-auth/jwt" alone doesn't merge into
// it, so both module specifiers need the same augmentation.
declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: Role
    branchId: string | null
    holdingCompanyId: string | null
    mustChangePassword: boolean
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string
    role: Role
    branchId: string | null
    holdingCompanyId: string | null
    mustChangePassword: boolean
  }
}
