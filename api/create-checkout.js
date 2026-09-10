// api/create-checkout.js
// Fonction serverless Vercel — crée une vraie session Stripe Checkout
// avec les metadata (rdv_ids, email, nom, tel du cuisiniste) correctement attachées.
// Contrairement à un Payment Link, cette méthode garantit que Make/Stripe reçoit les metadata.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS basique si le front appelle depuis le même domaine Vercel, pas nécessaire,
  // mais on le laisse au cas où tu testes en local.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { rdvIds, email, nom, tel, montantCentimes } = req.body;

    if (!rdvIds || !email || !montantCentimes) {
      return res.status(400).json({ error: 'Paramètres manquants (rdvIds, email, montantCentimes)' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'RDV cuisine qualifié' + (rdvIds.split(',').length > 1 ? 's' : ''),
            },
            unit_amount: montantCentimes, // montant total en centimes, ex: 17500 pour 175,00€
          },
          quantity: 1,
        },
      ],
      // Metadata posées sur la Session (utile pour l'admin Stripe / recherche).
      metadata: {
        rdv_ids: rdvIds,
        cuisiniste_email: email,
        cuisiniste_nom: nom || '',
        cuisiniste_tel: tel || '',
      },
      // IMPORTANT : Make écoute l'événement "payment_intent.succeeded", pas
      // "checkout.session.completed". Or les metadata de la Session ne sont PAS
      // automatiquement copiées sur le Payment Intent — il faut les dupliquer ici
      // explicitement, sinon Make recevra à nouveau des metadata vides.
      payment_intent_data: {
        metadata: {
          rdv_ids: rdvIds,
          cuisiniste_email: email,
          cuisiniste_nom: nom || '',
          cuisiniste_tel: tel || '',
        },
      },
      customer_email: email,
      success_url: `${req.headers.origin}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur création session Stripe:', err);
    return res.status(500).json({ error: err.message });
  }
};
