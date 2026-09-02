"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SignOutButton } from "@/components/console/sign-out-button"

export type HeaderNavItem = { label: string; href: string }

/**
 * Shared by all three authenticated shells (staff/doctor/console). §9:
 * "Target usable interaction on a 360px-wide screen" — a plain horizontal
 * row of 5-7 nav links (this app's staff nav alone has 7) overflows a
 * 375px viewport and silently hides whichever links don't fit, with no
 * way to reach them. Below `sm`, the links move into a slide-over drawer
 * instead of trying to somehow fit a full row.
 *
 * The drawer is built here rather than borrowed from a menu primitive
 * because a navigation drawer and a dropdown menu want different things:
 * this one traps nothing, closes on Escape and on the scrim, locks the
 * page behind it, and hands focus back to the button that opened it —
 * except when a link was followed, where taking focus back would fight
 * the destination page for it.
 */
export function AppHeader({
  navItems,
  userLabel,
  brand,
}: {
  navItems: HeaderNavItem[]
  userLabel: string
  /**
   * Required rather than defaulted: the name is a holding-admin setting now
   * (lib/branding.ts), and a default here would be a second copy of it that
   * silently wins whenever a caller forgets to pass one.
   */
  brand: string
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Escape closes from anywhere, including from inside the drawer.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, close])

  // The page behind a slide-over must not scroll with it.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  /**
   * A link is current when the path is it or sits beneath it. Exact match
   * alone would drop the highlight the moment someone opens a patient or a
   * branch, which is exactly when knowing where you are matters most.
   */
  function isCurrent(href: string) {
    return pathname === href || pathname.startsWith(href + "/")
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-1 sm:gap-4">
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="shrink-0 sm:hidden"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="app-nav-drawer"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-5" />
            </Button>

            {/* The name is admin-settable and can be much longer than the
                one this shipped with, so the brand yields space to the nav
                and ellipsises rather than pushing links off the row: the
                mark stays fixed, only the text gives. */}
            <span className="hidden min-w-0 max-w-[16rem] items-center gap-2 font-heading text-base font-semibold tracking-tight sm:inline-flex">
              <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
                <circle cx="11" cy="11" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M11 4.5c2.6 3 4 5.3 4 7.2a4 4 0 0 1-8 0c0-1.9 1.4-4.2 4-7.2Z"
                  fill="var(--marigold)"
                />
              </svg>
              <span className="truncate" title={brand}>
                {brand}
              </span>
            </span>

            <nav className="hidden items-center gap-1 sm:flex" aria-label="Sections">
              {navItems.map((item) => {
                const current = isCurrent(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`border-b-2 px-2.5 py-2 text-sm font-medium transition-colors ${
                      current
                        ? "border-marigold text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">{userLabel}</span>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <Link href="/change-password">Change password</Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Scrim stays mounted so the drawer can animate out rather than vanish. */}
      <div
        className={`fixed inset-0 z-50 bg-[#081310]/50 transition-opacity duration-200 sm:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => close()}
        aria-hidden="true"
      />

      <div
        id="app-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(20rem,86vw)] flex-col gap-1 overflow-y-auto border-l border-border bg-card px-4 pb-8 pt-3 transition-transform duration-200 sm:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex justify-end">
          <Button ref={closeRef} variant="ghost" size="icon" aria-label="Close menu" onClick={() => close()}>
            <X className="size-5" />
          </Button>
        </div>

        {navItems.map((item) => {
          const current = isCurrent(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? "page" : undefined}
              onClick={() => close(false)}
              className={`border-b border-border py-3.5 text-base font-medium ${
                current ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className={current ? "border-b-2 border-marigold pb-0.5" : undefined}>{item.label}</span>
            </Link>
          )
        })}

        <Link
          href="/change-password"
          onClick={() => close(false)}
          className="border-b border-border py-3.5 text-base font-medium text-muted-foreground"
        >
          Change password
        </Link>

        <p className="pt-4 text-sm text-muted-foreground">{userLabel}</p>
      </div>
    </>
  )
}
