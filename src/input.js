// Keyboard + gamepad input, unified into game intents.
//
// Movement is read in SCREEN space and converted to world axes for the
// broadcast camera (on −Z looking toward +Z): that camera's right vector is
// world −X, and screen-up on the ground plane is world +Z.
//
// Gamepad face buttons are addressed by POSITION, not by letter, because the
// Gamepad API's "standard" mapping indexes them by physical position while
// Nintendo prints the letters in a different arrangement than Xbox:
//   buttons[0] = bottom   -> Switch B   (Xbox A)
//   buttons[1] = right    -> Switch A   (Xbox B)
//   buttons[2] = left     -> Switch Y   (Xbox X)
//   buttons[3] = top      -> Switch X   (Xbox Y)
// So the labels below are Switch labels; the behaviour is position-based and
// works on an Xbox/PS pad too.

import { createTouchControls, isTouchDevice } from './touch.js';

const BTN = {
  bottom: 0,   // Switch B — short pass / (defending) press-tackle
  right: 1,    // Switch A — shoot / (defending) slide tackle
  left: 2,     // Switch Y — through ball
  top: 3,      // Switch X — lofted through ball
  L: 4,        // switch player
  R: 5,        // switch player (alt)
  ZL: 6,       // — reserved
  ZR: 7,       // sprint
  minus: 8,
  plus: 9,
};

const DEADZONE = 0.24;
const KEYBIND_STORAGE_KEY = 'fifacher_keybinds_v1';

export const ACTION_DEFS = [
  { id: 'moveUp', label: 'Move Up', group: 'MOVEMENT & BALL', defaults: ['KeyW', 'ArrowUp'] },
  { id: 'moveDown', label: 'Move Down', group: 'MOVEMENT & BALL', defaults: ['KeyS', 'ArrowDown'] },
  { id: 'moveLeft', label: 'Move Left', group: 'MOVEMENT & BALL', defaults: ['KeyA', 'ArrowLeft'] },
  { id: 'moveRight', label: 'Move Right', group: 'MOVEMENT & BALL', defaults: ['KeyD', 'ArrowRight'] },
  { id: 'sprint', label: 'Sprint', group: 'MOVEMENT & BALL', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'modifier', label: 'Shield / Finesse / 1-2', group: 'MOVEMENT & BALL', defaults: ['KeyZ'] },

  { id: 'pass', label: 'Pass / Press & Tackle', group: 'PASS, SHOOT & DEFEND', defaults: ['KeyX', 'KeyN', 'KeyJ'] },
  { id: 'through', label: 'Through Ball / GK Rush', group: 'PASS, SHOOT & DEFEND', defaults: ['KeyC', 'KeyM', 'KeyK'] },
  { id: 'lofted', label: 'Lob / Cross / Clear', group: 'PASS, SHOOT & DEFEND', defaults: ['KeyV', 'KeyB', 'KeyL'] },
  { id: 'shoot', label: 'Shoot / Slide Tackle', group: 'PASS, SHOOT & DEFEND', defaults: ['Space', 'Enter', 'KeyI', 'NumpadEnter'] },
  { id: 'chipMod', label: 'Chip Shot Modifier', group: 'PASS, SHOOT & DEFEND', defaults: ['KeyQ'] },
  { id: 'triggerRun', label: 'Trigger Forward Run', group: 'PASS, SHOOT & DEFEND', defaults: ['KeyQ', 'KeyT'] },

  { id: 'switchPlayer', label: 'Switch Player', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyQ', 'Tab'] },
  { id: 'offsideTrap', label: 'Offside Trap', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyT'] },
  { id: 'skillStepover', label: 'Skill: Stepover', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyE'] },
  { id: 'skillRoulette', label: 'Skill: Roulette Spin', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyR'] },
  { id: 'skillBallRoll', label: 'Skill: Ball Roll', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyF'] },
  { id: 'skillElastico', label: 'Skill: Elastico', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyG'] },
  { id: 'tacticBal', label: 'Tactic: Balanced', group: 'SKILLS, SWITCH & TACTICS', defaults: ['Digit1'] },
  { id: 'tacticPress', label: 'Tactic: High Press', group: 'SKILLS, SWITCH & TACTICS', defaults: ['Digit2'] },
  { id: 'tacticCounter', label: 'Tactic: Counter', group: 'SKILLS, SWITCH & TACTICS', defaults: ['Digit3'] },
  { id: 'tacticBus', label: 'Tactic: Low Block', group: 'SKILLS, SWITCH & TACTICS', defaults: ['Digit4'] },
  { id: 'pause', label: 'Pause / Settings', group: 'SKILLS, SWITCH & TACTICS', defaults: ['KeyP'] },
];

const ACTION_MAP = new Map(ACTION_DEFS.map((d) => [d.id, d]));

const CODE_LABELS = {
  Space: 'SPC',
  Enter: 'ENT',
  NumpadEnter: 'NUM↵',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Tab: 'TAB',
  CapsLock: 'CAPS',
  Backspace: 'BKSP',
  Delete: 'DEL',
  Escape: 'ESC',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  NumpadAdd: 'NUM+',
  NumpadSubtract: 'NUM-',
  NumpadMultiply: 'NUM*',
  NumpadDivide: 'NUM/',
  NumpadDecimal: 'NUM.',
};

export function formatKeyCode(code) {
  if (!code || typeof code !== 'string') return '?';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length === 7) return 'NUM' + code.slice(6);
  return code.toUpperCase();
}

function defaultBindState() {
  const out = {};
  for (const def of ACTION_DEFS) out[def.id] = def.defaults.slice();
  return out;
}

function loadStoredKeybinds() {
  const base = defaultBindState();
  try {
    const raw = window.localStorage && window.localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;
    for (const def of ACTION_DEFS) {
      const arr = parsed[def.id];
      if (Array.isArray(arr)) {
        const clean = [];
        for (const c of arr) {
          if (typeof c === 'string' && c.length > 0 && c !== 'Escape' && !clean.includes(c)) {
            clean.push(c);
          }
        }
        if (clean.length > 0) base[def.id] = clean.slice(0, 4);
      }
    }
  } catch (e) { /* sandboxed or unavailable localStorage */ }
  return base;
}

function saveStoredKeybinds(binds) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(binds));
    }
  } catch (e) { /* ignore storage quota/security errors */ }
}

// chipMod (held while shooting on the ball), triggerRun (pressed in possession),
// and switchPlayer (pressed off-ball) intentionally share KeyQ / L1 by default without conflict.
function canCoexist(aId, bId) {
  const allowed = new Set(['chipMod', 'switchPlayer', 'triggerRun']);
  return allowed.has(aId) && allowed.has(bId);
}

export function createInput() {
  const down = new Set();
  const pressed = new Set();
  let binds = loadStoredKeybinds();
  let capturing = false;
  const changeListeners = new Set();
  let preventCodes = new Set();

  function rebuildPreventCodes() {
    const next = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    for (const def of ACTION_DEFS) {
      for (const code of binds[def.id]) next.add(code);
    }
    preventCodes = next;
  }
  rebuildPreventCodes();

  function emitChange(info) {
    rebuildPreventCodes();
    saveStoredKeybinds(binds);
    for (const fn of changeListeners) {
      try { fn(getKeybinds(), info); } catch (e) { /* isolate listener */ }
    }
  }

  function getKeybinds() {
    const copy = {};
    for (const def of ACTION_DEFS) copy[def.id] = binds[def.id].slice();
    return copy;
  }

  function hasDown(actionId) {
    const arr = binds[actionId];
    if (!arr) return false;
    for (let i = 0; i < arr.length; i++) if (down.has(arr[i])) return true;
    return false;
  }

  function hasPressed(actionId) {
    const arr = binds[actionId];
    if (!arr) return false;
    for (let i = 0; i < arr.length; i++) if (pressed.has(arr[i])) return true;
    return false;
  }

  function formatActionKeys(actionId, maxCount = 4) {
    const arr = binds[actionId] || [];
    if (!arr.length) return '—';
    if (actionId === 'sprint' && arr.length === 2 &&
        arr.includes('ShiftLeft') && arr.includes('ShiftRight')) {
      return 'SHIFT';
    }
    return arr.slice(0, maxCount).map(formatKeyCode).join('/');
  }

  function formatMoveSummary() {
    const u = binds.moveUp[0], d = binds.moveDown[0], l = binds.moveLeft[0], r = binds.moveRight[0];
    if (u === 'KeyW' && d === 'KeyS' && l === 'KeyA' && r === 'KeyD') return 'WASD';
    if (u === 'ArrowUp' && d === 'ArrowDown' && l === 'ArrowLeft' && r === 'ArrowRight') return 'ARROWS';
    return [u, d, l, r].map((c) => formatKeyCode(c)).join('/');
  }

  function setBinding(actionId, slotIdx, code) {
    if (!ACTION_MAP.has(actionId)) return { ok: false, reason: 'unknown_action' };
    if (!code || typeof code !== 'string' || code === 'Escape' || code === 'Unidentified' ||
        code === 'MetaLeft' || code === 'MetaRight') {
      return { ok: false, reason: 'reserved' };
    }

    const cur = binds[actionId].slice();
    const safeIdx = Math.max(0, Math.min(slotIdx, cur.length));
    const prevCode = safeIdx < cur.length ? cur[safeIdx] : null;

    if (prevCode === code) return { ok: true, unchanged: true, code };

    // Pre-check: if adding a brand-new alt slot (prevCode == null) and `code` is the sole key
    // of another action (and no unused default exists for it), reject cleanly instead of duplicating.
    if (!prevCode) {
      for (const otherDef of ACTION_DEFS) {
        if (otherDef.id === actionId || canCoexist(actionId, otherDef.id)) continue;
        const otherArr = binds[otherDef.id];
        if (otherArr.length === 1 && otherArr[0] === code) {
          const unusedDefault = otherDef.defaults.find((dc) =>
            dc !== code && !ACTION_DEFS.some((ad) =>
              ad.id !== otherDef.id && !canCoexist(ad.id, otherDef.id) && binds[ad.id].includes(dc),
            ),
          );
          if (!unusedDefault) {
            return { ok: false, reason: 'sole_key', conflictLabel: otherDef.label, code };
          }
        }
      }
    }

    // Remove duplicate within the same action first (swap slots if already present).
    const existingSelfIdx = cur.indexOf(code);
    if (existingSelfIdx !== -1 && existingSelfIdx !== safeIdx) {
      if (prevCode) cur[existingSelfIdx] = prevCode;
      else cur.splice(existingSelfIdx, 1);
    }

    if (safeIdx < cur.length) cur[safeIdx] = code;
    else cur.push(code);

    // Deduplicate while preserving order.
    const dedup = [];
    for (const c of cur) if (!dedup.includes(c)) dedup.push(c);
    binds[actionId] = dedup.slice(0, 4);

    // Resolve conflicts against all other actions (swap if displaced action would empty).
    const swappedWith = [];
    for (const otherDef of ACTION_DEFS) {
      if (otherDef.id === actionId || canCoexist(actionId, otherDef.id)) continue;
      const otherArr = binds[otherDef.id];
      const idx = otherArr.indexOf(code);
      if (idx === -1) continue;
      if (otherArr.length > 1) {
        otherArr.splice(idx, 1);
        swappedWith.push({ id: otherDef.id, label: otherDef.label, action: 'removed' });
      } else if (prevCode && prevCode !== code) {
        otherArr[idx] = prevCode;
        swappedWith.push({ id: otherDef.id, label: otherDef.label, action: 'swapped', replacedWith: prevCode });
      } else {
        const unusedDefault = otherDef.defaults.find((dc) =>
          dc !== code && !ACTION_DEFS.some((ad) =>
            ad.id !== otherDef.id && !canCoexist(ad.id, otherDef.id) && binds[ad.id].includes(dc),
          ),
        );
        if (unusedDefault) {
          otherArr[idx] = unusedDefault;
          swappedWith.push({ id: otherDef.id, label: otherDef.label, action: 'swapped', replacedWith: unusedDefault });
        }
      }
    }

    const info = { type: 'bind', actionId, label: ACTION_MAP.get(actionId).label, code, swappedWith };
    emitChange(info);
    return { ok: true, ...info };
  }

  function removeBinding(actionId, slotIdx) {
    if (!ACTION_MAP.has(actionId)) return false;
    const arr = binds[actionId];
    if (!arr || arr.length <= 1) return false;
    if (slotIdx < 0 || slotIdx >= arr.length) return false;
    const [removed] = arr.splice(slotIdx, 1);
    emitChange({ type: 'remove', actionId, label: ACTION_MAP.get(actionId).label, code: removed });
    return true;
  }

  function resetKeybinds() {
    binds = defaultBindState();
    emitChange({ type: 'reset' });
    return getKeybinds();
  }

  function setCapture(v) {
    capturing = !!v;
    down.clear();
    pressed.clear();
  }

  function isTyping(e) {
    const t = (e && e.target) || (typeof document !== 'undefined' ? document.activeElement : null);
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (capturing) return;
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
    if (preventCodes.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (isTyping(e)) return;
    down.delete(e.code);
  });
  window.addEventListener('focusin', (e) => {
    if (isTyping(e)) {
      down.clear();
      pressed.clear();
    }
  });
  window.addEventListener('blur', () => down.clear());

  // Gamepad edge detection: the API only exposes level state, so we diff it.
  let padPrev = [];
  let padRsPrev = false;
  let padName = null;
  window.addEventListener('gamepadconnected', (e) => { padName = e.gamepad.id; });
  window.addEventListener('gamepaddisconnected', () => { padName = null; padPrev = []; padRsPrev = false; });

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) { padPrev = []; padRsPrev = false; return null; }
    padName = pad.id;

    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const edge = (i) => btn(i) && !padPrev[i];

    // Left stick, with a radial deadzone and rescaling so slow walks are
    // possible right outside the deadzone rather than snapping to full speed.
    let ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    let mag = Math.hypot(ax, ay);
    if (mag < DEADZONE) { ax = 0; ay = 0; mag = 0; }
    else {
      const scaled = (mag - DEADZONE) / (1 - DEADZONE);
      ax = (ax / mag) * scaled; ay = (ay / mag) * scaled;
      mag = scaled;
    }
    // D-pad falls back to the stick when the stick is idle.
    if (mag === 0) {
      if (btn(12)) ay = -1; if (btn(13)) ay = 1;
      if (btn(14)) ax = -1; if (btn(15)) ax = 1;
      mag = Math.hypot(ax, ay);
      if (mag > 1) { ax /= mag; ay /= mag; mag = 1; }
    }

    // Right stick flicks for skill moves: up = stepover, diag-up = elastico, down = roulette, L/R = ball roll
    const rx = pad.axes[2] || 0, ry = pad.axes[3] || 0;
    const rMag = Math.hypot(rx, ry);
    const rsNow = rMag > 0.58;
    const rsEdge = rsNow && !padRsPrev;
    padRsPrev = rsNow;

    let skillStepover = false;
    let skillRoulette = false;
    let skillBallRoll = false;
    let skillElastico = false;
    let skillRollSide = 0;
    if (rsEdge) {
      if (ry < -0.35 && Math.abs(rx) > 0.35) {
        skillElastico = true;
        skillRollSide = rx > 0 ? 1 : -1;
      } else if (Math.abs(ry) >= Math.abs(rx)) {
        if (ry < 0) skillStepover = true;
        else skillRoulette = true;
      } else {
        skillBallRoll = true;
        skillRollSide = rx > 0 ? 1 : -1;
      }
    }

    const out = {
      // stick +x = screen-right, stick +y = screen-DOWN (API convention)
      sx: ax, sy: -ay, mag,
      sprint: btn(BTN.ZR) || (pad.buttons[7] && pad.buttons[7].value > 0.4),
      pass: edge(BTN.bottom),
      shoot: edge(BTN.right),
      through: edge(BTN.left),
      lofted: edge(BTN.top),
      holdPass: btn(BTN.bottom),
      holdShoot: btn(BTN.right),
      holdThrough: btn(BTN.left),
      holdLob: btn(BTN.top),
      switchPlayer: edge(BTN.L),
      triggerRun: edge(BTN.L),
      modifier: btn(BTN.R),
      chipMod: btn(BTN.ZL),
      gkRush: btn(BTN.left),
      pressAssist: btn(BTN.bottom),
      mentalityCycle: edge(BTN.minus),
      offsideTrap: edge(12),
      pause: edge(BTN.plus),
      skillStepover,
      skillRoulette,
      skillBallRoll,
      skillElastico,
      skillRollSide,
      name: pad.id,
    };
    padPrev = pad.buttons.map((b) => b.pressed);
    return out;
  }

  const touch = isTouchDevice() ? createTouchControls() : null;

  return {
    get padName() { return padName; },
    get hasTouch() { return !!touch; },
    getActionDefs: () => ACTION_DEFS,
    getKeybinds,
    setBinding,
    removeBinding,
    resetKeybinds,
    setCapture,
    isCapturing: () => capturing,
    formatKeyCode,
    formatActionKeys,
    formatMoveSummary,
    onKeybindsChange(cb) {
      if (typeof cb === 'function') changeListeners.add(cb);
      return () => changeListeners.delete(cb);
    },

    /** Call once per sim tick; press-events are consumed. */
    sample() {
      const pad = readPad();
      const tc = touch ? touch.sample() : null;

      const kbActive = !capturing && !isTyping();
      let sx = 0, sy = 0, mag = 0;
      if (kbActive) {
        if (hasDown('moveLeft')) sx -= 1;
        if (hasDown('moveRight')) sx += 1;
        if (hasDown('moveUp')) sy += 1;
        if (hasDown('moveDown')) sy -= 1;
      }
      mag = Math.hypot(sx, sy);
      if (mag > 1) { sx /= mag; sy /= mag; mag = 1; }

      // Gamepad, then touch, win whenever their stick is actually deflected.
      if (pad && pad.mag > 0) { sx = pad.sx; sy = pad.sy; mag = pad.mag; }
      else if (tc && tc.mag > 0) { sx = tc.sx; sy = tc.sy; mag = tc.mag; }

      // screen-right = world −X, screen-up = world +Z (camera on the −Z side)
      const x = -sx, z = sy;

      let tacticalSet = null;
      if (kbActive) {
        if (hasPressed('tacticBal')) tacticalSet = 'bal';
        else if (hasPressed('tacticPress')) tacticalSet = 'press';
        else if (hasPressed('tacticCounter')) tacticalSet = 'counter';
        else if (hasPressed('tacticBus')) tacticalSet = 'bus';
      }

      const passPressKb = kbActive && hasPressed('pass');
      const passHoldKb = kbActive && hasDown('pass');
      const thruPressKb = kbActive && hasPressed('through');
      const thruHoldKb = kbActive && hasDown('through');
      const lobPressKb = kbActive && hasPressed('lofted');
      const lobHoldKb = kbActive && hasDown('lofted');
      const shootPressKb = kbActive && hasPressed('shoot');
      const shootHoldKb = kbActive && hasDown('shoot');

      const out = {
        moveVec: { x, z },
        magnitude: mag,
        active: mag > 0,
        sprint: (kbActive && hasDown('sprint')) ||
          !!(pad && pad.sprint) || !!(tc && tc.sprint),
        passPressed: passPressKb || !!(pad && pad.pass) || !!(tc && tc.pass),
        shootPressed: shootPressKb || !!(pad && pad.shoot) || !!(tc && tc.shoot),
        throughPressed: thruPressKb || !!(pad && pad.through) || !!(tc && tc.through),
        loftedPressed: lobPressKb || !!(pad && pad.lofted) || !!(tc && tc.lofted),
        holdPass: passHoldKb || !!(pad && pad.holdPass) || !!(tc && tc.holdPass),
        holdShoot: shootHoldKb || !!(pad && pad.holdShoot) || !!(tc && tc.holdShoot),
        holdThrough: thruHoldKb || !!(pad && pad.holdThrough) || !!(tc && tc.holdThrough),
        holdLob: lobHoldKb || !!(pad && pad.holdLob) || !!(tc && tc.holdLofted),
        modifier: (kbActive && hasDown('modifier')) || !!(pad && pad.modifier) || !!(tc && tc.modifier),
        chipMod: (kbActive && hasDown('chipMod')) || !!(pad && pad.chipMod) || !!(tc && tc.chip),
        gkRush: thruHoldKb || !!(pad && pad.gkRush) || !!(tc && tc.gkRush),
        pressAssist: passHoldKb || !!(pad && pad.pressAssist) || !!(tc && tc.pressAssist),
        tacticalSet,
        mentalitySet: tacticalSet === 'bus' ? 'def' : tacticalSet === 'press' ? 'att' : tacticalSet === 'bal' ? 'bal' : null,
        mentalityCycle: !!(pad && pad.mentalityCycle) || !!(tc && tc.mentalityCycle),
        offsideTrapPressed: (kbActive && hasPressed('offsideTrap')) || !!(pad && pad.offsideTrap) || !!(tc && tc.offsideTrap),
        pausePressed: (kbActive && (pressed.has('Escape') || hasPressed('pause'))) || !!(pad && pad.pause),
        standTacklePressed: !!(tc && tc.standTackle),
        slideTacklePressed: !!(tc && tc.slideTackle),
        switchPressed: (kbActive && hasPressed('switchPlayer')) ||
          !!(pad && pad.switchPlayer) || !!(tc && tc.switchPlayer),
        triggerRunPressed: (kbActive && hasPressed('triggerRun')) ||
          !!(pad && pad.triggerRun),
        skillStepoverPressed: (kbActive && hasPressed('skillStepover')) ||
          !!(pad && pad.skillStepover) || !!(tc && tc.skillStepover),
        skillRoulettePressed: (kbActive && hasPressed('skillRoulette')) ||
          !!(pad && pad.skillRoulette) || !!(tc && tc.skillRoulette),
        skillBallRollPressed: (kbActive && hasPressed('skillBallRoll')) ||
          !!(pad && pad.skillBallRoll) || !!(tc && tc.skillBallRoll),
        skillElasticoPressed: (kbActive && hasPressed('skillElastico')) ||
          !!(pad && pad.skillElastico) || !!(tc && tc.skillElastico),
        skillRollSide: (pad && pad.skillRollSide) || 0,
      };
      pressed.clear();
      return out;
    },
    clear() {
      down.clear();
      pressed.clear();
    },
  };
}
