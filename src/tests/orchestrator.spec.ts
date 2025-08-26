import { describe, it, expect } from 'vitest';
import { compileGraph } from '../orchestrator/compiler.js';

describe('compiler', () => {
  it('validates outputs_schema presence', () => {
    const g: any = { steps: { a: { step_id: 'a', executor:'intelligent', goal:'', inputs:{required:[]}, outputs_schema:{ x:'string' }, determinism:'low' } }, edges: [] };
    const out = compileGraph(g);
    expect(out).toBeTruthy();
  });
});
