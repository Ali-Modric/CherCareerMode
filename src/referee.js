import { PITCH, clamp, v3 } from './util.js';

// ---------------------------------------------------------------------------
// referee.js — Physics-driven Referee Entity & Tackle Collision Adjudicator.
// Detects player-ball and player-player collisions during active tackles,
// computes physics impulse magnitude J = (1 + e) * mu * v_eff, applies physical
// momentum transfer / separation, and decides foul, free kick / penalty, or
// yellow / second-yellow / straight red card based on impulse & context.
// ---------------------------------------------------------------------------

const HALF_X = PITCH.length / 2; // 52.5
const HALF_Z = PITCH.width / 2;  // 34.0

const BALL_MASS = 0.43; // regulation match ball (kg)
const BODY_RESTITUTION = 0.28;

// Physics impulse magnitude thresholds (N·s)
const FOUL_IMPULSE_STAND = 175;        // standing challenge without clean ball first
const FOUL_IMPULSE_SLIDE = 145;        // sliding challenge without clean ball first
const RECKLESS_BALL_FIRST = 480;       // reckless follow-through even when winning ball first
const YELLOW_IMPULSE = 425;            // reckless challenge caution threshold
const SLIDE_BEHIND_YELLOW = 315;       // slide from behind caution threshold
const RED_IMPULSE = 640;               // excessive force / serious foul play -> straight red
const DOGSO_IMPULSE = 330;             // denial of obvious goal-scoring opportunity

export function createRefereeSystem(deps) {
  const {
    referee,
    squads,
    ball,
    state,
    emit,
    isActive,
    dirFor,
    other,
    releaseBall,
    setupSetPiece,
    switchControlled,
    getController,
    getEvadeState,
    getSkillState,
    onCleanTackleWin,
  } = deps;

  const activeTackles = []; // { tackler, isSlide, reach, t, dur, lx, lz, winBias, kickMin, kickRange, ballHit, ballTouchedFirst, ballImpulse, playerHit, maxImpulse, victim, fromBehind, cx, cz, resolved }
  const refTgt = v3();
  const TMP = v3();
  let callT = 0;
  let focusPos = v3();
  let pendingAdv = null; // { fouler, victim, foulOpts, card, t, startX, oppDir }

  function pdist(a, b) {
    return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  }

  function ballDist(p) {
    return Math.hypot(p.pos.x - ball.pos.x, p.pos.z - ball.pos.z);
  }

  function isLastDefender(fouler) {
    const dirDef = dirFor(fouler.team);
    let closer = 0;
    for (const o of squads[fouler.team].out) {
      if (!isActive(o) || o === fouler) continue;
      if (o.pos.x * dirDef < fouler.pos.x * dirDef - 1.5) closer++;
    }
    return closer === 0;
  }

  function planCard(fouler, impulse, isSlide, fromBehind, victim) {
    const oppGoalDir = dirFor(victim.team);
    const lastMan = isLastDefender(fouler);
    const threateningPos = victim.pos.x * oppGoalDir > 12 && Math.abs(victim.pos.z) < 16;
    if (impulse >= RED_IMPULSE || (lastMan && threateningPos && impulse >= DOGSO_IMPULSE)) {
      return 'red';
    }
    if (
      impulse >= YELLOW_IMPULSE ||
      (isSlide && fromBehind && impulse >= SLIDE_BEHIND_YELLOW) ||
      (fromBehind && impulse >= YELLOW_IMPULSE * 0.88)
    ) {
      return fouler.yellowCards + 1 >= 2 ? 'second_yellow' : 'yellow';
    }
    return null;
  }

  function issueFoul(fouler, victim, opts) {
    pendingAdv = null;
    const fx = clamp(opts.cx != null ? opts.cx : victim.pos.x, -HALF_X + 1.5, HALF_X - 1.5);
    const fz = clamp(opts.cz != null ? opts.cz : victim.pos.z, -HALF_Z + 1.5, HALF_Z - 1.5);
    const impulse = Math.round(opts.impulse || 0);
    const isSlide = !!opts.isSlide;
    const fromBehind = !!opts.fromBehind;
    const ballFirst = !!opts.ballFirst;

    state.stats[fouler.team].fouls++;
    if (ballFirst && state.stats[fouler.team].tacklesWon > 0) state.stats[fouler.team].tacklesWon--;
    state.lastFoulImpulse = impulse;

    const card = planCard(fouler, impulse, isSlide, fromBehind, victim);
    if (card === 'red') {
      fouler.sentOff = true;
      state.stats[fouler.team].reds++;
    } else if (card === 'second_yellow') {
      fouler.yellowCards++;
      state.stats[fouler.team].yellows++;
      fouler.sentOff = true;
      state.stats[fouler.team].reds++;
    } else if (card === 'yellow') {
      fouler.yellowCards++;
      state.stats[fouler.team].yellows++;
    }

    if (fouler.sentOff) {
      fouler.stop();
      fouler.pos.set(clamp(fx, -40, 40), 0, -HALF_Z - 3.5);
      fouler.vel.set(0, 0, 0);
      if (typeof switchControlled === 'function') {
        switchControlled(fouler);
      }
    }

    // Referee animation & facing toward contact / offending player
    if (referee) {
      focusPos.set(fx, 0, fz);
      callT = card ? 1.45 : 0.75;
      referee.stop();
      referee.face(fouler.sentOff ? focusPos : fouler.pos);
      if (card === 'red' || card === 'second_yellow') referee.playAction('ref_red');
      else if (card === 'yellow') referee.playAction('ref_yellow');
      else referee.playAction('ref_whistle');
    }

    // Inside offending team's defending penalty box -> Penalty Kick
    const defDir = dirFor(fouler.team);
    const inOwnBox =
      fx * (-defDir) > HALF_X - PITCH.penAreaDepth &&
      Math.abs(fz) < PITCH.penAreaWidth / 2;

    emit('foul', {
      fouler: { number: fouler.number, name: fouler.name, team: fouler.team },
      victim: { number: victim.number, name: victim.name, team: victim.team },
      card,
      penalty: inOwnBox,
      impulse,
      isSlide,
      fromBehind,
      ballFirst,
    });
    if (card) {
      emit('card', {
        card,
        team: fouler.team,
        player: { number: fouler.number, name: fouler.name },
        impulse,
      });
    }
    emit('whistle', { reason: inOwnBox ? 'penalty' : 'foul' });

    if (inOwnBox) {
      const penX = dirFor(victim.team) * (HALF_X - PITCH.penSpotDist);
      setupSetPiece('penalty', victim.team, penX, 0, false, !!card);
    } else {
      setupSetPiece('free_kick', victim.team, fx, fz, false, !!card);
    }
  }

  function applyPhysicalCollision(tackler, target, isSlide, session) {
    const dx = target.pos.x - tackler.pos.x;
    const dz = target.pos.z - tackler.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;

    // Effective closing speed along collision normal + sweep shear during slide
    const rvx = tackler.vel.x - target.vel.x;
    const rvz = tackler.vel.z - target.vel.z;
    const vn = Math.max(0, rvx * nx + rvz * nz);
    const relSpeed = Math.hypot(rvx, rvz);
    if (vn < 0.35 && relSpeed < 1.2) return 0;
    const vEff = vn + relSpeed * (isSlide ? 0.26 : 0.14);

    const m1 = tackler.mass || 76;
    const m2 = target.mass || 76;
    const mu = (m1 * m2) / (m1 + m2);
    const impulse = (1 + BODY_RESTITUTION) * mu * vEff;

    // Positional separation & physical momentum knockback
    const minSep = (tackler.bodyRadius || 0.41) + (target.bodyRadius || 0.41) + (isSlide ? 0.12 : 0.04);
    if (dist < minSep) {
      const push = (minSep - dist) * 0.55;
      target.pos.x = clamp(target.pos.x + nx * push, -HALF_X + 0.5, HALF_X - 0.5);
      target.pos.z = clamp(target.pos.z + nz * push, -HALF_Z + 0.5, HALF_Z - 0.5);
      tackler.pos.x = clamp(tackler.pos.x - nx * push * 0.45, -HALF_X + 0.5, HALF_X - 0.5);
      tackler.pos.z = clamp(tackler.pos.z - nz * push * 0.45, -HALF_Z + 0.5, HALF_Z - 0.5);
    }

    const knock = clamp(impulse / m2, 0.5, 4.2);
    target.pushVel(target.vel.x * 0.50 + nx * knock, target.vel.z * 0.50 + nz * knock);
    tackler.pushVel(tackler.vel.x * 0.65 - nx * knock * 0.35, tackler.vel.z * 0.65 - nz * knock * 0.35);

    // Direction check: challenge from behind victim's facing
    const vfx = Math.cos(target.facing), vfz = Math.sin(target.facing);
    const attackDirX = Math.hypot(tackler.vel.x, tackler.vel.z) > 0.6
      ? tackler.vel.x / Math.hypot(tackler.vel.x, tackler.vel.z)
      : session.lx;
    const attackDirZ = Math.hypot(tackler.vel.x, tackler.vel.z) > 0.6
      ? tackler.vel.z / Math.hypot(tackler.vel.x, tackler.vel.z)
      : session.lz;
    const fromBehind = (attackDirX * vfx + attackDirZ * vfz) > 0.42;

    if (impulse > session.maxImpulse) {
      session.maxImpulse = impulse;
      session.victim = target;
      session.fromBehind = fromBehind;
      session.cx = (tackler.pos.x + target.pos.x) * 0.5;
      session.cz = (tackler.pos.z + target.pos.z) * 0.5;
    }
    session.playerHit = true;
    return impulse;
  }

  function applyBallCollision(tackler, session) {
    const controller = getController();
    if (controller && controller.role === 'GK' && controller.holdingBall) return false;
    if (ball.pos.y > 1.15) return false;
    const reach = session.reach;
    // Foot contact point extends slightly ahead along tackle direction
    const fx = tackler.pos.x + session.lx * (session.isSlide ? 0.52 : 0.30);
    const fz = tackler.pos.z + session.lz * (session.isSlide ? 0.52 : 0.30);
    const dBall = Math.min(ballDist(tackler), Math.hypot(ball.pos.x - fx, ball.pos.z - fz));
    if (dBall > reach) return false;

    // Physical body occlusion: a tackler behind the carrier cannot reach straight through their torso to poke the ball
    if (controller && controller.team !== tackler.team) {
      const dcx = controller.pos.x - tackler.pos.x;
      const dcz = controller.pos.z - tackler.pos.z;
      const dc = Math.hypot(dcx, dcz);
      const dbx = ball.pos.x - tackler.pos.x;
      const dbz = ball.pos.z - tackler.pos.z;
      const db = Math.hypot(dbx, dbz);
      if (dc > 0.10 && db > 0.10 && dc < db + 0.14) {
        const cross = Math.abs(dcx * dbz - dcz * dbx) / db;
        const cfx = Math.cos(controller.facing), cfz = Math.sin(controller.facing);
        const behindCarrier = (dcx / dc) * cfx + (dcz / dc) * cfz;
        const ballAheadOfCarrier = ((ball.pos.x - controller.pos.x) * (dcx / dc) +
          (ball.pos.z - controller.pos.z) * (dcz / dc)) > 0.05;
        if ((behindCarrier > 0.12 || ballAheadOfCarrier) && cross < 0.50 && dBall > 0.52) {
          return false;
        }
      }
    }

    const evade = getEvadeState ? getEvadeState() : null;
    if (controller && controller.team !== tackler.team && evade && controller === evade.player && evade.t > 0) {
      // Skill move evades clean foot contact most of the time
      if (dBall > reach * 0.55) return false;
    }

    const rvx = (tackler.vel.x + session.lx * 2.4) - ball.vel.x;
    const rvz = (tackler.vel.z + session.lz * 2.4) - ball.vel.z;
    const relSp = Math.hypot(rvx, rvz);
    const ballImpulse = BALL_MASS * Math.max(4.5, relSp * 1.45);

    session.ballHit = true;
    session.ballImpulse = ballImpulse;
    if (!session.playerHit) session.ballTouchedFirst = true;

    const victim = (controller && controller.team !== tackler.team) ? controller : null;
    if (victim) releaseBall();

    const dir = dirFor(tackler.team);
    const kickSp = session.kickMin + Math.min(session.kickRange, relSp * 0.35);
    TMP.set(
      session.lx * kickSp + dir * 0.85,
      0.55 + Math.min(0.85, ballImpulse * 0.08),
      session.lz * kickSp,
    );
    ball.kick(TMP.clone());
    if (onCleanTackleWin) onCleanTackleWin(tackler, victim);
    return true;
  }

  function hasAdvantage(fouler, victim, foulOpts) {
    if (pendingAdv) return false;
    if (victim.role === 'GK') return false;
    const card = planCard(fouler, foulOpts.impulse || 0, foulOpts.isSlide, foulOpts.fromBehind, victim);
    if (card === 'red' || card === 'second_yellow') return false;
    const fx = clamp(foulOpts.cx != null ? foulOpts.cx : victim.pos.x, -HALF_X + 1.5, HALF_X - 1.5);
    const fz = clamp(foulOpts.cz != null ? foulOpts.cz : victim.pos.z, -HALF_Z + 1.5, HALF_Z - 1.5);
    const defDir = dirFor(fouler.team);
    const inOwnBox = fx * (-defDir) > HALF_X - PITCH.penAreaDepth && Math.abs(fz) < PITCH.penAreaWidth / 2;
    if (inOwnBox) return false;

    const curr = getController();
    const oppDir = dirFor(victim.team);
    if (curr && curr.team === victim.team && curr !== victim) return true;
    if (!curr && ball.vel.x * oppDir > 2.2) {
      const px = ball.pos.x + ball.vel.x * 0.25;
      const pz = ball.pos.z + ball.vel.z * 0.25;
      let bestMate = 1e9, bestOpp = 1e9;
      for (const m of squads[victim.team].out) {
        if (!isActive(m)) continue;
        bestMate = Math.min(bestMate, Math.hypot(m.pos.x - px, m.pos.z - pz));
      }
      for (const o of squads[fouler.team].all) {
        if (!isActive(o)) continue;
        bestOpp = Math.min(bestOpp, Math.hypot(o.pos.x - px, o.pos.z - pz));
      }
      if (bestMate < 5.0 && bestMate + 0.5 < bestOpp) return true;
    }
    return false;
  }

  function evaluateSession(session) {
    if (session.resolved) return false;
    const thresh = session.isSlide ? FOUL_IMPULSE_SLIDE : FOUL_IMPULSE_STAND;

    if (!session.playerHit || !session.victim) {
      session.resolved = true;
      return false;
    }

    // Excessive force foul even if the tackler touched the ball first
    if (session.ballTouchedFirst && session.maxImpulse < RECKLESS_BALL_FIRST) {
      // Clean ball-winning challenge within physical limits
      session.resolved = true;
      return false;
    }

    if (session.maxImpulse >= thresh || (session.ballTouchedFirst && session.maxImpulse >= RECKLESS_BALL_FIRST)) {
      session.resolved = true;
      const foulOpts = {
        impulse: session.maxImpulse,
        isSlide: session.isSlide,
        fromBehind: session.fromBehind,
        ballFirst: session.ballTouchedFirst,
        cx: session.cx,
        cz: session.cz,
      };
      if (hasAdvantage(session.tackler, session.victim, foulOpts)) {
        const card = planCard(session.tackler, foulOpts.impulse, foulOpts.isSlide, foulOpts.fromBehind, session.victim);
        pendingAdv = {
          fouler: session.tackler,
          victim: session.victim,
          foulOpts,
          card,
          t: 0,
          startX: ball.pos.x,
          oppDir: dirFor(session.victim.team),
        };
        if (referee) {
          focusPos.set(ball.pos.x, 0, ball.pos.z);
          callT = 0.55;
        }
        emit('advantage', { team: session.victim.team, card });
        return true;
      }
      issueFoul(session.tackler, session.victim, foulOpts);
      return true;
    }

    return false;
  }

  function resolveSoftBodySeparation() {
    if (state.phase !== 'play') return;
    const all = [];
    for (const s of ['home', 'away']) {
      for (const p of squads[s].out) {
        if (isActive(p)) all.push(p);
      }
    }
    const currCtrl = getController();
    const shieldBonus = state.shieldingActive ? 0.14 : 0;
    const skillSt = getSkillState ? getSkillState() : null;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (skillSt && skillSt.type === 'roulette' && skillSt.wrapOpp &&
          ((a === skillSt.player && b === skillSt.wrapOpp) || (b === skillSt.player && a === skillSt.wrapOpp))) {
          continue;
        }
        const aIsCtrl = currCtrl && a === currCtrl && b.team !== a.team;
        const bIsCtrl = currCtrl && b === currCtrl && a.team !== b.team;
        const minSep = (aIsCtrl || bIsCtrl) ? (0.84 + shieldBonus) : 0.76;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minSep * minSep || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const pen = (minSep - d) * 0.45;
        const nx = dx / d, nz = dz / d;
        const aShare = bIsCtrl ? 0.72 : (aIsCtrl ? 0.28 : 0.50);
        const bShare = 1 - aShare;
        a.pos.x = clamp(a.pos.x - nx * pen * aShare * 2, -HALF_X + 0.4, HALF_X - 0.4);
        a.pos.z = clamp(a.pos.z - nz * pen * aShare * 2, -HALF_Z + 0.4, HALF_Z - 0.4);
        b.pos.x = clamp(b.pos.x + nx * pen * bShare * 2, -HALF_X + 0.4, HALF_X - 0.4);
        b.pos.z = clamp(b.pos.z + nz * pen * bShare * 2, -HALF_Z + 0.4, HALF_Z - 0.4);
      }
    }
    // Keep outfielders clear of any goalkeeper holding the ball in hands
    for (const s of ['home', 'away']) {
      const gk = squads[s].gk;
      if (!gk || !gk.holdingBall) continue;
      const gkMin = 1.85;
      const gkMinSq = gkMin * gkMin;
      for (let i = 0; i < all.length; i++) {
        const p = all[i];
        const dx = p.pos.x - gk.pos.x;
        const dz = p.pos.z - gk.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= gkMinSq || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (gkMin - d) * 0.85;
        p.pos.x = clamp(p.pos.x + (dx / d) * push, -HALF_X + 0.4, HALF_X - 0.4);
        p.pos.z = clamp(p.pos.z + (dz / d) * push, -HALF_Z + 0.4, HALF_Z - 0.4);
      }
    }
  }

  function updateMovement(dt) {
    if (!referee) return;
    if (callT > 0) {
      callT = Math.max(0, callT - dt);
      referee.stop();
      referee.face(focusPos);
      return;
    }

    // Diagonal system of control: track play at optimal 8..15m viewing lane
    const sideOffset = ball.pos.z > 4 ? -9.5 : 9.5;
    const leadX = clamp(ball.pos.x * 0.84 + ball.vel.x * 0.25, -HALF_X + 6, HALF_X - 6);
    const leadZ = clamp(ball.pos.z * 0.62 + sideOffset, -HALF_Z + 3, HALF_Z - 3);
    refTgt.set(leadX, 0, leadZ);

    const d = Math.hypot(referee.pos.x - refTgt.x, referee.pos.z - refTgt.z);
    if (d > 2.2) {
      referee.moveTo(refTgt, clamp(d / 11, 0.35, 0.92));
    } else {
      referee.stop();
    }
    referee.face(ball.pos);
  }

  function beginTackle(tackler, opts = {}) {
    if (!isActive(tackler)) return null;
    // Prevent duplicate concurrent session for same tackler
    for (const s of activeTackles) {
      if (s.tackler === tackler && !s.resolved) return s;
    }
    const isSlide = !!opts.isSlide;
    const session = {
      tackler,
      isSlide,
      reach: opts.reach || (isSlide ? 1.85 : 1.48),
      t: 0,
      dur: opts.dur || (isSlide ? 0.36 : 0.24),
      lx: opts.lx != null ? opts.lx : Math.cos(tackler.facing),
      lz: opts.lz != null ? opts.lz : Math.sin(tackler.facing),
      kickMin: opts.kickMin || (isSlide ? 3.2 : 2.2),
      kickRange: opts.kickRange || (isSlide ? 2.6 : 1.8),
      ballHit: false,
      ballTouchedFirst: false,
      ballImpulse: 0,
      playerHit: false,
      maxImpulse: 0,
      victim: null,
      fromBehind: false,
      cx: tackler.pos.x,
      cz: tackler.pos.z,
      resolved: false,
    };
    activeTackles.push(session);
    // Run immediate initial contact frame right away
    stepSession(session);
    return session;
  }

  function stepSession(session) {
    if (session.resolved || state.phase !== 'play') return false;
    const tackler = session.tackler;
    if (!isActive(tackler)) { session.resolved = true; return false; }

    // 1. Check ball-tackler collision
    if (!session.ballHit) {
      applyBallCollision(tackler, session);
    }

    // 2. Check tackler-opponent player collisions (tight real body envelope)
    const oppSide = other(tackler.team);
    const bodyEnv = (tackler.bodyRadius || 0.41) + 0.41 + (session.isSlide ? 0.14 : 0.05);
    for (const o of squads[oppSide].all) {
      if (!isActive(o)) continue;
      const isHoldGk = o.role === 'GK' && o.holdingBall;
      const env = isHoldGk ? bodyEnv + 0.25 : bodyEnv;
      if (pdist(tackler, o) <= env) {
        if (isHoldGk) {
          const dx = o.pos.x - tackler.pos.x;
          const dz = o.pos.z - tackler.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          tackler.pushVel(-(dx / d) * 2.4, -(dz / d) * 2.4);
          session.resolved = true;
          issueFoul(tackler, o, {
            impulse: Math.max(265, session.isSlide ? 330 : 270),
            isSlide: session.isSlide,
            fromBehind: false,
            ballFirst: false,
            cx: o.pos.x,
            cz: o.pos.z,
          });
          return true;
        }
        const impulse = applyPhysicalCollision(tackler, o, session.isSlide, session);
        if (impulse <= 0) continue;
        const thresh = session.isSlide ? FOUL_IMPULSE_SLIDE : FOUL_IMPULSE_STAND;
        // Immediate whistle if foul threshold exceeded without clean ball first, or reckless follow-through
        if ((!session.ballTouchedFirst && impulse >= thresh) || impulse >= RECKLESS_BALL_FIRST) {
          if (evaluateSession(session)) return true;
        }
      }
    }
    return false;
  }

  function update(dt) {
    if (state.phase === 'play') {
      if (pendingAdv) {
        pendingAdv.t += dt;
        const curr = getController();
        const gain = (ball.pos.x - pendingAdv.startX) * pendingAdv.oppDir;
        if (curr && curr.team === pendingAdv.fouler.team) {
          const adv = pendingAdv;
          pendingAdv = null;
          issueFoul(adv.fouler, adv.victim, adv.foulOpts);
          return;
        }
        if ((curr && curr.team === pendingAdv.victim.team && gain > 6.5) || gain > 8.5 || pendingAdv.t >= 2.2) {
          const adv = pendingAdv;
          pendingAdv = null;
          if (adv.card === 'yellow') {
            adv.fouler.yellowCards++;
            state.stats[adv.fouler.team].yellows++;
            state.stats[adv.fouler.team].fouls++;
            emit('card', {
              card: 'yellow',
              team: adv.fouler.team,
              player: { number: adv.fouler.number, name: adv.fouler.name },
              impulse: Math.round(adv.foulOpts.impulse || 0),
            });
          }
          emit('advantage_won', { team: adv.victim.team });
        }
      }

      for (let i = activeTackles.length - 1; i >= 0; i--) {
        const s = activeTackles[i];
        s.t += dt;
        const called = stepSession(s);
        if (called || s.resolved || s.t >= s.dur || state.phase !== 'play') {
          if (!s.resolved && state.phase === 'play') evaluateSession(s);
          activeTackles.splice(i, 1);
        }
      }
      resolveSoftBodySeparation();
    } else {
      activeTackles.length = 0;
      pendingAdv = null;
    }

    updateMovement(dt);
  }

  function reset() {
    activeTackles.length = 0;
    pendingAdv = null;
    callT = 0;
    focusPos.set(0, 0, 0);
    if (referee) {
      referee.pos.set(-2.5, 0, -7);
      referee.vel.set(0, 0, 0);
      referee.stop();
      referee.face(ball.pos);
    }
  }

  return {
    beginTackle,
    update,
    reset,
    clearAdvantage: () => { pendingAdv = null; },
    getActiveTackleCount: () => activeTackles.length,
  };
}
