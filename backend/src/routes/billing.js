// backend/src/routes/billing.js
import express from 'express'
import Stripe from 'stripe'
import { prisma } from '../lib/prisma.js'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

function needAuth(req, res, next) {
if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' })
next()
}

// POST /billing/checkout { email?: string }
router.post('/checkout', needAuth, async (req, res) => {
const { userId, email } = { userId: req.user.userId, email: req.body.email }
const session = await stripe.checkout.sessions.create({
mode: 'subscription',
success_url: process.env.APP_URL + '/premium/success?session_id={CHECKOUT_SESSION_ID}',
cancel_url: process.env.APP_URL + '/premium/cancel',
customer_email: email,
line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
subscription_data: {
trial_period_days: parseInt(process.env.TRIAL_DAYS || '14', 10)
},
metadata: { app_user_id: userId }
})
res.json({ ok: true, url: session.url })
})

// Webhook: on exporte "router" mais on a besoin d'un handler "raw" au montage
export function billingWebhookHandler() {
const wh = express.Router()
wh.post(
'/webhook',
express.raw({ type: 'application/json' }),
async (req, res) => {
try {
const sig = req.headers['stripe-signature']
const event = stripe.webhooks.constructEvent(
req.body,
sig,
process.env.STRIPE_WEBHOOK_SECRET
)

// On traite les états utiles
if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
const sub = event.data.object
const status = sub.status // trialing | active | past_due | canceled | incomplete | ...
const endsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null

// Récup userId depuis metadata (ou via customer → lookup, V1: metadata)
const userId = sub.metadata?.app_user_id

if (userId) {
await prisma.user.update({
where: { id: userId },
data: {
subscriptionStatus: status,
subscriptionEndsAt: endsAt,
stripeCustomerId: sub.customer?.toString() || null
}
})
}
}

if (event.type === 'customer.subscription.deleted') {
const sub = event.data.object
const userId = sub.metadata?.app_user_id
if (userId) {
await prisma.user.update({
where: { id: userId },
data: { subscriptionStatus: 'canceled' }
})
}
}

res.json({ received: true })
} catch (e) {
console.error('[Stripe webhook] error:', e.message)
res.status(400).send(`Webhook Error: ${e.message}`)
}
}
)
return wh
}

export default router
