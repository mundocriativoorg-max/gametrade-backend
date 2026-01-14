require('dotenv').config()

const express = require('express')
const cors = require('cors')
const Stripe = require('stripe')
const { createClient } = require('@supabase/supabase-js')

const app = express()

// ===============================
// Middlewares
// ===============================
app.use(cors())

// JSON só para rotas normais
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook/stripe') {
    next()
  } else {
    express.json()(req, res, next)
  }
})

// ===============================
// Stripe
// ===============================
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

// ===============================
// Supabase
// ===============================
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    : null

// ===============================
// Health check (IMPORTANTE)
// ===============================
app.get('/', (req, res) => {
  res.status(200).send('API GameTrade online 🚀')
})

// ===============================
// Criar Checkout Session
// ===============================
app.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe não configurado' })
  }

  try {
    const { priceId, userId } = req.body

    if (!priceId || !userId) {
      return res.status(400).json({
        error: 'priceId e userId são obrigatórios'
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      metadata: {
        user_id: userId
      }
    })

    res.json({ url: session.url })
  } catch (error) {
    console.error('❌ Erro checkout:', error)
    res.status(500).json({ error: 'Erro Stripe' })
  }
})

// ===============================
// Webhook Stripe
// ===============================
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).send('Webhook não configurado')
    }

    const sig = req.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error('❌ Webhook inválido:', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    try {
      if (event.type === 'checkout.session.completed' && supabase) {
        const session = event.data.object

        await supabase.from('payments').insert([
          {
            user_id: session.metadata.user_id,
            stripe_payment_intent: session.payment_intent,
            amount: session.amount_total / 100,
            status: 'paid'
          }
        ])
      }

      res.json({ received: true })
    } catch (error) {
      console.error('❌ Erro webhook:', error)
      res.status(500).send('Erro interno')
    }
  }
)

// ===============================
// Porta (Railway injeta PORT)
// ===============================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`)
})
