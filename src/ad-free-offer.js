// Oferta de "Quitar anuncios" que aparece al cerrar un video de AdMob.
// La compra es la misma de Mi plan: Google Play cobra y el servidor la verifica.

import { LEGAL_URLS } from "./legal.js";
import { tr } from "./i18n.js";
import { serverText } from "./server-messages.js";

// Precio de Play Console por si Google Play no informa el precio en ese momento.
export const AD_FREE_FALLBACK_PRICE = "$2.900";

/** Producto "Quitar anuncios" que se puede ofrecer, o null si no corresponde. */
export function adFreeProduct(monetization) {
  if (!monetization || monetization.ad_free || monetization.plan?.id !== "free") return null;
  return (monetization.products || []).find((p) => p.kind === "ad_free") || null;
}

/** Traduce la respuesta de la compra a lo que ve la persona. */
export function adFreePurchaseOutcome(result) {
  if (!result || result.status === "error")
    return {
      done: false,
      message:
        result?.code === 3
          ? tr("Google Play no está disponible en este dispositivo o cuenta.", "Google Play isn't available on this device or account.")
          : tr("Google Play no pudo completar la compra. Inténtalo de nuevo.", "Google Play couldn't complete the purchase. Try again."),
    };
  if (result.status === "cancelled") return { done: false, message: "" };
  if (result.status === "pending")
    return {
      done: true,
      message: tr(
        "Tu pago quedó pendiente. Quitaremos los videos cuando Google Play lo confirme.",
        "Your payment is pending. We'll remove the videos when Google Play confirms it.",
      ),
    };
  const results = result.sync?.results || [];
  const failed = results.find((r) => r.error);
  if (failed) return { done: false, message: serverText(failed.error) };
  if (results.some((r) => r.kind === "ad_free" && r.granted))
    return {
      done: true,
      message: tr("Listo: quitamos los videos de anuncios de tu cuenta para siempre.", "Done: we removed ad videos from your account for good."),
    };
  return { done: true, message: tr("Compra registrada. Estamos confirmándola con Google Play.", "Purchase registered. We're confirming it with Google Play.") };
}

/**
 * Muestra la tarjeta. Dentro de una ventana modal abierta se coloca al inicio de su contenido
 * (lo de fuera queda inerte); si no hay ventana, flota sobre la navegación inferior.
 */
export function mountAdFreeOffer({ price, onBuy, doc = document }) {
  doc.querySelector("[data-ad-free-sheet]")?.remove();
  const dialog = [...doc.querySelectorAll("dialog[open]")].at(-1);
  const offer = doc.createElement("section");
  offer.className = `ad-free-offer${dialog ? "" : " is-floating"}`;
  offer.dataset.adFreeSheet = "";
  offer.setAttribute("aria-labelledby", "ad-free-offer-title");
  offer.innerHTML = `<span class="ad-free-offer-icon" aria-hidden="true">✦</span>
    <div class="ad-free-offer-body"><h2 id="ad-free-offer-title" tabindex="-1">${tr("¿Prefieres usar la IA sin videos?", "Would you rather use the AI without videos?")}</h2>
    <p>${tr("Quita los anuncios para siempre con un pago único. Sin suscripción.", "Remove ads for good with a one-time payment. No subscription.")}</p>
    <p class="error" role="alert" data-ad-free-error hidden></p>
    <div class="ad-free-offer-actions"><button type="button" data-ad-free-buy></button><button type="button" class="text-button" data-ad-free-later>${tr("Ahora no", "Not now")}</button></div>
    <p class="fine">${tr("Podrás seguir viendo anuncios voluntarios para ganar créditos. Pago único con tu cuenta de Google Play, sin renovación. Al comprar aceptas los", "You can still watch optional ads to earn credits. One-time payment with your Google Play account, no renewal. By buying you accept the")} <a href="${LEGAL_URLS.terms}" target="_blank" rel="noopener noreferrer" data-external-link>${tr("Términos de uso", "Terms of Use")}</a>.</p></div>`;
  const buy = offer.querySelector("[data-ad-free-buy]");
  const error = offer.querySelector("[data-ad-free-error]");
  const label = tr(`Quitar anuncios por ${price}`, `Remove ads for ${price}`);
  buy.textContent = label;
  const close = () => offer.remove();
  offer.querySelector("[data-ad-free-later]").addEventListener("click", close);
  buy.addEventListener("click", async () => {
    if (buy.disabled) return;
    buy.disabled = true;
    buy.textContent = tr("Abriendo Google Play…", "Opening Google Play…");
    error.hidden = true;
    try {
      const outcome = await onBuy();
      if (outcome?.done) return close();
      if (outcome?.message) {
        error.textContent = outcome.message;
        error.hidden = false;
      }
    } finally {
      if (offer.isConnected) {
        buy.disabled = false;
        buy.textContent = label;
      }
    }
  });
  const loading = dialog?.querySelector(".ai-loading");
  if (loading) loading.before(offer);
  else (dialog || doc.body).append(offer);
  offer.querySelector("h2").focus({ preventScroll: true });
  if (dialog) offer.scrollIntoView?.({ block: "nearest" });
  return { element: offer, close };
}
