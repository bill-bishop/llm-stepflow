export interface Budget {
  tokens?: number;
  calls?: number;
  wall_time_s?: number;
}

export interface BudgetState {
  tokens_used: number;
  calls_used: number;
  started_at: number;
}

export function initBudget(): BudgetState {
  return { tokens_used: 0, calls_used: 0, started_at: Date.now() };
}

export function canUseCall(budget: Budget | undefined, state: BudgetState): boolean {
  if (!budget?.calls) return true;
  return state.calls_used < budget.calls;
}
