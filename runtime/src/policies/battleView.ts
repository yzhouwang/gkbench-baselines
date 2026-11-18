// The bridge resolves native card instances and emits a battle view before calling a policy.
export interface Observation {
  phase: "battle";
  decision: { battle: Record<string, any> };
}

export interface LegalAction {
  id: string;
  action: { kind: string; card?: string; drink?: string; index?: number };
}
