/**
 * §7.6: "Implement a NotificationChannel interface with MockChannel
 * (default), SmsChannel, and MessengerChannel." Real provider integration
 * goes behind this single interface, swappable by the NOTIFICATION_CHANNEL
 * env var (§0's rule: external providers run in mock mode by default).
 */
export type ChannelSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; error: string }
  | { status: "mocked" }

export interface NotificationChannel {
  send(to: string, message: string): Promise<ChannelSendResult>
}

/** Default channel: logs the payload to the console and to the `notifications` table (via the caller) — no real send. */
export class MockChannel implements NotificationChannel {
  async send(to: string, message: string): Promise<ChannelSendResult> {
    console.log(`[MOCK NOTIFICATION] to=${to}\n${message}`)
    return { status: "mocked" }
  }
}

/**
 * §7.6 DECISION: target a Philippine SMS provider (Semaphore, Movider, or
 * iTexMo) rather than Twilio when this goes live — better local
 * deliverability and pricing. Not implemented; this is the seam a real
 * integration plugs into without touching any calling code. Throws rather
 * than silently no-op'ing, so switching NOTIFICATION_CHANNEL=sms without
 * finishing the integration fails loudly instead of pretending to send.
 */
export class SmsChannel implements NotificationChannel {
  async send(): Promise<ChannelSendResult> {
    throw new Error(
      "SmsChannel is not implemented yet — set NOTIFICATION_CHANNEL=mock, or wire up a real provider (Semaphore/Movider/iTexMo) here."
    )
  }
}

/**
 * §7.6 DECISION: secondary channel, only reachable for patients who
 * initiated contact on Facebook — Meta restricts business-initiated
 * messages outside a limited window after the user's last message, so
 * this can never be the sole channel for a queue update. Not implemented
 * for the same reason as SmsChannel.
 */
export class MessengerChannel implements NotificationChannel {
  async send(): Promise<ChannelSendResult> {
    throw new Error(
      "MessengerChannel is not implemented yet — verify Meta's current messaging window and message-tag policy before wiring this up."
    )
  }
}

export function getNotificationChannel(): NotificationChannel {
  const driver = process.env.NOTIFICATION_CHANNEL ?? "mock"
  if (driver === "sms") return new SmsChannel()
  if (driver === "messenger") return new MessengerChannel()
  return new MockChannel()
}
