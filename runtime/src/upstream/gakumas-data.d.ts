// The upstream JavaScript package exposes these collections without TypeScript declarations.
declare module "gakumas-data" {
  export const SkillCards: any;
  export const PItems: any;
  export const PDrinks: any;
  export function deserializeEffectSequence(source: string): any[];
}
