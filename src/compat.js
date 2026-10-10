// Android usa el WebView del teléfono. Si Google Play no lo ha actualizado, faltan funciones
// recientes y la app quedaba en blanco. Vite traduce la sintaxis (build.target en vite.config.js);
// aquí se completan las pocas funciones del navegador que la app usa (las señales de fetch están
// en requestSignal de platform.js).
// Debe ser el primer import de main.js.

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value(index) {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
  });
}

if (globalThis.crypto && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}
