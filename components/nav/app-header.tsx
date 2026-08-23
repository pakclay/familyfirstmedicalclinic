"use client"

import Link from "next/link"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SignOutButton } from "@/components/console/sign-out-button"

export type HeaderNavItem = { label: string; href: string }

/**
 * Shared by all three authenticated shells (staff/doctor/console). §9:
 * "Target usable interaction on a 360px-wide screen" — a plain horizontal
 * row of 5-7 nav links (this app's staff nav alone has 7) overflows a
 * 375px viewport and silently hides whichever links don't fit, with no
 * way to reach them. Below `sm`, the links move into a hamburger-
 * triggered dropdown instead of trying to somehow fit a full row.
 */
export function AppHeader({
  navItems,
  userLabel,
  brand = "Family First",
}: {
  navItems: HeaderNavItem[]
  userLabel: string
  brand?: string
}) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 sm:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {navItems.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href} className="py-2 text-base">
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild>
              <Link href="/change-password" className="py-2 text-base">
                Change password
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="hidden shrink-0 font-heading text-sm font-semibold sm:inline">{brand}</span>

        <nav className="hidden items-center gap-1 sm:flex">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden truncate text-sm text-muted-foreground sm:inline">{userLabel}</span>
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
          <Link href="/change-password">Change password</Link>
        </Button>
        <SignOutButton />
      </div>
    </header>
  )
}
