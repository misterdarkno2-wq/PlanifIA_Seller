import { portrait } from "./pet-art.js";

/** Lumi estática para canvas e imágenes: sin fondo, sombra ni capas que oculta el CSS. */
export function spriteSvg(stage, attributes = "") {
  return portrait(stage)
    .replace(
      /^<svg[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 10 220 185" ${attributes}><style>.lumi-delighted-eyes,.lumi-talking-mouth{display:none}</style>`,
    )
    .replace(/<g class="lumi-shadow-position">.*?<\/g>/, "")
    .replace(/<circle cx="130" cy="105" r="87"[^>]*\/>/, "")
    .replace(/<g class="lumi-sparks"[^>]*>.*?<\/g>/, "");
}

export const dataUrl = (svg) =>
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

/** Dibuja a Lumi centrada en el origen actual; un círculo la reemplaza mientras carga. */
export function drawSprite(ctx, sprite, width) {
  const height = width * (185 / 220);
  if (sprite?.complete && sprite.naturalWidth)
    ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  else {
    ctx.fillStyle = "#77cdb0";
    ctx.beginPath();
    ctx.arc(0, 0, width / 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function star(ctx, x, y, r, fill = "#f2c568", stroke = "#b67e26") {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      d = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}
