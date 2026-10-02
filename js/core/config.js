// Constantes globales del juego: medidas del mundo (en metros), física y presets de calidad.

export const TW = 1.2;        // ancho de una baldosa (eje x)
export const RH = 2.6;        // alto de una fila / planta (eje y)
export const SLAB = 0.42;     // grosor del suelo
export const ZB = -1.75;      // profundidad de la pared del fondo
export const ZF = 1.15;       // borde delantero de los suelos
export const HEADROOM = RH - SLAB;

export const GRAVITY = 17.5;
export const MAX_FALL = 15;

export const BODY_HALF = 0.26;   // medio ancho del cuerpo para colisiones
export const HANG_REACH = 2.18;  // de los pies a las manos con los brazos estirados
export const HANG_OFF = 0.30;    // separación del cuerpo respecto al borde al colgar

export const RUN_SPEED = 4.3;
export const WALK_SPEED = 1.5;

export const START_MINUTES = 60;

const isTouch = (typeof window !== 'undefined') && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
const smallScreen = (typeof window !== 'undefined') && Math.min(screen.width, screen.height) < 820;
export const IS_MOBILE = isTouch && smallScreen;
export const IS_TOUCH = isTouch;

export const QUALITY = {
  low: {
    name: 'low', pixelRatio: 1.0, post: false, bloom: false, shadows: false, shadowSize: 0,
    msaa: 0, lights: 3, tex: 512, particles: 0.45, dust: 60, sheen: false,
  },
  medium: {
    name: 'medium', pixelRatio: 1.5, post: true, bloom: true, bloomRes: 0.5, shadows: true, shadowSize: 1024,
    msaa: 0, lights: 5, tex: 512, particles: 0.75, dust: 140, sheen: false,
  },
  high: {
    name: 'high', pixelRatio: 2.0, post: true, bloom: true, bloomRes: 0.75, shadows: true, shadowSize: 2048,
    msaa: 4, lights: 7, tex: 1024, particles: 1.0, dust: 260, sheen: true,
  },
};

export function defaultQuality() {
  const p = new URLSearchParams(location.search).get('q');
  if (p && QUALITY[p]) return p;
  try {
    const s = localStorage.getItem('pop_quality');
    if (s && QUALITY[s]) return s;
  } catch (e) { /* almacenamiento no disponible */ }
  if (IS_MOBILE) {
    const mem = navigator.deviceMemory || 4;
    return mem <= 3 ? 'low' : 'medium';
  }
  return 'high';
}

export const DEBUG = new URLSearchParams(location.search).has('debug');
