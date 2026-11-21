// Solara Bay — keyboard and mouse input. Keys are tracked as a live set so
// the game can read "held" and "just pressed" without its own listeners.
export const KEYS = new Set();
const PRESSED = new Set();

export const ACTIONS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  enter: ['KeyE'],
  punch: ['Space'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
  start: ['Enter'],
};

function actionOf(code) {
  for (const [name, codes] of Object.entries(ACTIONS)) {
    if (codes.includes(code)) return name;
  }
  return null;
}

export function isDown(action) {
  return ACTIONS[action].some((code) => KEYS.has(code));
}

export function wasPressed(action) {
  return ACTIONS[action].some((code) => PRESSED.has(code));
}

export function endFrame() {
  PRESSED.clear();
}

export function bindInput(canvas, onClick) {
  window.addEventListener('keydown', (event) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) {
      KEYS.add(event.code);
      PRESSED.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => {
    KEYS.delete(event.code);
  });
  window.addEventListener('blur', () => {
    KEYS.clear();
  });
  canvas.addEventListener('mousedown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    onClick(x, y);
  });
}
