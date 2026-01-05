export type BodyKind = 'star' | 'moon';

export type BodyId =
  | 'sun'
  | 'moon'
  | 'phobos'
  | 'deimos'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'titan'
  | 'enceladus'
  | 'rhea'
  | 'iapetus'
  | 'miranda'
  | 'ariel'
  | 'umbriel'
  | 'titania'
  | 'oberon'
  | 'triton'
  | 'nereid'
  | 'charon'
  | 'styx'
  | 'nix'
  | 'kerberos'
  | 'hydra';

export interface BodyConfig {
  id: BodyId;
  displayName: string;
  kind: BodyKind;
  horizonsId: string;
}

export const BODIES: BodyConfig[] = [
  { id: 'sun', displayName: 'Soleil', kind: 'star', horizonsId: '10' },

  // Terre
  { id: 'moon', displayName: 'Lune', kind: 'moon', horizonsId: '301' },

  // Mars
  { id: 'phobos', displayName: 'Phobos', kind: 'moon', horizonsId: '401' },
  { id: 'deimos', displayName: 'Deimos', kind: 'moon', horizonsId: '402' },

  // Jupiter (Galiléens)
  { id: 'io', displayName: 'Io', kind: 'moon', horizonsId: '501' },
  { id: 'europa', displayName: 'Europe', kind: 'moon', horizonsId: '502' },
  { id: 'ganymede', displayName: 'Ganymède', kind: 'moon', horizonsId: '503' },
  { id: 'callisto', displayName: 'Callisto', kind: 'moon', horizonsId: '504' },

  // Saturne
  { id: 'enceladus', displayName: 'Encelade', kind: 'moon', horizonsId: '602' },
  { id: 'rhea', displayName: 'Rhéa', kind: 'moon', horizonsId: '605' },
  { id: 'titan', displayName: 'Titan', kind: 'moon', horizonsId: '606' },
  { id: 'iapetus', displayName: 'Japet', kind: 'moon', horizonsId: '608' },

  // Uranus
  { id: 'ariel', displayName: 'Ariel', kind: 'moon', horizonsId: '701' },
  { id: 'umbriel', displayName: 'Umbriel', kind: 'moon', horizonsId: '702' },
  { id: 'titania', displayName: 'Titania', kind: 'moon', horizonsId: '703' },
  { id: 'oberon', displayName: 'Oberon', kind: 'moon', horizonsId: '704' },
  { id: 'miranda', displayName: 'Miranda', kind: 'moon', horizonsId: '705' },

  // Neptune
  { id: 'triton', displayName: 'Triton', kind: 'moon', horizonsId: '801' },
  { id: 'nereid', displayName: 'Néréide', kind: 'moon', horizonsId: '802' },

  // Pluton
  { id: 'charon', displayName: 'Charon', kind: 'moon', horizonsId: '901' },
  { id: 'nix', displayName: 'Nix', kind: 'moon', horizonsId: '902' },
  { id: 'hydra', displayName: 'Hydra', kind: 'moon', horizonsId: '903' },
  { id: 'kerberos', displayName: 'Kerberos', kind: 'moon', horizonsId: '904' },
  { id: 'styx', displayName: 'Styx', kind: 'moon', horizonsId: '905' }
];

export const BODY_BY_ID = new Map<BodyId, BodyConfig>(BODIES.map((b) => [b.id, b]));

