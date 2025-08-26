import { describe, it, expect } from 'vitest';
import { renderMetaprompt } from '../prompt/renderer.js';
import { createBlackboard } from '../blackboard/index.js';

describe('renderer', () => {
  it('injects inputs and schema', () => {
    const bb = createBlackboard();
    const msgs = renderMetaprompt({
      step_id: 's1',
      executor: 'intelligent',
      goal: 'do it',
      inputs: { required: [], optional: [] },
      outputs_schema: { result: 'string' },
      determinism: 'low'
    }, bb);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });
});
