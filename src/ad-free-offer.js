// Oferta de "Quitar anuncios" que aparece al cerrar un video de AdMob.
// La compra es la misma de Mi plan: Google Play cobra y el servidor la verifica.

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
          ? "Google Play no está disponible en este dispositivo o cuenta."
          : "Google Play no pudo completar la compra. Inténtalo de nuevo.",
    };
  if (result.status === "cancelled") return { done: false, message: "" };
  if (result.status === "pending")
    return { done: true, message: "Tu pago quedó pendiente. Quitaremos los videos cuando Google Play lo confirme." };
  const results = result.sync?.results || [];
  const failed = results.find((r) => r.error);
  if (failed) return { done: false, message: failed.error };
  if (results.some((r) => r.kind === "ad_free" && r.granted))
    return { done: true, message: "Listo: quitamos los videos de anuncios de tu cuenta para siempre." };
  return { done: true, message: "Compra registrada. Estamos confirmándola con Google Play." };
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
    <div class="ad-free-offer-body"><h2 id="ad-free-offer-title" tabindex="-1">¿Prefieres usar la IA sin videos?</h2>
    <p>Quita los anuncios para siempre con un pago único. Sin suscripción.</p>
    <p class="error" role="alert" data-ad-free-error hidden></p>
    <div class="ad-free-offer-actions"><button type="button" data-ad-free-buy></button><button type="button" class="text-button" data-ad-free-later>Ahora no</button></div>
    <p class="fine">Podrás seguir viendo anuncios voluntarios para ganar créditos.</p></div>`;
  const buy = offer.querySelector("[data-ad-free-buy]");
  const error = offer.querySelector("[data-ad-free-error]");
  const label = `Quitar anuncios por ${price}`;
  buy.textContent = label;
  const close = () => offer.remove();
  offer.querySelector("[data-ad-free-later]").addEventListener("click", close);
  buy.addEventListener("click", async () => {
    if (buy.disabled) return;
    buy.disabled = true;
    buy.textContent = "Abriendo Google Play…";
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
