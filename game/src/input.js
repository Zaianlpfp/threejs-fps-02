// Input. One job: turn keyboard/mouse events into the state's input snapshot
// and the player's yaw/pitch. Pointer lock is preferred; if the browser
// refuses it (headless, denied), dragging on the canvas still aims.
export function createInput(state, canvas, callbacks) {
  const keys = new Set();
  let locked = false;
  let lockAt = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  function syncKeys() {
    const inp = state.input;
    inp.fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    inp.strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    inp.crouch = keys.has("KeyC") || keys.has("ControlLeft");
    inp.walk = keys.has("ShiftLeft") || keys.has("ShiftRight");
    inp.use = keys.has("KeyE");
    inp.jump = keys.has("Space");
  }

  function look(dx, dy) {
    const p = state.agents[0];
    if (!p || !p.alive) return;
    p.yaw -= dx * 0.0022;
    p.pitch -= dy * 0.0022;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  }

  function onKeyDown(e) {
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    syncKeys();
    const inp = state.input;
    if (e.code === "KeyR") inp.reload = true;
    if (e.code === "KeyG") inp.grenade = true;
    if (e.code === "KeyB") callbacks.onBuyToggle();
    if (e.code === "KeyM") callbacks.onMute();
    if (e.code === "Digit1") inp.slot = 1;
    if (e.code === "Digit2") inp.slot = 2;
    if (e.code === "Digit3") inp.slot = 3;
    if (e.code === "Digit4") inp.slot = 4;
    // Buy-menu hotkeys are the same digits; the sim consumes them in buy phase.
    if (["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].includes(e.code)) {
      inp.buyKey = e.code.slice(-1);
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    syncKeys();
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (!locked) {
      // First click (re)locks the pointer; the shot starts on the next press.
      canvas.requestPointerLock?.();
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      return;
    }
    state.input.fire = true;
    // Queued edge as a counter: every click fires exactly once, even when
    // frames run slower than the clicks arrive.
    state.input.fireEdge = Math.min(2, (state.input.fireEdge || 0) + 1);
  }

  function onMouseUp(e) {
    if (e.button === 0) state.input.fire = false;
    dragging = false;
  }

  function onMouseMove(e) {
    if (!locked) {
      if (dragging) {
        look(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
      }
      return;
    }
    // Guard: events queued before the lock engaged carry the whole pre-click
    // mouse travel as one huge delta — ignore the first moments after locking
    // and any single jump no real flick produces.
    if (performance.now() - lockAt < 150) return;
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    look(e.movementX, e.movementY);
  }

  function onLockChange() {
    locked = document.pointerLockElement === canvas;
    if (locked) lockAt = performance.now();
  }

  function onBlur() {
    keys.clear();
    state.input.fire = false;
    syncKeys();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);
  window.addEventListener("blur", onBlur);

  return {
    get locked() { return locked; },
    lock() { canvas.requestPointerLock?.(); },
    unlock() { document.exitPointerLock?.(); },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("blur", onBlur);
    },
  };
}
