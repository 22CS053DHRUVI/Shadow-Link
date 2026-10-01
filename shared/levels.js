export const CHAPTERS = [
  { id: 1, name: 'The Awakening', range: [1, 5], theme: 'temple' },
  { id: 2, name: 'The Broken Realms', range: [6, 10], theme: 'ruins' },
  { id: 3, name: 'The Rift War', range: [11, 15], theme: 'rift' },
  { id: 4, name: 'The Collapse', range: [16, 20], theme: 'collapse' },
];

export const LEVELS = [
  {
    id: 1, chapter: 1, name: 'Awakening', difficulty: 1, theme: 'temple',
    objectiveType: 'eliminate', objectiveText: 'Defeat the first Rift invaders together.',
    intro: 'Two guardians wake in parallel worlds. Learn to move, attack and protect the link.',
    enemyKinds: ['soldier', 'shade'], enemyCount: 4, targetTime: 120,
    twist: 'Basic combat and movement'
  },
  {
    id: 2, chapter: 1, name: 'Broken Path', difficulty: 1, theme: 'temple',
    objectiveType: 'escape', objectiveText: 'Clear the path, then reach the Rift Gate together.',
    intro: 'The temple path is broken. Fight through the chamber and regroup at the exit.',
    enemyKinds: ['soldier', 'shade'], enemyCount: 5, targetTime: 135,
    twist: 'Co-op exit objective'
  },
  {
    id: 3, chapter: 1, name: 'Spirit Shield', difficulty: 2, theme: 'temple',
    objectiveType: 'linked', objectiveText: 'Shadow breaks Spirit Shields; Light finishes the Wardens.',
    intro: 'Some enemies exist in both worlds. Their spirit shell must fall before their body can be hurt.',
    enemyKinds: ['linked-warden'], enemyCount: 3, targetTime: 150,
    twist: 'Linked enemy shields'
  },
  {
    id: 4, chapter: 1, name: 'Rift Traps', difficulty: 2, theme: 'temple',
    objectiveType: 'hazard', objectiveText: 'Defeat the guards while avoiding dimensional hazard zones.',
    intro: 'The floor itself is unstable. Watch the warning rings and keep moving.',
    enemyKinds: ['soldier', 'shade', 'archer'], enemyCount: 7, targetTime: 165,
    hazards: 4, twist: 'Dimension hazards'
  },
  {
    id: 5, chapter: 1, name: 'Guardian of the Gate', difficulty: 2, theme: 'temple',
    objectiveType: 'boss', objectiveText: 'Break the Guardian shield and defeat the first boss.',
    intro: 'The ancient Guardian blocks the way. Break its spirit armor, then strike together.',
    enemyKinds: ['temple-guardian'], enemyCount: 1, bossHp: 520, targetTime: 210,
    twist: 'First multi-role boss'
  },
  {
    id: 6, chapter: 2, name: 'Split Arena', difficulty: 2, theme: 'ruins',
    objectiveType: 'eliminate', objectiveText: 'Clear both halves of the arena.',
    intro: 'The city has split into two combat lanes. Each guardian must hold their side.',
    enemyKinds: ['soldier', 'shade', 'brute'], enemyCount: 9, targetTime: 180,
    twist: 'Heavier enemy mix'
  },
  {
    id: 7, chapter: 2, name: 'Swarm Night', difficulty: 3, theme: 'ruins',
    objectiveType: 'survive', objectiveText: 'Survive the Rift swarm for 75 seconds.',
    intro: 'The portals will not stop. Stay mobile and use Link Burst when the arena fills.',
    enemyKinds: ['crawler', 'shade', 'soldier'], enemyCount: 12, surviveSeconds: 75, targetTime: 90,
    twist: 'Timed survival'
  },
  {
    id: 8, chapter: 2, name: 'Energy Core', difficulty: 3, theme: 'ruins',
    objectiveType: 'eliminate', objectiveText: 'Destroy the attackers before the core destabilizes.',
    intro: 'A fractured energy core powers the escape route. Keep the battlefield under control.',
    enemyKinds: ['soldier', 'shade', 'archer', 'brute'], enemyCount: 13, targetTime: 190,
    twist: 'Dense defense-style combat'
  },
  {
    id: 9, chapter: 2, name: 'Shadow Chase', difficulty: 3, theme: 'ruins',
    objectiveType: 'escape', objectiveText: 'Defeat the Hunters and reach the extraction gate.',
    intro: 'Rift Hunters have your signal. Fight while moving and do not get cornered.',
    enemyKinds: ['hunter', 'crawler', 'shade'], enemyCount: 10, targetTime: 175,
    twist: 'Fast pursuit enemies'
  },
  {
    id: 10, chapter: 2, name: 'Twin Beast', difficulty: 3, theme: 'ruins',
    objectiveType: 'boss', objectiveText: 'Defeat the Twin Beast across both dimensions.',
    intro: 'One monster. Two forms. Break the soul armor and punish the physical body.',
    enemyKinds: ['twin-beast'], enemyCount: 1, bossHp: 760, targetTime: 240,
    twist: 'Chapter boss'
  },
  {
    id: 11, chapter: 3, name: 'World Shift', difficulty: 3, theme: 'rift',
    objectiveType: 'eliminate', objectiveText: 'Fight through the shifting Rift formation.',
    intro: 'Reality is losing its shape. The arena pulses as new threats arrive.',
    enemyKinds: ['soldier', 'shade', 'hunter', 'brute'], enemyCount: 14, targetTime: 195,
    twist: 'Shifting visual arena'
  },
  {
    id: 12, chapter: 3, name: 'Mirror Battle', difficulty: 3, theme: 'rift',
    objectiveType: 'linked', objectiveText: 'Break mirrored shields and eliminate the echoes.',
    intro: 'The Rift has learned your combat pattern. Linked echoes now fight as pairs.',
    enemyKinds: ['linked-warden', 'mirror'], enemyCount: 8, targetTime: 205,
    twist: 'Linked echo enemies'
  },
  {
    id: 13, chapter: 3, name: 'Collapse Zone', difficulty: 4, theme: 'rift',
    objectiveType: 'hazard', objectiveText: 'Stay out of collapse zones and clear the arena.',
    intro: 'Safe ground is disappearing. Watch the floor and keep pressure on the enemy.',
    enemyKinds: ['crawler', 'hunter', 'archer', 'brute'], enemyCount: 15, hazards: 7, targetTime: 205,
    twist: 'More hazards and faster enemies'
  },
  {
    id: 14, chapter: 3, name: 'Darkness Pulse', difficulty: 4, theme: 'rift',
    objectiveType: 'survive', objectiveText: 'Survive 90 seconds through alternating darkness pulses.',
    intro: 'Vision will fade in waves. Trust your partner and fight by the glow of the link.',
    enemyKinds: ['shade', 'hunter', 'linked-warden'], enemyCount: 14, surviveSeconds: 90, targetTime: 105,
    darknessPulse: true, twist: 'Alternating visibility'
  },
  {
    id: 15, chapter: 3, name: 'Rift Warden', difficulty: 4, theme: 'rift',
    objectiveType: 'boss', objectiveText: 'Defeat the Warden before the Rift consumes the arena.',
    intro: 'The Warden controls the breach. Its shield alternates between Light and Shadow.',
    enemyKinds: ['rift-warden'], enemyCount: 1, bossHp: 1050, hazards: 4, targetTime: 270,
    twist: 'Three-stage boss pressure'
  },
  {
    id: 16, chapter: 4, name: 'Double Ambush', difficulty: 4, theme: 'collapse',
    objectiveType: 'linked', objectiveText: 'Destroy both elite linked squads.',
    intro: 'The dimensions are overlapping. Two elite squads attack at once.',
    enemyKinds: ['linked-warden', 'hunter', 'brute'], enemyCount: 12, targetTime: 215,
    twist: 'Multiple elite targets'
  },
  {
    id: 17, chapter: 4, name: 'Final Escape', difficulty: 4, theme: 'collapse',
    objectiveType: 'timed-escape', objectiveText: 'Clear the route and reach extraction before time expires.',
    intro: 'The structure is falling apart. Move fast—there will not be another exit.',
    enemyKinds: ['crawler', 'hunter', 'soldier'], enemyCount: 14, timeLimit: 150, targetTime: 150,
    twist: 'Hard countdown'
  },
  {
    id: 18, chapter: 4, name: 'Spirit Storm', difficulty: 4, theme: 'collapse',
    objectiveType: 'hazard', objectiveText: 'Destroy the storm guard while the arena erupts around you.',
    intro: 'Rift lightning is tearing through both worlds. Keep moving between safe pockets.',
    enemyKinds: ['shade', 'archer', 'hunter', 'linked-warden'], enemyCount: 18, hazards: 9, targetTime: 225,
    twist: 'High-density hazards'
  },
  {
    id: 19, chapter: 4, name: 'Broken Dimensions', difficulty: 5, theme: 'collapse',
    objectiveType: 'linked', objectiveText: 'Master both dimensions and eliminate the final elite force.',
    intro: 'Light and Shadow are almost indistinguishable now. Every role mechanic is tested at once.',
    enemyKinds: ['mirror', 'linked-warden', 'hunter', 'brute'], enemyCount: 16, darknessPulse: true, targetTime: 235,
    twist: 'Mixed endgame mechanics'
  },
  {
    id: 20, chapter: 4, name: 'The Twin King', difficulty: 5, theme: 'collapse',
    objectiveType: 'boss', objectiveText: 'Defeat the Twin King and unleash the Final Link.',
    intro: 'The source of the collapse waits beyond the breach. End the war together.',
    enemyKinds: ['twin-king'], enemyCount: 1, bossHp: 1600, hazards: 6, targetTime: 330,
    twist: 'Final boss'
  },
];

export function getLevel(id) {
  const numeric = Number(id);
  return LEVELS.find((level) => level.id === numeric) || LEVELS[0];
}

export function getChapter(id) {
  return CHAPTERS.find((chapter) => chapter.id === Number(id)) || CHAPTERS[0];
}
