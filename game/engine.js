/*
 * Sugar Glider rescue — deterministic, offline demo engine (1.7: five stages, hero levels).
 * Every number in CONFIG, UNITS and ENEMIES is an EDITABLE SAMPLE.
 * Star cookies are entry energy; flux belongs only to the current battle.
 * No purchases, wallet, NFT, network, or real-money economy are implemented.
 *
 * Browser: window.Sideview; Node: require('./engine.js').
 * new EnergyBank({value: 30, anchor: Date.now()}, () => Date.now())
 *   .refresh() -> current value; .spend(n)/.add(n) -> boolean/amount added;
 *   .snapshot() -> {value, anchor}; time injection permits repeatable tests.
 * new Battle(bank, progress={coins:0,rescued:false})
 *   .setMode('manual'|'auto'), .start(), .replay(), .pause(), .summon(index)
 *   return a boolean. Start is ready-only. Replay is terminal-only, and a won
 *   run must claim its reward first. Each accepted run costs entry energy once.
 *   .update(seconds) consumes finite frame deltas up to maxFrameDt using an
 *   accumulated fixedStep; it never advances a paused/terminal/ready battle.
 *   Destroying the enemy base enters 'advancing' for a deterministic pickup.
 *   baseDeployment (0..1) visually unfolds the parked vehicle in deployDuration.
 *   SideviewVictory plans celebration, folding, real survivor/friend runs,
 *   boarding, and a departure only after every actor is aboard. Departure lasts
 *   victoryTravelDuration; victoryDuration includes the complete pickup too.
 *   victoryActors/victorySnapshot expose that trip; combat statistics freeze.
 *   .pause() resumes the exact running/advancing phase that it interrupted.
 *   .setRoster(indices) selects a nonempty, unique list of UNITS indices only
 *   in ready/won/lost; selectedRoster defaults to all and survives replay.
 *   Manual and Auto summon only members of that roster, at unchanged costs.
 *   Units expose range/attackRange, stopDistance, targetId/targetX, movement and
 *   attackLock. Feet move at the real speed, re-form behind shorter-reach friends,
 *   and stay still for the full attack/heal release. Unscreened rear units have
 *   a bounded 90-world backstep per opponent; front fighters hold contact.
 *   .prepareReplay() returns a lost/claimed-won battle to ready for team edits,
 *   without spending entry energy or incrementing runId. Start charges later.
 *   .claimReward() returns {coins,cookies,friend} once per win, otherwise false.
 *   Guard formation/blocking, ranger projectiles, and type multipliers below
 *   are EDITABLE SAMPLE combat rules, independent of character collection.
 *   projectiles contains real in-flight shots; events is a bounded, seq-keyed
 *   combat history. Event unit is a detached snapshot: attacker for attack /
 *   projectile-launch / heal, victim for hit / block / defeat / impact.
 *   Event unitId/sourceId/targetId refer to unique live-entity ids; the unit's
 *   own unitId remains its character id (e.g. sugar-01). Events include time.
 *   Preview cannon MVP: baseCannons exposes the two stationary, symmetric
 *   defenders. They fire only at the nearest living opposing unit in range
 *   from the base center, without resources or a required teammate. Real
 *   projectiles use neutral damage and the existing guard block. Cannons never
 *   target bases. baseShots/baseHits/baseDamage metrics (and ally/enemy variants)
 *   are separate from ranger counters; baseDamage means damage to enemy units.
 * Renderer reads public state; mutating battle fields is unsupported.
 * Units use world x coordinates and a shared foot line controlled by the UI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./victory-sequence.js'));
  else root.Sideview = factory(root.SideviewVictory);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Victory) {
  'use strict';

  // All values below are demonstration balance, not a proposed live economy.
  const CONFIG = {
    width: 1200, homeX: 80, enemyX: 1120,
    victoryTravelDuration: 3.2, victoryVehicleTarget: 1360,
    deployDuration: 0.55, victoryFoldDuration: 0.55,
    victoryCelebrateDuration: 0.6, victoryRunSpeed: 320, victoryVehicleSpeed: 700,
    victoryBoardDuration: 0.32, victoryBoardGap: 0.04, victoryReadyDuration: 0.18,
    victoryDoorOffset: 20,
    homeHP: 360, enemyHP: 500, duration: 75,
    entryCost: 3, energyMax: 30, refillMs: 5 * 60 * 1000,
    fluxInitial: 40, fluxMax: 100, fluxRegen: 9,
    maxAllies: 12, maxEnemies: 14,
    fixedStep: 1 / 60, maxFrameDt: 0.5,
    enemyFirstSpawn: 2, enemySpawnInterval: 5,
    enemyInitialHP: 72, enemyHPGrowth: 5,
    enemyDamage: 12, enemyDamageGrowth: 0.7,
    enemySpeed: 40, enemyRange: 60, enemyAttackInterval: 1.2,
    autoCadence: 0.65,
    rewardCoins: 30, rewardCookies: 1,
    effectDuration: 0.32, attackFlashDuration: 0.18,
    // Legacy public spacing/aggro values are retained for old tools. Actual
    // formation uses stopDistance differences and the nearest front opponent.
    guardDamageMultiplier: 0.65, guardFormationGap: 28, guardAggroRadius: 135,
    guardBlockFlashDuration: 0.24, hitFlashDuration: 0.18,
    // Editable real movement samples, in the same 1200-wide world as sprites.
    // Range is maximum attack reach; stopDistance is the desired minimum gap.
    // Retreat has an 18/4 hysteresis band and cannot leave the two spawn edges.
    attackLockDuration: 0.38,
    retreatEnterDistance: 18, retreatExitDistance: 4, spawnInset: 25,
    retreatLimitWithoutScreen: 90,
    rangerProjectileSpeed: 420, rangerMuzzleOffset: 30, rangerMuzzleY: 382,
    // PREVIEW ONLY, editable equal samples for BOTH stationary base cannons.
    // Range is measured from the real base center, not from its muzzle.
    baseCannonRange: 360, baseCannonInterval: 4, baseCannonDamage: 12,
    // 1.8: production upgrade (paid in flux, resets every battle) and the player's base blast button.
    fluxLevelMax: 5, fluxUpgradeCosts: [20, 30, 40, 50], fluxRegenStep: 0.3, fluxCapStep: 20,
    blastChargeTime: 22, blastDamage: 65, blastRange: 1200,
    baseCannonProjectileSpeed: 420, baseCannonMuzzleOffset: 120, baseCannonMuzzleY: 180,
    projectileTargetY: 390, eventHistoryLimit: 160,
    typeAdvantageMultiplier: 1.20, typeDisadvantageMultiplier: 0.85,
    timeoutEnemyWins: true
  };

  // Original sample names/values. Combat type is separate from role (kind).
  const TYPES = [
    {id: 'stone', name: 'หินอุ่น', beats: 'star'},
    {id: 'star', name: 'แสงดาว', beats: 'wind'},
    {id: 'wind', name: 'สายลม', beats: 'stone'}
  ];
  function typeMultiplier(attackerType, targetType) {
    const attacker = TYPES.find(type => type.id === attackerType);
    const target = TYPES.find(type => type.id === targetType);
    if (!attacker || !target || attacker.id === target.id) return 1;
    if (attacker.beats === target.id) return CONFIG.typeAdvantageMultiplier;
    if (target.beats === attacker.id) return CONFIG.typeDisadvantageMultiplier;
    return 1;
  }

  // The same five classes exist on both sides. Legacy kind values remain
  // compatible with the renderer; classId is the public gameplay taxonomy.
  const CLASSES = [
    {classId: 'guard', classTag: 'Guard', className: 'รับ', kind: 'guard'},
    {classId: 'agile', classTag: 'Agile', className: 'ว่องไว', kind: 'scout'},
    {classId: 'ranged', classTag: 'Ranged', className: 'ยิงไกล', kind: 'ranger'},
    {classId: 'helper', classTag: 'Helper', className: 'ช่วยเหลือ', kind: 'healer'},
    {classId: 'mage', classTag: 'Mage', className: 'เวท', kind: 'burst'}
  ];

  // Names are provisional Thai role names, independent from the source art.
  const UNITS = [
    {id: 'sugar-01', name: 'ฟองสบู่', role: 'รับ', kind: 'guard', type: 'stone',
      asset: 'heroes-v2/hero-guard-fongsabo.png', filename: 'heroes-v2/hero-guard-fongsabo.png', cost: 15,
      hp: 160, damage: 14, interval: 1.1, speed: 38, range: 62, stopDistance: 60,
      cooldown: 5, style: 'slash', color: '#ffb56b'},
    {id: 'sugar-02', name: 'สายลม', role: 'ว่องไว', kind: 'scout', type: 'wind',
      asset: 'heroes-v2/hero-agile-sailom.png', filename: 'heroes-v2/hero-agile-sailom.png', cost: 20,
      // The existing dash attack has editable 160-world reach, not a new skill.
      hp: 100, damage: 10, interval: 0.7, speed: 51, range: 160, stopDistance: 150,
      cooldown: 6, style: 'dash', color: '#74dce2'},
    {id: 'sugar-05', name: 'เมล็ดดาว', role: 'ยิงไกล', kind: 'ranger', type: 'star',
      asset: 'heroes-v2/hero-ranged-maletdao.png', filename: 'heroes-v2/hero-ranged-maletdao.png', cost: 25,
      hp: 85, damage: 18, interval: 1.3, speed: 35, range: 320, stopDistance: 310,
      cooldown: 7, style: 'bolt', color: '#ffc86c'},
    {id: 'sugar-07', name: 'ปุยปั้น', role: 'ช่วยเหลือ', kind: 'healer', type: 'stone',
      asset: 'heroes-v2/hero-helper-puipan.png', filename: 'heroes-v2/hero-helper-puipan.png', cost: 20,
      hp: 90, damage: 7, interval: 1.3, speed: 36, range: 220, stopDistance: 210,
      cooldown: 8, style: 'heal', color: '#9ae3ad',
      heal: 12, healInterval: 1.6, healRange: 210},
    {id: 'sugar-08', name: 'ลูกโอ๊ก', role: 'เวท', kind: 'burst', type: 'star',
      asset: 'heroes-v2/hero-mage-lukoak.png', filename: 'heroes-v2/hero-mage-lukoak.png', cost: 30,
      hp: 120, damage: 22, interval: 1.7, speed: 34, range: 250, stopDistance: 240,
      cooldown: 10, style: 'burst', color: '#c7a4f5', splash: 85}
  ];
  UNITS.forEach((unit, index) => Object.assign(unit, CLASSES[index]));

  // Sample enemy balance: wave base HP/damage still escalate via CONFIG.
  // Role behavior is shared with heroes; no new skills or required team roles.
  const ENEMIES = [
    {id: 'enemy-guard', name: 'ศัตรูรับ', hpFactor: 1.15, damageFactor: 0.85,
      speed: 30, range: 60, stopDistance: 60, interval: 1.4, style: 'slash'},
    {id: 'enemy-agile', name: 'ศัตรูว่องไว', hpFactor: 0.75, damageFactor: 0.75,
      speed: 54, range: 160, stopDistance: 150, interval: 0.85, style: 'dash'},
    {id: 'enemy-ranged', name: 'ศัตรูยิงไกล', hpFactor: 0.8, damageFactor: 0.8,
      speed: 34, range: 320, stopDistance: 310, interval: 1.5, style: 'bolt'},
    {id: 'enemy-helper', name: 'ศัตรูช่วยเหลือ', hpFactor: 0.85, damageFactor: 0.45,
      speed: 35, range: 220, stopDistance: 210, interval: 1.5, style: 'heal',
      heal: 8, healInterval: 2.4, healRange: 210},
    {id: 'enemy-mage', name: 'ศัตรูเวท', hpFactor: 0.9, damageFactor: 0.9,
      speed: 34, range: 250, stopDistance: 240, interval: 1.8, style: 'burst', splash: 85}
  ];
  ENEMIES.forEach((unit, index) => Object.assign(unit, CLASSES[index], {
    role: CLASSES[index].className,
    asset: 'enemies-v2/' + unit.id + '.png', filename: 'enemies-v2/' + unit.id + '.png'
  }));

  // 1.7 stage ladder. Stage 1 keeps the exact 1.6.6 values so the released
  // single stage plays the same. Every number is an EDITABLE SAMPLE.
  const STAGES = [
    {id: 'stage-01', number: 1, name: 'ทุ่งสายลม', grade: 'day',
      enemyHP: 500, duration: 75, spawnInterval: 5, hpMul: 1, damageMul: 1, rewardCoins: 30},
    {id: 'stage-02', number: 2, name: 'ลำธารแสงแดด', grade: 'golden',
      enemyHP: 600, duration: 85, spawnInterval: 4.8, hpMul: 1.08, damageMul: 1.06, rewardCoins: 45},
    {id: 'stage-03', number: 3, name: 'สะพานหินยามเย็น', grade: 'sunset',
      enemyHP: 700, duration: 95, spawnInterval: 4.6, hpMul: 1.16, damageMul: 1.12, rewardCoins: 60},
    {id: 'stage-04', number: 4, name: 'ป่าเห็ดสนธยา', grade: 'dusk',
      enemyHP: 800, duration: 105, spawnInterval: 4.4, hpMul: 1.24, damageMul: 1.18, rewardCoins: 75},
    {id: 'stage-05', number: 5, name: 'หอ Mushroom ใต้แสงดาว', grade: 'night',
      enemyHP: 900, duration: 115, spawnInterval: 4.2, hpMul: 1.32, damageMul: 1.24, rewardCoins: 90,
      boss: {at: 60, baseRatio: 0.6, name: 'ราชาเห็ดยักษ์', hpMul: 4, damageMul: 2, scale: 1.6, speedMul: 0.7}}
  ];
  // Hero level sample: +10% HP, damage and heal per level above 1.
  const LEVELS = {max: 10, step: 0.1, costBase: 20};
  const levelMultiplier = level => 1 + LEVELS.step * (clamp(Math.floor(level) || 1, 1, LEVELS.max) - 1);
  const levelCost = level => LEVELS.costBase * level;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const isAmount = n => Number.isFinite(n) && n >= 0;

  class EnergyBank {
    constructor(saved, now) {
      this._now = typeof now === 'function' ? now : () => Date.now();
      const current = this._now();
      const source = typeof saved === 'number' ? {value: saved} : (saved || {});
      this.value = Number.isFinite(source.value)
        ? clamp(Math.floor(source.value), 0, CONFIG.energyMax) : CONFIG.energyMax;
      this.anchor = Number.isFinite(source.anchor) ? Math.min(source.anchor, current) : current;
      this.refresh();
    }

    refresh() {
      const now = this._now();
      if (!Number.isFinite(now)) return this.value;
      if (now < this.anchor) this.anchor = now;
      if (this.value >= CONFIG.energyMax) {
        this.value = CONFIG.energyMax;
        this.anchor = now;
        return this.value;
      }
      const steps = Math.floor((now - this.anchor) / CONFIG.refillMs);
      if (steps > 0) {
        this.value = Math.min(CONFIG.energyMax, this.value + steps);
        this.anchor = this.value === CONFIG.energyMax ? now : this.anchor + steps * CONFIG.refillMs;
      }
      return this.value;
    }

    spend(amount) {
      if (!isAmount(amount) || !Number.isInteger(amount)) return false;
      this.refresh();
      if (this.value < amount) return false;
      this.value -= amount;
      return true;
    }

    add(amount) {
      if (!isAmount(amount) || !Number.isInteger(amount)) return 0;
      this.refresh();
      const before = this.value;
      this.value = Math.min(CONFIG.energyMax, this.value + amount);
      if (this.value === CONFIG.energyMax) this.anchor = this._now();
      return this.value - before;
    }

    snapshot() {
      this.refresh();
      return {value: this.value, anchor: this.anchor};
    }
  }

  class Battle {
    constructor(bank, progress) {
      this.bank = bank || new EnergyBank();
      this.progress = progress || {coins: 0, rescued: false};
      if (!Number.isFinite(this.progress.coins)) this.progress.coins = 0;
      this.progress.rescued = Boolean(this.progress.rescued);
      this.mode = 'manual';
      this.state = 'ready';
      this.selectedRoster = UNITS.map((unit, index) => index);
      this.runId = 0;
      this.lastError = '';
      this.stageIndex = 0;
      this.levels = UNITS.map(() => 1);
      this._resetFields();
    }

    get stage() { return STAGES[this.stageIndex] || STAGES[0]; }

    setStage(index) {
      if (this.state !== 'ready' && this.state !== 'won' && this.state !== 'lost') return false;
      if (!Number.isInteger(index) || !STAGES[index]) return false;
      this.stageIndex = index;
      if (this.state === 'ready') this._resetFields();
      return true;
    }

    setLevels(levels) {
      if (!Array.isArray(levels) || levels.length !== UNITS.length) return false;
      this.levels = levels.map(level => clamp(Math.floor(level) || 1, 1, LEVELS.max));
      return true;
    }

    _resetFields() {
      this.time = 0;
      this.remaining = this.stage.duration;
      this.flux = CONFIG.fluxInitial;
      this.fluxLevel = 1;
      this.blastCharge = 0;
      this.bossSpawned = false;
      this.homeHP = CONFIG.homeHP;
      this.enemyHP = this.stage.enemyHP;
      this.enemyMaxHP = this.stage.enemyHP;
      this.vehicleX = CONFIG.homeX;
      this.travelProgress = 0;
      this.baseDeployment = 0;
      this.victoryPhase = null;
      this.victoryActors = [];
      this.victorySnapshot = null;
      this.victoryDuration = 0;
      this._victoryPlan = null;
      this.allies = [];
      this.enemies = [];
      this.effects = [];
      this.projectiles = [];
      this.baseCannons = ['ally', 'enemy'].map((side, index) => ({
        id: side + '-base-cannon', unitId: side + '-base-cannon', index: -1,
        kind: 'base-cannon', classId: 'base-cannon', faction: side,
        facing: index === 0 ? 1 : -1, type: null,
        x: index === 0 ? CONFIG.homeX : CONFIG.enemyX,
        hp: index === 0 ? this.homeHP : this.enemyHP,
        maxHP: index === 0 ? CONFIG.homeHP : this.enemyMaxHP,
        range: CONFIG.baseCannonRange, damage: CONFIG.baseCannonDamage,
        muzzleX: (index === 0 ? CONFIG.homeX : CONFIG.enemyX) +
          (index === 0 ? 1 : -1) * CONFIG.baseCannonMuzzleOffset,
        muzzleY: CONFIG.baseCannonMuzzleY,
        cooldown: 0, attackFlash: 0, targetId: null, targetX: null
      }));
      this.events = [];
      this.cooldowns = UNITS.map(() => 0);
      this.kills = 0;
      this.claimed = false;
      this.reward = null;
      this.reason = '';
      this.metrics = {energySpent: 0, summons: 0, fluxSpent: 0,
        summonsByUnit: UNITS.map(() => 0),
        rewardsClaimed: 0, totalDamage: 0, healed: 0, spawnedEnemies: 0,
        blockedDamage: 0, projectilesFired: 0, projectileHits: 0,
        fluxUpgrades: 0, blasts: 0, blastKills: 0, bossDefeated: false};
      this.metrics.baseShots = 0;
      this.metrics.baseHits = 0;
      this.metrics.baseDamage = 0;
      for (const side of ['ally', 'enemy']) {
        this.metrics[side + 'BlockedDamage'] = 0;
        this.metrics[side + 'Healed'] = 0;
        this.metrics[side + 'ProjectilesFired'] = 0;
        this.metrics[side + 'ProjectileHits'] = 0;
        this.metrics[side + 'BaseShots'] = 0;
        this.metrics[side + 'BaseHits'] = 0;
        this.metrics[side + 'BaseDamage'] = 0;
      }
      this._accumulator = 0;
      this._tick = 0;
      this._serial = 0;
      this._nextEnemy = CONFIG.enemyFirstSpawn;
      this._nextAuto = 0;
      this._autoIndex = 0;
      this._travelTick = 0;
      this._resumeState = 'running';
      this._eventSerial = 0;
      this._projectileSerial = 0;
    }

    setMode(mode) {
      if (mode !== 'manual' && mode !== 'auto') return false;
      this.mode = mode;
      this.lastError = '';
      return true;
    }

    setRoster(indices) {
      if (this.state !== 'ready' && this.state !== 'won' && this.state !== 'lost') return false;
      if (!Array.isArray(indices) || indices.length === 0 ||
          Array.from(indices).some(index => !Number.isInteger(index) || !UNITS[index]) ||
          new Set(indices).size !== indices.length) return false;
      this.selectedRoster = indices.slice();
      this._autoIndex = 0;
      return true;
    }

    _begin() {
      if (!this.bank.spend(CONFIG.entryCost)) {
        this.lastError = 'คุกกี้ดาวไม่พอ';
        return false;
      }
      this.runId += 1;
      this._resetFields();
      this.metrics.energySpent = CONFIG.entryCost;
      this.state = 'running';
      this.lastError = '';
      return true;
    }

    start() {
      if (this.state !== 'ready') return false;
      return this._begin();
    }

    replay() {
      if (this.state !== 'won' && this.state !== 'lost') return false;
      if (this.state === 'won' && !this.claimed) {
        this.lastError = 'รับรางวัลก่อนเริ่มรอบใหม่';
        return false;
      }
      return this._begin();
    }

    prepareReplay() {
      if (this.state !== 'lost' && !(this.state === 'won' && this.claimed)) return false;
      this._resetFields();
      this.state = 'ready';
      this.lastError = '';
      return true;
    }

    pause() {
      if (this.state === 'running' || this.state === 'advancing') {
        this._resumeState = this.state;
        this.state = 'paused';
      } else if (this.state === 'paused') this.state = this._resumeState;
      else return false;
      return true;
    }

    get fluxCap() { return CONFIG.fluxMax + CONFIG.fluxCapStep * (this.fluxLevel - 1); }
    get fluxRate() { return CONFIG.fluxRegen * (1 + CONFIG.fluxRegenStep * (this.fluxLevel - 1)); }
    get fluxUpgradeCost() {
      return this.fluxLevel >= CONFIG.fluxLevelMax ? null : CONFIG.fluxUpgradeCosts[this.fluxLevel - 1];
    }
    get blastReady() { return this.blastCharge + 1e-9 >= CONFIG.blastChargeTime; }

    upgradeFlux() {
      const cost = this.fluxUpgradeCost;
      if (this.state !== 'running' || cost === null || this.flux + 1e-9 < cost) return false;
      this.flux = Math.max(0, this.flux - cost);
      this.fluxLevel += 1;
      this.metrics.fluxUpgrades += 1;
      this._event('flux-upgrade', null, {level: this.fluxLevel, cost});
      return true;
    }

    // Player-fired base cannon: neutral damage to every enemy near the camper van. Dead enemies leave at once,
    // because _step only counts kills among the enemies alive when the tick began.
    fireBlast() {
      if (this.state !== 'running' || !this.blastReady) return false;
      this.blastCharge = 0;
      this.metrics.blasts += 1;
      const source = this.baseCannons[0];
      const targets = this.enemies.filter(enemy => enemy.hp > 0 &&
        enemy.x - CONFIG.homeX <= CONFIG.blastRange + 1e-9);
      this._event('base-blast', source, {sourceId: source.id, x: CONFIG.homeX,
        range: CONFIG.blastRange, targets: targets.map(enemy => enemy.id)});
      for (const enemy of targets) {
        this._applyUnitDamage(enemy, CONFIG.blastDamage * (enemy.boss ? 0.5 : 1), source.id, null, 'blast');
      }
      const killed = targets.filter(enemy => enemy.hp <= 0);
      this.kills += killed.length;
      this.metrics.blastKills += killed.length;
      if (killed.some(enemy => enemy.boss)) this.metrics.bossDefeated = true;
      this.enemies = this.enemies.filter(enemy => enemy.hp > 0);
      return true;
    }

    summon(index) {
      if (this.state !== 'running' || !Number.isInteger(index) || !UNITS[index] ||
          !this.selectedRoster.includes(index)) return false;
      const spec = UNITS[index], power = levelMultiplier(this.levels[index]);
      if (this.allies.length >= CONFIG.maxAllies || this.cooldowns[index] > 1e-9 ||
          this.flux + 1e-9 < spec.cost) return false;
      // All guards precede this single mutation: repeated clicks cannot double spend.
      this.flux = Math.max(0, this.flux - spec.cost);
      this.cooldowns[index] = spec.cooldown;
      this.metrics.summons += 1;
      this.metrics.summonsByUnit[index] += 1;
      this.metrics.fluxSpent += spec.cost;
      this.allies.push({id: spec.id + '-' + this.runId + '-' + (++this._serial),
        unitId: spec.id, index, kind: spec.kind, type: spec.type,
        classId: spec.classId, classTag: spec.classTag, className: spec.className,
        faction: 'ally', name: spec.name, x: CONFIG.homeX + CONFIG.spawnInset,
        hp: spec.hp * power, maxHP: spec.hp * power, damage: spec.damage * power, range: spec.range,
        attackRange: spec.range, stopDistance: spec.stopDistance,
        speed: spec.speed, cooldown: 0.12, healCooldown: 0, power, level: this.levels[index],
        attackLock: 0, movement: 'hold', targetId: null, targetX: null,
        formationAnchorId: null, formationGap: 0,
        retreatRemaining: ['guard', 'scout'].includes(spec.kind) ? 0 : CONFIG.retreatLimitWithoutScreen,
        _retreatSpent: 0,
        attackFlash: 0, blockFlash: 0, hitFlash: 0, blockedDamage: 0,
        facing: 1, asset: spec.asset});
      return true;
    }

    _spawnEnemy(boss) {
      if (!boss && this.enemies.length >= CONFIG.maxEnemies) return;
      const wave = this.metrics.spawnedEnemies;
      const index = boss ? 0 : wave % ENEMIES.length, spec = ENEMIES[index];
      const hp = (CONFIG.enemyInitialHP + wave * CONFIG.enemyHPGrowth) * spec.hpFactor * this.stage.hpMul *
        (boss ? boss.hpMul : 1);
      const enemy = {id: spec.id + '-' + this.runId + '-' + (++this._serial),
        unitId: spec.id, index, kind: spec.kind, type: TYPES[wave % TYPES.length].id,
        classId: spec.classId, classTag: spec.classTag, className: spec.className,
        faction: 'enemy', name: boss ? boss.name : spec.name,
        x: CONFIG.enemyX - CONFIG.spawnInset,
        hp, maxHP: hp, damage: (CONFIG.enemyDamage + wave * CONFIG.enemyDamageGrowth) * spec.damageFactor *
          this.stage.damageMul * (boss ? boss.damageMul : 1),
        range: spec.range, speed: spec.speed * (boss ? boss.speedMul : 1), cooldown: 0.2, healCooldown: 0,
        attackRange: spec.range, stopDistance: spec.stopDistance,
        attackLock: 0, movement: 'hold', targetId: null, targetX: null,
        formationAnchorId: null, formationGap: 0,
        retreatRemaining: ['guard', 'scout'].includes(spec.kind) ? 0 : CONFIG.retreatLimitWithoutScreen,
        _retreatSpent: 0,
        attackFlash: 0, blockFlash: 0, hitFlash: 0, blockedDamage: 0,
        facing: -1, asset: spec.asset};
      if (boss) {
        Object.assign(enemy, {id: 'boss-' + this.runId, boss: true, scale: boss.scale});
        this.enemies.push(enemy);
        this.bossSpawned = true;
        this._event('boss-arrive', enemy, {name: boss.name});
        return;
      }
      this.enemies.push(enemy);
      this.metrics.spawnedEnemies += 1;
    }

    update(dt) {
      if ((this.state !== 'running' && this.state !== 'advancing') || !Number.isFinite(dt) || dt <= 0) return false;
      this._accumulator += Math.min(dt, CONFIG.maxFrameDt);
      while (this._accumulator + 1e-10 >= CONFIG.fixedStep &&
          (this.state === 'running' || this.state === 'advancing')) {
        this._accumulator = Math.max(0, this._accumulator - CONFIG.fixedStep);
        if (this.state === 'advancing') this._advanceVehicle();
        else this._step(CONFIG.fixedStep);
      }
      return true;
    }

    _advanceVehicle() {
      this._travelTick += 1;
      const elapsed = this._travelTick * CONFIG.fixedStep;
      this._sampleVictory(elapsed + 1e-10);
      if (this.victorySnapshot.completed) {
        this.state = 'won';
        this.reason = 'rescue';
      }
    }

    _beginVictory() {
      this.state = 'advancing';
      this.reason = 'rescue';
      this._travelTick = 0;
      // Combat ends exactly here. Only the separate deterministic pickup actors
      // can move afterwards; HP, attacks, flux, clocks and rewards stay frozen.
      for (const unit of this.allies) {
        unit.attackLock = 0; unit.attackFlash = 0; unit.blockFlash = 0; unit.hitFlash = 0;
        unit.movement = 'hold';
      }
      const friend = UNITS[3];
      this._victoryPlan = Victory.plan({...CONFIG, survivors: this.allies.map(unit => ({...unit})),
        rescuedFriend: {id: 'rescued-friend-' + this.runId, unitId: friend.id,
          index: 3, kind: friend.kind, classId: friend.classId, classTag: friend.classTag,
          className: friend.className, faction: 'ally', name: friend.name,
          asset: friend.asset, type: friend.type, x: CONFIG.enemyX - 30,
          hp: friend.hp, maxHP: friend.hp, facing: -1, attackFlash: 0,
          blockFlash: 0, hitFlash: 0, attackLock: 0, movement: 'hold'}});
      this.victoryDuration = Victory.duration(this._victoryPlan);
      this._sampleVictory(0);
    }

    _sampleVictory(elapsed) {
      const snapshot = Victory.sample(elapsed, this._victoryPlan);
      this.victorySnapshot = snapshot;
      this.victoryPhase = snapshot.phase;
      this.victoryActors = snapshot.actors;
      this.vehicleX = snapshot.vehicleX;
      this.baseDeployment = snapshot.baseDeployment;
      this.travelProgress = snapshot.travelProgress;
      const actors = new Map(snapshot.actors.map(actor => [actor.id, actor]));
      for (const unit of this.allies) {
        const actor = actors.get(unit.id);
        if (!actor) continue;
        const difference = actor.x - unit.x;
        unit.x = actor.x;
        unit.facing = actor.facing;
        unit.victoryAction = actor.victoryAction;
        unit.boarded = actor.boarded;
        unit.boardingProgress = actor.boardingProgress;
        unit.rescueProgress = actor.rescueProgress;
        unit.movement = Math.abs(difference) > 1e-9 && !actor.boarded
          ? (difference * actor.facing >= 0 ? 'advance' : 'retreat') : 'hold';
      }
    }

    _effect(kind, source, target, amount) {
      this.effects.push({id: 'effect-' + this.runId + '-' + (++this._serial),
        kind, x: source.x, y: 340, fromX: source.x, toX: target.x,
        targetX: target.x, targetY: 340, amount,
        ttl: CONFIG.effectDuration, maxTTL: CONFIG.effectDuration,
        friendly: source.facing === 1, sourceId: source.id,
        targetId: target.id || (source.facing === 1 ? 'enemy-base' : 'home-base')});
      source.attackFlash = CONFIG.attackFlashDuration;
      source.attackLock = CONFIG.attackLockDuration;
      source.movement = 'hold';
    }

    _event(type, unit, details) {
      const event = {seq: ++this._eventSerial, type, time: this.time,
        unit: unit ? {...unit} : null, unitId: unit ? unit.id : null, ...details};
      this.events.push(event);
      if (this.events.length > CONFIG.eventHistoryLimit) this.events.shift();
      return event;
    }

    _applyUnitDamage(target, rawDamage, sourceId, sourceType, cause, projectileId) {
      if (!target || target.hp <= 0 || rawDamage <= 0) return null;
      const multiplier = typeMultiplier(sourceType, target.type);
      const typedDamage = rawDamage * multiplier;
      const reducedDamage = target.kind === 'guard'
        ? typedDamage * CONFIG.guardDamageMultiplier : typedDamage;
      const blocked = typedDamage - reducedDamage;
      const amount = Math.min(target.hp, reducedDamage);
      target.hp = Math.max(0, target.hp - amount);
      target.hitFlash = CONFIG.hitFlashDuration;
      if (blocked > 0) {
        target.blockFlash = CONFIG.guardBlockFlashDuration;
        target.blockedDamage += blocked;
        this.metrics.blockedDamage += blocked;
        this.metrics[(target.facing === 1 ? 'ally' : 'enemy') + 'BlockedDamage'] += blocked;
        this._event('block', target, {sourceId, targetId: target.id, amount: blocked,
          rawDamage, multiplier, cause, projectileId});
      }
      this._event('hit', target, {sourceId, targetId: target.id, amount,
        rawDamage, multiplier, blocked, cause, projectileId});
      if (target.hp <= 0) this._event('defeat', target,
        {sourceId, targetId: target.id, cause, projectileId});
      return {amount, blocked, multiplier};
    }

    _launchProjectile(source, target) {
      const cannon = source.kind === 'base-cannon';
      if (cannon && target.base) return; // No cannon can ever damage a base.
      const muzzleX = cannon ? source.muzzleX : source.x + source.facing * CONFIG.rangerMuzzleOffset;
      const muzzleY = cannon ? source.muzzleY : CONFIG.rangerMuzzleY;
      const projectile = {id: 'projectile-' + this.runId + '-' + (++this._projectileSerial),
        sourceId: source.id, sourceIndex: source.index, targetId: target.id,
        targetBase: Boolean(target.base), friendly: source.facing === 1,
        attackerType: source.type, type: source.type, damage: source.damage,
        x: muzzleX, fromX: muzzleX, targetX: target.x,
        y: muzzleY, fromY: muzzleY,
        targetY: CONFIG.projectileTargetY, flightProgress: 0,
        speed: cannon ? CONFIG.baseCannonProjectileSpeed : CONFIG.rangerProjectileSpeed, age: 0,
        ...(cannon ? {sourceKind: 'base-cannon'} : {})};
      this.projectiles.push(projectile);
      const side = source.facing === 1 ? 'ally' : 'enemy';
      if (cannon) {
        this.metrics.baseShots += 1;
        this.metrics[side + 'BaseShots'] += 1;
      } else {
        this.metrics.projectilesFired += 1;
        this.metrics[side + 'ProjectilesFired'] += 1;
      }
      this._event('projectile-launch', source, {sourceId: source.id,
        targetId: target.id, projectileId: projectile.id,
        projectile: {...projectile}});
    }

    _stepBaseCannons(dt) {
      for (const cannon of this.baseCannons) {
        cannon.hp = cannon.facing === 1 ? this.homeHP : this.enemyHP;
      }
      if (this.state !== 'running' || this.homeHP <= 0 || this.enemyHP <= 0) return;
      for (const cannon of this.baseCannons) {
        cannon.cooldown = Math.max(0, cannon.cooldown - dt);
        cannon.attackFlash = Math.max(0, cannon.attackFlash - dt);
        const target = this._nearest(cannon, cannon.facing === 1 ? this.enemies : this.allies);
        const inRange = target && Math.abs(target.x - cannon.x) <= cannon.range + 1e-9;
        cannon.targetId = inRange ? target.id : null;
        cannon.targetX = inRange ? target.x : null;
        if (!inRange || cannon.cooldown > 1e-9) continue;
        cannon.cooldown = CONFIG.baseCannonInterval;
        cannon.attackFlash = CONFIG.attackFlashDuration;
        this._event('base-cannon-fire', cannon, {sourceId: cannon.id,
          targetId: target.id, targetX: target.x, range: cannon.range,
          fromX: cannon.muzzleX, fromY: cannon.muzzleY, cause: 'projectile'});
        this._launchProjectile(cannon, target);
      }
    }

    _advanceProjectiles(dt) {
      const flying = [];
      for (const projectile of this.projectiles) {
        const cannon = projectile.sourceKind === 'base-cannon';
        // A base break ends cannon support immediately, including a break caused
        // by an earlier projectile in this very same deterministic substep.
        if (cannon && (this.homeHP <= 0 || this.enemyHP <= 0 || projectile.targetBase)) continue;
        const opponents = projectile.friendly ? this.enemies : this.allies;
        const baseKey = projectile.friendly ? 'enemyHP' : 'homeHP';
        const target = projectile.targetBase
          ? {id: projectile.targetId, unitId: projectile.targetId, kind: 'base',
            type: null, x: projectile.friendly ? CONFIG.enemyX : CONFIG.homeX,
            index: -1, hp: this[baseKey],
            maxHP: projectile.friendly ? this.enemyMaxHP : CONFIG.homeHP,
            attackFlash: 0, blockFlash: 0, hitFlash: 0, facing: projectile.friendly ? -1 : 1}
          : opponents.find(unit => unit.id === projectile.targetId && unit.hp > 0);
        // A projectile keeps its own source/type after firing. It never retargets
        // or makes an impact on an entity already defeated by an earlier hit.
        if (!target || target.hp <= 0) continue;
        projectile.age += dt;
        projectile.targetX = target.x;
        const distance = target.x - projectile.x;
        if (Math.abs(distance) > projectile.speed * dt) {
          projectile.x += Math.sign(distance) * projectile.speed * dt;
          projectile.flightProgress = clamp(Math.abs(projectile.x - projectile.fromX) /
            Math.max(1e-9, Math.abs(target.x - projectile.fromX)), 0, 1);
          projectile.y = projectile.fromY +
            (projectile.targetY - projectile.fromY) * projectile.flightProgress;
          flying.push(projectile);
          continue;
        }
        projectile.x = target.x;
        projectile.y = projectile.targetY;
        projectile.flightProgress = 1;
        let result;
        if (projectile.targetBase) {
          const amount = Math.min(this[baseKey], projectile.damage);
          this[baseKey] = Math.max(0, this[baseKey] - amount);
          target.hp = this[baseKey];
          result = {amount, multiplier: 1, blocked: 0};
        } else result = this._applyUnitDamage(target, projectile.damage,
          projectile.sourceId, projectile.attackerType, 'projectile', projectile.id);
        if (result) {
          const side = projectile.friendly ? 'ally' : 'enemy';
          if (cannon) {
            this.metrics.baseHits += 1;
            this.metrics[side + 'BaseHits'] += 1;
            this.metrics.baseDamage += result.amount;
            this.metrics[side + 'BaseDamage'] += result.amount;
          } else {
            this.metrics.projectileHits += 1;
            this.metrics[side + 'ProjectileHits'] += 1;
          }
          this._event('projectile-impact', target, {sourceId: projectile.sourceId,
            targetId: projectile.targetId, projectileId: projectile.id,
            amount: result.amount, multiplier: result.multiplier,
            blocked: result.blocked, projectile: {...projectile},
            ...(cannon ? {sourceKind: 'base-cannon'} : {})});
        }
      }
      this.projectiles = flying;
    }

    _nearest(unit, candidates) {
      let best = null;
      let distance = Infinity;
      for (const candidate of candidates) {
        if (candidate.hp <= 0) continue;
        const d = Math.abs(candidate.x - unit.x);
        if (d < distance) { best = candidate; distance = d; }
      }
      return best;
    }

    _frontOpponent(candidates, facing) {
      // Both factions attack the first living body in their direction.
      // No class gets to select a protected rear opponent through that body.
      let front = null;
      for (const candidate of candidates) {
        if (candidate.hp > 0 && (!front || candidate.x * facing < front.x * facing)) front = candidate;
      }
      return front;
    }

    _step(dt) {
      this._tick += 1;
      this.time = this._tick * CONFIG.fixedStep;
      this.baseDeployment = Math.min(1, this.time / CONFIG.deployDuration);
      this.remaining = Math.max(0, this.stage.duration - this.time);
      this.flux = Math.min(this.fluxCap, this.flux + this.fluxRate * dt);
      this.blastCharge = Math.min(CONFIG.blastChargeTime, this.blastCharge + dt);
      for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
      this.effects = this.effects.filter(effect => (effect.ttl -= dt) > 0);
      while (this.time + 1e-9 >= this._nextEnemy) {
        this._spawnEnemy();
        this._nextEnemy += this.stage.spawnInterval;
      }
      const boss = this.stage.boss;
      // The boss guards the enemy base: it comes out when the base drops to boss.baseRatio, or at boss.at seconds.
      if (boss && !this.bossSpawned && (this.time + 1e-9 >= boss.at ||
          this.enemyHP <= this.enemyMaxHP * boss.baseRatio)) this._spawnEnemy(boss);
      if (this.mode === 'auto' && this.time + 1e-9 >= this._nextAuto) {
        // Save up for the next role so cheap units cannot starve costly ones.
        // This rotates the selected roster and calls exactly the player's API.
        if (this.summon(this.selectedRoster[this._autoIndex])) {
          this._autoIndex = (this._autoIndex + 1) % this.selectedRoster.length;
        }
        this._nextAuto = this.time + CONFIG.autoCadence;
      }

      // Snapshot living units, compute intents, then apply damage together.
      // This avoids ally/enemy iteration bias. Units killed in this tick are
      // removed before the next tick and never attack, heal, or get targeted then.
      const livingAllies = this.allies.filter(u => u.hp > 0);
      const livingEnemies = this.enemies.filter(u => u.hp > 0);
      const damage = [];
      const healing = [];
      const baseDamage = [];
      const hit = (source, target, amount) => damage.push({source, target, amount});
      const allyGuard = this._nearest({x: CONFIG.enemyX}, livingAllies.filter(unit => unit.kind === 'guard'));
      const enemyGuard = this._nearest({x: CONFIG.homeX}, livingEnemies.filter(unit => unit.kind === 'guard'));
      const positions = new Map([...livingAllies, ...livingEnemies].map(unit => [unit.id, unit.x]));

      const act = (unit, opponents, friendly) => {
        const spec = friendly ? UNITS[unit.index] : ENEMIES[unit.index];
        const teammates = friendly ? livingAllies : livingEnemies;
        const frontGuard = friendly ? allyGuard : enemyGuard;
        unit.cooldown = Math.max(0, unit.cooldown - dt);
        unit.attackFlash = Math.max(0, unit.attackFlash - dt);
        unit.blockFlash = Math.max(0, unit.blockFlash - dt);
        unit.hitFlash = Math.max(0, unit.hitFlash - dt);
        unit.attackLock = Math.max(0, unit.attackLock - dt);
        if (unit.kind === 'healer') {
          unit.healCooldown = Math.max(0, unit.healCooldown - dt);
        }
        const target = this._frontOpponent(opponents, unit.facing) || {id: friendly ? 'enemy-base' : 'home-base',
          x: friendly ? CONFIG.enemyX : CONFIG.homeX, base: true};
        const distance = Math.abs(target.x - unit.x);
        const previousTarget = unit.targetId, previousAnchor = unit.formationAnchorId;
        unit.targetId = target.id;
        unit.targetX = target.x;
        unit.attackRange = unit.range;

        // Re-form behind a shorter-reach teammate, even when it was summoned
        // later. A guard is the first screen; without one, any nearer-reach
        // class can form that screen. This is real movement, never a draw offset.
        let anchor = unit.kind !== 'guard' ? frontGuard : null;
        if (!anchor) {
          for (const teammate of teammates) {
            if (teammate === unit || teammate.stopDistance >= unit.stopDistance) continue;
            if (!anchor || positions.get(teammate.id) * unit.facing > positions.get(anchor.id) * unit.facing) anchor = teammate;
          }
        }
        unit.formationAnchorId = anchor ? anchor.id : null;
        unit.formationGap = anchor ? unit.stopDistance - anchor.stopDistance : 0;
        if (previousTarget !== target.id || (previousAnchor && !anchor)) unit._retreatSpent = 0;
        const unscreenedLimit = ['guard', 'scout'].includes(unit.kind) ? 0 : CONFIG.retreatLimitWithoutScreen;
        unit.retreatRemaining = Math.max(0, unscreenedLimit - unit._retreatSpent);
        let desired = target.x * unit.facing - unit.stopDistance;
        if (anchor) desired = Math.min(desired,
          positions.get(anchor.id) * unit.facing - unit.formationGap);
        const desiredX = clamp(desired * unit.facing,
          CONFIG.homeX + CONFIG.spawnInset, CONFIG.enemyX - CONFIG.spawnInset);
        const difference = (desiredX - unit.x) * unit.facing;
        const wasRetreating = unit.movement === 'retreat';
        unit.movement = 'hold';
        // The animator's complete attack/heal release has the same true lock.
        // A target can change during it, but the source feet cannot move.
        if (unit.attackLock > 1e-9) return;
        // Front fighters hold contact. An unprotected rear class can backstep
        // only 90 sample world units per opponent, rather than kite forever.
        const retreat = difference < -(wasRetreating
          ? CONFIG.retreatExitDistance : CONFIG.retreatEnterDistance) &&
          (anchor || unit.retreatRemaining > 1e-9);
        const advance = distance > unit.range + 1e-9 && difference > 1e-9;
        if (retreat || advance) {
          const step = Math.min(unit.speed * dt, Math.abs(desiredX - unit.x),
            advance ? Math.max(0, distance - unit.range) : Infinity,
            retreat && !anchor ? unit.retreatRemaining : Infinity);
          unit.x = clamp(unit.x + Math.sign(desiredX - unit.x) * step,
            CONFIG.homeX + CONFIG.spawnInset, CONFIG.enemyX - CONFIG.spawnInset);
          if (step > 1e-9) unit.movement = retreat ? 'retreat' : 'advance';
          if (retreat && !anchor) {
            unit._retreatSpent += step;
            unit.retreatRemaining = Math.max(0, unscreenedLimit - unit._retreatSpent);
          }
          return;
        }

        // Heal casts obey the same stationary action lock as attacks.
        if (unit.kind === 'healer' && unit.healCooldown <= 1e-9) {
          const injured = teammates.filter(u => u.hp < u.maxHP && Math.abs(u.x - unit.x) <= spec.healRange)
            .sort((a, b) => a.hp / a.maxHP - b.hp / b.maxHP)[0];
          if (injured) {
            const healAmount = spec.heal * (unit.power || 1);
            healing.push({source: unit, target: injured, amount: healAmount});
            unit.healCooldown = spec.healInterval;
            this._effect('heal', unit, injured, healAmount);
          }
        }
        if (distance > unit.range + 1e-9) return;
        if (unit.cooldown > 1e-9) return;
        unit.cooldown = spec.interval;
        this._effect(spec.style, unit, target, unit.damage);
        this._event('attack', unit, {sourceId: unit.id, targetId: target.id,
          targetKind: target.base ? 'base' : target.kind, targetType: target.type || null,
          fromX: unit.x, targetX: target.x, range: unit.range,
          cause: unit.kind === 'ranger' ? 'projectile' : 'melee'});
        if (unit.kind === 'ranger') this._launchProjectile(unit, target);
        else if (target.base) {
          baseDamage.push({source: unit, target, amount: unit.damage, friendly});
        } else {
          hit(unit, target, unit.damage);
          if (spec.splash) {
            for (const enemy of opponents) {
              if (enemy !== target && Math.abs(enemy.x - target.x) <= spec.splash) hit(unit, enemy, unit.damage * 0.6);
            }
          }
        }
        // Legacy metric: attempted raw attack damage, including queued shots.
        // Renderer damage numbers must use hit/impact event.amount instead.
        if (friendly) this.metrics.totalDamage += unit.damage;
      };
      const formation = livingAllies.slice().sort((a, b) =>
        Number(b.kind === 'guard') - Number(a.kind === 'guard'));
      for (const ally of formation) act(ally, livingEnemies, true);
      const enemyFormation = livingEnemies.slice().sort((a, b) =>
        Number(b.kind === 'guard') - Number(a.kind === 'guard'));
      for (const enemy of enemyFormation) act(enemy, livingAllies, false);
      for (const hit of damage) this._applyUnitDamage(hit.target, hit.amount,
        hit.source.id, hit.source.type, 'melee');
      for (const hit of baseDamage) {
        const key = hit.friendly ? 'enemyHP' : 'homeHP';
        const amount = Math.min(this[key], hit.amount);
        this[key] = Math.max(0, this[key] - amount);
        if (amount > 0) {
          const base = {id: hit.target.id, unitId: hit.target.id, kind: 'base', index: -1,
            type: null, x: hit.target.x, hp: this[key], maxHP: hit.friendly ? this.enemyMaxHP : CONFIG.homeHP,
            facing: hit.friendly ? -1 : 1, attackFlash: 0, blockFlash: 0, hitFlash: CONFIG.hitFlashDuration};
          this._event('base-hit', base, {sourceId: hit.source.id, targetId: base.id,
            amount, rawDamage: hit.amount, multiplier: 1, blocked: 0, cause: 'melee'});
        }
      }
      this._stepBaseCannons(dt);
      this._advanceProjectiles(dt);
      for (const cannon of this.baseCannons) cannon.hp = cannon.facing === 1 ? this.homeHP : this.enemyHP;
      // Lethal damage wins over a heal in the same tick; defeated units stay out.
      for (const {source, target, amount} of healing) {
        if (target.hp <= 0) continue;
        const actual = Math.min(amount, target.maxHP - target.hp);
        target.hp += actual;
        this.metrics.healed += actual;
        this.metrics[(source.facing === 1 ? 'ally' : 'enemy') + 'Healed'] += actual;
        if (actual > 0) {
          this._event('heal', source, {sourceId: source.id,
            targetId: target.id, amount: actual, target: {...target}});
        }
      }
      this.kills += livingEnemies.filter(enemy => enemy.hp <= 0).length;
      if (livingEnemies.some(enemy => enemy.boss && enemy.hp <= 0)) this.metrics.bossDefeated = true;
      this.allies = livingAllies.filter(unit => unit.hp > 0);
      this.enemies = livingEnemies.filter(unit => unit.hp > 0);

      if (this.homeHP <= 0) { this.state = 'lost'; this.reason = 'home'; }
      else if (this.enemyHP <= 0) this._beginVictory();
      else if (this.remaining <= 0) { this.state = 'lost'; this.reason = 'timeout'; }
      if (this.state !== 'running') this.projectiles = [];
    }

    claimReward() {
      if (this.state !== 'won' || this.claimed) return false;
      // Mark first, then mutate balances, so repeated handlers remain idempotent.
      this.claimed = true;
      const reward = {coins: this.stage.rewardCoins, cookies: CONFIG.rewardCookies,
        friend: !this.progress.rescued, stageIndex: this.stageIndex};
      this.bank.add(reward.cookies);
      this.progress.coins += reward.coins;
      this.progress.rescued = true;
      this.metrics.rewardsClaimed += 1;
      this.reward = reward;
      this.lastError = '';
      return reward;
    }
  }

  return {CONFIG, TYPES, typeMultiplier, CLASSES, UNITS, ENEMIES, STAGES, LEVELS,
    levelMultiplier, levelCost, EnergyBank, Battle};
}));
