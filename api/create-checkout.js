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
    const { rdvIds, email, nom, tel, societe, adresse, siret, montantCentimes } = req.body;

    if (!rdvIds || !email || !montantCentimes) {
      return res.status(400).json({ error: 'Paramètres manquants (rdvIds, email, montantCentimes)' });
    }

    // Convertit un numéro français local (0627890053) au format international
    // requis par Brevo pour le SMS (+33627890053). Laisse intact si déjà au
    // format international (commence par +).
    function formatTelFR(numero) {
      if (!numero) return '';
      var n = String(numero).replace(/[\s.\-()]/g, ''); // retire espaces, points, tirets, parenthèses
      if (n.startsWith('+')) return n;
      if (n.startsWith('0')) return '+33' + n.slice(1);
      return n;
    }
    const telFormate = formatTelFR(tel);

    // Stripe limite chaque custom_field de facture à 30 caractères (nom ET valeur).
    // On tronque défensivement pour éviter une erreur API si la société/adresse
    // saisie est plus longue (le SIRET fait toujours 14 caractères, jamais tronqué).
    function tronque30(v) {
      return v ? String(v).slice(0, 30) : '';
    }

    const metadataCommune = {
      rdv_ids: rdvIds,
      cuisiniste_email: email,
      cuisiniste_nom: nom || '',
      cuisiniste_tel: telFormate,
      cuisiniste_societe: societe || '',
      cuisiniste_adresse: adresse || '',
      cuisiniste_siret: siret || '',
    };

    // Custom fields affichés directement sur le PDF de la facture Stripe.
    const invoiceCustomFields = [];
    if (societe) invoiceCustomFields.push({ name: 'Société', value: tronque30(societe) });
    if (siret) invoiceCustomFields.push({ name: 'SIRET', value: tronque30(siret) });
    if (adresse) invoiceCustomFields.push({ name: 'Adresse', value: tronque30(adresse) });

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
      metadata: metadataCommune,
      // IMPORTANT : Make écoute l'événement "payment_intent.succeeded", pas
      // "checkout.session.completed". Or les metadata de la Session ne sont PAS
      // automatiquement copiées sur le Payment Intent — il faut les dupliquer ici
      // explicitement, sinon Make recevra à nouveau des metadata vides.
      payment_intent_data: {
        metadata: metadataCommune,
      },
      customer_email: email,
      // Crée systématiquement un Customer Stripe (nécessaire pour que la facture
      // ci-dessous soit correctement rattachée, avec un historique consultable).
      customer_creation: 'always',
      // Génère automatiquement une facture Stripe après paiement réussi, avec
      // Société / SIRET / Adresse affichés en "custom fields" sur le PDF.
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: societe ? `RDV cuisine — ${societe}` : 'RDV cuisine',
          custom_fields: invoiceCustomFields.length ? invoiceCustomFields : undefined,
        },
      },
      success_url: `${req.headers.origin}/merci.html?session_id={CHECKOUT_SESSION_ID}&amount=${montantCentimes}`,
      cancel_url: `${req.headers.origin}/`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Erreur création session Stripe:', err);
    return res.status(500).json({ error: err.message });
  }
};
